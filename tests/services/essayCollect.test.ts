import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/db';
import {
  collectNodesIntoEssay,
  isEssayCollectable,
  pickEssayCollectTarget,
  repairEssayCollectedMedia,
  sourceCardFromCanvasNode,
  sourceCardPreviewImageSrc,
} from '../../src/services/essayCollect';
import { ARTICLE_MEDIA_SCHEME } from '../../src/utils/articleMedia';
import { encodeEssayContent, ESSAY_NODE_SIZE } from '../../src/utils/essayPayload';
import type { CanvasNode } from '../../src/db';

function note(id: string, x: number, y: number, content: string): CanvasNode {
  return {
    id,
    canvasId: 'c1',
    type: 'note',
    content,
    x,
    y,
    width: 200,
    height: 160,
  };
}

function essayNode(): CanvasNode {
  return {
    id: 'essay-1',
    canvasId: 'c1',
    type: 'essay',
    content: encodeEssayContent({ articleId: 'art-1' }),
    x: 0,
    y: 0,
    width: ESSAY_NODE_SIZE.width,
    height: ESSAY_NODE_SIZE.height,
  };
}

describe('essayCollect', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.articles.clear();
    await db.articles.add({
      id: 'art-1',
      title: 'Untitled',
      content: '',
      date: '2026',
      type: 'REF',
      tags: [],
    });
    await db.nodes.bulkAdd([essayNode(), note('n1', 40, 40, '一段便签')]);
  });

  it('does not collect essays or ambience cards', () => {
    expect(isEssayCollectable(essayNode())).toBe(false);
    expect(isEssayCollectable({ ...note('a', 0, 0, ''), type: 'ambience' })).toBe(false);
    expect(isEssayCollectable(note('n', 0, 0, 'ok'))).toBe(true);
  });

  it('picks an overlapping essay as the collect target', () => {
    const dragged = note('n1', 40, 40, '一段便签');
    const target = pickEssayCollectTarget(
      'n1',
      { x: dragged.x, y: dragged.y, width: 200, height: 160 },
      [essayNode(), dragged],
      new Set(['n1']),
    );
    expect(target?.id).toBe('essay-1');
  });

  it('writes an unlinked source card without changing the body', async () => {
    const nodes = [essayNode(), note('n1', 40, 40, '一段便签')];
    const collected = await collectNodesIntoEssay({
      essayNodeId: 'essay-1',
      sourceIds: ['n1'],
      nodes,
    });
    expect(collected).toEqual(['n1']);
    const article = await db.articles.get('art-1');
    expect(article?.content).toBe('');
    expect(article?.contentDrivesBody).toBeFalsy();
    expect(article?.sourceCards).toEqual([
      expect.objectContaining({
        nodeId: 'n1',
        segmentText: '一段便签',
        inBody: false,
      }),
    ]);
    const essay = await db.nodes.get('essay-1');
    expect(essay?.essaySourceNodeIds).toEqual(['n1']);
    expect(essay?.essaySourcesCollapsed).toBe(true);
  });

  it('builds image markdown for image cards', () => {
    const card = sourceCardFromCanvasNode({
      id: 'img-1',
      canvasId: 'c1',
      type: 'image',
      content: 'https://example.com/cover.jpg',
      description: '封面',
      x: 0,
      y: 0,
    });
    expect(card.inBody).toBe(false);
    expect(card.segmentText).toContain('![封面](https://example.com/cover.jpg)');
  });

  it('copies a local image into article media so the editor can render it', async () => {
    const pixel =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const image: CanvasNode = {
      id: 'img-1',
      canvasId: 'c1',
      type: 'image',
      content: pixel,
      description: '封面',
      x: 40,
      y: 40,
      width: 200,
      height: 160,
    };
    await db.nodes.add(image);
    const collected = await collectNodesIntoEssay({
      essayNodeId: 'essay-1',
      sourceIds: ['img-1'],
      nodes: [essayNode(), image],
    });
    expect(collected).toEqual(['img-1']);
    const article = await db.articles.get('art-1');
    expect(article?.sourceCards?.[0]?.segmentText).toBe(`![封面](${ARTICLE_MEDIA_SCHEME}node-img-1)`);
    expect(article?.media).toHaveLength(1);
    expect(article?.media?.[0]?.id).toBe('node-img-1');
    expect(article?.media?.[0]?.blob.size).toBeGreaterThan(0);
    expect(sourceCardPreviewImageSrc(article!.sourceCards![0]!.segmentText, { 'node-img-1': 'blob:preview' })).toBe(
      'blob:preview',
    );
  });

  it('repairs an inbox image that was stored without article media', async () => {
    const pixel =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    await db.nodes.add({
      id: 'img-2',
      canvasId: 'c1',
      type: 'image',
      content: pixel,
      description: '旧图',
      x: 0,
      y: 0,
    });
    await db.articles.update('art-1', {
      sourceCards: [
        {
          nodeId: 'img-2',
          canvasId: 'c1',
          kind: 'image',
          title: '旧图',
          segmentText: `![旧图](${ARTICLE_MEDIA_SCHEME}node-img-2)`,
          inBody: false,
        },
      ],
    });
    await repairEssayCollectedMedia('art-1');
    const article = await db.articles.get('art-1');
    expect(article?.media?.[0]?.id).toBe('node-img-2');
    expect(article?.media?.[0]?.blob.size).toBeGreaterThan(0);
  });
});
