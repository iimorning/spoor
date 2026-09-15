import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { useAiActions } from '../../src/hooks/useAiActions';
import { db } from '../../src/db';
import type { AgentConfig, CanvasNode } from '../../src/db';
import type { AIConfig } from '../../src/components/AISettingsModal';

/** Stable vi.fn() across re-renders so assertions stay valid after async handlers trigger state updates. */
function stableMockFn<T extends (...args: any[]) => any>(): T {
  return useRef(vi.fn()).current as unknown as T;
}

const publishJsonResponse = vi.hoisted(() =>
  JSON.stringify({
    title: 'Synthesized Title',
    body: '## Section\n\nParagraph one.',
  }),
);

vi.mock('../../src/services/ai', () => ({
  callUniversalAI: vi.fn().mockResolvedValue(publishJsonResponse),
  formatAiError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  maskApiKeyForLog: (k: string) => (k ? `${k.slice(0, 2)}…` : ''),
}));

vi.mock('../../src/services/search', () => ({
  metasoSearch: vi.fn().mockResolvedValue({
    credits: 0,
    total: 0,
    webpages: [],
  }),
  buildSearchContext: vi.fn(),
}));

vi.mock('../../src/services/liveWebSearch', () => ({
  liveWebSearch: vi.fn().mockResolvedValue({
    credits: 0,
    total: 0,
    webpages: [],
  }),
}));

vi.mock('../../src/services/wikipediaSearch', () => ({
  wikipediaSearch: vi.fn().mockResolvedValue({ webpages: [], images: [] }),
}));

vi.mock('../../src/services/flux302', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/flux302')>();
  return {
    ...actual,
    generateGptImage2: vi.fn(async () => ({ url: 'https://img.example/cover.jpg' })),
  };
});

import { callUniversalAI } from '../../src/services/ai';
import { metasoSearch } from '../../src/services/search';
import { liveWebSearch } from '../../src/services/liveWebSearch';
import { generateGptImage2 } from '../../src/services/flux302';
import { setServerConfig } from '../../src/lib/serverConfig';
import i18n from '../../src/i18n';
import { setCanvasV2Enabled } from '../../src/utils/canvasV2';

function mockCallUniversalAIWithStream(finalText: string) {
  vi.mocked(callUniversalAI).mockImplementation(async (opts) => {
    if (opts.onStreamChunk) {
      opts.onStreamChunk('partial');
      opts.onStreamChunk(finalText);
    }
    return finalText;
  });
}

const baseAiConfig: AIConfig = {
  provider: 'gemini',
  apiKey: 'test',
  baseUrl: '',
  model: 'gemini-1.5-flash',
  metasoApiKey: 'metaso-k',
};

function useTestAiActions(opts?: {
  agentConfigs?: AgentConfig[];
  selectedNodes?: Set<string>;
  edges?: { from: string; to: string; id?: string; canvasId?: string }[];
  dynamicNodes?: CanvasNode[];
  aiConfigOverrides?: Partial<AIConfig>;
  onOpenSettings?: () => void;
}) {
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(opts?.selectedNodes ?? new Set());

  const nodesRef = useRef<Record<string, HTMLElement | null>>({});
  const transformRef = useRef({ x: 0, y: 0, scale: 1 });

  return {
    ...useAiActions({
      aiConfig: { ...baseAiConfig, ...opts?.aiConfigOverrides },
      agentConfigs: opts?.agentConfigs ?? ([] as AgentConfig[]),
      activeCanvasId: 'default',
      nodesRef: nodesRef as React.RefObject<Record<string, HTMLElement | null>>,
      transformRef: transformRef as React.RefObject<{ x: number; y: number; scale: number }>,
      dynamicNodes: opts?.dynamicNodes ?? [],
      edges: (opts?.edges ?? []) as any[],
      selectedNodes,
      setSelectedNodes,
      onOpenSettings: opts?.onOpenSettings,
    }),
    nodesRef,
    setSelectedNodes,
  };
}

async function personaThread(personaId: string) {
  return db.canvasPersonaThreads.get(`default:${personaId}`);
}

describe('useAiActions', () => {
  beforeEach(async () => {
    localStorage.clear();
    await db.nodes.clear();
    await db.articles.clear();
    await db.edges.clear();
    await db.agents.clear();
    await db.canvasPersonaThreads.clear();
    setServerConfig({ session: null, useServerKeys: false, isPro: false });
    await i18n.changeLanguage('en');
    vi.mocked(callUniversalAI).mockClear();
    mockCallUniversalAIWithStream('AI generated text');
    vi.mocked(metasoSearch).mockClear();
    vi.mocked(metasoSearch).mockResolvedValue({
      credits: 0,
      total: 0,
      webpages: [],
    });
    vi.mocked(liveWebSearch).mockClear();
    vi.mocked(liveWebSearch).mockResolvedValue({
      credits: 0,
      total: 0,
      webpages: [],
    });
    vi.mocked(generateGptImage2).mockClear();
    vi.mocked(generateGptImage2).mockResolvedValue({ url: 'https://img.example/cover.jpg' });
  });

  // --- handlePublish ---
  // Publish opens canvas stroke-order mode (no AI arrange). Confirm synthesizes via
  // draftArticleFromOutline (covered in generateArticleFromOutline / synthesize tests).
  describe('handlePublish', () => {
    it('selectedNodes 少于 2 张时不进入串联模式', async () => {
      const { result } = renderHook(() => useTestAiActions());

      await act(async () => {
        await result.current.handlePublish();
      });
      expect(result.current.publishSequenceActive).toBe(false);

      act(() => {
        result.current.setSelectedNodes(new Set(['n1']));
      });
      await act(async () => {
        await result.current.handlePublish();
      });

      expect(callUniversalAI).not.toHaveBeenCalled();
      expect(result.current.publishSequenceActive).toBe(false);
      expect(result.current.publishSequenceCandidateIds).toEqual([]);
    });

    it('有选中节点时进入串联模式并把 candidateIds 写入 state（不调 AI、不写库）', async () => {
      const { result } = renderHook(() => useTestAiActions());

      act(() => {
        result.current.setSelectedNodes(new Set(['n1', 'n2']));
        const el = document.createElement('div');
        el.innerText = 'Hello publish body';
        result.current.nodesRef.current.n1 = el;
      });

      await act(async () => {
        await result.current.handlePublish();
      });

      expect(callUniversalAI).not.toHaveBeenCalled();
      expect(result.current.publishSequenceActive).toBe(true);
      expect(result.current.publishSequenceCandidateIds).toEqual(['n1', 'n2']);
      expect(result.current.publishSequenceOrderedIds).toEqual([]);
    });

    it('选中叠卡里一张便签时按从下到上的写作顺序展开 candidateIds', async () => {
      const { result } = renderHook(() =>
        useTestAiActions({
          dynamicNodes: [
            {
              id: 'b',
              type: 'text',
              x: 0,
              y: 0,
              notePileMemberIds: ['b', 'a'],
              notePileParentId: 'b',
              notePileCollapsed: true,
            },
            { id: 'a', type: 'text', x: 0, y: 0, notePileParentId: 'b' },
          ],
        }),
      );

      act(() => {
        result.current.setSelectedNodes(new Set(['b']));
      });

      await act(async () => {
        await result.current.handlePublish();
      });

      expect(result.current.publishSequenceActive).toBe(true);
      expect(result.current.publishSequenceCandidateIds).toEqual(['b', 'a']);
    });

    it('cancelPublishSequence 清空顺序并退出模式', async () => {
      const { result } = renderHook(() => useTestAiActions());

      act(() => {
        result.current.setSelectedNodes(new Set(['n1', 'n2']));
      });
      await act(async () => {
        await result.current.handlePublish();
      });
      expect(result.current.publishSequenceActive).toBe(true);

      act(() => {
        result.current.setPublishSequenceOrderedIds(['n2', 'n1']);
      });
      act(() => {
        result.current.cancelPublishSequence();
      });
      expect(result.current.publishSequenceActive).toBe(false);
      expect(result.current.publishSequenceCandidateIds).toEqual([]);
      expect(result.current.publishSequenceOrderedIds).toEqual([]);
    });
  });

  // --- runAskCardGeneration ---
  describe('runAskCardGeneration', () => {
    const tinyPng =
      'data:image/png;base64,iVBORORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

    it('Ask 卡片不存在时提前返回', async () => {
      const { result } = renderHook(() => useTestAiActions());
      await act(async () => {
        await result.current.runAskCardGeneration('nope', 'hello');
      });
      expect(callUniversalAI).not.toHaveBeenCalled();
    });

    it('未连到阿狸或角色卡的图卡不能提问', async () => {
      const imgNode: CanvasNode = {
        id: 'img1',
        canvasId: 'default',
        type: 'image',
        content: tinyPng,
        x: 0,
        y: 0,
      };
      await db.nodes.add(imgNode);
      const { result } = renderHook(() => useTestAiActions({ dynamicNodes: [imgNode] }));
      await act(async () => {
        await result.current.runAskCardGeneration('img1', '上色');
      });
      expect(callUniversalAI).not.toHaveBeenCalled();
      expect((await db.nodes.toArray()).filter((n) => n.type === 'ai')).toHaveLength(0);
    });


    it('无连线时使用 bare persona + 用户原文 作为唯一一条 user 消息', async () => {
      const askNode: CanvasNode = { id: 'ask1', canvasId: 'default', type: 'ask', x: 0, y: 0 };
      const { result } = renderHook(() => useTestAiActions({ dynamicNodes: [askNode] }));
      await act(async () => {
        await result.current.runAskCardGeneration('ask1', 'Hello world');
      });
      expect(callUniversalAI).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: 'user', content: 'Hello world' }],
          systemInstruction: expect.stringMatching(/Your name is 阿狸[\s\S]*AI thinking partner/i),
        }),
      );
      const thread = await personaThread('ask1');
      expect(thread?.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
      expect(thread?.messages[0]?.text).toBe('Hello world');
      expect(thread?.messages[1]?.text).toBe('AI generated text');
      expect((await db.nodes.toArray()).filter((n) => n.type === 'ai')).toHaveLength(0);
    });

    it('voiceBrief 时 system 追加整段朗读说明', async () => {
      const askNode: CanvasNode = { id: 'ask1', canvasId: 'default', type: 'ask', x: 0, y: 0 };
      const { result } = renderHook(() => useTestAiActions({ dynamicNodes: [askNode] }));
      await act(async () => {
        await result.current.runAskCardGeneration('ask1', 'Hello world', { voiceBrief: true });
      });
      expect(callUniversalAI).toHaveBeenCalledWith(
        expect.objectContaining({
          systemInstruction: expect.stringMatching(/speak/i),
        }),
      );
    });

    it('onReplyNodeCreated 在首个 stream chunk 之前给出回复消息 id', async () => {
      mockCallUniversalAIWithStream('Hello world');
      const askNode: CanvasNode = { id: 'ask1', canvasId: 'default', type: 'ask', x: 0, y: 0 };
      const { result } = renderHook(() => useTestAiActions({ dynamicNodes: [askNode] }));
      const order: string[] = [];
      await act(async () => {
        await result.current.runAskCardGeneration('ask1', 'Hello world', {
          onReplyNodeCreated: (id) => {
            order.push(`node:${id}`);
          },
          onStreamChunk: () => {
            order.push('chunk');
          },
        });
      });
      expect(order[0]).toMatch(/^node:/);
      expect(order.filter((x) => x === 'chunk').length).toBeGreaterThan(0);
      expect(order.indexOf('chunk')).toBeGreaterThan(0);
      const thread = await personaThread('ask1');
      expect(thread?.messages.some((m) => m.id === order[0]!.slice(5))).toBe(true);
    });

    it('ask 回复写入侧栏线程，不在画布上连线出卡', async () => {
      const askNode: CanvasNode = { id: 'ask1', canvasId: 'default', type: 'ask', x: 0, y: 0 };
      const { result } = renderHook(() => useTestAiActions({ dynamicNodes: [askNode] }));
      await act(async () => {
        await result.current.runAskCardGeneration('ask1', 'describe');
      });
      expect(await db.edges.toArray()).toEqual([]);
      expect((await db.nodes.toArray()).filter((n) => n.type === 'ai')).toHaveLength(0);
      const thread = await personaThread('ask1');
      expect(thread?.messages).toHaveLength(2);
    });

    it('工作区 note 节点时 system 拼接正文 + user message 只放问题(每轮都有上下文)', async () => {
      const askNode: CanvasNode = { id: 'ask1', canvasId: 'default', type: 'ask', x: 0, y: 0 };
      const noteNode: CanvasNode = {
        id: 'n1',
        canvasId: 'default',
        type: 'note',
        x: 50,
        y: 50,
        content: 'note body',
        contextScopeAgentId: 'ask1',
      };
      const { result } = renderHook(() =>
        useTestAiActions({
          dynamicNodes: [askNode, noteNode],
        }),
      );
      act(() => {
        const el = document.createElement('div');
        el.innerText = 'NOTE_BODY_FROM_DOM';
        result.current.nodesRef.current['n1'] = el;
      });
      await act(async () => {
        await result.current.runAskCardGeneration('ask1', 'summarize');
      });
      expect(callUniversalAI).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: 'user', content: 'summarize' }],
          systemInstruction: expect.stringMatching(/NOTE_BODY_FROM_DOM/),
        }),
      );
    });

    it('工作区 image 节点时 callUniversalAI 传入 images', async () => {
      const askNode: CanvasNode = { id: 'ask1', canvasId: 'default', type: 'ask', x: 0, y: 0 };
      const imgNode: CanvasNode = {
        id: 'img1',
        canvasId: 'default',
        type: 'image',
        content: tinyPng,
        x: 0,
        y: 0,
        contextScopeAgentId: 'ask1',
      };
      const { result } = renderHook(() =>
        useTestAiActions({
          dynamicNodes: [askNode, imgNode],
          selectedNodes: new Set(['img1']),
        }),
      );
      await act(async () => {
        await result.current.runAskCardGeneration('ask1', 'describe this');
      });
      expect(callUniversalAI).toHaveBeenCalledWith(
        expect.objectContaining({
          images: [tinyPng],
        }),
      );
    });

    it('AI 失败时侧栏助手消息留下错误文案', async () => {
      vi.mocked(callUniversalAI).mockRejectedValueOnce(new Error('API Error'));
      const askNode: CanvasNode = { id: 'ask1', canvasId: 'default', type: 'ask', x: 0, y: 0 };
      const { result } = renderHook(() => useTestAiActions({ dynamicNodes: [askNode] }));
      await act(async () => {
        await result.current.runAskCardGeneration('ask1', 'fail me');
      });
      const thread = await personaThread('ask1');
      expect(thread?.messages).toHaveLength(2);
      expect(thread?.messages[1]?.text).toContain('API Error');
      expect((await db.nodes.toArray()).filter((n) => n.type === 'ai')).toHaveLength(0);
    });

    it('AI 失败时主按钮打开设置而不是只点知道了', async () => {
      vi.mocked(callUniversalAI).mockRejectedValueOnce(new Error('服务器代理调用失败 (500: internal_error)'));
      const onOpenSettings = vi.fn();
      const askNode: CanvasNode = { id: 'ask1', canvasId: 'default', type: 'ask', x: 0, y: 0 };
      const { result } = renderHook(() =>
        useTestAiActions({ dynamicNodes: [askNode], onOpenSettings }),
      );
      await act(async () => {
        await result.current.runAskCardGeneration('ask1', 'fail me');
      });
      expect(await screen.findByRole('dialog')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Sign in|去登录/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /知道了|^OK$/i })).not.toBeInTheDocument();
      await act(async () => {
        screen.getByRole('button', { name: /Sign in|去登录/ }).click();
      });
      expect(onOpenSettings).toHaveBeenCalledTimes(1);
    });

    it('普通提问时 system 注入联网工具说明（有联网搜索权限）', async () => {
      const askNode: CanvasNode = { id: 'ask1', canvasId: 'default', type: 'ask', x: 0, y: 0 };
      const { result } = renderHook(() =>
        useTestAiActions({
          dynamicNodes: [askNode],
          aiConfigOverrides: { provider: 'openrouter', model: 'openai/gpt-4o-mini' },
        }),
      );
      await act(async () => {
        await result.current.runAskCardGeneration('ask1', 'what is entropy');
      });
      expect(callUniversalAI).toHaveBeenCalledWith(
        expect.objectContaining({
          systemInstruction: expect.stringMatching(/Live retrieval/i),
        }),
      );
    });

    it('提到「联网搜索」也不再当口令去搜，检索词只看模型的 search fence', async () => {
      const askNode: CanvasNode = { id: 'ask1', canvasId: 'default', type: 'ask', x: 0, y: 0 };
      const { result } = renderHook(() => useTestAiActions({ dynamicNodes: [askNode] }));
      await act(async () => {
        await result.current.runAskCardGeneration('ask1', '为啥你没有联网搜索');
      });
      expect(callUniversalAI).toHaveBeenCalled();
      const payload = vi.mocked(callUniversalAI).mock.calls[0]![0];
      expect(JSON.stringify(payload.messages ?? payload.prompt)).toContain('为啥你没有联网搜索');
      expect(JSON.stringify(payload)).not.toMatch(/Live retrieval required this turn/i);
      expect(metasoSearch).not.toHaveBeenCalled();
      expect(liveWebSearch).not.toHaveBeenCalled();
    });

    it('模型回复含 search fence 时把命中写入侧栏消息，不铺画布来源卡', async () => {
      mockCallUniversalAIWithStream(
        '先看这几份材料。\n```search\n{"query":"量子计算","scopes":["webpage"]}\n```',
      );
      vi.mocked(liveWebSearch).mockResolvedValue({
        credits: 0,
        total: 1,
        webpages: [{ title: 'T', snippet: 'S', link: 'https://ex.com', score: '', date: '' }],
      });
      const askNode: CanvasNode = { id: 'ask1', canvasId: 'default', type: 'ask', x: 0, y: 0 };
      await db.nodes.add(askNode);
      const { result } = renderHook(() =>
        useTestAiActions({
          dynamicNodes: [askNode],
          aiConfigOverrides: { provider: 'openrouter', model: 'openai/gpt-4o-mini' },
        }),
      );
      await act(async () => {
        await result.current.runAskCardGeneration('ask1', '帮我查量子计算');
      });
      expect(callUniversalAI).toHaveBeenCalled();
      expect(liveWebSearch).toHaveBeenCalledWith(
        '量子计算',
        expect.objectContaining({ scope: 'webpage' }),
      );
      const sources = (await db.nodes.toArray()).filter((n) => n.webSearchParentId);
      expect(sources).toHaveLength(0);
      const thread = await personaThread('ask1');
      const assistant = thread?.messages.find((m) => m.role === 'assistant');
      expect(assistant?.searchHits?.some((h) => h.link === 'https://ex.com')).toBe(true);
    });

    describe('多轮对话(history)', () => {
      async function seedThread(askId: string, rounds: Array<{ user: string; ai: string }>) {
        const messages = rounds.flatMap((round, i) => [
          {
            id: `u${i + 1}`,
            role: 'user' as const,
            text: round.user,
            createdAt: i * 2,
          },
          {
            id: `a${i + 1}`,
            role: 'assistant' as const,
            text: round.ai,
            createdAt: i * 2 + 1,
          },
        ]);
        await db.canvasPersonaThreads.put({
          id: `default:${askId}`,
          canvasId: 'default',
          agentNodeId: askId,
          messages,
          updatedAt: Date.now(),
        });
      }

      it('第二轮把第一轮的 user + assistant 都喂给模型(顺序正确)', async () => {
        const ask: CanvasNode = { id: 'ask1', canvasId: 'default', type: 'ask', x: 0, y: 0 };
        await seedThread(ask.id, [{ user: '笔记 A 说什么', ai: 'A 说 X' }]);
        const { result } = renderHook(() => useTestAiActions({ dynamicNodes: [ask] }));
        await act(async () => {
          await result.current.runAskCardGeneration('ask1', '那 A 第 2 段呢?');
        });
        const call = vi.mocked(callUniversalAI).mock.calls.at(-1)![0] as {
          messages?: Array<{ role: string; content: unknown }>;
        };
        const tail = call.messages!.slice(-3);
        expect(tail[0]!.role).toBe('user');
        expect(String(tail[0]!.content)).toBe('笔记 A 说什么');
        expect(tail[1]!.role).toBe('assistant');
        expect(String(tail[1]!.content)).toBe('A 说 X');
        expect(tail[2]!.role).toBe('user');
        expect(String(tail[2]!.content)).toBe('那 A 第 2 段呢?');
      });

      it('第二轮仍把工作区笔记写进 system', async () => {
        const ask: CanvasNode = { id: 'ask1', canvasId: 'default', type: 'ask', x: 0, y: 0 };
        const note: CanvasNode = {
          id: 'n1',
          canvasId: 'default',
          type: 'note',
          x: 50,
          y: 50,
          content: '',
          contextScopeAgentId: 'ask1',
        };
        await seedThread(ask.id, [{ user: 'q1', ai: 'a1' }]);
        const { result } = renderHook(() =>
          useTestAiActions({
            dynamicNodes: [ask, note],
          }),
        );
        act(() => {
          const el = document.createElement('div');
          el.innerText = 'NOTE_CONTEXT_TEXT';
          result.current.nodesRef.current['n1'] = el;
        });
        await act(async () => {
          await result.current.runAskCardGeneration('ask1', 'q2');
        });
        const thread = await personaThread('ask1');
        expect(thread?.messages.filter((m) => m.role === 'user')).toHaveLength(2);
        const call = vi.mocked(callUniversalAI).mock.calls.at(-1)![0] as {
          systemInstruction?: string;
        };
        expect(call.systemInstruction).toMatch(/NOTE_CONTEXT_TEXT/);
      });

      it('删掉第一轮侧栏消息后,下一轮 history 就不再有它', async () => {
        const ask: CanvasNode = { id: 'ask1', canvasId: 'default', type: 'ask', x: 0, y: 0 };
        await seedThread(ask.id, [
          { user: 'q1', ai: 'a1' },
          { user: 'q2', ai: 'a2' },
        ]);
        const row = await personaThread('ask1');
        await db.canvasPersonaThreads.put({
          ...row!,
          messages: row!.messages.filter((m) => m.text !== 'q1' && m.text !== 'a1'),
        });

        const { result } = renderHook(() => useTestAiActions({ dynamicNodes: [ask] }));
        await act(async () => {
          await result.current.runAskCardGeneration('ask1', 'q3');
        });
        const call = vi.mocked(callUniversalAI).mock.calls.at(-1)![0] as {
          messages?: Array<{ role: string; content: unknown }>;
        };
        const flat = call.messages!.map((m) => String(m.content));
        expect(flat).toContain('q2');
        expect(flat).toContain('a2');
        expect(flat).not.toContain('a1');
        expect(flat).not.toContain('q1');
      });

      it('历史超过 20 轮时只保留最近 20 轮(老轮被丢)', async () => {
        const ask: CanvasNode = { id: 'ask1', canvasId: 'default', type: 'ask', x: 0, y: 0 };
        const rounds = Array.from({ length: 25 }, (_, i) => ({
          user: `q${i + 1}`,
          ai: `a${i + 1}`,
        }));
        await seedThread(ask.id, rounds);

        const { result } = renderHook(() => useTestAiActions({ dynamicNodes: [ask] }));
        await act(async () => {
          await result.current.runAskCardGeneration('ask1', 'q-new');
        });
        const call = vi.mocked(callUniversalAI).mock.calls.at(-1)![0] as {
          messages?: Array<{ role: string; content: unknown }>;
        };
        const flat = call.messages!.map((m) => String(m.content));
        expect(flat).not.toContain('q1');
        expect(flat).not.toContain('q5');
        expect(flat).toContain('q6');
        expect(flat).toContain('q25');
        const thread = await personaThread('ask1');
        expect(thread?.messages.filter((m) => m.role === 'user').at(-1)?.text).toBe('q-new');
      });
    });

    it('连续两轮追加到同一侧栏线程', async () => {
      const ask: CanvasNode = { id: 'ask1', canvasId: 'default', type: 'ask', x: 0, y: 0 };
      await db.nodes.add(ask);
      const { result } = renderHook(() => useTestAiActions({ dynamicNodes: [ask], edges: [] }));
      await act(async () => {
        await result.current.runAskCardGeneration('ask1', 'q1');
      });
      await act(async () => {
        await result.current.runAskCardGeneration('ask1', 'q2');
      });
      const thread = await personaThread('ask1');
      expect(thread?.messages.filter((m) => m.role === 'user').map((m) => m.text)).toEqual(['q1', 'q2']);
      expect((await db.nodes.toArray()).filter((n) => n.type === 'ai')).toHaveLength(0);
    });


  });

  // --- runAskCardGeneration persona substitution ---
  // V2：点阿狸永远是阿狸；角色人设只在点角色卡时生效。连线不再换嘴。
  // V1：阿狸连到角色卡时仍可借用该人格。
  describe('runAskCardGeneration persona substitution', () => {
    const personaPrompt =
      '你是海龟汤游戏的主持人。开局出一道汤面。每轮只用 是 / 不是 / 与此无关 回答。';


    it('ask 卡未连到角色时即使画布上有主持人,system 仍走阿狸身份', async () => {
      const askNode: CanvasNode = { id: 'ask1', canvasId: 'default', type: 'ask', x: 0, y: 0 };
      const personaNode: CanvasNode = {
        id: 'host1',
        canvasId: 'default',
        type: 'agent',
        agentConfigId: 'intuition_pump_expert',
        x: 100,
        y: 100,
      };
      const persona: AgentConfig = {
        id: 'intuition_pump_expert',
        name: '直觉泵专家',
        role: '思想实验设计师',
        prompt: '你是直觉泵专家，设计思想实验。',
      };
      const { result } = renderHook(() =>
        useTestAiActions({
          dynamicNodes: [askNode, personaNode],
          edges: [],
          agentConfigs: [persona],
        }),
      );
      await act(async () => {
        await result.current.runAskCardGeneration('ask1', '换个角度');
      });
      const call = vi.mocked(callUniversalAI).mock.calls.at(-1)![0] as {
        systemInstruction?: string;
      };
      expect(call.systemInstruction).toMatch(/Your name is 阿狸/);
      expect(call.systemInstruction).not.toMatch(/直觉泵专家/);
    });

    it('画布上没有 agent 卡时回退到默认阿狸身份(回归保证)', async () => {
      const askNode: CanvasNode = { id: 'ask1', canvasId: 'default', type: 'ask', x: 0, y: 0 };
      const { result } = renderHook(() => useTestAiActions({ dynamicNodes: [askNode] }));
      await act(async () => {
        await result.current.runAskCardGeneration('ask1', 'hello');
      });
      expect(callUniversalAI).toHaveBeenCalledWith(
        expect.objectContaining({
          systemInstruction: expect.stringMatching(/Your name is 阿狸/),
        }),
      );
    });

    it('agent 卡存在但 agentConfigs 里找不到对应 persona 时回退到阿狸', async () => {
      // agentConfigId 指向已被删除的 persona 时,不能让 system 崩溃,
      // 也不应该注入空 prompt —— 应回退到默认 Ask 身份。
      const askNode: CanvasNode = { id: 'ask1', canvasId: 'default', type: 'ask', x: 0, y: 0 };
      const orphanAgent: CanvasNode = {
        id: 'host1',
        canvasId: 'default',
        type: 'agent',
        agentConfigId: 'deleted_persona',
        x: 100,
        y: 100,
      };
      const { result } = renderHook(() =>
        useTestAiActions({
          dynamicNodes: [askNode, orphanAgent],
          edges: [{ id: 'e1', from: 'ask1', to: 'host1', canvasId: 'default' }],
          agentConfigs: [],
        }),
      );
      await act(async () => {
        await result.current.runAskCardGeneration('ask1', 'hello');
      });
      expect(callUniversalAI).toHaveBeenCalledWith(
        expect.objectContaining({
          systemInstruction: expect.stringMatching(/Your name is 阿狸/),
        }),
      );
    });

    it('persona 路径下 system 仍然包含笔记上下文与语音概览说明', async () => {
      const askNode: CanvasNode = { id: 'ask1', canvasId: 'default', type: 'ask', x: 0, y: 0 };
      const noteNode: CanvasNode = {
        id: 'n1',
        canvasId: 'default',
        type: 'note',
        x: 50,
        y: 50,
        content: '',
        contextScopeAgentId: 'ask1',
      };
      const agentNode: CanvasNode = {
        id: 'host1',
        canvasId: 'default',
        type: 'agent',
        agentConfigId: 'turtle_soup_host',
        x: 100,
        y: 100,
      };
      const persona: AgentConfig = {
        id: 'turtle_soup_host',
        name: '海龟汤主持人',
        role: '情境推理主持',
        prompt: personaPrompt,
      };
      const { result } = renderHook(() =>
        useTestAiActions({
          dynamicNodes: [askNode, noteNode, agentNode],
          edges: [
            { id: 'e1', from: 'ask1', to: 'host1', canvasId: 'default' },
            { id: 'e2', from: 'ask1', to: 'n1', canvasId: 'default' },
          ],
          agentConfigs: [persona],
        }),
      );
      act(() => {
        const el = document.createElement('div');
        el.innerText = 'CONTEXT_NOTE_BODY';
        result.current.nodesRef.current['n1'] = el;
      });
      await act(async () => {
        await result.current.runAskCardGeneration('ask1', '开局', { voiceBrief: true });
      });
      const call = vi.mocked(callUniversalAI).mock.calls.at(-1)![0] as {
        systemInstruction?: string;
      };
      expect(call.systemInstruction).toMatch(/Your name is 阿狸/);
      expect(call.systemInstruction).toMatch(/CONTEXT_NOTE_BODY/);
      expect(call.systemInstruction).toMatch(/speak/i);
      expect(call.systemInstruction).not.toMatch(/海龟汤游戏的主持人/);
    });

    it('点阿狸提问时即使用连线挂着角色卡也走阿狸', async () => {
      const askNode: CanvasNode = { id: 'ask1', canvasId: 'default', type: 'ask', x: 0, y: 0 };
      const agentNode: CanvasNode = {
        id: 'host1',
        canvasId: 'default',
        type: 'agent',
        agentConfigId: 'turtle_soup_host',
        x: 100,
        y: 100,
      };
      const persona: AgentConfig = {
        id: 'turtle_soup_host',
        name: '海龟汤主持人',
        role: '情境推理主持',
        prompt: personaPrompt,
      };
      const { result } = renderHook(() =>
        useTestAiActions({
          dynamicNodes: [askNode, agentNode],
          edges: [{ id: 'e1', from: 'ask1', to: 'host1', canvasId: 'default' }],
          agentConfigs: [persona],
        }),
      );
      await act(async () => {
        await result.current.sendPersonaMessage('ask1', '开局');
      });
      const call = vi.mocked(callUniversalAI).mock.calls.at(-1)![0] as {
        systemInstruction?: string;
      };
      expect(call.systemInstruction).toMatch(/Your name is 阿狸/);
      expect(call.systemInstruction).not.toMatch(/海龟汤游戏的主持人/);
    });

    it('composer 圈选时 focus 正文进 user、[1] 编号，system 仅保留背景', async () => {
      const askNode: CanvasNode = { id: 'ask1', canvasId: 'default', type: 'ask', x: 0, y: 0 };
      const focusNote: CanvasNode = {
        id: 'focus1',
        canvasId: 'default',
        type: 'note',
        x: 10,
        y: 10,
        content: 'focus body',
        contextScopeAgentId: 'ask1',
      };
      const bgNote: CanvasNode = {
        id: 'bg1',
        canvasId: 'default',
        type: 'note',
        x: 20,
        y: 20,
        content: 'background body',
        contextScopeAgentId: 'ask1',
      };
      const { result } = renderHook(() =>
        useTestAiActions({
          dynamicNodes: [askNode, focusNote, bgNote],
          selectedNodes: new Set(['focus1']),
        }),
      );
      act(() => {
        const el = document.createElement('div');
        el.innerText = 'focus body';
        result.current.nodesRef.current['focus1'] = el;
        const bgEl = document.createElement('div');
        bgEl.innerText = 'background body';
        result.current.nodesRef.current['bg1'] = bgEl;
      });
      await act(async () => {
        await result.current.sendPersonaMessage('ask1', '请改写', {
          composerSegments: [
            { type: 'card', nodeId: 'focus1' },
            { type: 'text', content: '请改写' },
          ],
        });
      });
      const call = vi.mocked(callUniversalAI).mock.calls.at(-1)![0] as {
        systemInstruction?: string;
        messages?: Array<{ role: string; content: string }>;
      };
      expect(call.systemInstruction).toMatch(/background body/);
      expect(call.systemInstruction).not.toMatch(/focus body/);
      expect(call.systemInstruction).not.toMatch(/本轮重点|focus_context/);
      const userTurn = call.messages?.at(-1)?.content ?? '';
      expect(userTurn).toMatch(/^\[1\] focus body/);
      expect(userTurn).toContain('请改写');
      const thread = await personaThread('ask1');
      expect(thread?.messages.some((m) => m.role === 'user' && m.text.includes('[1] focus body'))).toBe(
        true,
      );
    });

    it('点角色卡提问时用该人格，而不是阿狸 Ask', async () => {
      const askNode: CanvasNode = { id: 'ask1', canvasId: 'default', type: 'ask', x: 0, y: 0 };
      const turtleNode: CanvasNode = {
        id: 'host1',
        canvasId: 'default',
        type: 'agent',
        agentConfigId: 'turtle_soup_host',
        x: 100,
        y: 100,
      };
      const pumpNode: CanvasNode = {
        id: 'host2',
        canvasId: 'default',
        type: 'agent',
        agentConfigId: 'intuition_pump_expert',
        x: 200,
        y: 100,
      };
      const turtle: AgentConfig = {
        id: 'turtle_soup_host',
        name: '海龟汤主持人',
        role: '情境推理主持',
        prompt: personaPrompt,
      };
      const pump: AgentConfig = {
        id: 'intuition_pump_expert',
        name: '直觉泵专家',
        role: '思想实验设计师',
        prompt: '你是直觉泵专家，设计思想实验。',
      };
      const { result } = renderHook(() =>
        useTestAiActions({
          dynamicNodes: [askNode, turtleNode, pumpNode],
          edges: [],
          agentConfigs: [turtle, pump],
        }),
      );
      await act(async () => {
        await result.current.runAskCardGeneration('host2', '开局', {
          voiceBrief: true,
        });
      });
      const call = vi.mocked(callUniversalAI).mock.calls.at(-1)![0] as {
        systemInstruction?: string;
      };
      expect(call.systemInstruction).toMatch(/直觉泵专家/);
      expect(call.systemInstruction).not.toMatch(/海龟汤游戏的主持人/);
      expect(call.systemInstruction).not.toMatch(/Your name is 阿狸/);
    });

    it('toolbar pin preferredAgentNodeId=null 即使有角色卡也走阿狸', async () => {
      const askNode: CanvasNode = { id: 'ask1', canvasId: 'default', type: 'ask', x: 0, y: 0 };
      const agentNode: CanvasNode = {
        id: 'host1',
        canvasId: 'default',
        type: 'agent',
        agentConfigId: 'turtle_soup_host',
        x: 100,
        y: 100,
      };
      const persona: AgentConfig = {
        id: 'turtle_soup_host',
        name: '海龟汤主持人',
        role: '情境推理主持',
        prompt: personaPrompt,
      };
      const { result } = renderHook(() =>
        useTestAiActions({
          dynamicNodes: [askNode, agentNode],
          edges: [],
          agentConfigs: [persona],
        }),
      );
      await act(async () => {
        await result.current.runAskCardGeneration('ask1', 'hello', {
          voiceBrief: true,
          preferredAgentNodeId: null,
        });
      });
      expect(callUniversalAI).toHaveBeenCalledWith(
        expect.objectContaining({
          systemInstruction: expect.stringMatching(/Your name is 阿狸/),
        }),
      );
    });

    it('两个角色卡各自追问互不带入对方历史', async () => {
      const turtleNode: CanvasNode = {
        id: 'host1',
        canvasId: 'default',
        type: 'agent',
        agentConfigId: 'turtle_soup_host',
        x: 0,
        y: 0,
      };
      const pumpNode: CanvasNode = {
        id: 'host2',
        canvasId: 'default',
        type: 'agent',
        agentConfigId: 'intuition_pump_expert',
        x: 200,
        y: 0,
      };
      const turtle: AgentConfig = {
        id: 'turtle_soup_host',
        name: '海龟汤主持人',
        role: '情境推理主持',
        prompt: personaPrompt,
      };
      const pump: AgentConfig = {
        id: 'intuition_pump_expert',
        name: '直觉泵专家',
        role: '思想实验设计师',
        prompt: '你是直觉泵专家，设计思想实验。',
      };
      await db.canvasPersonaThreads.put({
        id: 'default:host1',
        canvasId: 'default',
        agentNodeId: 'host1',
        messages: [
          { id: 'u0', role: 'user', text: '开一局海龟汤', createdAt: 1 },
          { id: 'a0', role: 'assistant', text: '汤面：男人走进餐厅', createdAt: 2 },
        ],
        updatedAt: Date.now(),
      });
      const { result } = renderHook(() =>
        useTestAiActions({
          dynamicNodes: [turtleNode, pumpNode],
          agentConfigs: [turtle, pump],
        }),
      );
      await act(async () => {
        await result.current.runAskCardGeneration('host2', '换个角度');
      });
      const call = vi.mocked(callUniversalAI).mock.calls.at(-1)![0] as {
        systemInstruction?: string;
        messages?: Array<{ role: string; content: unknown }>;
      };
      expect(call.systemInstruction).toMatch(/直觉泵专家/);
      expect(call.systemInstruction).not.toMatch(/海龟汤游戏的主持人/);
      const joined = (call.messages ?? []).map((m) => String(m.content)).join('\n');
      expect(joined).not.toMatch(/开一局海龟汤/);
      expect(joined).not.toMatch(/汤面：男人走进餐厅/);
      expect(joined).toMatch(/换个角度/);
      const pumpThread = await personaThread('host2');
      expect(pumpThread?.messages.some((m) => m.text === '换个角度')).toBe(true);
    });

    it('海龟汤主持人在侧栏出题，汤底只存在会话里、不写画布卡片', async () => {
      const host: CanvasNode = {
        id: 'host1',
        canvasId: 'default',
        type: 'agent',
        agentConfigId: 'turtle_soup_host',
        x: 0,
        y: 0,
      };
      const persona: AgentConfig = {
        id: 'turtle_soup_host',
        name: '海龟汤主持人',
        role: '情境推理主持',
        prompt: personaPrompt,
      };
      mockCallUniversalAIWithStream(JSON.stringify({
        language: 'zh',
        title: '两套餐具',
        surface: '桌上摆了两套餐具。',
        secret_solution: '他在等一个不会来的人。',
        key_facts: ['他只点了一人份'],
      }));
      const { result } = renderHook(() =>
        useTestAiActions({ dynamicNodes: [host], agentConfigs: [persona] }),
      );
      await act(async () => {
        await result.current.runAskCardGeneration('host1', '开局');
      });
      const call = vi.mocked(callUniversalAI).mock.calls.at(-1)![0];
      expect(call.systemInstruction).toMatch(/海龟汤游戏的主持人/);
      expect(String(call.systemInstruction)).not.toMatch(/search the web|draw tool/i);
      const sentUser = String([...(call.messages ?? [])].reverse().find((m) => m.role === 'user')?.content);
      expect(sentUser).toMatch(/开局/);
      expect(sentUser).toMatch(/THIS CALL IS SETTER-ONLY/);
      const thread = await personaThread('host1');
      expect(thread?.messages[0]?.text).toBe('开局');
      expect(thread?.messages[1]?.text).toMatch(/汤面：桌上摆了两套餐具/);
      expect(thread?.messages[1]?.text).not.toMatch(/不会来的人/);
      expect(thread?.messages[1]?.turtleSoupRound?.secret_solution).toBe('他在等一个不会来的人。');
      expect((await db.nodes.toArray()).filter((n) => n.type === 'ai')).toHaveLength(0);
    });

    it('海龟汤追问走裁判包，侧栏不展示汤底', async () => {
      const host: CanvasNode = {
        id: 'host1',
        canvasId: 'default',
        type: 'agent',
        agentConfigId: 'turtle_soup_host',
        x: 0,
        y: 0,
      };
      const persona: AgentConfig = {
        id: 'turtle_soup_host',
        name: '海龟汤主持人',
        role: '情境推理主持',
        prompt: personaPrompt,
      };
      const round = {
        status: 'playing' as const,
        language: 'zh' as const,
        title: '两套餐具',
        surface: '桌上摆了两套餐具。',
        secret_solution: '他在等一个不会来的人。',
        key_facts: ['他只点了一人份'],
      };
      await db.canvasPersonaThreads.put({
        id: 'default:host1',
        canvasId: 'default',
        agentNodeId: 'host1',
        updatedAt: 1,
        messages: [
          { id: 'u0', role: 'user', text: '开局', createdAt: 1 },
          {
            id: 'a0',
            role: 'assistant',
            text: '两套餐具\n\n汤面：桌上摆了两套餐具。',
            createdAt: 2,
            turtleSoupRound: round,
          },
        ],
      });
      mockCallUniversalAIWithStream(JSON.stringify({
        secret_solution: '他在等一个不会来的人。',
      }));
      const { result } = renderHook(() =>
        useTestAiActions({ dynamicNodes: [host], agentConfigs: [persona] }),
      );
      await act(async () => {
        await result.current.sendPersonaMessage('host1', '他是一个人来的吗？');
      });
      const call = vi.mocked(callUniversalAI).mock.calls.at(-1)![0];
      const sentUser = String([...(call.messages ?? [])].reverse().find((m) => m.role === 'user')?.content);
      expect(sentUser).toMatch(/他是一个人来的吗/);
      expect(sentUser).toMatch(/REFEREE PACKET/);
      expect(sentUser).toMatch(/他在等一个不会来的人/);
      const thread = await personaThread('host1');
      const storedUser = thread?.messages.find((m) => m.text === '他是一个人来的吗？');
      expect(storedUser?.text).not.toMatch(/REFEREE PACKET/);
      const reply = thread?.messages.at(-1);
      expect(reply?.text).toBe(i18n.t('nodes.turtle_soup_output_hidden'));
      expect(reply?.text).not.toMatch(/不会来的人/);
      expect(reply?.turtleSoupRound?.secret_solution).toBe('他在等一个不会来的人。');
    });
  });

  // --- triggerAgentAnalysis ---
  describe('triggerAgentAnalysis', () => {
    it('agentConfigId 不存在时提前返回', async () => {
      const { result } = renderHook(() => useTestAiActions());

      await act(async () => {
        await result.current.triggerAgentAnalysis('nonexistent', 'node1', 'node2');
      });

      expect(callUniversalAI).not.toHaveBeenCalled();
    });

    it('传入 temperature、topP，且 system 含 Markdown 知识块', async () => {
      const agent: AgentConfig = {
        id: 'a1',
        name: 'Test',
        role: 'R',
        prompt: 'You are test',
        temperature: 0.3,
        creativity: 0.9,
        knowledgeMarkdownFiles: [{ name: 'doc.md', content: 'Hello knowledge' }],
      };

      const { result } = renderHook(() =>
        useTestAiActions({
          agentConfigs: [agent],
          dynamicNodes: [
            { id: 'agent-node', type: 'agent', agentConfigId: 'a1', x: 0, y: 0, canvasId: 'default' },
            {
              id: 'ctx1',
              type: 'note',
              x: 40,
              y: 0,
              canvasId: 'default',
              content: 'context body',
              contextScopeAgentId: 'agent-node',
            },
          ],
        }),
      );

      act(() => {
        const el = document.createElement('div');
        el.appendChild(document.createTextNode('context body'));
        result.current.nodesRef.current.ctx1 = el;
      });

      await act(async () => {
        await result.current.triggerAgentAnalysis('a1', 'agent-node', 'ctx1');
      });

      expect(callUniversalAI).toHaveBeenCalledTimes(1);
      expect(callUniversalAI).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.3,
          topP: 0.9,
          systemInstruction: expect.stringMatching(/Markdown knowledge base[\s\S]*doc\.md[\s\S]*Hello knowledge/),
        }),
      );
      const sys = String(vi.mocked(callUniversalAI).mock.calls[0]![0].systemInstruction);
      expect(sys).toMatch(/context body/);
      const thread = await personaThread('agent-node');
      expect(thread?.messages).toHaveLength(2);
      expect(thread?.messages[0]?.role).toBe('user');
      expect((await db.nodes.toArray()).filter((n) => n.type === 'ai')).toHaveLength(0);
    });

    it('工作区图片会作为分析附图传入模型', async () => {
      const tinyPng =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const agent: AgentConfig = {
        id: 'a1',
        name: 'Test',
        role: 'R',
        prompt: 'You are test',
        temperature: 0.7,
        creativity: 0.4,
      };

      const { result } = renderHook(() =>
        useTestAiActions({
          agentConfigs: [agent],
          dynamicNodes: [
            { id: 'agent-node', type: 'agent', agentConfigId: 'a1', x: 0, y: 0, canvasId: 'default' },
            {
              id: 'img1',
              type: 'image',
              content: tinyPng,
              x: 0,
              y: 0,
              canvasId: 'default',
              contextScopeAgentId: 'agent-node',
            },
            {
              id: 'ctx1',
              type: 'note',
              x: 20,
              y: 0,
              canvasId: 'default',
              content: 'note text',
              contextScopeAgentId: 'agent-node',
            },
          ],
        }),
      );

      act(() => {
        const el = document.createElement('div');
        el.appendChild(document.createTextNode('note text'));
        result.current.nodesRef.current.ctx1 = el;
      });

      await act(async () => {
        await db.nodes.add({
          id: 'ai-reuse',
          canvasId: 'default',
          type: 'ai',
          content: 'old',
          x: 100,
          y: 0,
        });
        await result.current.triggerAgentAnalysis('a1', 'agent-node', 'ctx1', {
          reuseNodeId: 'ai-reuse',
        });
      });

      expect(callUniversalAI).toHaveBeenCalledWith(
        expect.objectContaining({
          images: [tinyPng],
        }),
      );
      const call = vi.mocked(callUniversalAI).mock.calls[0]![0] as { prompt?: string };
      expect(String(call.prompt)).toMatch(/note text/);
    });
  });

  describe('continueAgentDiscussion', () => {
    const agents: AgentConfig[] = [
      { id: 'cosmos_weaver', name: 'Weaver', role: 'W', prompt: 'p', temperature: 0.7, creativity: 0.4 },
      { id: 'character_atelier', name: 'Atelier', role: 'C', prompt: 'p', temperature: 0.7, creativity: 0.4 },
    ];

    const discussionNodes = (): CanvasNode[] => [
      { id: 'note1', canvasId: 'default', type: 'note', content: 'pain', x: 0, y: 0, contextScopeAgentId: 'hub' },
      { id: 'hub', canvasId: 'default', type: 'agent', agentConfigId: 'cosmos_weaver', x: 0, y: 0 },
      {
        id: 'ai-a',
        canvasId: 'default',
        type: 'ai',
        content: 'A speaks',
        userTurn: 'Weaver',
        x: 400,
        y: 0,
        threadRootContextNodeId: 'note1',
        threadAgentConfigId: 'cosmos_weaver',
        threadDiscussionId: 'disc-1',
        threadDiscussionAgentIds: ['character_atelier', 'cosmos_weaver'],
        threadDiscussionTurnIndex: 0,
      },
      {
        id: 'ai-b',
        canvasId: 'default',
        type: 'ai',
        content: 'B speaks',
        userTurn: 'Atelier',
        x: 400,
        y: 200,
        threadRootContextNodeId: 'note1',
        threadAgentConfigId: 'character_atelier',
        threadDiscussionId: 'disc-1',
        threadDiscussionAgentIds: ['character_atelier', 'cosmos_weaver'],
        threadDiscussionTurnIndex: 1,
      },
    ];

    const discussionEdges = [
      { id: 'e0', canvasId: 'default', from: 'hub', to: 'ai-a' },
      { id: 'e1', canvasId: 'default', from: 'ai-a', to: 'ai-b' },
    ];

    it('从讨论末卡再追加一对一来回', async () => {
      const nodes = discussionNodes();
      await db.nodes.bulkPut(nodes);
      await db.edges.bulkPut(discussionEdges);

      const { result } = renderHook(() =>
        useTestAiActions({ agentConfigs: agents, dynamicNodes: nodes, edges: discussionEdges }),
      );
      act(() => {
        const el = document.createElement('div');
        el.innerText = 'pain body';
        result.current.nodesRef.current.note1 = el;
      });

      await act(async () => {
        await result.current.continueAgentDiscussion('ai-b');
      });

      expect(callUniversalAI).toHaveBeenCalledTimes(2);
      const ai = (await db.nodes.toArray()).filter((n) => n.type === 'ai');
      expect(ai).toHaveLength(4);
      const newest = ai.filter((n) => n.id !== 'ai-a' && n.id !== 'ai-b');
      expect(newest.map((n) => n.threadDiscussionTurnIndex).sort()).toEqual([2, 3]);
      expect(newest.every((n) => n.threadDiscussionId === 'disc-1')).toBe(true);
      const historyPrompt = String(vi.mocked(callUniversalAI).mock.calls[0]![0].prompt ?? '');
      expect(historyPrompt).toMatch(/A speaks/);
      expect(historyPrompt).toMatch(/B speaks/);
    });

    it('中间卡不是末卡时不继续', async () => {
      const nodes = discussionNodes();
      await db.nodes.bulkPut(nodes);
      await db.edges.bulkPut(discussionEdges);

      const { result } = renderHook(() =>
        useTestAiActions({ agentConfigs: agents, dynamicNodes: nodes, edges: discussionEdges }),
      );

      await act(async () => {
        await result.current.continueAgentDiscussion('ai-a');
      });

      expect(callUniversalAI).not.toHaveBeenCalled();
    });
  });

  describe('加载状态标志', () => {
    it('初始均为空闲', () => {
      const { result } = renderHook(() => useTestAiActions());
      expect(result.current.isPublishing).toBe(false);
      expect(result.current.streamingAiNodeId).toBe(null);
      expect(result.current.streamingAskNodeId).toBe(null);
      expect(result.current.analyzingAgentNodeId).toBe(null);
      expect(result.current.generatingCoverAgentId).toBe(null);
      expect(result.current.isAnyAiBusy).toBe(false);
    });
  });

  describe('generateAgentCover', () => {
    const agent: AgentConfig = {
      id: 'ag1',
      name: '阿狸',
      role: '绘本旅人',
      prompt: '温柔安静',
    };

    it('缺少 302 密钥时不调用生图', async () => {
      await db.agents.add(agent);
      const { result } = renderHook(() => useTestAiActions({ agentConfigs: [agent] }));

      await act(async () => {
        await result.current.generateAgentCover('ag1');
      });

      expect(generateGptImage2).not.toHaveBeenCalled();
      expect(
        screen.getByText(
          'Add a 302.AI API key in Settings (or sign in with server-managed keys) to generate illustrations.',
        ),
      ).toBeInTheDocument();
    });

    it('已登录云端用户不需要本地 302 密钥', async () => {
      setServerConfig({
        session: {
          access_token: 'jwt-cover',
          refresh_token: 'rt',
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          token_type: 'bearer',
          user: { id: 'u1' } as never,
        } as never,
        useServerKeys: true,
        isPro: true,
      });
      await db.agents.add(agent);

      const { result } = renderHook(() => useTestAiActions({ agentConfigs: [agent] }));

      await act(async () => {
        await result.current.generateAgentCover('ag1');
      });

      expect(generateGptImage2).toHaveBeenCalled();
      expect((await db.agents.get('ag1'))?.coverImageUrl).toBe('https://img.example/cover.jpg');
    });

    it('生成封面并拉伸该人格的画布卡片', async () => {
      await db.agents.add(agent);
      await db.nodes.bulkAdd([
        { id: 'card-1', type: 'agent', agentConfigId: 'ag1', canvasId: 'default', x: 0, y: 0 },
        { id: 'note-1', type: 'note', agentConfigId: 'ag1', canvasId: 'default', x: 10, y: 10 },
      ]);

      const { result } = renderHook(() =>
        useTestAiActions({
          agentConfigs: [agent],
          aiConfigOverrides: { api302Key: 'sk-test' },
        }),
      );

      await act(async () => {
        await result.current.generateAgentCover('ag1');
      });

      expect(generateGptImage2).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'sk-test',
          size: '1536x1024',
          quality: 'high',
        }),
      );
      const prompt = vi.mocked(generateGptImage2).mock.calls[0][0].prompt;
      expect(prompt).toContain('阿狸');
      expect(prompt).toContain('温柔安静');
      expect(prompt).toContain('16:9');

      const saved = await db.agents.get('ag1');
      expect(saved?.coverImageUrl).toBe('https://img.example/cover.jpg');
      const card = await db.nodes.get('card-1');
      expect(card?.width).toBe(320);
      expect(card?.height).toBe(180);
      const note = await db.nodes.get('note-1');
      expect(note?.width).toBeUndefined();
      expect(result.current.generatingCoverAgentId).toBe(null);
    });
  });

  describe('parallel persona chat', () => {
    const cfgA: AgentConfig = {
      id: 'cfg-a',
      name: 'A',
      role: 'Ra',
      prompt: 'You are A',
    };
    const cfgB: AgentConfig = {
      id: 'cfg-b',
      name: 'B',
      role: 'Rb',
      prompt: 'You are B',
    };
    const nodeA: CanvasNode = {
      id: 'agent-a',
      canvasId: 'default',
      type: 'agent',
      agentConfigId: 'cfg-a',
      x: 0,
      y: 0,
    };
    const nodeB: CanvasNode = {
      id: 'agent-b',
      canvasId: 'default',
      type: 'agent',
      agentConfigId: 'cfg-b',
      x: 80,
      y: 0,
    };

    it('starts B while A is still streaming, and finishing A does not wipe B', async () => {
      let releaseA!: (text: string) => void;
      const hangA = new Promise<string>((resolve) => {
        releaseA = resolve;
      });
      let calls = 0;
      vi.mocked(callUniversalAI).mockImplementation(async (opts) => {
        calls += 1;
        if (calls === 1) {
          opts.onStreamChunk?.('partial-a');
          return hangA;
        }
        opts.onStreamChunk?.('reply-b');
        return 'reply-b';
      });

      const { result } = renderHook(() =>
        useTestAiActions({
          dynamicNodes: [nodeA, nodeB],
          agentConfigs: [cfgA, cfgB],
        }),
      );

      let first!: Promise<string | null>;
      act(() => {
        first = result.current.sendPersonaMessage('agent-a', 'hello A');
      });
      await vi.waitFor(() => expect(callUniversalAI).toHaveBeenCalledTimes(1));
      expect(result.current.personaStreams['agent-a']?.messageId).toBeTruthy();

      await act(async () => {
        await result.current.sendPersonaMessage('agent-b', 'hello B');
      });
      expect(callUniversalAI).toHaveBeenCalledTimes(2);
      const threadB = await personaThread('agent-b');
      expect(threadB?.messages.some((m) => m.text === 'hello B')).toBe(true);
      expect(threadB?.messages.some((m) => m.text === 'reply-b')).toBe(true);
      expect(result.current.personaStreams['agent-a']?.messageId).toBeTruthy();
      expect(result.current.personaStreams['agent-b']).toBeUndefined();

      await act(async () => {
        releaseA('reply-a');
        await first;
      });
      expect(result.current.personaStreams['agent-a']).toBeUndefined();
      const threadA = await personaThread('agent-a');
      expect(threadA?.messages.some((m) => m.text === 'hello A')).toBe(true);
      expect(threadA?.messages.some((m) => m.text === 'reply-a')).toBe(true);
      expect(threadB?.messages.some((m) => m.text === 'reply-b')).toBe(true);
    });

    it('blocks a second send to the same persona until the first turn finishes', async () => {
      let releaseA!: (text: string) => void;
      const hangA = new Promise<string>((resolve) => {
        releaseA = resolve;
      });
      vi.mocked(callUniversalAI).mockImplementation(async (opts) => {
        opts.onStreamChunk?.('partial-a');
        return hangA;
      });

      const { result } = renderHook(() =>
        useTestAiActions({
          dynamicNodes: [nodeA],
          agentConfigs: [cfgA],
        }),
      );

      let first!: Promise<string | null>;
      act(() => {
        first = result.current.sendPersonaMessage('agent-a', 'one');
      });
      await vi.waitFor(() => expect(callUniversalAI).toHaveBeenCalledTimes(1));

      await act(async () => {
        const second = await result.current.sendPersonaMessage('agent-a', 'two');
        expect(second).toBeNull();
      });
      expect(callUniversalAI).toHaveBeenCalledTimes(1);

      await act(async () => {
        releaseA('reply-a');
        await first;
      });
      const thread = await personaThread('agent-a');
      expect(thread?.messages.filter((m) => m.role === 'user')).toHaveLength(1);
    });
  });
});
