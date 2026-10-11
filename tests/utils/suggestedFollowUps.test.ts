import { describe, expect, it, vi, beforeEach } from 'vitest';
import { db } from '../../src/db';
import { callUniversalAI } from '../../src/services/ai';
import {
  attachSuggestedFollowUpsToThreadMessage,
  generateSuggestedFollowUps,
  parseSuggestedFollowUps,
} from '../../src/utils/suggestedFollowUps';
import type { AIConfig } from '../../src/components/AISettingsModal';

vi.mock('../../src/services/ai', () => ({
  callUniversalAI: vi.fn(),
}));

const callAi = vi.mocked(callUniversalAI);
const aiConfig = { provider: 'openrouter', apiKey: 'k' } as AIConfig;

describe('parseSuggestedFollowUps', () => {
  it('keeps three distinct questions and strips numbering', () => {
    expect(
      parseSuggestedFollowUps({
        questions: ['1. 风险在哪？', '2. 风险在哪？', 'Q3: 还有别的做法吗', '如果预算减半会怎样'],
      }),
    ).toEqual(['风险在哪？', '还有别的做法吗', '如果预算减半会怎样']);
  });

  it('accepts a bare string array', () => {
    expect(parseSuggestedFollowUps([' deepen this ', 'compare it'])).toEqual([
      'deepen this',
      'compare it',
    ]);
  });

  it('returns empty on unrelated JSON', () => {
    expect(parseSuggestedFollowUps({ reply: 'Looked it up.', edits: [] })).toEqual([]);
  });
});

describe('generateSuggestedFollowUps', () => {
  beforeEach(() => {
    callAi.mockReset();
  });

  it('parses JSON from the model', async () => {
    callAi.mockResolvedValue('{"questions":["风险在哪？","还有别的做法吗","预算减半会怎样"]}');
    await expect(
      generateSuggestedFollowUps({
        config: aiConfig,
        userQuestion: '这个方案怎么样',
        assistantReply: '先看约束，再看取舍。'.repeat(2),
        t: (key, opts) => `${key}:${JSON.stringify(opts ?? {})}`,
      }),
    ).resolves.toEqual(['风险在哪？', '还有别的做法吗', '预算减半会怎样']);
  });

  it('skips short replies and failed JSON', async () => {
    await expect(
      generateSuggestedFollowUps({
        config: aiConfig,
        userQuestion: 'hi',
        assistantReply: 'ok',
        t: (key) => key,
      }),
    ).resolves.toEqual([]);
    expect(callAi).not.toHaveBeenCalled();

    callAi.mockResolvedValue('not json');
    await expect(
      generateSuggestedFollowUps({
        config: aiConfig,
        userQuestion: '这个方案怎么样',
        assistantReply: '先看约束，再看取舍。这段要足够长。',
        t: (key) => key,
      }),
    ).resolves.toEqual([]);
  });
});

describe('attachSuggestedFollowUpsToThreadMessage', () => {
  beforeEach(async () => {
    callAi.mockReset();
    callAi.mockResolvedValue('{"questions":["下一步是什么","和上次比呢","落地会卡在哪"]}');
    await db.canvasPersonaThreads.clear();
    await db.canvasPersonaThreads.put({
      id: 'c1:ask-1',
      canvasId: 'c1',
      agentNodeId: 'ask-1',
      updatedAt: 1,
      messages: [
        { id: 'u1', role: 'user', text: '这个方案怎么样', createdAt: 1 },
        { id: 'a1', role: 'assistant', text: '先看约束，再看取舍。这段要足够长。', createdAt: 2 },
      ],
    });
  });

  it('writes follow-ups onto the latest assistant message', async () => {
    await attachSuggestedFollowUpsToThreadMessage({
      threadId: 'c1:ask-1',
      messageId: 'a1',
      config: aiConfig,
      userQuestion: '这个方案怎么样',
      t: (key) => key,
    });
    const row = await db.canvasPersonaThreads.get('c1:ask-1');
    expect(row?.messages.find((m) => m.id === 'a1')?.suggestedFollowUps).toEqual([
      '下一步是什么',
      '和上次比呢',
      '落地会卡在哪',
    ]);
  });

  it('does not write if the user already sent another turn', async () => {
    await db.canvasPersonaThreads.update('c1:ask-1', {
      messages: [
        { id: 'u1', role: 'user', text: '这个方案怎么样', createdAt: 1 },
        { id: 'a1', role: 'assistant', text: '先看约束，再看取舍。这段要足够长。', createdAt: 2 },
        { id: 'u2', role: 'user', text: '再说细一点', createdAt: 3 },
      ],
    });
    await attachSuggestedFollowUpsToThreadMessage({
      threadId: 'c1:ask-1',
      messageId: 'a1',
      config: aiConfig,
      userQuestion: '这个方案怎么样',
      t: (key) => key,
    });
    const row = await db.canvasPersonaThreads.get('c1:ask-1');
    expect(row?.messages.find((m) => m.id === 'a1')?.suggestedFollowUps).toBeUndefined();
  });
});
