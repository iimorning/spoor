import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentConfig, CanvasNode, Edge } from '../../src/db';
import {
  VOLC_ASR_CONTEXT_CHAR_BUDGET,
  VOLC_ASR_HOTWORD_CHAR_BUDGET,
  buildVolcAsrBiasFromCanvas,
  buildVolcAsrCorpusContext,
  extractAsrHotwords,
} from '../../src/utils/volcAsrBias';

function node(partial: Partial<CanvasNode> & Pick<CanvasNode, 'id' | 'type'>): CanvasNode {
  return {
    x: 0,
    y: 0,
    canvasId: 'c1',
    content: '',
    ...partial,
  };
}

describe('extractAsrHotwords', () => {
  it('keeps persona names and 汤面 keywords, drops function words', () => {
    const words = extractAsrHotwords(
      ['一个男人走进酒吧点了一碗海龟汤，尝了一口就自杀了。'],
      ['海龟汤主持人'],
    );
    expect(words).toContain('海龟汤主持人');
    expect(words).toContain('海龟汤');
    expect(words).not.toContain('一个');
    expect(words.join('').length).toBeLessThanOrEqual(VOLC_ASR_HOTWORD_CHAR_BUDGET);
  });
});

describe('buildVolcAsrCorpusContext', () => {
  it('returns undefined when there is nothing to bias', () => {
    expect(buildVolcAsrCorpusContext({ snippets: ['   '] })).toBeUndefined();
  });

  it('packs 汤面 into dialog_ctx and names into hotwords', () => {
    const raw = buildVolcAsrCorpusContext({
      snippets: [
        '语音对话角色：海龟汤主持人',
        '汤面：一个男人点了海龟汤，尝了一口就自杀了。',
      ],
      seedTerms: ['海龟汤主持人'],
    });
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as {
      hotwords: { word: string }[];
      context_type: string;
      context_data: { text: string }[];
    };
    expect(parsed.context_type).toBe('dialog_ctx');
    expect(parsed.context_data[0]?.text).toContain('海龟汤主持人');
    expect(parsed.context_data.some((row) => row.text.includes('海龟汤'))).toBe(true);
    expect(parsed.hotwords.some((h) => h.word === '海龟汤主持人')).toBe(true);
  });

  it('stays under the Volc dialog-context budget', () => {
    const long = '海龟汤'.repeat(400);
    const raw = buildVolcAsrCorpusContext({ snippets: [long, long] });
    const parsed = JSON.parse(raw!) as { context_data: { text: string }[] };
    const total = parsed.context_data.reduce((n, row) => n + row.text.length, 0);
    expect(total).toBeLessThanOrEqual(VOLC_ASR_CONTEXT_CHAR_BUDGET);
  });
});

describe('buildVolcAsrBiasFromCanvas', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('V2: reads work-zone cards and side-panel chat, not wired neighbors', () => {
    const nodes: CanvasNode[] = [
      node({ id: 'ask', type: 'ask' }),
      node({ id: 'host', type: 'agent', agentConfigId: 'turtle' }),
      node({
        id: 'book',
        type: 'book',
        description: '红房子',
        content: '红房子里有人点了海龟汤。',
        contextScopeAgentId: 'ask',
      }),
      node({
        id: 'wired-ai',
        type: 'ai',
        content: '这句只在连线上，不该进热词',
      }),
    ];
    const edges: Edge[] = [
      { id: 'e1', canvasId: 'c1', from: 'ask', to: 'host' },
      { id: 'e2', canvasId: 'c1', from: 'ask', to: 'wired-ai' },
    ];
    const agents: AgentConfig[] = [
      { id: 'turtle', name: '海龟汤主持人', role: 'host', prompt: '' },
    ];
    const raw = buildVolcAsrBiasFromCanvas({
      askNodeId: 'ask',
      nodes,
      edges,
      agents,
      threadMessages: [
        { id: 'm1', role: 'assistant', text: '汤面：红房子里有人点了海龟汤。', createdAt: 2 },
      ],
    });
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as {
      hotwords: { word: string }[];
      context_data: { text: string }[];
    };
    const blob = parsed.context_data.map((row) => row.text).join('\n');
    expect(blob).toContain('红房子');
    expect(blob).not.toContain('只在连线上');
    expect(parsed.hotwords.some((h) => h.word.includes('海龟汤主持人'))).toBe(false);
  });

  it('V2: agent-card voice seeds that persona name from the card, not from edges', () => {
    const nodes: CanvasNode[] = [
      node({ id: 'host', type: 'agent', agentConfigId: 'turtle' }),
      node({
        id: 'note',
        type: 'note',
        content: '红房子',
        contextScopeAgentId: 'host',
      }),
    ];
    const raw = buildVolcAsrBiasFromCanvas({
      askNodeId: 'host',
      nodes,
      edges: [],
      agents: [{ id: 'turtle', name: '海龟汤主持人', role: 'host', prompt: '' }],
    });
    const parsed = JSON.parse(raw!) as { hotwords: { word: string }[]; context_data: { text: string }[] };
    expect(parsed.hotwords.some((h) => h.word.includes('海龟汤主持人'))).toBe(true);
    expect(parsed.context_data.some((row) => row.text.includes('红房子'))).toBe(true);
  });

});
