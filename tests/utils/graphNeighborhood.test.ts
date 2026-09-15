import { describe, expect, it } from 'vitest';
import {
  buildGraphInsightCards,
  collectGraphNeighborhood,
  formatGraphInsightContext,
} from '../../src/utils/graphNeighborhood';
import type { CanvasNode } from '../../src/db';

describe('graphNeighborhood', () => {
  it('collects one-hop neighbors and edge notes', () => {
    const { memberIds, edgeIds, edgeNotes } = collectGraphNeighborhood(
      'a',
      [
        { id: 'e1', from: 'a', to: 'b', note: 'why linked' },
        { id: 'e2', from: 'b', to: 'c' },
        { id: 'e3', from: 'a', to: 'd' },
      ],
      { maxHops: 1 },
    );
    expect(memberIds.sort()).toEqual(['a', 'b', 'd'].sort());
    expect(edgeIds.sort()).toEqual(['e1', 'e3'].sort());
    expect(edgeNotes).toEqual(['why linked']);
  });

  it('builds excerpts and skips empty / media cards', () => {
    const nodes = new Map<string, CanvasNode>([
      ['a', { id: 'a', type: 'note', content: 'Hub thesis about cities', x: 0, y: 0 }],
      ['b', { id: 'b', type: 'image', content: 'data:image/png;base64,xx', x: 0, y: 0 }],
      ['c', { id: 'c', type: 'ai', content: 'A counter-argument about density.', x: 0, y: 0 }],
    ]);
    const cards = buildGraphInsightCards(['a', 'b', 'c'], 'a', nodes);
    expect(cards).toHaveLength(2);
    expect(cards[0]?.isHub).toBe(true);
    const ctx = formatGraphInsightContext(cards, ['related because of housing']);
    expect(ctx).toContain('[HUB]');
    expect(ctx).toContain('housing');
  });
});
