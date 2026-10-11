import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { db } from '../../src/db';
import type { AgentConfig, BookChatMessage } from '../../src/db';
import { useBookChat } from '../../src/hooks/useBookChat';
import { callUniversalAI } from '../../src/services/ai';
import { encodeBookContent, type BookUnit } from '../../src/utils/bookPayload';
import type { AIConfig } from '../../src/components/AISettingsModal';
import i18n from '../../src/i18n';
import { addSurfacePersona, readSurfaceRoom } from '../../src/utils/surfacePersonaRoom';
import { ASK_PERSONA_ID } from '../../src/utils/askPersona';

vi.mock('../../src/services/ai', () => ({
  callUniversalAI: vi.fn(),
  formatAiError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

vi.mock('../../src/services/fulfillSearchTool', () => ({
  fulfillSearchToolFromNode: vi.fn(async () => []),
}));

vi.mock('../../src/services/synthesizeAskFromSearch', () => ({
  synthesizeAskFromSearch: vi.fn(async ({ draftAnswer }: { draftAnswer: string }) => draftAnswer),
}));

vi.mock('../../src/lib/serverConfig', () => ({
  hasLiveWebSearchAccess: () => false,
}));

vi.mock('../../src/constants/webSearchBackend', () => ({
  liveSearchMissingKeyI18nKey: () => 'nodes.search_no_metaso_key',
  liveSearchToolsPromptKey: () => 'ai.prompts.askWebToolsAvailable',
  liveSearchUsesImmediateUserQuestion: () => false,
}));

vi.mock('../../src/utils/suggestedFollowUps', () => ({
  generateSuggestedFollowUps: vi.fn(async () => [] as string[]),
}));

const callAi = vi.mocked(callUniversalAI);
const NODE_ID = 'b1';

const UNIT: BookUnit = {
  title: 'Ch1',
  text: '这一章讲记忆。',
  blocks: [{ type: 'text', text: '这一章讲记忆。' }],
};

const aiConfig = { provider: 'openrouter', apiKey: 'k', metasoApiKey: 'm' } as AIConfig;
const t = ((key: string, opts?: Record<string, unknown>) =>
  (i18n.t as unknown as (k: string, o?: Record<string, unknown>) => string)(key, opts)) as never;
const copy = ((key: string) => key) as never;

/** 自定义角色：提示词一句话就够，断言只关心它在 system 里的相对位置。 */
const persona = (id: string, extra: Partial<AgentConfig> = {}): AgentConfig => ({
  id,
  name: `名字${id}`,
  role: 'role',
  prompt: `PROMPT_${id}_MARKER`,
  ...extra,
});

const A = persona('a');
const B = persona('b');

beforeEach(async () => {
  callAi.mockReset();
  callAi.mockImplementation(async ({ onStreamChunk }: { onStreamChunk?: (s: string) => void }) => {
    onStreamChunk?.('答');
    return '答';
  });
  await db.nodes.clear();
  await db.nodes.add({
    id: NODE_ID,
    type: 'book',
    x: 0,
    y: 0,
    content: encodeBookContent({ format: 'epub', title: '书', units: [UNIT] }),
    bookChatMessages: [],
  });
});

function renderChat(
  overrides: Partial<Parameters<typeof useBookChat>[0]> = {},
) {
  return renderHook(() =>
    useBookChat({
      nodeId: NODE_ID,
      bookTitle: '书',
      unit: UNIT,
      unitLabel: 'Ch1',
      currentSelection: '',
      excerpts: [],
      focusedExcerpts: [],
      messages: [],
      aiConfig,
      agents: [A, B],
      t,
      copy,
      ...overrides,
    }),
  );
}

const lastCall = () => callAi.mock.calls.at(-1)?.[0] as never as {
  systemInstruction: string;
  temperature: number;
  topP: number;
  messages: Array<{ role: string; content: string }>;
};

describe('侧栏房间：空房间（默认只有阿狸）', () => {
  it('system 里是阿狸的身份加功能契约，顺序和画布上一致', async () => {
    // 角色连续性：空房间不代表"没有角色"，而是"只有阿狸"。他在画布上是默认的伴读
    // 对象，书和长文里也该是他——身份在前，功能契约在后。
    const { result } = renderChat();
    await act(async () => {
      await result.current.send('这段在说什么');
    });
    const system = lastCall().systemInstruction;
    expect(system).toContain(i18n.t('ai.prompts.askCharacterIdentity', {
      name: i18n.t('ask.character_name') as string,
    }) as string);
    expect(system).toContain(i18n.t('ai.prompts.bookChatSystem') as string);
    expect(system.indexOf(i18n.t('ai.prompts.askCharacterIdentity', {
      name: i18n.t('ask.character_name') as string,
    }) as string)).toBeLessThan(system.indexOf(i18n.t('ai.prompts.bookChatSystem') as string));
    // 房里没有任何客人，那两条标记都不该出现。
    expect(system).not.toContain('PROMPT_a_MARKER');
    expect(system).not.toContain('PROMPT_b_MARKER');
  });

  it('回复署名是阿狸', async () => {
    const { result } = renderChat();
    await act(async () => {
      await result.current.send('问');
    });
    const row = await db.nodes.get(NODE_ID);
    const reply = row?.bookChatMessages?.find((m) => m.role === 'assistant');
    expect(reply?.speakerName).toBe(i18n.t('ask.character_name') as string);
  });

  it('阿狸没设采样参数，用默认那一份', async () => {
    const { result } = renderChat();
    await act(async () => {
      await result.current.send('问');
    });
    expect(lastCall().temperature).toBe(0.7);
    expect(lastCall().topP).toBe(0.4);
  });
});

describe('侧栏房间：选了角色', () => {
  it('阿狸仍然是答话的人——选进来的角色是客人', async () => {
    const { result } = renderChat({ room: readSurfaceRoom(['a']) });
    await act(async () => {
      await result.current.send('这段在说什么');
    });
    const system = lastCall().systemInstruction;
    expect(system).not.toContain('PROMPT_a_MARKER');
    expect(system).toContain(i18n.t('ai.prompts.askCharacterIdentity', {
      name: i18n.t('ask.character_name') as string,
    }) as string);
  });

  it('禁言阿狸之后顺位给第一个没被禁言的客人', async () => {
    const { result } = renderChat({
      room: readSurfaceRoom(['a', 'b'], [ASK_PERSONA_ID]),
    });
    await act(async () => {
      await result.current.send('问');
    });
    const system = lastCall().systemInstruction;
    expect(system).toContain('PROMPT_a_MARKER');
    expect(system).not.toContain('PROMPT_b_MARKER');
  });

  it('客人的采样参数在讨论时用上', async () => {
    callAi.mockImplementation(async () => '嘉宾的话');
    const { result } = renderChat({
      room: readSurfaceRoom(['a']),
      agents: [persona('a', { temperature: 0.2, creativity: 0.9 }), B],
    });
    await act(async () => {
      await result.current.discuss();
    });
    expect(lastCall().temperature).toBe(0.2);
    expect(lastCall().topP).toBe(0.9);
  });
});

describe('侧栏房间：讨论', () => {
  const room = () => readSurfaceRoom(['a']);

  it('房里只有阿狸时不发请求', async () => {
    // 空房间 = 只有主人，没有客人可接。
    const { result } = renderChat({ room: readSurfaceRoom([]) });
    await act(async () => {
      await result.current.discuss();
    });
    expect(callAi).not.toHaveBeenCalled();
  });

  it('客人被全部禁言时不发请求', async () => {
    const { result } = renderChat({ room: readSurfaceRoom(['a'], ['a']) });
    await act(async () => {
      await result.current.discuss();
    });
    expect(callAi).not.toHaveBeenCalled();
  });

  it('客人依次接一句，每句都署自己的名', async () => {
    callAi.mockImplementation(async () => '嘉宾的话');
    const { result } = renderChat({ room: room() });
    await act(async () => {
      await result.current.discuss();
    });

    expect(callAi).toHaveBeenCalledTimes(1);
    const row = await db.nodes.get(NODE_ID);
    const replies = (row?.bookChatMessages ?? []).filter((m) => m.role === 'assistant');
    expect(replies).toHaveLength(1);
    expect(replies[0]?.speakerAgentId).toBe('a');
    expect(replies[0]?.speakerName).toBe('名字a');
  });

  it('两个客人时各说一句', async () => {
    callAi.mockImplementation(async () => '嘉宾的话');
    const { result } = renderChat({ room: readSurfaceRoom(['a', 'b']) });
    await act(async () => {
      await result.current.discuss();
    });
    expect(callAi).toHaveBeenCalledTimes(2);
    const row = await db.nodes.get(NODE_ID);
    const speakers = (row?.bookChatMessages ?? [])
      .filter((m) => m.role === 'assistant')
      .map((m) => m.speakerAgentId);
    expect(speakers).toEqual(['a', 'b']);
  });

  it('满员是三个人：阿狸加两个客人', async () => {
    // 上限含阿狸，所以能拉的客人只有两个。
    const C = persona('c');
    let state = readSurfaceRoom([]);
    state = addSurfacePersona(state, 'a');
    state = addSurfacePersona(state, 'b');
    state = addSurfacePersona(state, 'c');
    expect(state.personaIds).toEqual(['a', 'b']);
    expect(C.id).toBe('c');
  });

  it('嘉宾用的是自己的提示词，不是阿狸的', async () => {
    callAi.mockImplementation(async () => '嘉宾的话');
    const { result } = renderChat({ room: room() });
    await act(async () => {
      await result.current.discuss();
    });
    const system = lastCall().systemInstruction;
    expect(system).toContain('PROMPT_a_MARKER');
    expect(system).not.toContain(i18n.t('ai.prompts.askCharacterIdentity', {
      name: i18n.t('ask.character_name') as string,
    }) as string);
  });

  it('历史里别人的话带名字前缀，自己的不带', async () => {
    callAi.mockImplementation(async () => '嘉宾的话');
    const seed: BookChatMessage[] = [
      { id: 'u1', role: 'user', text: '这段在说什么', createdAt: 1 },
      {
        id: 'a1',
        role: 'assistant',
        text: '我在讲记忆',
        createdAt: 2,
        speakerAgentId: ASK_PERSONA_ID,
        speakerName: i18n.t('ask.character_name') as string,
      },
    ];
    await db.nodes.update(NODE_ID, { bookChatMessages: seed });
    const { result } = renderChat({ room: room(), messages: seed });
    await act(async () => {
      await result.current.discuss();
    });
    const history = lastCall().messages;
    const assistantTurn = history.find((m) => m.role === 'assistant');
    expect(assistantTurn?.content).toContain(`${i18n.t('ask.character_name')}: 我在讲记忆`);
  });

  it('连点两下不会跑两轮讨论', async () => {
    // `sending` 来自渲染闭包，两次调用读到的是同一个 false；真拦住重入的是那个 ref。
    let release: (() => void) | null = null;
    callAi.mockImplementation(
      () => new Promise<string>((resolve) => {
        release = () => resolve('嘉宾的话');
      }),
    );
    const { result } = renderChat({ room: room() });
    let first!: Promise<void>;
    act(() => {
      first = result.current.discuss();
    });
    await act(async () => {
      await result.current.discuss();
    });
    expect(callAi).toHaveBeenCalledTimes(1);
    await act(async () => {
      release?.();
      await first;
    });
  });

  it('讨论期间 discussing 才是 true，普通提问时不是', async () => {
    const { result } = renderChat({ room: room() });
    expect(result.current.discussing).toBe(false);
    callAi.mockImplementation(async () => {
      expect(result.current.discussing).toBe(true);
      return '嘉宾的话';
    });
    await act(async () => {
      await result.current.discuss();
    });
    expect(result.current.discussing).toBe(false);
  });
});
