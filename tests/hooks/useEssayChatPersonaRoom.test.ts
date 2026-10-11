import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TFunction } from 'i18next';
import { act, renderHook } from '@testing-library/react';
import { db } from '../../src/db';
import type { AgentConfig } from '../../src/db';
import { useEssayChat } from '../../src/hooks/useEssayChat';
import { callUniversalAI } from '../../src/services/ai';
import type { AIConfig } from '../../src/components/AISettingsModal';
import i18n from '../../src/i18n';
import { readSurfaceRoom } from '../../src/utils/surfacePersonaRoom';
import { ASK_PERSONA_ID } from '../../src/utils/askPersona';

vi.mock('../../src/services/ai', () => ({
  callUniversalAI: vi.fn(),
  formatAiError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

vi.mock('../../src/services/fulfillSearchTool', () => ({
  fulfillSearchToolFromNode: vi.fn(async () => []),
}));

vi.mock('../../src/services/fulfillDrawTool', () => ({
  fulfillDrawToolIntoChat: vi.fn(async () => undefined),
}));

vi.mock('../../src/services/synthesizeAskFromSearch', () => ({
  synthesizeAskFromSearch: vi.fn(async ({ draftAnswer }: { draftAnswer: string }) => draftAnswer),
}));

vi.mock('../../src/lib/serverConfig', () => ({
  hasLiveWebSearchAccess: () => false,
}));

vi.mock('../../src/services/flux302', () => ({
  hasFlux302Credentials: () => false,
  imageKeysFromAiConfig: () => ({ apiKey: '', openrouterApiKey: '' }),
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
const ARTICLE_ID = 'a1';

const aiConfig = { provider: 'openrouter', apiKey: 'k' } as AIConfig;
const t = ((key: string, opts?: Record<string, unknown>) =>
  (i18n.t as unknown as (k: string, o?: Record<string, unknown>) => string)(key, opts)) as unknown as TFunction<
  'translation',
  undefined
>;

const persona = (id: string, extra: Partial<AgentConfig> = {}): AgentConfig => ({
  id,
  name: `名字${id}`,
  role: 'role',
  prompt: `PROMPT_${id}_MARKER`,
  ...extra,
});

const A = persona('a');
const B = persona('b');

const applyChatEdits = vi.fn(() => ({ applied: 0, missed: [] }));

beforeEach(async () => {
  applyChatEdits.mockClear();
  callAi.mockReset();
  callAi.mockImplementation(async ({ onStreamChunk }: { onStreamChunk?: (s: string) => void }) => {
    onStreamChunk?.('改好的正文');
    return '改好的正文';
  });
  await db.articles.clear();
  await db.articles.add({
    id: ARTICLE_ID,
    title: '一篇长文',
    content: '原始正文',
    date: '2026',
    type: 'GEN',
    tags: [],
    chatMessages: [],
  });
});

function renderChat(overrides: Partial<Parameters<typeof useEssayChat>[0]> = {}) {
  return renderHook(() =>
    useEssayChat({
      articleId: ARTICLE_ID,
      articleTitle: '一篇长文',
      messages: [],
      aiConfig,
      agents: [A, B],
      t,
      getBodyMarkdown: () => '原始正文',
      getSelectedText: () => '',
      applyChatEdits,
      ...overrides,
    }),
  );
}

const lastCall = () => callAi.mock.calls.at(-1)?.[0] as never as { systemInstruction: string; temperature?: number };

describe('长文房间：空房间（默认只有阿狸）', () => {
  it('system 里是阿狸的身份加功能契约', async () => {
    const { result } = renderChat();
    await act(async () => {
      await result.current.send('把这段改短一点');
    });
    const system = lastCall().systemInstruction;
    expect(system).toContain(i18n.t('ai.prompts.askCharacterIdentity', {
      name: i18n.t('ask.character_name') as string,
    }) as string);
    expect(system).toContain(i18n.t('ai.prompts.essayChatSystem') as string);
  });
});

describe('长文房间：选了角色', () => {
  it('阿狸仍然答话——选进来的角色是客人', async () => {
    const { result } = renderChat({ room: readSurfaceRoom(['a']) });
    await act(async () => {
      await result.current.send('把这段改短一点');
    });
    const system = lastCall().systemInstruction;
    expect(system).not.toContain('PROMPT_a_MARKER');
    expect(system).toContain(i18n.t('ai.prompts.askCharacterIdentity', {
      name: i18n.t('ask.character_name') as string,
    }) as string);
  });

  it('禁言阿狸之后顺位给第一个没被禁言的客人', async () => {
    const { result } = renderChat({ room: readSurfaceRoom(['a'], [ASK_PERSONA_ID]) });
    await act(async () => {
      await result.current.send('改一下');
    });
    const system = lastCall().systemInstruction;
    expect(system).toContain('PROMPT_a_MARKER');
  });
});

describe('长文房间：讨论', () => {
  it('客人接话，但不碰正文', async () => {
    // 嘉宾插进来改正文会和用户的编辑意图打架：正文的占位符是答话者那一份
    // 提示词的契约，别的角色没有这份契约，写出来的 find 未必逐字对得上。
    callAi.mockImplementation(async () => '嘉宾的一段评论');
    const { result } = renderChat({ room: readSurfaceRoom(['a', 'b']) });
    await act(async () => {
      await result.current.discuss();
    });
    expect(applyChatEdits).not.toHaveBeenCalled();
    const row = await db.articles.get(ARTICLE_ID);
    const reply = row?.chatMessages?.find((m) => m.role === 'assistant');
    expect(reply?.speakerAgentId).toBe('a');
    expect(reply?.editCount).toBeUndefined();
  });

  it('嘉宾用的是自己的提示词和功能契约', async () => {
    callAi.mockImplementation(async () => '嘉宾的一段评论');
    const { result } = renderChat({ room: readSurfaceRoom(['a', 'b']) });
    await act(async () => {
      await result.current.discuss();
    });
    const system = lastCall().systemInstruction;
    expect(system).toContain('PROMPT_b_MARKER');
    expect(system).not.toContain('PROMPT_a_MARKER');
    expect(system).toContain(i18n.t('ai.prompts.essayChatSystem') as string);
  });

  it('房里只有阿狸时不发请求', async () => {
    const { result } = renderChat({ room: readSurfaceRoom([]) });
    await act(async () => {
      await result.current.discuss();
    });
    expect(callAi).not.toHaveBeenCalled();
  });
});
