import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db';
import { encodeEssayContent } from '../../src/utils/essayPayload';
import {
  essaySourceStackIndex,
  essaySourceStackPos,
  essaySourceStackZIndex,
  listEssaySourceNodes,
  resetEssaySourceBackfillForTests,
  setEssaySourcesCollapsed,
  uniqueEssaySourceNodeIds,
} from '../../src/services/essaySourceStack';

describe('essaySourceStack', () => {
  beforeEach(async () => {
    resetEssaySourceBackfillForTests();
    await db.nodes.clear();
    await db.articles.clear();
  });

  it('keeps first-selected ids first', () => {
    expect(uniqueEssaySourceNodeIds(['b', 'a', 'b', '', 'c'])).toEqual(['b', 'a', 'c']);
  });

  it('lists sources in stored generation order', () => {
    const essay = {
      id: 'essay',
      type: 'essay',
      x: 0,
      y: 0,
      essaySourceNodeIds: ['first', 'second'],
    };
    const nodes = [
      essay,
      { id: 'second', type: 'note', x: 40, y: 40 },
      { id: 'first', type: 'note', x: 10, y: 10 },
    ];
    expect(listEssaySourceNodes(essay, nodes).map((n) => n.id)).toEqual(['first', 'second']);
  });

  it('stacks first source on top', () => {
    expect(essaySourceStackZIndex(0)).toBeGreaterThan(essaySourceStackZIndex(1));
    expect(essaySourceStackIndex({ essaySourceNodeIds: ['a', 'b'] } as never, 'a')).toBe(0);
    const front = essaySourceStackPos({ x: 100, y: 200, width: 380 }, 0);
    const under = essaySourceStackPos({ x: 100, y: 200, width: 380 }, 1);
    expect(under.x).toBeGreaterThan(front.x);
    expect(under.y).toBeGreaterThan(front.y);
  });

  it('hides sources on collapse and places them beside the essay on expand', async () => {
    await db.articles.add({
      id: 'art-1',
      title: '长文',
      content: 'body',
      date: '2026-08-21',
      type: 'ESSAY',
      sourceCards: [
        { nodeId: 'n1', canvasId: 'default', kind: 'note', title: '一', segmentText: '1' },
        { nodeId: 'n2', canvasId: 'default', kind: 'note', title: '二', segmentText: '2' },
      ],
    });
    await db.nodes.bulkAdd([
      {
        id: 'essay',
        type: 'essay',
        x: 100,
        y: 50,
        width: 380,
        content: encodeEssayContent({ articleId: 'art-1' }),
      },
      { id: 'n1', type: 'note', x: 10, y: 20 },
      { id: 'n2', type: 'note', x: 400, y: 300 },
    ]);

    const collapsed = await setEssaySourcesCollapsed('essay', true);
    expect(collapsed).toBe(2);
    const afterCollapse = await db.nodes.bulkGet(['essay', 'n1', 'n2']);
    expect(afterCollapse[0]?.essaySourcesCollapsed).toBe(true);
    expect(afterCollapse[0]?.essaySourceNodeIds).toEqual(['n1', 'n2']);
    expect(afterCollapse[1]?.x).toBe(10);
    expect(afterCollapse[1]?.y).toBe(20);
    expect(afterCollapse[2]?.x).toBe(400);
    expect(afterCollapse[2]?.y).toBe(300);

    await setEssaySourcesCollapsed('essay', false);
    const afterExpand = await db.nodes.bulkGet(['n1', 'n2']);
    const stackedN1 = essaySourceStackPos({ x: 100, y: 50, width: 380 }, 0);
    const stackedN2 = essaySourceStackPos({ x: 100, y: 50, width: 380 }, 1);
    expect(afterExpand[0]?.x).toBe(stackedN1.x);
    expect(afterExpand[0]?.y).toBe(stackedN1.y);
    expect(afterExpand[1]?.x).toBe(stackedN2.x);
    expect(afterExpand[1]?.y).toBe(stackedN2.y);
    expect(afterExpand[0]?.essaySourceExpandedOffsetX).toBe(stackedN1.x - 100);
    expect(afterExpand[1]?.essaySourceExpandedOffsetY).toBe(stackedN2.y - 50);
  });
});
