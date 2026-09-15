import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db';
import { encodeEssayContent } from '../../src/utils/essayPayload';
import { resolveEssayRelatedNodeIds } from '../../src/utils/essayRelatedHighlight';

describe('resolveEssayRelatedNodeIds', () => {
  beforeEach(async () => {
    await db.articles.clear();
    await db.nodes.clear();
  });

  it('includes essay + source cards still on the canvas', async () => {
    await db.articles.add({
      id: 'art-1',
      title: 'Essay',
      content: 'body',
      date: '2026',
      type: 'GEN',
      sourceCards: [
        { nodeId: 'n1', canvasId: 'default', kind: 'note', title: 'A', segmentText: 'a' },
        { nodeId: 'n2', canvasId: 'default', kind: 'note', title: 'B', segmentText: 'b' },
        { nodeId: 'gone', canvasId: 'default', kind: 'note', title: 'C', segmentText: 'c' },
      ],
    });
    await db.nodes.bulkAdd([
      {
        id: 'essay-1',
        type: 'essay',
        content: encodeEssayContent({ articleId: 'art-1' }),
        x: 0,
        y: 0,
        width: 380,
        height: 520,
        canvasId: 'default',
      },
      {
        id: 'n1',
        type: 'note',
        content: 'a',
        x: 10,
        y: 10,
        width: 200,
        height: 200,
        canvasId: 'default',
      },
      {
        id: 'n2',
        type: 'note',
        content: 'b',
        x: 20,
        y: 20,
        width: 200,
        height: 200,
        canvasId: 'default',
      },
    ]);

    const ids = await resolveEssayRelatedNodeIds({
      essayNodeId: 'essay-1',
      canvasId: 'default',
      canvasNodeIds: new Set(['essay-1', 'n1', 'n2']),
    });

    expect([...ids].sort()).toEqual(['essay-1', 'n1', 'n2']);
  });

  it('returns only the essay when there are no source cards', async () => {
    await db.articles.add({
      id: 'art-blank',
      title: 'Blank',
      content: '',
      date: '2026',
      type: 'GEN',
    });
    await db.nodes.add({
      id: 'essay-blank',
      type: 'essay',
      content: encodeEssayContent({ articleId: 'art-blank' }),
      x: 0,
      y: 0,
      width: 380,
      height: 520,
      canvasId: 'default',
    });

    const ids = await resolveEssayRelatedNodeIds({
      essayNodeId: 'essay-blank',
      canvasId: 'default',
    });

    expect([...ids]).toEqual(['essay-blank']);
  });
});
