import { useState, useRef, useEffect, useLayoutEffect, type RefObject } from 'react';
import { CANVAS_OVERLAY_ATTR, CANVAS_EDIT_LOCK_ATTR } from '../utils/canvasOverlay';
import {
  createNestedScrollChainLatch,
  decideNestedScrollChain,
  wheelOverflowDirection,
} from '../utils/nestedScrollChain';
import { loadCanvasViewport, saveCanvasViewport } from '../utils/canvasViewport';
import { readNodeDragOffset } from '../utils/nodeDragVisual';
import { edgeLineNeedsWrite, edgeVisibleSegmentAnchor, writeSvgLineGeom } from '../utils/edgeGeometry';
import { placeLinkNoteGhost } from '../utils/linkNoteGhost';

export interface CanvasTransform {
  x: number;
  y: number;
  scale: number;
}

/** Debounce React commit after wheel nudge so toolbar/node scale catch up without per-tick re-renders. */
const WHEEL_COMMIT_MS = 100;

function formatViewportTransform(t: CanvasTransform): string {
  return `translate(${t.x}px, ${t.y}px) scale(${t.scale})`;
}

/**
 * Layout (world) center of a node relative to the transformed canvas container.
 * Uses offsetLeft/Top/Width/Height so parent CSS scale cannot inject subpixel
 * jitter the way getBoundingClientRect → ÷ scale does during zoom.
 */
function getNodeLayoutBox(el: HTMLElement, container: HTMLElement) {
  let left = 0;
  let top = 0;
  let cur: HTMLElement | null = el;
  while (cur && cur !== container) {
    left += cur.offsetLeft;
    top += cur.offsetTop;
    cur = cur.offsetParent as HTMLElement | null;
  }
  // Drag uses CSS translate vars (not left/top); fold that into edge endpoints.
  const drag = readNodeDragOffset(el);
  left += drag.x;
  top += drag.y;
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  return {
    left,
    top,
    width,
    height,
    centerX: left + width / 2,
    centerY: top + height / 2,
    right: left + width,
  };
}

export function useCanvasInteraction(
  mainRef: RefObject<HTMLDivElement | null>,
  contentContainerRef: RefObject<HTMLDivElement | null>,
  svgRef: RefObject<SVGSVGElement | null>,
  edgeLabelsRef: RefObject<HTMLDivElement | null>,
  nodesRef: RefObject<Record<string, HTMLElement | null>>,
  connectingFrom: string | null,
  setConnectingFrom: (v: string | null) => void,
  canvasId: string = 'default',
  /**
   * When the canvas host unmounts (e.g. leaving the Personal tab), pass false then
   * true on return so the non-passive wheel listener is re-bound to the new DOM node.
   * Otherwise Ctrl+wheel falls through to the browser and zooms the whole UI.
   */
  enabled: boolean = true,
  /** Link-mode note ghost: positioned on the edge rAF path (no React per pointermove). */
  linkGhostRef?: RefObject<HTMLDivElement | null>,
) {
  const [canvasTransform, setCanvasTransformState] = useState<CanvasTransform>(() =>
    loadCanvasViewport(canvasId),
  );
  const transformRef = useRef<CanvasTransform>(canvasTransform);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const wheelCommitTimerRef = useRef<number | null>(null);

  const applyTransformToDom = (t: CanvasTransform) => {
    const el = contentContainerRef.current;
    if (el) {
      el.style.transform = formatViewportTransform(t);
    }
  };

  const clearWheelCommitTimer = () => {
    if (wheelCommitTimerRef.current != null) {
      window.clearTimeout(wheelCommitTimerRef.current);
      wheelCommitTimerRef.current = null;
    }
  };

  /** Hot path: update ref + DOM only (no React re-render). */
  const nudgeTransform = (next: CanvasTransform) => {
    transformRef.current = next;
    applyTransformToDom(next);
  };

  /** Commit ref + DOM + React state (toolbar zoom %, node scale prop, persist). */
  const commitTransform = (next: CanvasTransform) => {
    clearWheelCommitTimer();
    transformRef.current = next;
    applyTransformToDom(next);
    setCanvasTransformState(next);
  };

  // Keep transformRef in lockstep with state (including inside the updater) so
  // edge math never reads a one-frame-stale scale during zoom/pan.
  const setCanvasTransform = (
    update: CanvasTransform | ((prev: CanvasTransform) => CanvasTransform),
  ) => {
    const prev = transformRef.current;
    const next = typeof update === 'function' ? update(prev) : update;
    commitTransform(next);
  };

  const scheduleWheelCommit = () => {
    clearWheelCommitTimer();
    wheelCommitTimerRef.current = window.setTimeout(() => {
      wheelCommitTimerRef.current = null;
      setCanvasTransformState(transformRef.current);
    }, WHEEL_COMMIT_MS);
  };

  // Sync DOM when React state commits (fit/focus, canvas switch, wheel debounce).
  // Does not run on unrelated App re-renders — critical so pan/zoom nudges are not overwritten.
  useLayoutEffect(() => {
    applyTransformToDom(canvasTransform);
  }, [canvasTransform]);

  // Leaving archive/agents unmounts the canvas host. React transform state
  // often does not change, so the effect above would not write CSS onto the
  // new element — restore from the live ref, and flush persist so a pending
  // wheel debounce cannot lose the viewport.
  useLayoutEffect(() => {
    if (!enabled) {
      const current = transformRef.current;
      saveCanvasViewport(canvasId, current);
      setCanvasTransformState((prev) =>
        prev.x === current.x && prev.y === current.y && prev.scale === current.scale
          ? prev
          : current,
      );
      return;
    }
    applyTransformToDom(transformRef.current);
  }, [enabled, canvasId]);

  // Restore per-canvas viewport when switching canvases; flush previous on change/unmount.
  useEffect(() => {
    const loaded = loadCanvasViewport(canvasId);
    setCanvasTransform(loaded);
    return () => {
      saveCanvasViewport(canvasId, transformRef.current);
    };
  }, [canvasId]);

  // Debounced persist while panning / zooming.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveCanvasViewport(canvasId, canvasTransform);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [canvasId, canvasTransform]);

  useEffect(() => {
    const flush = () => saveCanvasViewport(canvasId, transformRef.current);
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      flush();
      clearWheelCommitTimer();
    };
  }, [canvasId]);

  // Track mouse position
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mousePosRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Wheel zoom & scroll — Ctrl+zoom is on window capture so it survives the
  // canvas <main> remounting (essay fullscreen) without flipping `enabled`.
  // Otherwise Ctrl+wheel becomes browser page zoom (toolbar, chrome, everything).
  useEffect(() => {
    if (!enabled) return;
    const nestedScrollLatch = createNestedScrollChainLatch();

    const applyCanvasZoom = (e: WheelEvent, host: HTMLElement) => {
      const prev = transformRef.current;
      const zoomBase = 1.05;
      const factor = e.deltaY < 0 ? zoomBase : 1 / zoomBase;
      const newScale = Math.min(Math.max(0.1, prev.scale * factor), 5);
      const mainRect = host.getBoundingClientRect();
      const clientX = e.clientX - mainRect.left;
      const clientY = e.clientY - mainRect.top;
      const mouseXInCanvas = (clientX - prev.x) / prev.scale;
      const mouseYInCanvas = (clientY - prev.y) / prev.scale;
      nudgeTransform({
        x: clientX - mouseXInCanvas * newScale,
        y: clientY - mouseYInCanvas * newScale,
        scale: newScale,
      });
      scheduleWheelCommit();
    };

    const onWindowCtrlZoom = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const host = mainRef.current;
      if (!host) return;
      const target = e.target;
      if (target instanceof Node && !host.contains(target)) return;
      e.preventDefault();
      e.stopPropagation();
      applyCanvasZoom(e, host);
    };
    window.addEventListener('wheel', onWindowCtrlZoom, { passive: false, capture: true });

    const main = mainRef.current;
    if (!main) {
      return () => window.removeEventListener('wheel', onWindowCtrlZoom, { capture: true });
    }

    const onWheel = (e: WheelEvent) => {
      // 缩放手势由 window capture 处理；这里只做普通滚轮平移
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        applyCanvasZoom(e, main);
        return;
      }
      // 编辑锁标记（data-canvas-edit-lock）：滚轮事件始终留在容器内，
      // 不让画布在边界处接管平移——避免编辑时滚到底突然开始拖动画布。
      let editProbe: HTMLElement | null = e.target as HTMLElement;
      if (editProbe && editProbe.nodeType !== Node.ELEMENT_NODE) {
        editProbe = editProbe.parentElement;
      }
      while (editProbe && main.contains(editProbe) && editProbe !== main) {
        if (editProbe.hasAttribute(CANVAS_EDIT_LOCK_ATTR)) {
          return;
        }
        editProbe = editProbe.parentElement;
      }
      let node: HTMLElement | null = e.target as HTMLElement;
      if (node && node.nodeType !== Node.ELEMENT_NODE) {
        node = node.parentElement;
      }
      let overlayProbe: HTMLElement | null = node;
      while (overlayProbe && main.contains(overlayProbe) && overlayProbe !== main) {
        if (overlayProbe.hasAttribute(CANVAS_OVERLAY_ATTR)) {
          return;
        }
        overlayProbe = overlayProbe.parentElement;
      }
      while (node && main.contains(node) && node !== main) {
        const { overflowY } = window.getComputedStyle(node);
        const canScrollY =
          (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
          node.scrollHeight > node.clientHeight;
        if (canScrollY) {
          const direction = wheelOverflowDirection(e.deltaY);
          const atTop = node.scrollTop <= 0;
          const atBottom = node.scrollTop + node.clientHeight >= node.scrollHeight - 1;
          if (direction === 0) {
            break;
          }
          const canScrollInner =
            (direction < 0 && !atTop) || (direction > 0 && !atBottom);
          const action = decideNestedScrollChain(nestedScrollLatch, {
            now: performance.now(),
            direction,
            canScrollInner,
          });
          if (action === 'inner') {
            return;
          }
          if (action === 'absorb') {
            e.preventDefault();
            return;
          }
          // 第二次溢出才让画布平移；避免看便签时滚到底立刻飞走。
          break;
        }
        node = node.parentElement;
      }

      e.preventDefault();
      const prev = transformRef.current;
      nudgeTransform({
        ...prev,
        x: prev.x - e.deltaX,
        y: prev.y - e.deltaY,
      });
      scheduleWheelCommit();
    };
    main.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      window.removeEventListener('wheel', onWindowCtrlZoom, { capture: true });
      main.removeEventListener('wheel', onWheel);
    };
  }, [mainRef, enabled]);

  // Two-finger pinch zoom on touch devices — `wheel + ctrlKey` is the macOS
  // trackpad path but real finger pinch fires as `touch*` events only. We use
  // the mid-point of the two fingers as the zoom anchor so the canvas content
  // under the gesture stays under the fingers, matching how Ctrl+wheel zoom
  // behaves on desktop. Single-finger pan is already covered by pointerdown
  // → handlePanStart (Pointer Events fire for touch on every modern browser).
  useEffect(() => {
    if (!enabled) return;
    const main = mainRef.current;
    if (!main) return;
    let pinchStartDistance = 0;
    let pinchStartScale = 1;
    let pinchAnchor: { clientX: number; clientY: number } | null = null;

    const distance = (a: Touch, b: Touch) =>
      Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) {
        pinchStartDistance = 0;
        pinchAnchor = null;
        return;
      }
      pinchStartDistance = distance(e.touches[0], e.touches[1]);
      pinchStartScale = transformRef.current.scale;
      pinchAnchor = {
        clientX: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        clientY: (e.touches[0].clientY + e.touches[1].clientY) / 2,
      };
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || pinchStartDistance === 0 || !pinchAnchor) return;
      // Block the browser's own page zoom while we drive canvas zoom.
      e.preventDefault();
      const current = distance(e.touches[0], e.touches[1]);
      const prev = transformRef.current;
      const factor = current / pinchStartDistance;
      const newScale = Math.min(Math.max(0.1, pinchStartScale * factor), 5);

      const mainRect = main.getBoundingClientRect();
      const anchorX = pinchAnchor.clientX - mainRect.left;
      const anchorY = pinchAnchor.clientY - mainRect.top;
      const anchorCanvasX = (anchorX - prev.x) / prev.scale;
      const anchorCanvasY = (anchorY - prev.y) / prev.scale;
      const newX = anchorX - anchorCanvasX * newScale;
      const newY = anchorY - anchorCanvasY * newScale;

      nudgeTransform({ x: newX, y: newY, scale: newScale });
      scheduleWheelCommit();
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        pinchStartDistance = 0;
        pinchAnchor = null;
      }
    };

    // touchstart/touchend are passive (we only read state). touchmove is
    // non-passive so preventDefault can stop the browser's own page-zoom.
    main.addEventListener('touchstart', onTouchStart, { passive: true });
    main.addEventListener('touchmove', onTouchMove, { passive: false });
    main.addEventListener('touchend', onTouchEnd, { passive: true });
    main.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      main.removeEventListener('touchstart', onTouchStart);
      main.removeEventListener('touchmove', onTouchMove);
      main.removeEventListener('touchend', onTouchEnd);
      main.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [mainRef, enabled]);

  // Pan start handler — DOM nudge on move; React commit on pointerup.
  const handlePanStart = (e: React.PointerEvent) => {
    if (e.target === e.currentTarget || e.button === 1 || e.button === 0) {
      if (connectingFrom) setConnectingFrom(null);
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const startTransform = transformRef.current;

      const onPointerMove = (moveEv: PointerEvent) => {
        nudgeTransform({
          ...startTransform,
          x: startTransform.x + (moveEv.clientX - startX),
          y: startTransform.y + (moveEv.clientY - startY),
        });
      };
      const onPointerUp = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        commitTransform(transformRef.current);
      };
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    }
  };

  // Edge line animation loop
  useEffect(() => {
    let animationFrameId: number;
    // Skip SVG setAttribute / label style writes when geometry is unchanged.
    // Rewriting x1/y1/x2/y2 every frame restarts the CSS dash animation on
    // agent-to-agent edges, which is what makes the flow look stuttery.
    // 缓存里连元素一起记：切画布会把 <line> 换成新元素，只比几何就会漏写（见 edgeLineNeedsWrite）。
    const edgeLineCache = new Map<
      string,
      { geom: { x1: number; y1: number; x2: number; y2: number }; line: SVGLineElement | null }
    >();
    const edgeLabelCache = new Map<string, { mx: number; my: number; noteX: number; noteY: number; labelDeg: number }>();

    const updateLines = () => {
      const svg = svgRef.current;
      const container = contentContainerRef.current;
      const edgeLabelsContainer = edgeLabelsRef.current;

      // Always reschedule: after HMR or strict-mode remount, refs can be null for a frame.
      // Early-return without rAF would permanently stop edge updates until a full reload.
      if (svg && container) {
        const edgeGroups = Array.from(svg.querySelectorAll('g[data-edge-id]')) as SVGGElement[];
        const nodeBoxCache = new Map<string, ReturnType<typeof getNodeLayoutBox>>();
        const boxFor = (id: string, el: HTMLElement) => {
          let box = nodeBoxCache.get(id);
          if (!box) {
            box = getNodeLayoutBox(el, container);
            nodeBoxCache.set(id, box);
          }
          return box;
        };

        edgeGroups.forEach((g: SVGGElement) => {
          const fromId = g.getAttribute('data-edge-from');
          const toId = g.getAttribute('data-edge-to');
          const edgeId = g.getAttribute('data-edge-id');
          if (!fromId || !toId || !edgeId) return;

          const fromNode = nodesRef.current[fromId];
          const toNode = nodesRef.current[toId];
          if (!fromNode || !toNode) return;

          const fromBox = boxFor(fromId, fromNode);
          const toBox = boxFor(toId, toNode);
          const geom = {
            x1: fromBox.centerX,
            y1: fromBox.centerY,
            x2: toBox.centerX,
            y2: toBox.centerY,
          };

          const edgeLines = Array.from(g.querySelectorAll('line')) as SVGLineElement[];
          if (edgeLineNeedsWrite(edgeLineCache.get(edgeId), edgeLines[0] ?? null, geom)) {
            edgeLines.forEach((line) => writeSvgLineGeom(line, geom));
            edgeLineCache.set(edgeId, { geom, line: edgeLines[0] ?? null });
          }

          if (!edgeLabelsContainer) return;

          const note = edgeLabelsContainer.querySelector(`[data-edge-note="${edgeId}"]`) as HTMLElement | null;
          const btn = edgeLabelsContainer.querySelector(`[data-edge-btn="${edgeId}"]`) as HTMLButtonElement | null;
          const badge = edgeLabelsContainer.querySelector(
            `[data-room-link-badge="${edgeId}"]`,
          ) as HTMLElement | null;
          const { x: mx, y: my, angleDeg } = edgeVisibleSegmentAnchor(fromBox, toBox);
          // Keep label readable (never upside-down).
          const labelDeg = angleDeg > 90 || angleDeg < -90 ? angleDeg + 180 : angleDeg;
          const rad = (angleDeg * Math.PI) / 180;
          const noteX = mx + Math.sin(rad) * 20;
          const noteY = my - Math.cos(rad) * 20;
          const label = { mx, my, noteX, noteY, labelDeg };

          const prevLabel = edgeLabelCache.get(edgeId);
          const labelsMatch =
            prevLabel != null &&
            prevLabel.mx === label.mx &&
            prevLabel.my === label.my &&
            prevLabel.noteX === label.noteX &&
            prevLabel.noteY === label.noteY &&
            prevLabel.labelDeg === label.labelDeg;
          // Newly mounted chrome still sits at the JSX placeholder (-100,-100).
          const chromeNeedsInit =
            (note != null && note.style.left === '-100px') ||
            (btn != null && btn.style.left === '-100px') ||
            (badge != null && badge.style.left === '-100px');
          if (labelsMatch && !chromeNeedsInit) return;

          if (note) {
            note.style.left = `${noteX}px`;
            note.style.top = `${noteY}px`;
            note.style.transform = `translate(-50%, -50%) rotate(${labelDeg}deg)`;
          }
          if (btn) {
            btn.style.left = `${mx}px`;
            btn.style.top = `${my}px`;
          }
          // 房间状态线的中点标识：正压在中点上（transform 在 JSX 里已给），
          // 看上去像线上的一颗珠子。
          if (badge) {
            badge.style.left = `${mx}px`;
            badge.style.top = `${my}px`;
          }
          edgeLabelCache.set(edgeId, label);
        });

        if (edgeLineCache.size > edgeGroups.length) {
          const live = new Set(edgeGroups.map((el) => el.getAttribute('data-edge-id') ?? ''));
          for (const cachedId of edgeLineCache.keys()) {
            if (!live.has(cachedId)) edgeLineCache.delete(cachedId);
          }
          for (const cachedId of edgeLabelCache.keys()) {
            if (!live.has(cachedId)) edgeLabelCache.delete(cachedId);
          }
        }

        const tempEdge = svg.querySelector('#temp-edge') as SVGLineElement;
        const connFrom = svg.getAttribute('data-connecting-from');
        if (tempEdge) {
          if (connFrom && nodesRef.current[connFrom]) {
            const fromNode = nodesRef.current[connFrom]!;
            const fromBox = getNodeLayoutBox(fromNode, container);
            // Cursor is screen-space; convert once into the scaled container's world space.
            const containerRect = container.getBoundingClientRect();
            const currentScale = transformRef.current.scale || 1;
            const x1 = fromBox.right;
            const y1 = fromBox.centerY;
            const x2 = (mousePosRef.current.x - containerRect.left) / currentScale;
            const y2 = (mousePosRef.current.y - containerRect.top) / currentScale;

            tempEdge.style.display = 'block';
            tempEdge.setAttribute('x1', x1.toString());
            tempEdge.setAttribute('y1', y1.toString());
            tempEdge.setAttribute('x2', x2.toString());
            tempEdge.setAttribute('y2', y2.toString());
            const ghost = linkGhostRef?.current;
            if (ghost) placeLinkNoteGhost(ghost, x2, y2);
          } else {
            tempEdge.style.display = 'none';
          }
        }
      }

      animationFrameId = requestAnimationFrame(updateLines);
    };
    updateLines();
    return () => cancelAnimationFrame(animationFrameId);
  }, [svgRef, contentContainerRef, edgeLabelsRef, nodesRef, linkGhostRef]);

  return {
    canvasTransform,
    setCanvasTransform,
    transformRef,
    handlePanStart,
    nudgeTransform,
    commitTransform,
    mousePosRef,
  };
}
