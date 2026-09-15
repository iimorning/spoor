import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../../src/db';
import {
  migrateArticlesToEssayNodes,
  resetEssayNodesMigrationLockForTests,
} from '../../src/utils/migrateArticlesToEssayNodes';
import { encodeEssayContent, tryParseEssayContent } from '../../src/utils/essayPayload';
import { dedupeEssayNodesByArticle, placeEssayNode } from '../../src/utils/essayNodes';

describe('migrateArticlesToEssayNodes', () => {
  beforeEach(async () => {
    resetEssayNodesMigrationLockForTests();
    await db.articles.clear();
    await db.nodes.clear();
    await db.canvases.clear();
    localStorage.removeItem('spoor-essay-nodes-migrated-v1');
    await db.canvases.add({
      id: 'default',
      name: 'Canvas',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  afterEach(() => {
    resetEssayNodesMigrationLockForTests();
    localStorage.removeItem('spoor-essay-nodes-migrated-v1');
  });

  it('creates essay nodes for articles without one', async () => {
    await db.articles.add({
      id: 'a1',
      title: 'One',
      content: 'body',
      date: '2026',
      type: 'GEN',
      linkedCanvasIds: ['default'],
    });

    const first = await migrateArticlesToEssayNodes({ preferredCanvasId: 'default' });
    expect(first.created).toBe(1);
    expect(first.skipped).toBe(0);

    const nodes = await db.nodes.where('type').equals('essay').toArray();
    expect(nodes).toHaveLength(1);
    expect(tryParseEssayContent(nodes[0]!.content)?.articleId).toBe('a1');

    const second = await migrateArticlesToEssayNodes({ preferredCanvasId: 'default' });
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(1);
    expect(await db.nodes.where('type').equals('essay').count()).toBe(1);
  });

  it('coalesces concurrent migrations so StrictMode cannot double-create', async () => {
    await db.articles.add({
      id: 'a1',
      title: 'One',
      content: 'body',
      date: '2026',
      type: 'GEN',
      linkedCanvasIds: ['default'],
    });

    const [a, b] = await Promise.all([
      migrateArticlesToEssayNodes({ preferredCanvasId: 'default' }),
      migrateArticlesToEssayNodes({ preferredCanvasId: 'default' }),
    ]);

    // Shared in-flight promise → identical result; only one card written.
    expect(a).toEqual(b);
    expect(a.created).toBe(1);
    expect(await db.nodes.where('type').equals('essay').count()).toBe(1);
  });

  it('dedupes existing duplicate essay cards for the same article', async () => {
    await db.articles.add({
      id: 'a1',
      title: 'One',
      content: 'body',
      date: '2026',
      type: 'GEN',
      linkedCanvasIds: ['default'],
    });
    await db.nodes.bulkAdd([
      {
        id: 'e-keep',
        canvasId: 'default',
        type: 'essay',
        content: encodeEssayContent({ articleId: 'a1' }),
        x: 0,
        y: 0,
      },
      {
        id: 'e-drop',
        canvasId: 'default',
        type: 'essay',
        content: encodeEssayContent({ articleId: 'a1' }),
        x: 100,
        y: 0,
      },
    ]);

    await migrateArticlesToEssayNodes({ preferredCanvasId: 'default' });
    const left = await db.nodes.where('type').equals('essay').toArray();
    expect(left).toHaveLength(1);
    // Stable id sort keeps the lexicographically first id.
    expect(left[0]!.id).toBe('e-drop');
  });
});

describe('dedupeEssayNodesByArticle', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.edges.clear();
  });

  it('removes extras and their edges', async () => {
    const first = await placeEssayNode({ articleId: 'a1', canvasId: 'default', x: 0, y: 0 });
    const second = await placeEssayNode({ articleId: 'a1', canvasId: 'default', x: 40, y: 0 });

    // `dedupeEssayNodesByArticle` keeps the lex-smaller id and removes the
    // lex-larger one. placeEssayNode returns random UUIDs, so figure out
    // which one will actually be deleted and attach the dangling edge to
    // it. (Earlier this test pointed the edge at `second` blindly, which
    // was flaky: ~50% of the time `second` was lex-smaller and got kept.)
    const [keepId, dropId] = [first, second].sort((a, b) => a.localeCompare(b));
    await db.edges.add({ id: 'edge1', from: dropId, to: 'other', canvasId: 'default' });

    const { removed } = await dedupeEssayNodesByArticle();
    expect(removed).toBe(1);
    expect(await db.nodes.where('type').equals('essay').count()).toBe(1);
    // The dropped node's dangling edge is gone; the kept node's id matches
    // what dedupe promised to preserve.
    expect(await db.edges.get('edge1')).toBeUndefined();
    const survivors = await db.nodes.where('type').equals('essay').toArray();
    expect(survivors[0]?.id).toBe(keepId);
  });
});
