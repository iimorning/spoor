import { describe, it, expect, vi, beforeEach } from 'vitest';
import { draftArticleFromOutline, generateArticleFromOutline, generatePublishOutline } from '../../src/utils/generateArticleFromOutline';
import type { PublishOutline } from '../../src/utils/parsePublishOutlineResponse';
import {
  outlineAttachedVisualLine,
  OUTLINE_VISUAL_PIXELS_SKIPPED,
  type PublishSourceCardMeta,
  type PublishMediaAsset,
} from '../../src/utils/publishSourceMaterial';
import { MAX_VISION_DATA_URL_CHARS } from '../../src/utils/canvasContextImages';

vi.mock('../../src/services/ai', () => ({
  callUniversalAI: vi.fn(),
}));

import { callUniversalAI } from '../../src/services/ai';

const baseAiConfig = {
  provider: 'gemini' as const,
  apiKey: 'k',
  baseUrl: '',
  model: 'm',
};

const t = (key: string, opts?: Record<string, unknown>): string => {
  if (key === 'ai.prompts.publishArticleFromOutline') return `outline=${opts?.outline} | content=${opts?.content}`;
  if (key === 'ai.prompts.publishOutline') return `content=${opts?.content}`;
  if (key === 'ai.prompts.publishOutlineSystem') return 'system-stub';
  if (key === 'ai.prompts.publishOutlineRevise') return 'revise-stub';
  if (key === 'ai.publish_related_media') return 'Related media';
  if (key === 'ai.generated_article_title') return '默认标题';
  return key;
};

function makeCards(overrides: Partial<PublishSourceCardMeta>[] = []): PublishSourceCardMeta[] {
  const defaults: PublishSourceCardMeta[] = [
    { nodeId: 'n1', canvasId: 'cv', kind: 'note', title: '卡片一', markdown: '' },
    { nodeId: 'n2', canvasId: 'cv', kind: 'note', title: '卡片二', markdown: '' },
  ];
  return defaults.map((c, i) => ({ ...c, ...(overrides[i] ?? {}) }));
}

function makeOutline(extra: Partial<PublishOutline> = {}): PublishOutline {
  return {
    title: '示例大纲',
    sections: [
      { cardId: 'n1', heading: '段一', summary: '' },
      { cardId: 'n2', heading: '段二', summary: '' },
    ],
    ...extra,
  };
}

beforeEach(() => {
  vi.mocked(callUniversalAI).mockReset();
});

describe('draftArticleFromOutline', () => {
  it('按大纲顺序拼接原文，不调用模型', async () => {
    const article = await draftArticleFromOutline({
      outline: makeOutline(),
      cards: makeCards([
        { nodeId: 'n1', markdown: '第一段原文。' },
        { nodeId: 'n2', markdown: '第二段原文。' },
      ]),
      mediaAssets: [],
      activeCanvasId: 'cv',
      articleId: 'art-1',
    });
    expect(article.generating).toBe(false);
    expect(article.contentDrivesBody).toBe(true);
    expect(article.title).toBe('示例大纲');
    expect(article.content).toBe('第一段原文。\n\n第二段原文。');
    expect(callUniversalAI).not.toHaveBeenCalled();
  });

  it('图片卡写入文章用的 markdown，而不是 prompt 占位符', async () => {
    const article = await draftArticleFromOutline({
      outline: {
        title: '带图',
        sections: [
          { cardId: 'n1', heading: '', summary: '' },
          { cardId: 'img1', heading: '', summary: '' },
        ],
      },
      cards: [
        { nodeId: 'n1', canvasId: 'cv', kind: 'note', title: '文字', markdown: '说明这段。' },
        {
          nodeId: 'img1',
          canvasId: 'cv',
          kind: 'image',
          title: '封面',
          markdown: '![封面](media://image/img1)',
        },
      ],
      mediaAssets: [
        {
          nodeId: 'img1',
          articleMarkdown: '![封面](spoor-article-media:node-img1)',
          promptMarkdown: '![封面](media://image/img1)',
        },
      ],
      activeCanvasId: 'cv',
      articleId: 'art-2',
    });
    expect(article.content).toContain('说明这段。');
    expect(article.content).toContain('spoor-article-media:node-img1');
    expect(article.content).not.toContain('media://image/img1');
  });
});

describe('generateArticleFromOutline', () => {
  it('segments 输出时按 cardId 对齐到 cards，构建 sourceCards 并按段拼正文', async () => {
    vi.mocked(callUniversalAI).mockResolvedValueOnce(
      JSON.stringify({
        title: '结构化标题',
        segments: [
          { cardId: 'n1', text: '## 段一\n\n第一段正文。' },
          { cardId: 'n2', text: '## 段二\n\n第二段正文。' },
        ],
      }),
    );

    const article = await generateArticleFromOutline({
      aiConfig: baseAiConfig,
      outline: makeOutline(),
      promptContent: 'prompt',
      mediaAssets: [],
      cards: makeCards([
        { nodeId: 'n1', markdown: '## 段一\n\n第一段正文。' },
        { nodeId: 'n2', markdown: '## 段二\n\n第二段正文。' },
      ]),
      activeCanvasId: 'cv',
      t,
    });

    // outline.title 与 parsed.title 都有值时优先 outline（用户/AI 在弹窗确认过的标题）
    expect(article.title).toBe('示例大纲');
    expect(article.linkedCanvasIds).toEqual(['cv']);
    expect(article.sourceCards).toHaveLength(2);
    expect(article.sourceCards![0]).toMatchObject({
      nodeId: 'n1',
      canvasId: 'cv',
      kind: 'note',
      title: '卡片一',
      segmentText: '## 段一\n\n第一段正文。',
      transitions: [],
    });
    expect(article.sourceCards![1]).toMatchObject({
      nodeId: 'n2',
      segmentText: '## 段二\n\n第二段正文。',
      transitions: [],
    });
    expect(article.content).toBe('## 段一\n\n第一段正文。\n\n## 段二\n\n第二段正文。');
    expect(article.contentDrivesBody).toBe(true);
    expect(article.generating).toBe(false);
  });

  it('模型漏掉某张卡时用源卡片 markdown 填回正文', async () => {
    vi.mocked(callUniversalAI).mockResolvedValueOnce(
      JSON.stringify({
        title: 'T',
        segments: [{ cardId: 'n2', cardText: '第二段原文' }],
      }),
    );

    const article = await generateArticleFromOutline({
      aiConfig: baseAiConfig,
      outline: makeOutline(),
      promptContent: 'p',
      mediaAssets: [],
      cards: makeCards([
        { markdown: '第一段用户原文' },
        { markdown: '第二段原文' },
      ]),
      activeCanvasId: 'cv',
      t,
    });

    expect(article.sourceCards![0].segmentText).toBe('第一段用户原文');
    expect(article.sourceCards![1].segmentText).toBe('第二段原文');
    expect(article.content).toContain('第一段用户原文');
  });

  it('旧 {title, body} 格式且大纲无 cardId → 不构建 sourceCards，正文用模型 body', async () => {
    vi.mocked(callUniversalAI).mockResolvedValueOnce(
      JSON.stringify({ title: '旧格式标题', body: '单段正文' }),
    );

    const article = await generateArticleFromOutline({
      aiConfig: baseAiConfig,
      outline: { title: '', sections: [] }, // 空 outline → outline.title 为空，用 parsed.title
      promptContent: 'p',
      mediaAssets: [],
      cards: makeCards(),
      activeCanvasId: 'cv',
      t,
    });

    expect(article.title).toBe('旧格式标题');
    expect(article.sourceCards).toBeUndefined();
    expect(article.content).toBe('单段正文');
  });

  it('旧 {title, body} 格式但大纲仍有 cardId → 仍构建 sourceCards（关联画布），body 不污染 segmentText', async () => {
    // 新行为：parsed.body 是兜底（不被拆到 sourceCards[0].segmentText 里），
    // 因为 sourceCards 的 segmentText 现在代表"卡片原文 verbatim"，不应混入 AI 改写过的整篇 body。
    vi.mocked(callUniversalAI).mockResolvedValueOnce(
      JSON.stringify({ title: '旧格式标题', body: '单段正文' }),
    );

    const article = await generateArticleFromOutline({
      aiConfig: baseAiConfig,
      outline: makeOutline(),
      promptContent: 'p',
      mediaAssets: [],
      cards: makeCards(),
      activeCanvasId: 'cv',
      t,
    });

    expect(article.sourceCards).toHaveLength(2);
    expect(article.sourceCards![0].segmentText).toBe('');
    expect(article.sourceCards![1].segmentText).toBe('');
    expect(article.content).toBe('单段正文');
  });

  it('大纲完全不含 cardId（用户清空）→ 不走 sourceCards 链路', async () => {
    vi.mocked(callUniversalAI).mockResolvedValueOnce(
      JSON.stringify({
        title: 'T',
        segments: [{ cardId: 'n1', text: '## 段一' }],
      }),
    );

    const article = await generateArticleFromOutline({
      aiConfig: baseAiConfig,
      outline: makeOutline({
        sections: [
          { cardId: '', heading: '全新章节 1', summary: '' },
          { cardId: '', heading: '全新章节 2', summary: '' },
        ],
      }),
      promptContent: 'p',
      mediaAssets: [],
      cards: makeCards(),
      activeCanvasId: 'cv',
      t,
    });

    // 大纲无 cardId → eligibleCards 为空 → sourceCards=undefined → 走旧 body 格式
    expect(article.sourceCards).toBeUndefined();
    expect(article.content).toBe('## 段一');
  });

  it('大纲只保留部分 cardId → sourceCards 只包含被大纲提及的卡', async () => {
    vi.mocked(callUniversalAI).mockResolvedValueOnce(
      JSON.stringify({
        title: 'T',
        segments: [
          { cardId: 'n1', text: '## 段一' },
          { cardId: 'n2', text: '## 段二' },
        ],
      }),
    );

    const article = await generateArticleFromOutline({
      aiConfig: baseAiConfig,
      outline: makeOutline({
        sections: [{ cardId: 'n1', heading: '只保留 n1', summary: '' }],
      }),
      promptContent: 'p',
      mediaAssets: [],
      cards: makeCards(),
      activeCanvasId: 'cv',
      t,
    });

    expect(article.sourceCards).toHaveLength(1);
    expect(article.sourceCards![0].nodeId).toBe('n1');
  });

  it('媒体兜底：模型遗漏 media URL 时按 nodeId 拼回到对应段末尾', async () => {
    vi.mocked(callUniversalAI).mockResolvedValueOnce(
      JSON.stringify({
        title: 'T',
        segments: [
          { cardId: 'n1', text: '## 段一' },
          { cardId: 'n2', text: '## 段二' },
        ],
      }),
    );

    const mediaAssets: PublishMediaAsset[] = [
      {
        nodeId: 'n2',
        articleMarkdown: '![img](https://cdn.example.com/x.png)',
        promptMarkdown: '[img](https://cdn.example.com/x.png)',
      },
    ];

    const article = await generateArticleFromOutline({
      aiConfig: baseAiConfig,
      outline: makeOutline(),
      promptContent: 'p',
      mediaAssets,
      cards: makeCards(),
      activeCanvasId: 'cv',
      t,
    });

    // 兜底必须把 missing media 写到 n2 段末尾，n1 段保持原样
    expect(article.sourceCards![1].segmentText).toContain('https://cdn.example.com/x.png');
    expect(article.sourceCards![0].segmentText).not.toContain('https://cdn.example.com/x.png');
    expect(article.content).toContain('Related media');
  });

  it('本地图片只保存一份 Blob，正文仅保留短引用', async () => {
    vi.mocked(callUniversalAI).mockResolvedValueOnce(
      JSON.stringify({
        title: 'T',
        segments: [
          { cardId: 'n1', text: '## 段一' },
          { cardId: 'n2', text: '## 配图' },
        ],
      }),
    );
    const dataUrl = 'data:image/png;base64,QUJD';
    const reference = 'spoor-article-media:node-n2';
    const article = await generateArticleFromOutline({
      aiConfig: baseAiConfig,
      outline: makeOutline(),
      promptContent: 'p',
      mediaAssets: [
        {
          nodeId: 'n2',
          articleMarkdown: `![img](${reference})`,
          promptMarkdown: '![img](media://image/n2)',
          localDataUrl: dataUrl,
          articleMediaId: 'node-n2',
        },
      ],
      cards: makeCards(),
      activeCanvasId: 'cv',
      t,
    });

    expect(article.content).toContain(reference);
    expect(article.content).not.toContain('base64');
    expect(article.sourceCards?.[1].segmentText).toContain(reference);
    expect(article.media).toHaveLength(1);
    expect(article.media?.[0].blob.type).toBe('image/png');
    expect(article.media?.[0].blob.size).toBe(3);
  });

  it('模型回显本地图片占位符时替换为真实引用且不重复追加', async () => {
    vi.mocked(callUniversalAI).mockResolvedValueOnce(
      JSON.stringify({
        title: 'T',
        segments: [
          { cardId: 'n1', text: '## 段一' },
          { cardId: 'n2', text: '## 配图\n\n![Image](media://image/n2)' },
        ],
      }),
    );
    const reference = 'spoor-article-media:node-n2';
    const article = await generateArticleFromOutline({
      aiConfig: baseAiConfig,
      outline: makeOutline(),
      promptContent: 'p',
      mediaAssets: [
        {
          nodeId: 'n2',
          articleMarkdown: `![Image](${reference})`,
          promptMarkdown: '![Image](media://image/n2)',
          localDataUrl: 'data:image/png;base64,QUJD',
          articleMediaId: 'node-n2',
        },
      ],
      // 给卡片提供 markdown（verbatim），让 fidelity gate 不触发覆盖。
      cards: makeCards([
        { nodeId: 'n1', markdown: '## 段一' },
        { nodeId: 'n2', markdown: '## 配图\n\n![Image](media://image/n2)' },
      ]),
      activeCanvasId: 'cv',
      t,
    });

    expect(article.content).not.toContain('media://image/n2');
    expect(article.content.match(/spoor-article-media:node-n2/g)).toHaveLength(1);
    expect(article.content).not.toContain('## Related media');
  });

  it('媒体兜底：sourceCards 链路 missing 为空时不应走到 ensurePublishMediaInBody', async () => {
    vi.mocked(callUniversalAI).mockResolvedValueOnce(
      JSON.stringify({
        title: 'T',
        segments: [
          { cardId: 'n1', text: '段一含 https://cdn.example.com/y.png' },
          { cardId: 'n2', text: '段二' },
        ],
      }),
    );
    const article = await generateArticleFromOutline({
      aiConfig: baseAiConfig,
      outline: makeOutline(),
      promptContent: 'p',
      mediaAssets: [
        {
          nodeId: 'n1',
          articleMarkdown: '![img](https://cdn.example.com/y.png)',
          promptMarkdown: '![img](https://cdn.example.com/y.png)',
        },
      ],
      // 给卡片提供 verbatim markdown，让 fidelity gate 不覆盖（保持 AI 输出里的 URL）
      cards: makeCards([
        { nodeId: 'n1', markdown: '段一含 https://cdn.example.com/y.png' },
        { nodeId: 'n2', markdown: '段二' },
      ]),
      activeCanvasId: 'cv',
      t,
    });
    // 模型已含 URL → 不算 missing → 不应出现 'Related media' 兜底头
    expect(article.content).not.toContain('Related media');
    expect(article.content).not.toContain('## Related');
  });

  it('流式：onStreamChunk 把累积文本透传', async () => {
    vi.mocked(callUniversalAI).mockImplementation(async (opts) => {
      opts.onStreamChunk?.('partial-1');
      opts.onStreamChunk?.('partial-1-2');
      return JSON.stringify({ title: 'T', body: '最终' });
    });

    const seen: string[] = [];
    const article = await generateArticleFromOutline({
      aiConfig: baseAiConfig,
      outline: makeOutline(),
      promptContent: 'p',
      mediaAssets: [],
      cards: makeCards(),
      activeCanvasId: 'cv',
      t,
      onStreamChunk: (acc) => seen.push(acc),
    });

    expect(seen).toEqual(['partial-1', 'partial-1-2']);
    expect(article.content).toBe('最终');
  });

  it('Article 默认字段：id/date/tags/author/type/linkedCanvasIds 符合契约', async () => {
    vi.mocked(callUniversalAI).mockResolvedValueOnce(
      JSON.stringify({ title: 'T', body: 'b' }),
    );

    const article = await generateArticleFromOutline({
      aiConfig: baseAiConfig,
      outline: makeOutline(),
      promptContent: 'p',
      mediaAssets: [],
      cards: makeCards(),
      activeCanvasId: 'canvas-x',
      t,
    });

    expect(article.id).toMatch(/^gen-/);
    expect(article.tags).toEqual([]);
    expect(article.author).toBe('');
    expect(article.type).toMatch(/^GEN-\d+$/);
    expect(article.linkedCanvasIds).toEqual(['canvas-x']);
    expect(article.date).toMatch(/^\d{4}$/);
  });

  it('AI 抛出错误时同步抛错（由调用方上抛到弹窗）', async () => {
    vi.mocked(callUniversalAI).mockRejectedValueOnce(new Error('upstream down'));
    await expect(
      generateArticleFromOutline({
        aiConfig: baseAiConfig,
        outline: makeOutline(),
        promptContent: 'p',
        mediaAssets: [],
        cards: makeCards(),
        activeCanvasId: 'cv',
        t,
      }),
    ).rejects.toThrow('upstream down');
  });
});

describe('generatePublishOutline', () => {
  it('attaches local images as image parts (compact data URL)', async () => {
    const png = 'data:image/png;base64,AAAA';
    vi.mocked(callUniversalAI).mockResolvedValueOnce(
      JSON.stringify({ title: 'T', sections: [{ cardId: 'img1' }] }),
    );
    await generatePublishOutline({
      aiConfig: baseAiConfig,
      promptContent: 'p',
      fallbackTitle: '默认标题',
      t,
      imageHrefs: [png],
    });
    expect(callUniversalAI).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [png],
        lockModel: true,
        config: expect.objectContaining({
          provider: 'openrouter',
          model: 'openai/gpt-5.6-terra',
        }),
      }),
    );
  });

  it('http 配图按 URL 附件发送，不先转成 Base64', async () => {
    const href = 'https://cdn.example/cover.jpg';
    vi.mocked(callUniversalAI).mockResolvedValueOnce(
      JSON.stringify({ title: 'T', sections: [{ cardId: 'img1' }] }),
    );
    await generatePublishOutline({
      aiConfig: baseAiConfig,
      promptContent: 'p',
      fallbackTitle: '默认标题',
      t,
      imageHrefs: [href],
    });
    expect(callUniversalAI).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [href],
      }),
    );
  });

  it('无图时大纲仍锁定 GLM 多模态模型', async () => {
    vi.mocked(callUniversalAI).mockResolvedValueOnce(
      JSON.stringify({ title: 'T', sections: [{ cardId: 'n1' }] }),
    );
    await generatePublishOutline({
      aiConfig: baseAiConfig,
      promptContent: 'p',
      fallbackTitle: '默认标题',
      t,
    });
    expect(callUniversalAI).toHaveBeenCalledWith(
      expect.objectContaining({
        lockModel: true,
        config: expect.objectContaining({
          provider: 'openrouter',
          model: 'openai/gpt-5.6-terra',
        }),
      }),
    );
    expect(callUniversalAI.mock.calls[0]![0]).not.toHaveProperty('images');
  });

  it('跳过无法附上的图后，Attached visual #N 与 images 数组对齐', async () => {
    const huge = `data:image/png;base64,${'A'.repeat(MAX_VISION_DATA_URL_CHARS + 50)}`;
    const href = 'https://cdn.example/cover.jpg';
    vi.mocked(callUniversalAI).mockResolvedValueOnce(
      JSON.stringify({ title: 'T', sections: [{ cardId: 'img2' }] }),
    );
    await generatePublishOutline({
      aiConfig: baseAiConfig,
      promptContent: outlineAttachedVisualLine(1) + outlineAttachedVisualLine(2),
      fallbackTitle: '默认标题',
      t,
      imageHrefs: [huge, href],
    });
    const call = callUniversalAI.mock.calls[0]![0];
    expect(call.images).toEqual([href]);
    expect(String(call.prompt)).toContain(OUTLINE_VISUAL_PIXELS_SKIPPED);
    expect(String(call.prompt)).toContain(outlineAttachedVisualLine(1));
    expect(String(call.prompt)).not.toContain(outlineAttachedVisualLine(2));
  });
});
