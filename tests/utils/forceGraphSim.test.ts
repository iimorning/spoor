import { describe, expect, it } from 'vitest';
import { buildForceGraph, graphNodeRadius, stepForceGraph } from '../../src/utils/forceGraphSim';

describe('forceGraphSim', () => {
  it('builds degree counts and drops dangling edges', () => {
    const { nodes, edges } = buildForceGraph(
      [
        { id: 'a', type: 'note', label: 'A' },
        { id: 'b', type: 'note', label: 'B' },
        { id: 'c', type: 'theme', label: 'C' },
      ],
      [
        { id: 'e1', from: 'a', to: 'b' },
        { id: 'e2', from: 'a', to: 'missing' },
        { id: 'e3', from: 'b', to: 'b' },
      ],
    );
    expect(edges).toHaveLength(1);
    expect(nodes.find((n) => n.id === 'a')?.degree).toBe(1);
    expect(nodes.find((n) => n.id === 'b')?.degree).toBe(1);
    expect(nodes.find((n) => n.id === 'c')?.degree).toBe(0);
  });

  it('moves connected nodes closer over a few ticks', () => {
    const { nodes, edges } = buildForceGraph(
      [
        { id: 'a', type: 'note', label: 'A', seedX: 0, seedY: 0 },
        { id: 'b', type: 'note', label: 'B', seedX: 4000, seedY: 0 },
      ],
      [{ id: 'e1', from: 'a', to: 'b' }],
    );
    const before = Math.hypot(nodes[1].x - nodes[0].x, nodes[1].y - nodes[0].y);
    for (let i = 0; i < 40; i++) stepForceGraph(nodes, edges);
    const after = Math.hypot(nodes[1].x - nodes[0].x, nodes[1].y - nodes[0].y);
    expect(after).toBeLessThan(before);
  });

  it('grows radius with degree', () => {
    expect(graphNodeRadius(0)).toBeLessThan(graphNodeRadius(4));
    expect(graphNodeRadius(100)).toBeLessThanOrEqual(18);
  });
});
