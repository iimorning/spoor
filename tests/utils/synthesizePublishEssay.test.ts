import { describe, expect, it, beforeEach } from 'vitest';
import { db } from '../../src/db';
import { synthesizePublishEssay } from '../../src/utils/synthesizePublishEssay';
import { tryParseEssayContent } from '../../src/utils/essayPayload';

describe('synthesizePublishEssay', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.articles.clear();
    await db.edges.clear();
  });

  it('assembles essay in stroke order and appends unbrushed candidates', async () => {
    await db.nodes.bulkPut([
      { id: 'a', type: 'text', content: 'Alpha', x: 0, y: 0, canvasId: 'default' },
      { id: 'b', type: 'text', content: 'Beta', x: 100, y: 0, canvasId: 'default' },
      { id: 'c', type: 'text', content: 'Gamma', x: 200, y: 0, canvasId: 'default' },
    ]);
    const nodes = await db.nodes.toArray();
    const nodesRef: Record<string, HTMLElement | null> = {};
    for (const id of ['a', 'b', 'c']) {
      const el = document.createElement('div');
      el.innerText = id === 'a' ? 'Alpha' : id === 'b' ? 'Beta' : 'Gamma';
      nodesRef[id] = el;
    }

    const { articleId, nodeId, willAssemble } = await synthesizePublishEssay({
      orderedIds: ['c', 'a'],
      candidateIds: ['a', 'b', 'c'],
      dynamicNodes: nodes,
      nodesRef,
      activeCanvasId: 'default',
      fallbackTitle: 'Fallback',
      relatedHeading: 'Related',
      kindLabel: (k) => k,
    });

    expect(willAssemble).toBe(false);
    const article = await db.articles.get(articleId);
    expect(article).toBeTruthy();
    expect(article!.generating).toBeFalsy();
    expect(article!.sourceCards?.map((s) => s.nodeId)).toEqual(['c', 'a', 'b']);
    expect(article!.content).toContain('Gamma');
    expect(article!.content).toContain('Alpha');
    expect(article!.content).toContain('Beta');

    const essay = await db.nodes.get(nodeId);
    expect(essay?.type).toBe('essay');
    expect(tryParseEssayContent(essay?.content)?.articleId).toBe(articleId);
  });

  it('marks draft generating when assembly will follow, without waiting on AI', async () => {
    await db.nodes.bulkPut([
      { id: 'a', type: 'text', content: 'Alpha', x: 0, y: 0, canvasId: 'default' },
      { id: 'b', type: 'text', content: 'Beta', x: 100, y: 0, canvasId: 'default' },
    ]);
    const nodes = await db.nodes.toArray();
    const nodesRef: Record<string, HTMLElement | null> = {
      a: Object.assign(document.createElement('div'), { innerText: 'Alpha' }),
      b: Object.assign(document.createElement('div'), { innerText: 'Beta' }),
    };

    const { articleId, willAssemble } = await synthesizePublishEssay({
      orderedIds: ['a', 'b'],
      candidateIds: ['a', 'b'],
      dynamicNodes: nodes,
      nodesRef,
      activeCanvasId: 'default',
      fallbackTitle: 'Fallback',
      relatedHeading: 'Related',
      kindLabel: (k) => k,
      aiConfig: { provider: 'openrouter', apiKey: 'test', model: 'x' } as never,
      t: (key) => key,
    });

    expect(willAssemble).toBe(true);
    const article = await db.articles.get(articleId);
    expect(article?.generating).toBe(true);
    expect(article?.content).toContain('Alpha');
    expect(article?.content).toContain('Beta');
  });
});
