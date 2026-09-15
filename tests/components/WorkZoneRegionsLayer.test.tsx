import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { WorkZoneRegionsLayer } from '../../src/components/canvas/WorkZoneRegionsLayer';
import type { CanvasWorkZone } from '../../src/db';

const zone: CanvasWorkZone = {
  id: 'zone-1',
  canvasId: 'canvas-1',
  x: 10,
  y: 20,
  width: 200,
  height: 120,
  createdAt: 1,
};

describe('WorkZoneRegionsLayer', () => {
  it('renders a transparent dashed boundary', () => {
    const { container } = render(
      <WorkZoneRegionsLayer
        zones={[zone]}
        scale={1}
        zoneLabel={() => '阿狸的房间'}
      />,
    );
    const rect = container.querySelector('rect');
    expect(rect).toHaveAttribute('fill', 'none');
    expect(rect).toHaveAttribute('stroke-dasharray', '8 6');
    expect(rect).toHaveAttribute('stroke', 'rgba(80, 78, 72, 0.26)');
    expect(rect).toHaveAttribute('rx', '0');
  });
});
