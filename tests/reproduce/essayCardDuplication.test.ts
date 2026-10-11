import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../../src/db';
import {
  migrateArticlesToEssayNodes,
  resetEssayNodesMigrationLockForTests,
} from '../../src/utils/migrateArticlesToEssayNodes';
import { dedupeEssayNodesByArticle, placeEssayNode } from '../../src/utils/essayNodes';
import { tryParseEssayContent } from '../../src/utils/essayPayload';

/**
 * 复现「长文卡凭空复制」这个症状本身。
 *
 * 这里不去猜第二行 article 是怎么来的（那需要看用户的云端数据），只回答两个能在这里
 * 实证的问题：
 *
 *   1. 两篇内容一样的 article 在，迁移会不会各给一张卡？
 *   2. 把其中一张卡删掉、文章留下，下次启动它会不会自己长回来？
 *
 * 第 2 条如果成立，就解释了"复制了几张、又删了几张、结果又冒出几张"——
 * 每删一次、每开一次应用，就多一张。
 */

const BODY = '# 模型中转站OpenRouter入门\n\n接你写的东西，不是接模型。'.repeat(6);

async function seedCanvas(id = 'default') {
  await db.canvases.add({ id, name: 'Canvas', createdAt: Date.now(), updatedAt: Date.now() });
}

const cardCount = async () => (await db.nodes.where('type').equals('essay').toArray()).length;
const cardFor = async (articleId: string) =>
  (await db.nodes.where('type').equals('essay').toArray()).find(
    (n) => tryParseEssayContent(n.content)?.articleId === articleId,
  );

beforeEach(async () => {
  resetEssayNodesMigrationLockForTests();
  await db.articles.clear();
  await db.nodes.clear();
  await db.canvases.clear();
  localStorage.removeItem('spoor-essay-nodes-migrated-v1');
  await seedCanvas();
});

afterEach(() => {
  resetEssayNodesMigrationLockForTests();
  localStorage.removeItem('spoor-essay-nodes-migrated-v1');
});

describe('症状一：两篇内容相同的文章，各得一张卡', () => {
  it('迁移只按 articleId 判"有没有卡"，看不出这两篇是同一篇', async () => {
    // 这就是用户截图里的状态：两行内容逐字相同，各有一张卡。
    await db.articles.add({
      id: 'art-1',
      title: '模型中转站OpenRouter入门',
      content: BODY,
      date: '2026',
      type: 'GEN',
      linkedCanvasIds: ['default'],
    });
    await db.articles.add({
      id: 'art-2',
      title: '模型中转站OpenRouter入门',
      content: BODY,
      date: '2026',
      type: 'GEN',
      linkedCanvasIds: ['default'],
    });

    // 先给 art-1 一张卡（模拟"用户自己建的那张"）。
    await placeEssayNode({ articleId: 'art-1', canvasId: 'default', x: 0, y: 0, title: 't' });
    expect(await cardCount()).toBe(1);

    // 再跑迁移（每次开应用都会跑）。
    const result = await migrateArticlesToEssayNodes({ preferredCanvasId: 'default' });

    // art-2 没有卡 → 补一张。迁移没有"内容相同就是同一篇"这个概念。
    expect(result.created).toBe(1);
    expect(await cardCount()).toBe(2);
    expect(await cardFor('art-2')).toBeTruthy();
  });

  it('去重也救不了：它按 articleId 分组，两个 id 不同就算两篇', async () => {
    await db.articles.add({
      id: 'art-1', title: 'T', content: BODY, date: '2026', type: 'GEN', linkedCanvasIds: ['default'],
    });
    await db.articles.add({
      id: 'art-2', title: 'T', content: BODY, date: '2026', type: 'GEN', linkedCanvasIds: ['default'],
    });
    await placeEssayNode({ articleId: 'art-1', canvasId: 'default', x: 0, y: 0, title: 't' });
    await migrateArticlesToEssayNodes({ preferredCanvasId: 'default' });
    expect(await cardCount()).toBe(2);

    // 迁移开头会调一次去重。
    const { removed } = await dedupeEssayNodesByArticle();
    expect(removed).toBe(0);
    expect(await cardCount()).toBe(2);
  });
});

describe('症状二：删掉一张卡，它自己会长回来', () => {
  it('删卡留文章，下次启动迁移又补一张——每删一次多一张', async () => {
    // 用户看到复制品、删掉一张，以为完事了。下次开应用又冒出来。
    await db.articles.add({
      id: 'art-1', title: 'T', content: BODY, date: '2026', type: 'GEN', linkedCanvasIds: ['default'],
    });
    await db.articles.add({
      id: 'art-2', title: 'T', content: BODY, date: '2026', type: 'GEN', linkedCanvasIds: ['default'],
    });
    await migrateArticlesToEssayNodes({ preferredCanvasId: 'default' });
    expect(await cardCount()).toBe(2);

    // 用户删掉其中一张。
    const doomed = await cardFor('art-2');
    await db.nodes.delete(doomed!.id);
    expect(await cardCount()).toBe(1);

    // 下次启动。
    const again = await migrateArticlesToEssayNodes({ preferredCanvasId: 'default' });
    expect(again.created).toBe(1);
    expect(await cardCount()).toBe(2);
  });

  it('连着删三次，就有三张一模一样的卡', async () => {
    // "凭空复制了几张"最像的解释：不是一次多出来的，是一次一次长回来的。
    await db.articles.add({
      id: 'art-1', title: 'T', content: BODY, date: '2026', type: 'GEN', linkedCanvasIds: ['default'],
    });
    await db.articles.add({
      id: 'art-2', title: 'T', content: BODY, date: '2026', type: 'GEN', linkedCanvasIds: ['default'],
    });
    await migrateArticlesToEssayNodes({ preferredCanvasId: 'default' });

    for (let i = 0; i < 3; i += 1) {
      const cards = await db.nodes.where('type').equals('essay').toArray();
      // 删掉所有卡，模拟用户清空画布上的长文卡
      await db.nodes.bulkDelete(cards.map((c) => c.id));
      expect(await cardCount()).toBe(0);
      await migrateArticlesToEssayNodes({ preferredCanvasId: 'default' });
      expect(await cardCount()).toBe(2);
    }
  });
});

describe('症状三：两篇都是空白草稿时不能按内容去重', () => {
  it('两个空白新长文内容天然相同，按内容去重会把它们误合并', async () => {
    // 这是"按内容判重"必须卡死的边界：两个都还没写东西的新卡，正文都是空。
    await db.articles.add({
      id: 'art-1', title: '未命名长文', content: '', date: '2026', type: 'REF', linkedCanvasIds: ['default'],
    });
    await db.articles.add({
      id: 'art-2', title: '未命名长文', content: '', date: '2026', type: 'REF', linkedCanvasIds: ['default'],
    });
    await placeEssayNode({ articleId: 'art-1', canvasId: 'default', x: 0, y: 0, title: 't' });
    await migrateArticlesToEssayNodes({ preferredCanvasId: 'default' });

    // 现在的行为是保留两张——这是对的。将来加内容判重时，不能把这里变成一张。
    expect(await cardCount()).toBe(2);
  });
});
