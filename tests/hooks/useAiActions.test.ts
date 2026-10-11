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

// 参数是**一个对象**（真函数是解构入参），用例断言的就是 mock 收到了这个对象，
// 所以必须原样透传；写成两个位置参数会把断言打翻。
const attachSuggestedFollowUpsMock = vi.hoisted(() =>
  vi.fn(async (_args: {
    threadId: string;
    messageId: string;
    config: unknown;
    userQuestion: string;
    t: unknown;
    sessionId?: string;
  }) => {}),
);

vi.mock('../../src/services/ai', () => ({
  callUniversalAI: vi.fn().mockResolvedValue(publishJsonResponse),
  formatAiError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  maskApiKeyForLog: (k: string) => (k ? `${k.slice(0, 2)}…` : ''),
}));

vi.mock('../../src/utils/suggestedFollowUps', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/suggestedFollowUps')>();
  return {
    ...actual,
    // 具名转发单个对象；`(...args: unknown[])` 展开进 mock 会报 TS2556。
    attachSuggestedFollowUpsToThreadMessage: ((
      arg: Parameters<typeof attachSuggestedFollowUpsMock>[0],
    ) => attachSuggestedFollowUpsMock(arg)) as typeof actual.attachSuggestedFollowUpsToThreadMessage,
  };
});

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

/** 抓一次 callUniversalAI 的入参：房间相关的断言都看 system 和 messages。 */
type CapturedCall = {
  systemInstruction?: string;
  messages?: Array<{ role: string; content: unknown }>;
};

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
    attachSuggestedFollowUpsMock.mockClear();
    attachSuggestedFollowUpsMock.mockResolvedValue(undefined);
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

    it('语音朗读拿不到汤底：念的和写下来的是同一份', async () => {
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
      const chunks: string[] = [];
      const { result } = renderHook(() =>
        useTestAiActions({ dynamicNodes: [host], agentConfigs: [persona] }),
      );
      await act(async () => {
        await result.current.runAskCardGeneration('host1', '开局', {
          onSpeakerStream: (chunk) => chunks.push(chunk.accumulated),
        });
      });
      // 汤底只留在会话里：念出来的这一路也不能漏
      const spoken = chunks.join('');
      expect(chunks.length).toBeGreaterThan(0);
      expect(spoken).toMatch(/桌上摆了两套餐具/);
      expect(spoken).not.toMatch(/不会来的人/);
      expect(spoken).not.toMatch(/secret_solution/);
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

  describe('suggested follow-ups', () => {
    it('asks for related questions after a canvas AI reply', async () => {
      const ask: CanvasNode = { id: 'ask1', canvasId: 'default', type: 'ask', x: 0, y: 0 };
      const { result } = renderHook(() => useTestAiActions({ dynamicNodes: [ask] }));
      await act(async () => {
        await result.current.sendPersonaMessage('ask1', '为什么少即是多');
      });
      expect(attachSuggestedFollowUpsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          userQuestion: '为什么少即是多',
          messageId: expect.any(String),
          threadId: 'default:ask1',
        }),
      );
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

  // --- 侧栏多角色房间 ---
  describe('multi-persona room', () => {
    const cfgA: AgentConfig = { id: 'cfg-a', name: 'Mirror', role: 'Ra', prompt: 'You are the mirror.' };
    const cfgB: AgentConfig = { id: 'cfg-b', name: 'Turtle', role: 'Rb', prompt: 'You are the turtle.' };
    const nodeA: CanvasNode = {
      id: 'agent-a', canvasId: 'default', type: 'agent', agentConfigId: 'cfg-a', x: 0, y: 0,
    };
    const nodeB: CanvasNode = {
      id: 'agent-b', canvasId: 'default', type: 'agent', agentConfigId: 'cfg-b', x: 80, y: 0,
    };
    const noteHost: CanvasNode = {
      id: 'note-a', canvasId: 'default', type: 'text', content: 'HOST MATERIAL',
      contextScopeAgentId: 'agent-a', x: 0, y: 300,
    };
    const notePeer: CanvasNode = {
      id: 'note-b', canvasId: 'default', type: 'text', content: 'PEER MATERIAL',
      contextScopeAgentId: 'agent-b', x: 320, y: 300,
    };

    async function seedRoom(participantNodeIds: string[], mutedNodeIds: string[] = []) {
      await db.canvasPersonaThreads.put({
        id: 'default:agent-a',
        canvasId: 'default',
        agentNodeId: 'agent-a',
        messages: [],
        participantNodeIds,
        mutedNodeIds,
        updatedAt: Date.now(),
      });
    }

    function replyWith(label: (n: number) => string) {
      let n = 0;
      vi.mocked(callUniversalAI).mockImplementation(async (opts) => {
        n += 1;
        const text = label(n);
        opts.onStreamChunk?.(text);
        return text;
      });
    }

    type CapturedCall = {
      systemInstruction?: string;
      messages?: Array<{ role: string; content: unknown }>;
    };

    it('has everyone in the room read the same material, host first then unmuted participants', async () => {
      await seedRoom(['agent-b']);
      replyWith((n) => `reply-${n}`);

      const { result } = renderHook(() =>
        useTestAiActions({
          dynamicNodes: [nodeA, nodeB, noteHost, notePeer],
          agentConfigs: [cfgA, cfgB],
        }),
      );

      await act(async () => {
        await result.current.sendPersonaMessage('agent-a', 'what do you two think?');
      });

      expect(callUniversalAI).toHaveBeenCalledTimes(2);
      const hostCall = vi.mocked(callUniversalAI).mock.calls[0]![0] as CapturedCall;
      const peerCall = vi.mocked(callUniversalAI).mock.calls[1]![0] as CapturedCall;

      // 房间是主 Agent 的房间：在场的人读同一份材料
      expect(hostCall.systemInstruction).toMatch(/HOST MATERIAL/);
      expect(peerCall.systemInstruction).toMatch(/HOST MATERIAL/);
      // 参与者自己房间里有什么，与这场讨论无关
      expect(hostCall.systemInstruction).not.toMatch(/PEER MATERIAL/);
      expect(peerCall.systemInstruction).not.toMatch(/PEER MATERIAL/);
      // 参与者知道房间里还有谁在说话
      expect(peerCall.systemInstruction).toMatch(/Mirror/);
      // 而且被明确告知：用户的话不是它说的（否则会出现"我打「你们」真是没多想"这种人称串位）
      expect(peerCall.systemInstruction).toContain("never speak in the user's first person");
      // 参与者拿到的是"参与者版"规则：不是在回答用户的新问题，而是回应其他角色
      expect(peerCall.systemInstruction).toContain('NOT answering a fresh question from the user');
      // 主人拿到的必须是"主人版"：先答用户的问题。以前给主人也发参与者版，
      // 一边说"你不是在回答用户"，一边 cue 说"针对用户的问题给出判断"，自相矛盾。
      expect(hostCall.systemInstruction).toContain('You are the host of this room');
      expect(hostCall.systemInstruction).not.toContain('NOT answering a fresh question from the user');

      const thread = await personaThread('agent-a');
      expect(
        thread!.messages
          .filter((m) => m.role === 'assistant')
          .map((m) => [m.speakerNodeId, m.speakerName, m.text]),
      ).toEqual([
        ['agent-a', 'Mirror', 'reply-1'],
        ['agent-b', 'Turtle', 'reply-2'],
      ]);
      // 后来的人看到别人说过的话带署名，自己说过的保持裸文本。
      const peerHistory = (peerCall.messages ?? []).map((m) => String(m.content));
      expect(peerHistory.some((c) => c.includes('Mirror: reply-1'))).toBe(true);
      expect(peerHistory.some((c) => c.includes('what do you two think?'))).toBe(true);
    });

    it('skips a muted participant', async () => {
      await seedRoom(['agent-b'], ['agent-b']);
      replyWith(() => 'host only');

      const { result } = renderHook(() =>
        useTestAiActions({
          dynamicNodes: [nodeA, nodeB, noteHost, notePeer],
          agentConfigs: [cfgA, cfgB],
        }),
      );

      await act(async () => {
        await result.current.sendPersonaMessage('agent-a', 'anyone there?');
      });

      expect(callUniversalAI).toHaveBeenCalledTimes(1);
      const thread = await personaThread('agent-a');
      const replies = thread!.messages.filter((m) => m.role === 'assistant');
      expect(replies).toHaveLength(1);
      // 不是"房间功能整体没生效"，而是房间生效了、只是这个人被禁言
      expect(replies[0]!.speakerNodeId).toBe('agent-a');
      expect(thread!.messages.every((m) => m.speakerNodeId !== 'agent-b')).toBe(true);
      const hostCall = vi.mocked(callUniversalAI).mock.calls[0]![0] as CapturedCall;
      expect(hostCall.systemInstruction).toMatch(/Not speaking this round: Turtle/);
    });

    it('ends a participant request with a user turn', async () => {
      await seedRoom(['agent-b']);
      replyWith((n) => `reply-${n}`);

      const { result } = renderHook(() =>
        useTestAiActions({
          dynamicNodes: [nodeA, nodeB, noteHost, notePeer],
          agentConfigs: [cfgA, cfgB],
        }),
      );

      await act(async () => {
        await result.current.sendPersonaMessage('agent-a', 'go');
      });

      const peerMessages = (vi.mocked(callUniversalAI).mock.calls[1]![0] as CapturedCall)
        .messages!;
      expect(peerMessages.length).toBeGreaterThan(0);
      expect(peerMessages[peerMessages.length - 1]!.role).toBe('user');
      // 主 Agent 那一路本来就已经以用户轮结尾，没被这次改动带偏
      const hostMessages = (vi.mocked(callUniversalAI).mock.calls[0]![0] as CapturedCall)
        .messages!;
      expect(hostMessages[hostMessages.length - 1]!.role).toBe('user');
    });

    it('stops the round and records the failure when a participant turn throws', async () => {
      const cfgC: AgentConfig = { id: 'cfg-c', name: 'Owl', role: 'Rc', prompt: 'You are the owl.' };
      const nodeC: CanvasNode = {
        id: 'agent-c', canvasId: 'default', type: 'agent', agentConfigId: 'cfg-c', x: 160, y: 0,
      };
      await seedRoom(['agent-b', 'agent-c']);
      let n = 0;
      vi.mocked(callUniversalAI).mockImplementation(async (opts) => {
        n += 1;
        if (n === 1) {
          opts.onStreamChunk?.('host reply');
          return 'host reply';
        }
        throw new Error('provider exploded');
      });

      const { result } = renderHook(() =>
        useTestAiActions({
          dynamicNodes: [nodeA, nodeB, nodeC, noteHost, notePeer],
          agentConfigs: [cfgA, cfgB, cfgC],
        }),
      );

      await act(async () => {
        await result.current.sendPersonaMessage('agent-a', 'go');
      });

      // 主 Agent + 第一个参与者，之后就止损了
      expect(callUniversalAI).toHaveBeenCalledTimes(2);
      const thread = await personaThread('agent-a');
      const replies = thread!.messages.filter((m) => m.role === 'assistant');
      expect(replies.map((m) => m.speakerNodeId)).toEqual(['agent-a', 'agent-b']);
      expect(replies[0]!.text).toBe('host reply');
      expect((replies[1]!.text ?? '').trim().length).toBeGreaterThan(0);
      expect(thread!.messages.some((m) => m.speakerNodeId === 'agent-c')).toBe(false);
      // 流式槽位全部释放，下一轮还能发出去
      expect(result.current.personaStreams['agent-a']).toBeUndefined();
      expect(result.current.personaStreams['agent-b']).toBeUndefined();
      expect(result.current.personaStreams['agent-c']).toBeUndefined();
    });

    it('hands each speaker’s stream to the voice layer, labelled with whose reply it is', async () => {
      await seedRoom(['agent-b']);
      replyWith((n) => `reply-${n}`);
      const chunks: Array<{ messageId: string; speakerNodeId: string; accumulated: string }> = [];

      const { result } = renderHook(() =>
        useTestAiActions({
          dynamicNodes: [nodeA, nodeB, noteHost, notePeer],
          agentConfigs: [cfgA, cfgB],
        }),
      );

      await act(async () => {
        await result.current.sendPersonaMessage('agent-a', 'go', {
          onSpeakerStream: (chunk) => chunks.push(chunk),
        });
      });

      const thread = await personaThread('agent-a');
      const replies = thread!.messages.filter((m) => m.role === 'assistant');
      // 说话顺序 = 回调顺序；消息 id 是这条回复自己的，语音层据此按人分音色。
      expect(chunks.map((c) => [c.speakerNodeId, c.accumulated])).toEqual([
        ['agent-a', 'reply-1'],
        ['agent-b', 'reply-2'],
      ]);
      expect(chunks.map((c) => c.messageId)).toEqual([replies[0]!.id, replies[1]!.id]);
    });

    it('keeps a single-persona thread unsigned and single-call', async () => {
      replyWith(() => 'solo reply');

      const { result } = renderHook(() =>
        useTestAiActions({
          dynamicNodes: [nodeA, noteHost],
          agentConfigs: [cfgA],
        }),
      );

      await act(async () => {
        await result.current.sendPersonaMessage('agent-a', 'just you');
      });

      expect(callUniversalAI).toHaveBeenCalledTimes(1);
      const thread = await personaThread('agent-a');
      const reply = thread!.messages.find((m) => m.role === 'assistant')!;
      expect(reply.text).toBe('solo reply');
      expect(reply.speakerNodeId).toBeUndefined();
      expect(reply.speakerName).toBeUndefined();
    });

    it('drops a participant whose card was deleted instead of failing the turn', async () => {
      await seedRoom(['agent-b', 'agent-gone']);
      replyWith(() => 'ok');

      const { result } = renderHook(() =>
        useTestAiActions({
          dynamicNodes: [nodeA, noteHost],
          agentConfigs: [cfgA],
        }),
      );

      await act(async () => {
        await result.current.sendPersonaMessage('agent-a', 'still fine?');
      });

      expect(callUniversalAI).toHaveBeenCalledTimes(1);
      const thread = await personaThread('agent-a');
      expect(thread!.messages.some((m) => m.text === 'ok')).toBe(true);
    });

    it('shows the host who said what in a room, but not its own words', async () => {
      await seedRoom(['agent-b']);
      await db.canvasPersonaThreads.put({
        id: 'default:agent-a',
        canvasId: 'default',
        agentNodeId: 'agent-a',
        messages: [
          { id: 'u0', role: 'user', text: '开场白', createdAt: 1 },
          { id: 'a0', role: 'assistant', text: 'host said this', createdAt: 2, speakerNodeId: 'agent-a', speakerName: 'Mirror' },
          { id: 'a1', role: 'assistant', text: 'peer said this', createdAt: 3, speakerNodeId: 'agent-b', speakerName: 'Turtle' },
        ],
        participantNodeIds: ['agent-b'],
        mutedNodeIds: [],
        updatedAt: Date.now(),
      });
      replyWith(() => 'next');

      const { result } = renderHook(() =>
        useTestAiActions({
          dynamicNodes: [nodeA, nodeB, noteHost, notePeer],
          agentConfigs: [cfgA, cfgB],
        }),
      );

      await act(async () => {
        await result.current.sendPersonaMessage('agent-a', '接着聊');
      });

      const hostHistory = (vi.mocked(callUniversalAI).mock.calls[0]![0] as CapturedCall)
        .messages!.map((m) => String(m.content));
      expect(hostHistory.some((c) => c.includes('Turtle: peer said this'))).toBe(true);
      expect(hostHistory.some((c) => c.includes('host said this'))).toBe(true);
      expect(hostHistory.some((c) => c.includes('Mirror: host said this'))).toBe(false);
    });

    it('tells a peer that unsigned old replies came from the host', async () => {
      await seedRoom(['agent-b']);
      await db.canvasPersonaThreads.put({
        id: 'default:agent-a',
        canvasId: 'default',
        agentNodeId: 'agent-a',
        messages: [
          { id: 'u0', role: 'user', text: '开场白', createdAt: 1 },
          // 加进讨论之前的老回复：没有发言人标记
          { id: 'a0', role: 'assistant', text: 'before the room', createdAt: 2 },
        ],
        participantNodeIds: ['agent-b'],
        mutedNodeIds: [],
        updatedAt: Date.now(),
      });
      replyWith(() => 'hello');

      const { result } = renderHook(() =>
        useTestAiActions({
          dynamicNodes: [nodeA, nodeB, noteHost, notePeer],
          agentConfigs: [cfgA, cfgB],
        }),
      );

      await act(async () => {
        await result.current.sendPersonaMessage('agent-a', '你来了');
      });

      const peerHistory = (vi.mocked(callUniversalAI).mock.calls[1]![0] as CapturedCall)
        .messages!.map((m) => String(m.content));
      expect(peerHistory.some((c) => c.includes('Mirror: before the room'))).toBe(true);
    });

    it('lets a muted host stay silent and has the participants answer alone', async () => {
      await seedRoom(['agent-b'], ['agent-a']);
      replyWith((n) => `peer-${n}`);

      const { result } = renderHook(() =>
        useTestAiActions({
          dynamicNodes: [nodeA, nodeB, noteHost, notePeer],
          agentConfigs: [cfgA, cfgB],
        }),
      );

      await act(async () => {
        await result.current.sendPersonaMessage('agent-a', 'only you, Turtle');
      });

      // 只有参与者那一次调用
      expect(callUniversalAI).toHaveBeenCalledTimes(1);
      const thread = await personaThread('agent-a');
      expect(
        thread!.messages
          .filter((m) => m.role === 'assistant')
          .map((m) => [m.speakerNodeId, m.text]),
      ).toEqual([['agent-b', 'peer-1']]);
      // 用户消息仍然写进了 thread，只是没有被禁言的人回它
      expect(thread!.messages.some((m) => m.role === 'user' && m.text.includes('Turtle'))).toBe(true);
      // 参与者仍然拿到房间材料
      const peerCall = vi.mocked(callUniversalAI).mock.calls[0]![0] as CapturedCall;
      expect(peerCall.systemInstruction).toMatch(/HOST MATERIAL/);
      expect(peerCall.systemInstruction).toMatch(/Not speaking this round: Mirror/);
    });

    it('refuses to send when every voice is muted', async () => {      await seedRoom(['agent-b'], ['agent-a', 'agent-b']);
      replyWith(() => 'nobody');

      const { result } = renderHook(() =>
        useTestAiActions({
          dynamicNodes: [nodeA, nodeB, noteHost, notePeer],
          agentConfigs: [cfgA, cfgB],
        }),
      );

      await act(async () => {
        await result.current.sendPersonaMessage('agent-a', 'hello?');
      });

      expect(callUniversalAI).not.toHaveBeenCalled();
      const thread = await personaThread('agent-a');
      // 没有人在发言就不该留下一条永远没人回的用户消息
      expect(thread?.messages ?? []).toHaveLength(0);
      expect(result.current.personaStreams['agent-a']).toBeUndefined();
    });
  });

  // --- 房间自动讨论（角色之间自己聊） ---
  describe('room auto discussion', () => {
    const cfgA: AgentConfig = { id: 'cfg-a', name: 'Mirror', role: 'Ra', prompt: 'You are the mirror.' };
    const cfgB: AgentConfig = { id: 'cfg-b', name: 'Turtle', role: 'Rb', prompt: 'You are the turtle.' };
    const nodeA: CanvasNode = {
      id: 'agent-a', canvasId: 'default', type: 'agent', agentConfigId: 'cfg-a', x: 0, y: 0,
    };
    const nodeB: CanvasNode = {
      id: 'agent-b', canvasId: 'default', type: 'agent', agentConfigId: 'cfg-b', x: 80, y: 0,
    };
    const noteHost: CanvasNode = {
      id: 'note-a', canvasId: 'default', type: 'text', content: 'ROOM MATERIAL',
      contextScopeAgentId: 'agent-a', x: 0, y: 300,
    };

    async function seedRoom(participantNodeIds: string[], mutedNodeIds: string[] = []) {
      await db.canvasPersonaThreads.put({
        id: 'default:agent-a',
        canvasId: 'default',
        agentNodeId: 'agent-a',
        messages: [],
        participantNodeIds,
        mutedNodeIds,
        updatedAt: Date.now(),
      });
    }

    /** 每条回复按顺序标号，便于断言"谁说了第几句"。 */
    function replyWith(label: (n: number) => string) {
      let n = 0;
      vi.mocked(callUniversalAI).mockImplementation(async (opts) => {
        n += 1;
        const text = label(n);
        opts.onStreamChunk?.(text);
        return text;
      });
    }

    async function speakersInThread() {
      const thread = await personaThread('agent-a');
      return (thread?.messages ?? [])
        .filter((m) => m.role === 'assistant')
        .map((m) => m.speakerNodeId);
    }

    it('runs whole rounds without any user message: everyone speaks once per round', async () => {
      await seedRoom(['agent-b']);
      replyWith((n) => `turn-${n}`);

      const { result } = renderHook(() =>
        useTestAiActions({ dynamicNodes: [nodeA, nodeB, noteHost], agentConfigs: [cfgA, cfgB] }),
      );

      await act(async () => {
        await result.current.advanceRoomDiscussion('agent-a');
      });

      // 默认两轮，每个声音每轮各说一次 —— 不是两句话
      expect(callUniversalAI).toHaveBeenCalledTimes(4);
      expect(await speakersInThread()).toEqual(['agent-a', 'agent-b', 'agent-a', 'agent-b']);
      // 没有用户消息 —— 这是角色自己聊，不是回答谁
      const thread = await personaThread('agent-a');
      expect(thread?.messages.some((m) => m.role === 'user')).toBe(false);
      // 每个人都读到房间的材料
      for (const call of vi.mocked(callUniversalAI).mock.calls) {
        expect((call[0] as { systemInstruction?: string }).systemInstruction).toMatch(/ROOM MATERIAL/);
      }
      // 跑完就释放，不要卡住界面
      expect(result.current.roomDiscussion).toBeNull();
    });

    it('honours a single requested round', async () => {
      await seedRoom(['agent-b']);
      replyWith((n) => `turn-${n}`);

      const { result } = renderHook(() =>
        useTestAiActions({ dynamicNodes: [nodeA, nodeB, noteHost], agentConfigs: [cfgA, cfgB] }),
      );

      await act(async () => {
        await result.current.advanceRoomDiscussion('agent-a', 1);
      });

      expect(callUniversalAI).toHaveBeenCalledTimes(2);
      expect(await speakersInThread()).toEqual(['agent-a', 'agent-b']);
    });

    it('never gives the mic to a muted voice', async () => {
      await seedRoom(['agent-b'], ['agent-b']);
      replyWith((n) => `turn-${n}`);

      const { result } = renderHook(() =>
        useTestAiActions({ dynamicNodes: [nodeA, nodeB, noteHost], agentConfigs: [cfgA, cfgB] }),
      );

      await act(async () => {
        await result.current.advanceRoomDiscussion('agent-a');
      });

      // 只剩主人一个声音，于是两轮都是他说 —— 关键是被禁言的那位一句都没有
      expect(callUniversalAI).toHaveBeenCalledTimes(2);
      expect(await speakersInThread()).toEqual(['agent-a', 'agent-a']);
    });

    it('refuses to start when every voice is muted', async () => {
      await seedRoom(['agent-b'], ['agent-a', 'agent-b']);
      replyWith(() => 'nobody');

      const { result } = renderHook(() =>
        useTestAiActions({ dynamicNodes: [nodeA, nodeB, noteHost], agentConfigs: [cfgA, cfgB] }),
      );

      await act(async () => {
        await result.current.advanceRoomDiscussion('agent-a');
      });

      expect(callUniversalAI).not.toHaveBeenCalled();
      expect(await speakersInThread()).toEqual([]);
    });

    it('stops at the next turn boundary when asked, and waits for the turn in flight', async () => {
      await seedRoom(['agent-b']);
      let release!: (text: string) => void;
      const hanging = new Promise<string>((resolve) => {
        release = resolve;
      });
      let n = 0;
      vi.mocked(callUniversalAI).mockImplementation(async (opts) => {
        n += 1;
        if (n === 1) return hanging;
        opts.onStreamChunk?.(`turn-${n}`);
        return `turn-${n}`;
      });

      const { result } = renderHook(() =>
        useTestAiActions({ dynamicNodes: [nodeA, nodeB, noteHost], agentConfigs: [cfgA, cfgB] }),
      );

      let batch!: Promise<void>;
      // 不套 act：这一批要一直挂到我们 release 为止，套 act 会互相等死
      batch = result.current.advanceRoomDiscussion('agent-a');
      await vi.waitFor(() => expect(callUniversalAI).toHaveBeenCalledTimes(1));
      expect(result.current.roomDiscussion?.hostNodeId).toBe('agent-a');

      // 停止：应该等正在说的那一轮收尾，然后不再开新一轮
      let stopped = false;
      let stopPromise!: Promise<void>;
      await act(async () => {
        stopPromise = result.current.stopRoomDiscussion().then(() => {
          stopped = true;
        });
      });
      expect(stopped).toBe(false); // 还在等第一轮
      await act(async () => {
        release('turn-1');
        await batch;
        await stopPromise;
      });

      expect(stopped).toBe(true);
      expect(callUniversalAI).toHaveBeenCalledTimes(1);
      expect(await speakersInThread()).toEqual(['agent-a']);
      expect(result.current.roomDiscussion).toBeNull();
    });

    it('drops a participant whose card was deleted mid-batch', async () => {
      await seedRoom(['agent-b', 'agent-gone']);
      replyWith((n) => `turn-${n}`);

      const { result } = renderHook(() =>
        // agent-gone 的卡不在画布上
        useTestAiActions({ dynamicNodes: [nodeA, nodeB, noteHost], agentConfigs: [cfgA, cfgB] }),
      );

      await act(async () => {
        await result.current.advanceRoomDiscussion('agent-a', 2);
      });

      // 两轮 × 两个真实在场的声音；不在场的那位从头到尾没有发言
      expect(callUniversalAI).toHaveBeenCalledTimes(4);
      expect(await speakersInThread()).toEqual(['agent-a', 'agent-b', 'agent-a', 'agent-b']);
    });

    it('tells each speaker who they are answering, following the real transcript', async () => {
      const cfgC: AgentConfig = { id: 'cfg-c', name: 'Owl', role: 'Rc', prompt: 'You are the owl.' };
      const nodeC: CanvasNode = {
        id: 'agent-c', canvasId: 'default', type: 'agent', agentConfigId: 'cfg-c', x: 160, y: 0,
      };
      await seedRoom(['agent-b', 'agent-c']);
      replyWith((n) => `reply-${n}`);

      const { result } = renderHook(() =>
        useTestAiActions({
          dynamicNodes: [nodeA, nodeB, nodeC, noteHost],
          agentConfigs: [cfgA, cfgB, cfgC],
        }),
      );

      await act(async () => {
        await result.current.sendPersonaMessage('agent-a', 'what do you two think?');
      });

      // 每个参与者的 cue 都是"上一位是谁"，且第一位是主人、第二位是第一个参与者
      const lastTurn = (i: number) => {
        const messages = (vi.mocked(callUniversalAI).mock.calls[i]![0] as CapturedCall).messages!;
        expect(messages[messages.length - 1]!.role).toBe('user');
        return String(messages[messages.length - 1]!.content);
      };
      expect(lastTurn(1)).toContain('Previous speaker: Mirror');
      expect(lastTurn(1)).toContain('reply-1');
      expect(lastTurn(2)).toContain('Previous speaker: Turtle');
      expect(lastTurn(2)).toContain('reply-2');
    });

    it('honours a mute that lands mid-round instead of waiting for the next round', async () => {
      await seedRoom(['agent-b']);
      let release!: (text: string) => void;
      const hanging = new Promise<string>((resolve) => {
        release = resolve;
      });
      let n = 0;
      vi.mocked(callUniversalAI).mockImplementation(async (opts) => {
        n += 1;
        if (n === 1) return hanging;
        opts.onStreamChunk?.(`turn-${n}`);
        return `turn-${n}`;
      });

      const { result } = renderHook(() =>
        useTestAiActions({ dynamicNodes: [nodeA, nodeB, noteHost], agentConfigs: [cfgA, cfgB] }),
      );

      const batch = result.current.advanceRoomDiscussion('agent-a', 1);
      await vi.waitFor(() => expect(callUniversalAI).toHaveBeenCalledTimes(1));

      // 主人还在说的时候把参与者禁言：它这一轮就不该再拿到麦克风
      const row = await db.canvasPersonaThreads.get('default:agent-a');
      await db.canvasPersonaThreads.put({ ...row!, mutedNodeIds: ['agent-b'] });

      await act(async () => {
        release('turn-1');
        await batch;
      });

      expect(callUniversalAI).toHaveBeenCalledTimes(1);
      expect(await speakersInThread()).toEqual(['agent-a']);
    });

    it('stops a batch when one of its turns fails', async () => {
      await seedRoom(['agent-b']);
      let n = 0;
      vi.mocked(callUniversalAI).mockImplementation(async (opts) => {
        n += 1;
        if (n === 2) throw new Error('provider exploded');
        opts.onStreamChunk?.(`turn-${n}`);
        return `turn-${n}`;
      });

      const { result } = renderHook(() =>
        useTestAiActions({ dynamicNodes: [nodeA, nodeB, noteHost], agentConfigs: [cfgA, cfgB] }),
      );

      await act(async () => {
        // 三整轮本应 6 次调用；第二句就炸了，之后不该再打请求
        await result.current.advanceRoomDiscussion('agent-a', 3);
      });

      expect(callUniversalAI).toHaveBeenCalledTimes(2);
      expect(result.current.roomDiscussion).toBeNull();
    });

    it('refuses to start a second room while one is discussing, and leaves the first running', async () => {
      await seedRoom(['agent-b']);
      // 另一个房间：以 agent-b 为主人，agent-a 是它的客人
      await db.canvasPersonaThreads.put({
        id: 'default:agent-b',
        canvasId: 'default',
        agentNodeId: 'agent-b',
        messages: [],
        participantNodeIds: ['agent-a'],
        mutedNodeIds: [],
        updatedAt: Date.now(),
      });
      let release!: (text: string) => void;
      const hanging = new Promise<string>((resolve) => {
        release = resolve;
      });
      let n = 0;
      vi.mocked(callUniversalAI).mockImplementation(async (opts) => {
        n += 1;
        if (n === 1) return hanging;
        opts.onStreamChunk?.(`turn-${n}`);
        return `turn-${n}`;
      });

      const { result } = renderHook(() =>
        useTestAiActions({ dynamicNodes: [nodeA, nodeB, noteHost], agentConfigs: [cfgA, cfgB] }),
      );

      const batch = result.current.advanceRoomDiscussion('agent-a', 1);
      await vi.waitFor(() => expect(callUniversalAI).toHaveBeenCalledTimes(1));

      // 另一个房间申请开始：应当被挡下，且不能把第一场讨论弄停
      await act(async () => {
        await result.current.advanceRoomDiscussion('agent-b', 1);
      });
      expect(callUniversalAI).toHaveBeenCalledTimes(1);
      expect(result.current.roomDiscussion?.hostNodeId).toBe('agent-a');

      await act(async () => {
        release('turn-1');
        await batch;
      });

      // 第一场照常跑完两轮里的两句；第二场从头到尾没开始
      expect(callUniversalAI).toHaveBeenCalledTimes(2);
      const second = await db.canvasPersonaThreads.get('default:agent-b');
      expect((second?.messages ?? []).filter((m) => m.role === 'assistant')).toHaveLength(0);
    });

    it('persists the round count on the room and clamps it', async () => {
      await seedRoom(['agent-b']);
      const { result } = renderHook(() =>
        useTestAiActions({ dynamicNodes: [nodeA, nodeB, noteHost], agentConfigs: [cfgA, cfgB] }),
      );

      await act(async () => {
        await result.current.setRoomDiscussionRounds('agent-a', 4);
      });
      expect((await personaThread('agent-a'))?.roomDiscussionRounds).toBe(4);

      await act(async () => {
        await result.current.setRoomDiscussionRounds('agent-a', 99);
      });
      // 上限收口，且没有把房间的其它设置（名单）写丢
      const row = await personaThread('agent-a');
      expect(row?.roomDiscussionRounds).toBe(5);
      expect(row?.participantNodeIds).toEqual(['agent-b']);
    });

    it('refuses to run for a turtle-soup host', async () => {
      const turtleNode: CanvasNode = {
        id: 'agent-a', canvasId: 'default', type: 'agent',
        agentConfigId: 'turtle_soup_host', x: 0, y: 0,
      };
      const turtle: AgentConfig = {
        id: 'turtle_soup_host', name: '主持人', role: 'R', prompt: '主持海龟汤游戏。',
      };
      await seedRoom(['agent-b']);
      replyWith(() => 'nope');

      const { result } = renderHook(() =>
        useTestAiActions({ dynamicNodes: [turtleNode, nodeB, noteHost], agentConfigs: [turtle, cfgB] }),
      );

      await act(async () => {
        await result.current.advanceRoomDiscussion('agent-a');
      });

      expect(callUniversalAI).not.toHaveBeenCalled();
      expect(await speakersInThread()).toEqual([]);
    });

    it('keeps the running discussion when the same room is started twice in one tick', async () => {
      await seedRoom(['agent-b']);
      let release!: (text: string) => void;
      const hanging = new Promise<string>((resolve) => {
        release = resolve;
      });
      let n = 0;
      vi.mocked(callUniversalAI).mockImplementation(async (opts) => {
        n += 1;
        if (n === 1) return hanging;
        opts.onStreamChunk?.(`turn-${n}`);
        return `turn-${n}`;
      });

      const { result } = renderHook(() =>
        useTestAiActions({ dynamicNodes: [nodeA, nodeB, noteHost], agentConfigs: [cfgA, cfgB] }),
      );

      let first!: Promise<void>;
      await act(async () => {
        first = result.current.advanceRoomDiscussion('agent-a', 1);
        // 同一个 tick 里再点一次（双击/手快）：第二次必须被挡下 ——
        // 否则后一批会把前一批顶掉，再清掉它的进度，侧栏只剩"开始讨论"，停不下来。
        await result.current.advanceRoomDiscussion('agent-a', 1);
      });

      await vi.waitFor(() => expect(callUniversalAI).toHaveBeenCalledTimes(1));
      // 第一场还在说（它的第一次调用挂着）：给被顶替的批次一点时间露头
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
      expect(callUniversalAI).toHaveBeenCalledTimes(1);
      expect(result.current.roomDiscussion?.hostNodeId).toBe('agent-a');

      await act(async () => {
        release('turn-1');
        await first;
      });
      expect(callUniversalAI).toHaveBeenCalledTimes(2);
      expect(await speakersInThread()).toEqual(['agent-a', 'agent-b']);
      expect(result.current.roomDiscussion).toBeNull();
    });

    it('refuses to start while the host is still answering', async () => {
      await seedRoom(['agent-b']);
      let release!: (text: string) => void;
      const hanging = new Promise<string>((resolve) => {
        release = resolve;
      });
      vi.mocked(callUniversalAI).mockImplementation(async () => hanging);

      const { result } = renderHook(() =>
        useTestAiActions({ dynamicNodes: [nodeA, nodeB, noteHost], agentConfigs: [cfgA, cfgB] }),
      );

      const send = result.current.sendPersonaMessage('agent-a', 'what do you think?');
      await vi.waitFor(() => expect(callUniversalAI).toHaveBeenCalledTimes(1));

      // 主人这一轮还在说：讨论不能另起一条流去写同一条 thread
      await act(async () => {
        await result.current.advanceRoomDiscussion('agent-a', 1);
      });
      expect(callUniversalAI).toHaveBeenCalledTimes(1);
      expect(result.current.roomDiscussion).toBeNull();

      await act(async () => {
        release('answer');
        await send;
      });
    });
  });

  // 摘抄放上画布：卡片正文里必须同时有摘抄和用户写的想法，
  // 而且标签走 i18n——中文界面上卡片里不能冒出一行英文 "My note"。
  describe('extractBookSelectionToCard', () => {
    const bookNode: CanvasNode = {
      id: 'book1',
      canvasId: 'default',
      type: 'book',
      x: 0,
      y: 0,
      description: 'demo.epub',
    };

    async function extract(quote: string, note?: string) {
      const { result } = renderHook(() => useTestAiActions({ dynamicNodes: [bookNode] }));
      await act(async () => {
        await result.current.extractBookSelectionToCard('book1', quote, 'Ch1', note);
      });
      const nodes = await db.nodes.toArray();
      const card = nodes.find((node) => node.id !== 'book1');
      return { card: card ?? null, edges: await db.edges.toArray() };
    }

    it('把摘抄和想法一起放进卡片正文', async () => {
      const { card, edges } = await extract('摘抄正文', '这跟我手上的项目对得上');
      expect(card?.type).toBe('text');
      expect(card?.content).toBe('摘抄正文\n\nMy note\n这跟我手上的项目对得上');
      // 想法不是另一个字段：卡片只有一份正文，AI 读到的和用户看到的是同一段。
      expect(Object.keys(card ?? {})).not.toContain('note');
      expect(edges).toHaveLength(1);
      expect(edges[0]).toMatchObject({ from: 'book1', to: card?.id });
    });

    it('没写想法时卡片正文和以前一模一样', async () => {
      const { card } = await extract('摘抄正文');
      expect(card?.content).toBe('摘抄正文');
    });

    it('标签跟着界面语言走', async () => {
      await i18n.changeLanguage('zh');
      try {
        const { card } = await extract('摘抄正文', '这跟项目对得上');
        expect(card?.content).toBe('摘抄正文\n\n我的想法\n这跟项目对得上');
      } finally {
        await i18n.changeLanguage('en');
      }
    });

    it('正文为空时不建卡，哪怕想法有内容', async () => {
      const { card } = await extract('   ', '只有想法');
      expect(card).toBeNull();
    });

    it('来源不是书籍或 AI 卡时什么都不建', async () => {
      const noteHost: CanvasNode = {
        id: 'note1',
        canvasId: 'default',
        type: 'note',
        x: 0,
        y: 0,
        content: '随便一张卡',
      };
      const { result } = renderHook(() => useTestAiActions({ dynamicNodes: [noteHost] }));
      await act(async () => {
        await result.current.extractBookSelectionToCard('note1', '摘抄正文', 'Ch1', '想法');
      });
      expect(await db.nodes.toArray()).toEqual([]);
      expect(await db.edges.toArray()).toEqual([]);
    });
  });
});
