import { describe, expect, it } from 'vitest';
import {
  askAiRequiresLinkedPersona,
  canAskAiOnNode,
  isAskPersonaAnchorType,
  nodeIdsLinkedToAskPersona,
} from '../../src/utils/canvasAskAi';

describe('canAskAiOnNode', () => {
  it('allows common canvas cards including Ask', () => {
    for (const type of ['note', 'text', 'image', 'video', 'book', 'theme', 'agent', 'essay', 'document', 'ai', 'ask']) {
      expect(canAskAiOnNode({ type })).toBe(true);
    }
  });

  it('skips ambience fixtures', () => {
    expect(canAskAiOnNode({ type: 'ambience' })).toBe(false);
  });
});

describe('askAiRequiresLinkedPersona', () => {
  it('requires a wired persona on source cards, not on Ask or agent anchors', () => {
    for (const type of ['note', 'text', 'image', 'video', 'book', 'theme', 'essay', 'document', 'ai']) {
      expect(askAiRequiresLinkedPersona({ type })).toBe(true);
    }
    expect(askAiRequiresLinkedPersona({ type: 'agent' })).toBe(false);
    expect(askAiRequiresLinkedPersona({ type: 'ask' })).toBe(false);
    expect(askAiRequiresLinkedPersona({ type: 'ambience' })).toBe(false);
  });
});

describe('isAskPersonaAnchorType', () => {
  it('treats agent and ask cards as persona anchors', () => {
    expect(isAskPersonaAnchorType('agent')).toBe(true);
    expect(isAskPersonaAnchorType('ask')).toBe(true);
    expect(isAskPersonaAnchorType('note')).toBe(false);
  });
});

describe('nodeIdsLinkedToAskPersona', () => {
  it('includes notes in the same undirected component as an agent', () => {
    const linked = nodeIdsLinkedToAskPersona(
      [
        { id: 'note', type: 'note' },
        { id: 'mid', type: 'note' },
        { id: 'agent', type: 'agent' },
        { id: 'orphan', type: 'note' },
      ],
      [
        { from: 'note', to: 'mid' },
        { from: 'mid', to: 'agent' },
      ],
    );
    expect(linked.has('note')).toBe(true);
    expect(linked.has('mid')).toBe(true);
    expect(linked.has('agent')).toBe(true);
    expect(linked.has('orphan')).toBe(false);
  });

  it('includes notes wired to an Ask (阿狸) card', () => {
    const linked = nodeIdsLinkedToAskPersona(
      [
        { id: 'note', type: 'note' },
        { id: 'ali', type: 'ask' },
        { id: 'orphan', type: 'note' },
      ],
      [{ from: 'note', to: 'ali' }],
    );
    expect(linked.has('note')).toBe(true);
    expect(linked.has('ali')).toBe(true);
    expect(linked.has('orphan')).toBe(false);
  });

  it('includes images wired to an Ask card', () => {
    const linked = nodeIdsLinkedToAskPersona(
      [
        { id: 'img', type: 'image' },
        { id: 'ali', type: 'ask' },
        { id: 'orphan', type: 'image' },
      ],
      [{ from: 'img', to: 'ali' }],
    );
    expect(linked.has('img')).toBe(true);
    expect(linked.has('ali')).toBe(true);
    expect(linked.has('orphan')).toBe(false);
  });

  it('returns empty when the canvas has no persona anchors', () => {
    const linked = nodeIdsLinkedToAskPersona([{ id: 'note', type: 'note' }], []);
    expect(linked.size).toBe(0);
  });
});
