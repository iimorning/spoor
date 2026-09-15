import { describe, expect, it } from 'vitest';
import type { CanvasNode } from '../../src/db';
import {
  composerHasContent,
  formatUserMessageForDisplay,
  focusNodeIdsFromSegments,
  insertCardAtTextOffset,
  mergeSelectionIntoComposer,
  normalizeComposerSegments,
  readCardBodyForPrompt,
  removeCardFromComposer,
  reorderComposerSegment,
  resolveReorderIndex,
  segmentsFromFocusAndText,
  serializeComposerSegments,
  userTextFromSegments,
} from '../../src/utils/chatComposer';

function note(id: string, content: string): CanvasNode {
  return { id, type: 'note', content, x: 0, y: 0, canvasId: 'c1' };
}

describe('chatComposer', () => {
  it('serializeComposerSegments interleaves cards and text in order', () => {
    const nodes = [note('b', 'body B'), note('a', 'body A')];
    const segments = [
      { type: 'card' as const, nodeId: 'b' },
      { type: 'text' as const, content: '参照前面的风格，改写后面的文字。' },
      { type: 'card' as const, nodeId: 'a' },
    ];
    const readBody = (id: string) => nodes.find((n) => n.id === id)?.content ?? '';
    const out = serializeComposerSegments(segments, nodes, readBody);
    expect(out).toMatch(/^\[1\] body B/);
    expect(out).toContain('参照前面的风格');
    expect(out).toMatch(/\[2\] body A$/);
  });

  it('focusNodeIdsFromSegments preserves composer card order', () => {
    const ids = focusNodeIdsFromSegments([
      { type: 'card', nodeId: 'z' },
      { type: 'text', content: 'hi' },
      { type: 'card', nodeId: 'a' },
    ]);
    expect(ids).toEqual(['z', 'a']);
  });

  it('mergeSelectionIntoComposer appends new cards at end', () => {
    const base = [{ type: 'text' as const, content: 'draft' }];
    const merged = mergeSelectionIntoComposer(base, ['n1', 'n2'], []);
    expect(merged).toEqual([
      { type: 'text', content: 'draft' },
      { type: 'card', nodeId: 'n1' },
      { type: 'card', nodeId: 'n2' },
      { type: 'text', content: '' },
    ]);
    const again = mergeSelectionIntoComposer(merged, ['n1', 'n2', 'n3'], ['n1', 'n2']);
    expect(again.filter((s) => s.type === 'card').map((s) => (s as { nodeId: string }).nodeId)).toEqual([
      'n1',
      'n2',
      'n3',
    ]);
  });

  it('reinserts selected cards missing from composer even if already tracked', () => {
    const merged = mergeSelectionIntoComposer(
      [{ type: 'text', content: '' }],
      ['n1'],
      ['n1'],
    );
    expect(merged).toEqual([
      { type: 'card', nodeId: 'n1' },
      { type: 'text', content: '' },
    ]);
  });

  it('mergeSelectionIntoComposer inserts new cards before the trailing empty input', () => {
    const merged = mergeSelectionIntoComposer([{ type: 'text', content: '' }], ['n1'], []);
    expect(merged).toEqual([
      { type: 'card', nodeId: 'n1' },
      { type: 'text', content: '' },
    ]);
  });

  it('mergeSelectionIntoComposer removes deselected cards', () => {
    const base = [
      { type: 'card' as const, nodeId: 'n1' },
      { type: 'text' as const, content: '' },
    ];
    const merged = mergeSelectionIntoComposer(base, [], ['n1']);
    expect(merged).toEqual([{ type: 'text', content: '' }]);
  });

  it('resolveReorderIndex maps drop edges onto splice indices', () => {
    expect(resolveReorderIndex(0, 2, 'after')).toBe(2);
    expect(resolveReorderIndex(2, 0, 'before')).toBe(0);
    expect(resolveReorderIndex(1, 0, 'after')).toBe(1);
  });

  it('insertCardAtTextOffset splits a text run around the card', () => {
    expect(
      insertCardAtTextOffset(
        [
          { type: 'text', content: 'abcdefgh' },
          { type: 'card', nodeId: 'c1' },
          { type: 'text', content: '' },
        ],
        1,
        0,
        3,
      ),
    ).toEqual([
      { type: 'text', content: 'abc' },
      { type: 'card', nodeId: 'c1' },
      { type: 'text', content: 'defgh' },
    ]);
  });

  it('reorderComposerSegment moves card blocks', () => {
    const segments = [
      { type: 'card' as const, nodeId: 'a' },
      { type: 'text' as const, content: 'mid' },
      { type: 'card' as const, nodeId: 'b' },
    ];
    const reordered = reorderComposerSegment(segments, 2, 0);
    expect(reordered.map((s) => (s.type === 'card' ? s.nodeId : s.content))).toEqual(['b', 'a', 'mid']);
  });

  it('removeCardFromComposer drops one card', () => {
    expect(
      removeCardFromComposer(
        [
          { type: 'card', nodeId: 'a' },
          { type: 'text', content: 'x' },
        ],
        'a',
      ),
    ).toEqual([{ type: 'text', content: 'x' }]);
  });

  it('removing a card joins the surrounding text into one editable run', () => {
    expect(
      removeCardFromComposer(
        [
          { type: 'text', content: '前' },
          { type: 'card', nodeId: 'n1' },
          { type: 'text', content: '后可删' },
        ],
        'n1',
      ),
    ).toEqual([{ type: 'text', content: '前后可删' }]);
    expect(
      mergeSelectionIntoComposer(
        [
          { type: 'text', content: '左' },
          { type: 'card', nodeId: 'n1' },
          { type: 'text', content: '右' },
          { type: 'card', nodeId: 'n2' },
          { type: 'text', content: '尾' },
        ],
        ['n2'],
        ['n1', 'n2'],
      ),
    ).toEqual([
      { type: 'text', content: '左右' },
      { type: 'card', nodeId: 'n2' },
      { type: 'text', content: '尾' },
    ]);
  });

  it('composerHasContent accepts cards-only or text-only', () => {
    expect(composerHasContent([{ type: 'card', nodeId: 'a' }])).toBe(true);
    expect(composerHasContent([{ type: 'text', content: '  ' }])).toBe(false);
    expect(composerHasContent([{ type: 'text', content: 'hi' }])).toBe(true);
  });

  it('readCardBodyForPrompt uses image caption fields', () => {
    const img: CanvasNode = {
      id: 'img',
      type: 'image',
      content: 'data:image/png;base64,abc',
      description: '席琳',
      imagePrompt: 'hospital bed',
      x: 0,
      y: 0,
      canvasId: 'c1',
    };
    const body = readCardBodyForPrompt(img, () => '');
    expect(body).toContain('席琳');
    expect(body).toContain('hospital bed');
  });

  it('segmentsFromFocusAndText builds card-then-text', () => {
    expect(segmentsFromFocusAndText(['n1'], 'quote')).toEqual([
      { type: 'card', nodeId: 'n1' },
      { type: 'text', content: 'quote' },
    ]);
  });

  it('userTextFromSegments joins text parts', () => {
    expect(
      userTextFromSegments([
        { type: 'text', content: 'a' },
        { type: 'card', nodeId: 'x' },
        { type: 'text', content: 'b' },
      ]),
    ).toBe('a\n\nb');
  });

  it('normalizeComposerSegments defaults empty to one text segment', () => {
    expect(normalizeComposerSegments(undefined)).toEqual([{ type: 'text', content: '' }]);
    expect(
      normalizeComposerSegments([
        { type: 'text', content: 'a' },
        { type: 'text', content: 'b' },
        { type: 'card', nodeId: 'n' },
      ]),
    ).toEqual([
      { type: 'text', content: 'ab' },
      { type: 'card', nodeId: 'n' },
      { type: 'text', content: '' },
    ]);
  });

  it('formatUserMessageForDisplay collapses numbered material blocks', () => {
    const raw = '[1] ' + 'x'.repeat(60) + '\n\n请改写。\n\n[2] short';
    expect(formatUserMessageForDisplay(raw)).toContain('[1]');
    expect(formatUserMessageForDisplay(raw)).toContain('…');
    expect(formatUserMessageForDisplay(raw)).toContain('请改写。');
  });
});
