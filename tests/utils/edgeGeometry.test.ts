import { describe, it, expect } from 'vitest';
import {
  edgeLineGeomEqual,
  edgeVisibleSegmentAnchor,
  exitParamFromCenter,
  writeSvgLineGeom,
} from '../../src/utils/edgeGeometry';

function box(left: number, top: number, width: number, height: number) {
  return {
    left,
    top,
    width,
    height,
    centerX: left + width / 2,
    centerY: top + height / 2,
  };
}

describe('exitParamFromCenter', () => {
  it('exits the bottom edge when aiming straight down', () => {
    const b = box(0, 0, 100, 200);
    // centerY=100 → bottom=200 toward y=400 → t = 100/300
    expect(exitParamFromCenter(b, 50, 400)).toBeCloseTo(1 / 3, 5);
  });
});

describe('edgeVisibleSegmentAnchor', () => {
  it('places the anchor in the gap between stacked cards, not inside either card', () => {
    // Ask above (tall), AI below — centers midpoint would land inside the AI card.
    const ask = box(0, 0, 280, 200);
    const ai = box(0, 220, 280, 400);
    const anchor = edgeVisibleSegmentAnchor(ask, ai);
    expect(anchor.y).toBeGreaterThanOrEqual(200);
    expect(anchor.y).toBeLessThanOrEqual(220);
    expect(anchor.x).toBeCloseTo(140, 5);
  });

  it('falls back to geometric mid when boxes overlap', () => {
    const a = box(0, 0, 100, 100);
    const b = box(40, 40, 100, 100);
    const anchor = edgeVisibleSegmentAnchor(a, b);
    expect(anchor.x).toBeCloseTo((a.centerX + b.centerX) / 2, 5);
    expect(anchor.y).toBeCloseTo((a.centerY + b.centerY) / 2, 5);
  });
});

describe('edgeLineGeomEqual / writeSvgLineGeom', () => {
  it('treats undefined as unequal and matching coords as equal', () => {
    const geom = { x1: 1, y1: 2, x2: 3, y2: 4 };
    expect(edgeLineGeomEqual(undefined, geom)).toBe(false);
    expect(edgeLineGeomEqual(geom, geom)).toBe(true);
    expect(edgeLineGeomEqual(geom, { ...geom, x2: 9 })).toBe(false);
  });

  it('writes SVG line endpoints', () => {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    writeSvgLineGeom(line, { x1: 10, y1: 20, x2: 30, y2: 40 });
    expect(line.getAttribute('x1')).toBe('10');
    expect(line.getAttribute('y1')).toBe('20');
    expect(line.getAttribute('x2')).toBe('30');
    expect(line.getAttribute('y2')).toBe('40');
  });
});
