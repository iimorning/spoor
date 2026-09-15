import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../../src/db';
import { assembleEssayDraft } from '../../src/utils/assembleEssayDraft';

vi.mock('../../src/services/ai', () => ({
  callUniversalAI: vi.fn(),
}));

import { callUniversalAI } from '../../src/services/ai';

const aiConfig = {
  provider: 'gemini' as const,
  apiKey: 'k',
  baseUrl: '',
  model: 'm',
};

const t = (key: string, opts?: Record<string, unknown>) => {
  if (key === 'ai.prompts.publishEssayPolish') return String(opts?.content ?? '');
  if (key === 'ai.prompts.publishEssayPolishSystem') return 'assemble-system';
  if (key === 'ai.generated_article_title') return 'fallback';
  return key;
};

describe('assembleEssayDraft', () => {
  beforeEach(async () => {
    await db.articles.clear();
    vi.mocked(callUniversalAI).mockReset();
  });

  it('maps transitions and unique deletions onto verbatim source text', async () => {
    await db.articles.add({
      id: 'a1',
      title: 'T',
      content: '第一段 ###\n\n第二段',
      date: '2026',
      type: 'GEN-1',
      tags: [],
      generating: true,
      contentDrivesBody: true,
      sourceCards: [
        {
          nodeId: 'n1',
          canvasId: 'cv',
          kind: 'note',
          title: '一',
          segmentText: '第一段 ###',
          transitions: [],
          deletions: [],
        },
        {
          nodeId: 'n2',
          canvasId: 'cv',
          kind: 'note',
          title: '二',
          segmentText: '第二段',
          transitions: [],
          deletions: [],
        },
      ],
    });

    vi.mocked(callUniversalAI).mockResolvedValueOnce(
      JSON.stringify({
        title: '两张便签',
        segments: [
          { cardId: 'n1', transitions: ['开场。'], deletions: [' ###'] },
          { cardId: 'n2', transitions: ['接下来。'], deletions: [] },
        ],
      }),
    );

    await assembleEssayDraft({ articleId: 'a1', aiConfig, t });

    expect(callUniversalAI).toHaveBeenCalledWith(
      expect.objectContaining({
        systemInstruction: 'assemble-system',
      }),
    );

    const article = await db.articles.get('a1');
    expect(article?.generating).toBe(false);
    expect(article?.title).toBe('两张便签');
    expect(article?.sourceCards?.[0].segmentText).toBe('第一段 ###');
    expect(article?.sourceCards?.[0].transitions).toEqual(['开场。']);
    expect(article?.sourceCards?.[0].deletions).toEqual([' ###']);
    expect(article?.content).toContain('<mark data-ai-transition="true">开场。</mark>');
    expect(article?.content).toContain('<mark data-ai-deletion="true"> ###</mark>');
    expect(article?.content).toContain('第一段');
    expect(article?.content).toContain('第二段');
  });

  it('drops deletion snippets that are missing or occur more than once', async () => {
    await db.articles.add({
      id: 'a2',
      title: 'T',
      content: '于是走了于是又停',
      date: '2026',
      type: 'GEN-1',
      tags: [],
      generating: true,
      sourceCards: [
        {
          nodeId: 'n1',
          canvasId: 'cv',
          kind: 'note',
          title: '一',
          segmentText: '于是走了于是又停',
        },
      ],
    });

    vi.mocked(callUniversalAI).mockResolvedValueOnce(
      JSON.stringify({
        title: 'T',
        segments: [{ cardId: 'n1', transitions: [], deletions: ['不存在的碎片', '于是'] }],
      }),
    );

    await assembleEssayDraft({ articleId: 'a2', aiConfig, t });
    const article = await db.articles.get('a2');
    expect(article?.sourceCards?.[0].deletions).toEqual([]);
    expect(article?.content).toBe('于是走了于是又停');
  });
});
