/** SVG line endpoints in canvas (world) coordinates. */
export type EdgeLineGeom = { x1: number; y1: number; x2: number; y2: number };

export function edgeLineGeomEqual(a: EdgeLineGeom | undefined, b: EdgeLineGeom): boolean {
  return a != null && a.x1 === b.x1 && a.y1 === b.y1 && a.x2 === b.x2 && a.y2 === b.y2;
}

export function writeSvgLineGeom(line: SVGLineElement, geom: EdgeLineGeom): void {
  line.setAttribute('x1', String(geom.x1));
  line.setAttribute('y1', String(geom.y1));
  line.setAttribute('x2', String(geom.x2));
  line.setAttribute('y2', String(geom.y2));
}

/** Axis-aligned box in canvas (world) coordinates. */
export type EdgeLayoutBox = {
  left: number;
  top: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
};

/**
 * Smallest t ∈ (0, 1] where the ray from `box` center toward `(x2, y2)` exits the AABB.
 * Centers are assumed inside the box.
 */
export function exitParamFromCenter(box: EdgeLayoutBox, x2: number, y2: number): number {
  const x1 = box.centerX;
  const y1 = box.centerY;
  const dx = x2 - x1;
  const dy = y2 - y1;
  let best = 1;
  if (dx > 0) best = Math.min(best, (box.left + box.width - x1) / dx);
  else if (dx < 0) best = Math.min(best, (box.left - x1) / dx);
  if (dy > 0) best = Math.min(best, (box.top + box.height - y1) / dy);
  else if (dy < 0) best = Math.min(best, (box.top - y1) / dy);
  return best > 1e-6 ? best : 1;
}

/**
 * Anchor for edge chrome (delete button / note chip): midpoint of the visible
 * segment between the two card borders along the center-to-center line.
 * Using the geometric midpoint of centers drops the control inside a tall card
 * when the gap is short.
 */
export function edgeVisibleSegmentAnchor(
  from: EdgeLayoutBox,
  to: EdgeLayoutBox,
): { x: number; y: number; angleDeg: number } {
  const x1 = from.centerX;
  const y1 = from.centerY;
  const x2 = to.centerX;
  const y2 = to.centerY;
  const tExit = exitParamFromCenter(from, x2, y2);
  const tEnter = 1 - exitParamFromCenter(to, x1, y1);
  const tMid = tEnter > tExit + 1e-4 ? (tExit + tEnter) / 2 : 0.5;
  return {
    x: x1 + (x2 - x1) * tMid,
    y: y1 + (y2 - y1) * tMid,
    angleDeg: (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI,
  };
}
