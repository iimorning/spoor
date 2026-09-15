import { describe, expect, it } from 'vitest';
import type { CanvasNode, CanvasWorkZone } from '../../src/db';
import {
  formatSourceAskDraft,
  planSourceSelectionAsk,
  resolvePersonaIdForSourceAsk,
} from '../../src/utils/sourceSelectionAsk';

function node(
  partial: Partial<CanvasNode> & Pick<CanvasNode, 'id' | 'type' | 'x' | 'y'>,
): CanvasNode {
  return { content: '', width: 320, height: 200, canvasId: 'c1', ...partial };
}

function zone(
  partial: Partial<CanvasWorkZone> & Pick<CanvasWorkZone, 'id' | 'x' | 'y' | 'width' | 'height'>,
): CanvasWorkZone {
  return { canvasId: 'c1', createdAt: 0, ...partial };
}

describe('formatSourceAskDraft', () => {
  it('trims the quote and prefixes a source label', () => {
    expect(formatSourceAskDraft('  hello  world  ', ' Demo ')).toBe('Demo\n\nhello world');
  });

  it('returns empty when the quote is blank', () => {
    expect(formatSourceAskDraft('   ', 'Demo')).toBe('');
  });
});

describe('resolvePersonaIdForSourceAsk', () => {
  const ask = node({ id: 'ask-1', type: 'ask', x: 10, y: 10 });
  const book = node({ id: 'book-1', type: 'book', x: 80, y: 60 });
  const room = zone({
    id: 'z1',
    personaNodeId: 'ask-1',
    x: 0,
    y: 0,
    width: 400,
    height: 300,
  });

  it('uses the source itself when it is a persona card', () => {
    expect(resolvePersonaIdForSourceAsk(ask, [ask, book], [room])).toBe('ask-1');
  });

  it('uses contextScopeAgentId when that persona still exists', () => {
    const scoped = node({
      id: 'book-2',
      type: 'book',
      x: 900,
      y: 900,
      contextScopeAgentId: 'ask-1',
    });
    expect(resolvePersonaIdForSourceAsk(scoped, [ask, scoped], [])).toBe('ask-1');
  });

  it('falls back to the bound room containing the card', () => {
    expect(resolvePersonaIdForSourceAsk(book, [ask, book], [room])).toBe('ask-1');
  });

  it('returns undefined when the card is not in a room', () => {
    expect(resolvePersonaIdForSourceAsk(book, [ask, book], [])).toBeUndefined();
  });
});

describe('planSourceSelectionAsk', () => {
  it('opens the room persona with a labeled draft', () => {
    const ask = node({ id: 'ask-1', type: 'ask', x: 10, y: 10 });
    const book = node({ id: 'book-1', type: 'book', x: 80, y: 60 });
    const plan = planSourceSelectionAsk({
      quote: '  a passage  ',
      sourceLabel: 'Demo.epub',
      source: book,
      nodes: [ask, book],
      zones: [
        zone({
          id: 'z1',
          personaNodeId: 'ask-1',
          x: 0,
          y: 0,
          width: 400,
          height: 300,
        }),
      ],
    });
    expect(plan).toEqual({
      personaNodeId: 'ask-1',
      draft: 'Demo.epub\n\na passage',
      focusNodeId: 'book-1',
      composerSegments: [
        { type: 'card', nodeId: 'book-1' },
        { type: 'text', content: 'Demo.epub\n\na passage' },
      ],
    });
  });

  it('returns null without a persona', () => {
    const book = node({ id: 'book-1', type: 'book', x: 80, y: 60 });
    expect(
      planSourceSelectionAsk({
        quote: 'a passage',
        source: book,
        nodes: [book],
        zones: [],
      }),
    ).toBeNull();
  });
});
