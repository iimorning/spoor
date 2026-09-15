import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db';
import { runCanvasStreamingAiCall } from '../../src/utils/canvasStreamingAi';

describe('runCanvasStreamingAiCall', () => {
  beforeEach(async () => {
    await db.nodes.clear();
  });

  it('streams updates then writes final content', async () => {
    await db.nodes.add({
      id: 'n1',
      canvasId: 'default',
      type: 'ai',
      content: '',
      x: 0,
      y: 0,
    });

    const updates: string[] = [];
    const origUpdate = db.nodes.update.bind(db.nodes);
    vi.spyOn(db.nodes, 'update').mockImplementation((async (id: any, changes: any) => {
      if (typeof changes === 'object' && changes && 'content' in changes) {
        updates.push(String(changes.content));
      }
      return origUpdate(id, changes);
    }) as any);

    const result = await runCanvasStreamingAiCall({
      nodeId: 'n1',
      throttleMs: 0,
      callAi: async (onStream) => {
        onStream('Hel');
        onStream('Hello');
        return 'Hello';
      },
    });

    expect(result).toBe('Hello');
    const row = await db.nodes.get('n1');
    expect(row?.content).toBe('Hello');
    expect(updates.length).toBeGreaterThan(0);
  });

  it('marks placeholder failed when response empty', async () => {
    await db.nodes.add({
      id: 'n2',
      canvasId: 'default',
      type: 'ai',
      content: '',
      x: 0,
      y: 0,
    });

    const result = await runCanvasStreamingAiCall({
      nodeId: 'n2',
      callAi: async () => '   ',
    });

    expect(result).toBe('');
    const row = await db.nodes.get('n2');
    expect(row?.aiStatus).toBe('error');
    expect(row?.aiError).toBeTruthy();
  });

  it('marks node failed on failure', async () => {
    await db.nodes.add({
      id: 'n3',
      canvasId: 'default',
      type: 'ai',
      content: '',
      x: 0,
      y: 0,
    });

    await expect(
      runCanvasStreamingAiCall({
        nodeId: 'n3',
        callAi: async () => {
          throw new Error('fail');
        },
      }),
    ).rejects.toThrow('fail');

    const row = await db.nodes.get('n3');
    expect(row?.aiStatus).toBe('error');
    expect(row?.aiError).toBe('fail');
  });

  it('strips a draw fence from saved content and reports image specs', async () => {
    await db.nodes.add({
      id: 'n4',
      canvasId: 'default',
      type: 'ai',
      content: '',
      x: 0,
      y: 0,
    });

    const drawn: Array<{ title: string; prompt: string }> = [];
    const result = await runCanvasStreamingAiCall({
      nodeId: 'n4',
      throttleMs: 0,
      onDrawImages: (images) => {
        drawn.push(...images);
      },
      callAi: async (onStream) => {
        const full =
          '教室很安静。\n```draw\n{"images":[{"title":"教室","prompt":"a quiet classroom"}]}\n```';
        onStream(full);
        return full;
      },
    });

    expect(result.trim()).toBe('教室很安静。');
    const row = await db.nodes.get('n4');
    expect(row?.content.trim()).toBe('教室很安静。');
    expect(drawn).toEqual([{ title: '教室', prompt: 'a quiet classroom' }]);
  });

  it('strips a search fence from saved content and reports search specs', async () => {
    await db.nodes.add({
      id: 'n5',
      canvasId: 'default',
      type: 'ai',
      content: '',
      x: 0,
      y: 0,
    });

    const searches: Array<{ query: string; scopes: string[] }> = [];
    const result = await runCanvasStreamingAiCall({
      nodeId: 'n5',
      throttleMs: 0,
      onSearchTools: (specs) => {
        searches.push(...specs);
      },
      callAi: async (onStream) => {
        const full =
          '先看来源。\n```search\n{"query":"量子计算","scopes":["webpage"]}\n```';
        onStream(full);
        return full;
      },
    });

    expect(result.trim()).toBe('先看来源。');
    const row = await db.nodes.get('n5');
    expect(row?.content.trim()).toBe('先看来源。');
    expect(searches).toEqual([{ query: '量子计算', scopes: ['webpage'] }]);
  });

  it('starts live search from the user question without a search fence', async () => {
    await db.nodes.add({
      id: 'n5imm',
      canvasId: 'default',
      type: 'ai',
      content: '',
      x: 0,
      y: 0,
    });
    const searches: Array<{ query: string; scopes: string[] }> = [];
    const result = await runCanvasStreamingAiCall({
      nodeId: 'n5imm',
      throttleMs: 0,
      immediateSearchQuery: '谷歌最新的模型怎么样',
      onSearchTools: (specs) => {
        searches.push(...specs);
      },
      callAi: async () => '谷歌模型迭代得比较快，我先查一下当前最新的状态。',
    });
    expect(result).toContain('我先查一下');
    expect(searches).toEqual([{ query: '谷歌最新的模型怎么样', scopes: ['webpage'] }]);
  });

  it('dispatches search as soon as a closed fence appears during streaming', async () => {
    await db.nodes.add({
      id: 'n5b',
      canvasId: 'default',
      type: 'ai',
      content: '',
      x: 0,
      y: 0,
    });

    const searchCalls: number[] = [];
    let resolveSearch!: () => void;
    const searchGate = new Promise<void>((r) => {
      resolveSearch = r;
    });

    const resultPromise = runCanvasStreamingAiCall({
      nodeId: 'n5b',
      throttleMs: 0,
      onSearchTools: async () => {
        searchCalls.push(Date.now());
        await searchGate;
      },
      callAi: async (onStream) => {
        onStream('还在写正文…');
        onStream(
          '还在写正文…\n```search\n{"query":"早触发","scopes":["webpage"]}\n```',
        );
        await new Promise((r) => setTimeout(r, 30));
        return '还在写正文…';
      },
    });

    await new Promise((r) => setTimeout(r, 5));
    expect(searchCalls).toHaveLength(1);
    resolveSearch();
    const result = await resultPromise;
    expect(result.trim()).toBe('还在写正文…');
    expect(searchCalls).toHaveLength(1);
  });

  it('runs search synthesis after hits return', async () => {
    await db.nodes.add({
      id: 'n5c',
      canvasId: 'default',
      type: 'ai',
      content: '',
      x: 0,
      y: 0,
    });

    const result = await runCanvasStreamingAiCall({
      nodeId: 'n5c',
      throttleMs: 0,
      onSearchTools: async () => [
        {
          kind: 'webpage' as const,
          query: '量子',
          title: 'Quantum intro',
          snippet: 'Qubits exploit superposition.',
          link: 'https://example.com/q',
        },
      ],
      synthesizeFromSearch: async ({ draftAnswer, hits }) => {
        expect(draftAnswer).toBe('初稿。');
        expect(hits).toHaveLength(1);
        return '修订稿：叠加态。';
      },
      callAi: async () =>
        '初稿。\n```search\n{"query":"量子计算","scopes":["webpage"]}\n```',
    });

    expect(result.trim()).toBe('修订稿：叠加态。');
    expect((await db.nodes.get('n5c'))?.content).toBe('修订稿：叠加态。');
  });

  it('waits for in-flight early search before no-results alert', async () => {
    await db.nodes.add({
      id: 'n5d',
      canvasId: 'default',
      type: 'ai',
      content: '',
      x: 0,
      y: 0,
    });

    let resolveSearch!: () => void;
    const searchGate = new Promise<void>((r) => {
      resolveSearch = r;
    });
    let noResults = false;

    const resultPromise = runCanvasStreamingAiCall({
      nodeId: 'n5d',
      throttleMs: 0,
      onSearchNoResults: () => {
        noResults = true;
      },
      onSearchTools: async () => {
        await searchGate;
        return [
          {
            kind: 'image' as const,
            query: 'q',
            title: 'Hit',
            snippet: '',
            link: 'https://example.com/i.jpg',
          },
        ];
      },
      callAi: async (onStream) => {
        const full = '正文\n```search\n{"query":"q","scopes":["image"]}\n```';
        onStream(full);
        return full;
      },
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(noResults).toBe(false);
    resolveSearch();
    await resultPromise;
    expect(noResults).toBe(false);
  });

  it('does not write the card body until visible prose exists, and reports thinking', async () => {
    await db.nodes.add({
      id: 'n6',
      canvasId: 'default',
      type: 'ai',
      content: '',
      x: 0,
      y: 0,
    });
    const thoughts: string[] = [];
    const TO = '<' + 'think>';
    const TC = '</' + 'think>';
    const result = await runCanvasStreamingAiCall({
      nodeId: 'n6',
      throttleMs: 0,
      onThinking: (thought) => {
        thoughts.push(thought);
      },
      callAi: async (onStream) => {
        onStream(TO + '先推理');
        expect((await db.nodes.get('n6'))?.content).toBe('');
        const full = TO + '先推理' + TC + '答案来了';
        onStream(full);
        return full;
      },
    });
    expect(result).toBe('答案来了');
    expect(thoughts.some((t) => t.includes('先推理'))).toBe(true);
    expect((await db.nodes.get('n6'))?.content).toBe('答案来了');
    expect((await db.nodes.get('n6'))?.thinkingTrace).toBe('先推理');
  });

  it('keeps thinking captured during the stream if the final text has no think tags', async () => {
    await db.nodes.add({
      id: 'n9',
      canvasId: 'default',
      type: 'ai',
      content: '',
      x: 0,
      y: 0,
    });
    const TO = '<' + 'think>';
    const TC = '</' + 'think>';
    await runCanvasStreamingAiCall({
      nodeId: 'n9',
      throttleMs: 0,
      callAi: async (onStream) => {
        onStream(TO + '只在流里');
        onStream(TO + '只在流里' + TC + '可见回答');
        return '可见回答';
      },
    });
    expect((await db.nodes.get('n9'))?.content).toBe('可见回答');
    expect((await db.nodes.get('n9'))?.thinkingTrace).toBe('只在流里');
  });

  it('falls back to the user request when the model never emits a draw fence', async () => {
    await db.nodes.add({
      id: 'n7',
      canvasId: 'default',
      type: 'ai',
      content: '',
      x: 0,
      y: 0,
    });

    const drawn: Array<{ title: string; prompt: string }> = [];
    await runCanvasStreamingAiCall({
      nodeId: 'n7',
      throttleMs: 0,
      fallbackDrawFromUser: '帮我生成意大利冰淇淋的图片',
      onDrawImages: (images) => {
        drawn.push(...images);
      },
      callAi: async () => '意大利冰淇淋图片已生成，你可查看当前对话的图片附件获取。',
    });

    expect(drawn).toEqual([{ title: '意大利冰淇淋', prompt: '意大利冰淇淋' }]);
  });

  it('does not invent a search query from the user wording when the model omits a search fence', async () => {
    await db.nodes.add({
      id: 'n8',
      canvasId: 'default',
      type: 'ai',
      content: '',
      x: 0,
      y: 0,
    });

    const searches: Array<{ query: string; scopes: string[] }> = [];
    await runCanvasStreamingAiCall({
      nodeId: 'n8',
      throttleMs: 0,
      onSearchTools: (rows) => {
        searches.push(...rows);
      },
      callAi: async () => '为啥你没有联网搜索？我先按记忆回答。',
    });
    expect(searches).toEqual([]);
  });
});
