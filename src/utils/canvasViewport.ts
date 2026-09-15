import type { CanvasTransform } from '../hooks/useCanvasInteraction';

export const CANVAS_VIEWPORTS_KEY = 'spoor_canvas_viewports';

const DEFAULT_TRANSFORM: CanvasTransform = { x: 0, y: 0, scale: 1 };

function isValidTransform(value: unknown): value is CanvasTransform {
  if (!value || typeof value !== 'object') return false;
  const t = value as Partial<CanvasTransform>;
  return (
    typeof t.x === 'number' &&
    Number.isFinite(t.x) &&
    typeof t.y === 'number' &&
    Number.isFinite(t.y) &&
    typeof t.scale === 'number' &&
    Number.isFinite(t.scale) &&
    t.scale > 0
  );
}

function readAll(): Record<string, CanvasTransform> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(CANVAS_VIEWPORTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, CanvasTransform> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (isValidTransform(value)) {
        out[id] = {
          x: value.x,
          y: value.y,
          scale: Math.min(5, Math.max(0.1, value.scale)),
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function loadCanvasViewport(canvasId: string): CanvasTransform {
  const all = readAll();
  return all[canvasId] ? { ...all[canvasId] } : { ...DEFAULT_TRANSFORM };
}

export function saveCanvasViewport(canvasId: string, transform: CanvasTransform): void {
  if (typeof localStorage === 'undefined' || !canvasId) return;
  try {
    const all = readAll();
    all[canvasId] = {
      x: transform.x,
      y: transform.y,
      scale: Math.min(5, Math.max(0.1, transform.scale)),
    };
    localStorage.setItem(CANVAS_VIEWPORTS_KEY, JSON.stringify(all));
  } catch {
    // ignore quota / private mode
  }
}

/** Pan/zoom so axis-aligned world rects fit inside the viewport with padding. */
export function transformToFitRects(
  rects: { x: number; y: number; width: number; height: number }[],
  viewport: { width: number; height: number },
  padding = 96,
): CanvasTransform {
  if (rects.length === 0 || viewport.width <= 0 || viewport.height <= 0) {
    return { ...DEFAULT_TRANSFORM };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }

  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  const scale = Math.min(
    5,
    Math.max(
      0.1,
      Math.min((viewport.width - padding * 2) / bw, (viewport.height - padding * 2) / bh),
    ),
  );
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return {
    scale,
    x: viewport.width / 2 - cx * scale,
    y: viewport.height / 2 - cy * scale,
  };
}

/** Pan/zoom so every card's bbox fits inside the viewport with padding. */
export function transformToFitNodes(
  nodes: { x: number; y: number; width?: number; height?: number }[],
  viewport: { width: number; height: number },
  padding = 96,
): CanvasTransform {
  if (nodes.length === 0) return { ...DEFAULT_TRANSFORM };
  const rects = nodes.map((n) => {
    const w = n.width && n.width > 0 ? n.width : 320;
    const h = n.height && n.height > 0 ? n.height : 200;
    return { x: n.x, y: n.y, width: w, height: h };
  });
  return transformToFitRects(rects, viewport, padding);
}
