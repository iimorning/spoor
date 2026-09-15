import type { CanvasRect } from './canvas';

export type MarqueeTransform = { x: number; y: number; scale: number };

/** How close to a viewport edge starts auto-panning during marquee. */
export const MARQUEE_EDGE_MARGIN_PX = 48;

/** Peak pan speed when the pointer is on/past the viewport edge. */
export const MARQUEE_EDGE_MAX_SPEED_PX_PER_MS = 1.15;

export function clientToWorld(
  clientX: number,
  clientY: number,
  viewportLeft: number,
  viewportTop: number,
  transform: MarqueeTransform,
): { x: number; y: number } {
  const scale = transform.scale || 1;
  return {
    x: (clientX - viewportLeft - transform.x) / scale,
    y: (clientY - viewportTop - transform.y) / scale,
  };
}

/** Viewport-local screen point (origin = canvas host top-left). */
export function worldToViewport(
  worldX: number,
  worldY: number,
  transform: MarqueeTransform,
): { x: number; y: number } {
  return {
    x: worldX * transform.scale + transform.x,
    y: worldY * transform.scale + transform.y,
  };
}

/**
 * Marquee overlay in viewport coordinates. The drag origin stays in world
 * space so edge-panning grows the box instead of sliding it with the camera.
 */
export function marqueeScreenRect(args: {
  startWorldX: number;
  startWorldY: number;
  clientX: number;
  clientY: number;
  viewportLeft: number;
  viewportTop: number;
  transform: MarqueeTransform;
}): CanvasRect {
  const start = worldToViewport(args.startWorldX, args.startWorldY, args.transform);
  const endX = args.clientX - args.viewportLeft;
  const endY = args.clientY - args.viewportTop;
  return {
    x: Math.min(start.x, endX),
    y: Math.min(start.y, endY),
    width: Math.abs(endX - start.x),
    height: Math.abs(endY - start.y),
  };
}

function edgePush(pos: number, size: number, margin: number): number {
  if (size <= 0 || margin <= 0) return 0;
  if (pos < margin) {
    return 1 - Math.max(0, pos) / margin;
  }
  if (pos > size - margin) {
    return -(1 - Math.max(0, size - pos) / margin);
  }
  return 0;
}

export function isNearMarqueeEdge(
  localX: number,
  localY: number,
  width: number,
  height: number,
  margin = MARQUEE_EDGE_MARGIN_PX,
): boolean {
  return localX < margin || localY < margin || localX > width - margin || localY > height - margin;
}

/**
 * Delta to apply to the canvas transform this frame.
 * Pointer on the top/left edge increases x/y so content slides toward the
 * pointer, revealing cards that were off-screen.
 */
export function marqueeEdgePanDelta(args: {
  localX: number;
  localY: number;
  width: number;
  height: number;
  dtMs: number;
  margin?: number;
  maxSpeed?: number;
}): { x: number; y: number } {
  const margin = args.margin ?? MARQUEE_EDGE_MARGIN_PX;
  const maxSpeed = args.maxSpeed ?? MARQUEE_EDGE_MAX_SPEED_PX_PER_MS;
  const dt = Math.max(0, args.dtMs);
  const speed = maxSpeed * dt;
  return {
    x: edgePush(args.localX, args.width, margin) * speed,
    y: edgePush(args.localY, args.height, margin) * speed,
  };
}
