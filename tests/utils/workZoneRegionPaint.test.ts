import { describe, it, expect } from 'vitest';
import { workZoneRegionPaint } from '../../src/utils/workZoneRegionPaint';

describe('workZoneRegionPaint', () => {
  it('uses a hollow dashed outline', () => {
    const paint = workZoneRegionPaint({ selected: false, draft: false, scale: 1 });
    expect(paint.fill).toBe('none');
    expect(paint.stroke).toBe('rgba(80, 78, 72, 0.26)');
    expect(paint.strokeDasharray).toBe('8 6');
    expect(paint.rx).toBe(0);
  });

  it('draft stays hollow with a lighter dashed gray stroke', () => {
    const paint = workZoneRegionPaint({ selected: false, draft: true, scale: 1 });
    expect(paint.fill).toBe('none');
    expect(paint.strokeDasharray).toBe('8 6');
    expect(paint.stroke).toBe('rgba(80, 78, 72, 0.32)');
  });

  it('scales stroke with canvas zoom', () => {
    const paint = workZoneRegionPaint({ selected: true, draft: false, scale: 2 });
    expect(paint.strokeWidth).toBe(0.75);
    expect(paint.rx).toBe(0);
    expect(paint.strokeDasharray).toBe('4 3');
  });
});
