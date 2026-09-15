import { describe, it, expect, vi } from 'vitest';
import type { CanvasNode } from '../../src/db';
import { buildPublishSourceMaterial, stripEmbeddedImageDataUrls } from '../../src/utils/publishSourceMaterial';
import { resolvePublishOutline } from '../../src/utils/parsePublishOutlineResponse';
import { draftArticleFromOutline, generatePublishOutline } from '../../src/utils/generateArticleFromOutline';

vi.mock('../../src/services/ai', () => ({
  callUniversalAI: vi.fn(),
}));

import { callUniversalAI } from '../../src/services/ai';

const base = { x: 0, y: 0, canvasId: 'c1' };
const t = (key: string, opts?: Record<string, unknown>) => {
  if (key === 'ai.prompts.publishOutline') return String(opts?.content ?? '');
  if (key === 'ai.prompts.publishOutlineSystem') return 'sys';
  return key;
};

describe('publish outline pipeline (real functions, mocked LLM only)', () => {
  it('keeps note prose, attaches the image, and still drafts text when the model only returns the image cardId', async () => {
    const huge = `data:image/png;base64,${'A'.repeat(4000)}`;
    const nodes: CanvasNode[] = [
      { ...base, id: 'n1', type: 'note', content: '毛衣要叠着收，领口朝下。' },
      { ...base, id: 'n2', type: 'note', content: `补充：${huge} then we discussed 收纳盒` },
      {
        ...base,
        id: 'img1',
        type: 'image',
        content: 'https://cdn.example/sweater.jpg',
        description: '叠好的毛衣',
      },
      { ...base, id: 'n3', type: 'note', content: '最后写保养，不要机洗。' },
    ];
    const selected = ['n1', 'n2', 'img1', 'n3'];
    const material = buildPublishSourceMaterial(selected, nodes, () => '');

    expect(material.promptContent).toContain('毛衣要叠着收');
    expect(material.promptContent).toContain('then we discussed 收纳盒');
    expect(material.promptContent).toContain('最后写保养');
    expect(material.promptContent).toContain('Attached visual #1');
    expect(material.promptContent).not.toMatch(/base64,A{20,}/);
    expect(material.visionImageHrefs).toEqual(['https://cdn.example/sweater.jpg']);
    expect(stripEmbeddedImageDataUrls(`${huge} then we discussed`)).toContain('then we discussed');

    vi.mocked(callUniversalAI).mockResolvedValueOnce(
      JSON.stringify({ title: '收纳', sections: [{ cardId: 'img1' }] }),
    );
    const parsed = await generatePublishOutline({
      aiConfig: { provider: 'gemini', apiKey: 'k', baseUrl: '', model: 'm' },
      promptContent: material.promptContent,
      fallbackTitle: '默认标题',
      t,
      imageHrefs: material.visionImageHrefs,
    });
    const outline = resolvePublishOutline(parsed, '默认标题', material.cards.map((c) => c.nodeId));
    expect(outline.sections.map((s) => s.cardId)).toEqual(['n1', 'n2', 'img1', 'n3']);

    const article = await draftArticleFromOutline({
      outline,
      cards: material.cards,
      mediaAssets: material.mediaAssets,
      activeCanvasId: 'c1',
      articleId: 'art-live',
    });
    expect(article.content).toContain('毛衣要叠着收，领口朝下。');
    expect(article.content).toContain('then we discussed 收纳盒');
    expect(article.content).toContain('最后写保养，不要机洗。');
    expect(article.content).toContain('https://cdn.example/sweater.jpg');
    expect(article.sourceCards?.map((c) => c.nodeId)).toEqual(['n1', 'n2', 'img1', 'n3']);

    const sent = callUniversalAI.mock.calls[0]![0];
    expect(sent.images).toEqual(['https://cdn.example/sweater.jpg']);
    expect(String(sent.prompt)).toContain('毛衣要叠着收');
    expect(String(sent.prompt)).toContain('Attached visual #1');
  });
});
