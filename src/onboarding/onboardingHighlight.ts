import type { CanvasNode, CanvasWorkZone } from '../db';
import type { CanvasTransform } from '../hooks/useCanvasInteraction';
import { estimateNodeRect } from '../utils/canvas';
import { transformToFitRects } from '../utils/canvasViewport';
import { isNodeInWorkZone } from '../utils/workZoneGeometry';
import {
  onboardingOutsideMaterialNodes,
} from '../utils/onboardingWorkroomLayout';
import type { OnboardingStep } from './useOnboarding';

export type OnboardingHighlightMode =
  | 'work-zone'
  | 'work-zone-and-outside'
  | 'outside-material-handle'
  | 'chat-reply-drag-handle';

export function worldRectToClientRect(
  rect: { x: number; y: number; width: number; height: number },
  transform: CanvasTransform,
  host: HTMLElement,
): DOMRect {
  const hostRect = host.getBoundingClientRect();
  const left = hostRect.left + transform.x + rect.x * transform.scale;
  const top = hostRect.top + transform.y + rect.y * transform.scale;
  const width = rect.width * transform.scale;
  const height = rect.height * transform.scale;
  return new DOMRect(left, top, width, height);
}

export function unionClientRects(a: DOMRect, b: DOMRect): DOMRect {
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  const right = Math.max(a.right, b.right);
  const bottom = Math.max(a.bottom, b.bottom);
  return new DOMRect(left, top, right - left, bottom - top);
}

export function resolveOutsideMaterialsClientRect(
  ctx: {
    host: HTMLElement | null;
    transform: CanvasTransform;
    workZone: CanvasWorkZone | null;
    nodes: CanvasNode[];
  },
): DOMRect | null {
  if (!ctx.host || !ctx.workZone) return null;

  let union: DOMRect | null = null;
  for (const node of onboardingOutsideMaterialNodes(ctx.nodes)) {
    if (isNodeInWorkZone(node, ctx.workZone)) continue;
    const client = worldRectToClientRect(estimateNodeRect(node), ctx.transform, ctx.host);
    union = union ? unionClientRects(union, client) : client;
  }
  return union;
}

export function resolveOnboardingTooltipAnchorRect(
  step: OnboardingStep,
  ctx: {
    host: HTMLElement | null;
    transform: CanvasTransform;
    workZone: CanvasWorkZone | null;
    nodes: CanvasNode[];
  },
): DOMRect | null {
  if (step.tooltipAnchor === 'outside-materials') {
    return resolveOutsideMaterialsClientRect(ctx);
  }
  return resolveOnboardingHighlightRect(step, ctx);
}

export function resolveOnboardingHighlightRects(
  step: OnboardingStep,
  ctx: {
    host: HTMLElement | null;
    transform: CanvasTransform;
    workZone: CanvasWorkZone | null;
    nodes: CanvasNode[];
    nodesRef?: { current: Record<string, HTMLElement | null> };
  },
): DOMRect[] {
  if (!step.highlight) return [];

  if (step.highlight === 'chat-reply-drag-handle') {
    const handle = resolveChatReplyDragHandleClientRect();
    return handle ? [handle] : [];
  }

  if (!ctx.host || !ctx.workZone) return [];

  if (step.highlight === 'work-zone-and-outside') {
    const zoneRect = worldRectToClientRect(ctx.workZone, ctx.transform, ctx.host);
    const materialsRect = resolveOutsideMaterialsClientRect(ctx);
    return materialsRect ? [zoneRect, materialsRect] : [zoneRect];
  }

  const single = resolveOnboardingHighlightRect(step, ctx);
  return single ? [single] : [];
}

export function resolveOnboardingDragArrowRects(
  ctx: {
    host: HTMLElement | null;
    transform: CanvasTransform;
    workZone: CanvasWorkZone | null;
    nodes: CanvasNode[];
  },
): { from: DOMRect; to: DOMRect } | null {
  if (!ctx.host || !ctx.workZone) return null;
  const materials = resolveOutsideMaterialsClientRect(ctx);
  if (!materials) return null;
  const room = worldRectToClientRect(ctx.workZone, ctx.transform, ctx.host);
  return { from: materials, to: room };
}

export function resolveOnboardingHighlightRect(
  step: OnboardingStep,
  ctx: {
    host: HTMLElement | null;
    transform: CanvasTransform;
    workZone: CanvasWorkZone | null;
    nodes: CanvasNode[];
    nodesRef?: { current: Record<string, HTMLElement | null> };
  },
): DOMRect | null {
  const mode = step.highlight;
  if (!mode) return null;

  if (mode === 'chat-reply-drag-handle') {
    return resolveChatReplyDragHandleClientRect();
  }

  if (!ctx.host || !ctx.workZone) return null;

  if (mode === 'outside-material-handle') {
    return resolveOutsideMaterialDragHandleClientRect(ctx);
  }

  const zoneRect = worldRectToClientRect(ctx.workZone, ctx.transform, ctx.host);
  if (mode === 'work-zone') return zoneRect;

  let union = zoneRect;
  for (const node of onboardingOutsideMaterialNodes(ctx.nodes)) {
    if (isNodeInWorkZone(node, ctx.workZone)) continue;
    const client = worldRectToClientRect(estimateNodeRect(node), ctx.transform, ctx.host);
    union = unionClientRects(union, client);
  }
  return union;
}

function inflateClientRect(rect: DOMRect, padding: number): DOMRect {
  return new DOMRect(
    rect.left - padding,
    rect.top - padding,
    rect.width + padding * 2,
    rect.height + padding * 2,
  );
}

export function resolveChatReplyDragHandleClientRect(): DOMRect | null {
  const panel = document.querySelector('[data-testid="canvas-chat-panel"]');
  if (!panel) return null;
  const handles = panel.querySelectorAll('[data-testid="chat-reply-drag-handle"]');
  const handle = handles[handles.length - 1] as HTMLElement | null;
  if (!handle) return null;
  return inflateClientRect(handle.getBoundingClientRect(), 8);
}

export function resolveOutsideMaterialDragHandleClientRect(
  ctx: {
    host: HTMLElement | null;
    transform: CanvasTransform;
    workZone: CanvasWorkZone | null;
    nodes: CanvasNode[];
    nodesRef?: { current: Record<string, HTMLElement | null> };
  },
): DOMRect | null {
  if (!ctx.host || !ctx.workZone) return null;

  const outside = onboardingOutsideMaterialNodes(ctx.nodes).filter(
    (node) => !isNodeInWorkZone(node, ctx.workZone!),
  );
  if (outside.length === 0) return null;

  for (const node of outside) {
    const root = ctx.nodesRef?.current?.[node.id];
    const handle = root?.querySelector('[data-testid="node-drag-handle"]') as HTMLElement | null;
    if (handle) return inflateClientRect(handle.getBoundingClientRect(), 6);
  }

  const fallback = worldRectToClientRect(estimateNodeRect(outside[0]!), ctx.transform, ctx.host);
  const handleSize = 16 * ctx.transform.scale;
  return new DOMRect(
    fallback.left + 6 * ctx.transform.scale,
    fallback.top + 6 * ctx.transform.scale,
    handleSize,
    handleSize,
  );
}

export function transformToFitOnboardingStep(
  step: OnboardingStep,
  ctx: {
    workZone: CanvasWorkZone | null;
    nodes: CanvasNode[];
    viewport: { width: number; height: number };
  },
): CanvasTransform | null {
  if (!ctx.workZone || !step.highlight) return null;

  const rects: { x: number; y: number; width: number; height: number }[] = [ctx.workZone];
  if (step.highlight === 'work-zone-and-outside' || step.highlight === 'outside-material-handle') {
    for (const node of onboardingOutsideMaterialNodes(ctx.nodes)) {
      if (isNodeInWorkZone(node, ctx.workZone)) continue;
      rects.push(estimateNodeRect(node));
    }
  }

  return transformToFitRects(rects, ctx.viewport, step.highlight === 'work-zone' ? 120 : 96);
}
