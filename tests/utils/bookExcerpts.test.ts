import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db';
import {
  BOOK_EXCERPT_CAP,
  BOOK_EXCERPT_MAX_CHARS,
  BOOK_EXCERPT_NOTE_MAX_CHARS,
  appendBookExcerpt,
  buildBookExcerpt,
  countBookExcerptsInSelection,
  formatExcerptCardContent,
  normalizeBookExcerptNote,
  readBookExcerpts,
  removeBookExcerpt,
  updateBookExcerptNote,
} from '../../src/utils/bookExcerpts';

async function seedBook(id = 'b1') {
  await db.nodes.add({ id, type: 'book', x: 0, y: 0 });
}

function makeExcerpt(text: string, unitIndex = 0) {
  const excerpt = buildBookExcerpt({
    text,
    unitIndex,
    unitLabel: 'Ch1',
    bookTitle: 'Demo',
  });
  if (!excerpt) throw new Error('excerpt not built');
  return excerpt;
}

describe('buildBookExcerpt', () => {
  it('collapses whitespace in single-paragraph prose', () => {
    const excerpt = buildBookExcerpt({
      text: '  他说  这件事不能  只看结果  ',
      unitIndex: 2,
      unitLabel: '第二章',
      bookTitle: ' Demo ',
    });
    expect(excerpt?.text).toBe('他说 这件事不能 只看结果');
    expect(excerpt?.unitIndex).toBe(2);
    expect(excerpt?.unitLabel).toBe('第二章');
    expect(excerpt?.bookTitle).toBe('Demo');
    expect(excerpt?.id).toBeTruthy();
  });

  it('keeps paragraph breaks when the selection spans more than one', () => {
    // `normalizeExtractedPassage` 对含换行的文本刻意只做裁剪，保留段落结构。
    const excerpt = buildBookExcerpt({
      text: '\n  第一段。\n\n  第二段。\n',
      unitIndex: 0,
      unitLabel: '',
      bookTitle: '',
    });
    expect(excerpt?.text).toBe('第一段。\n\n  第二段。');
  });

  it('does not pin chat-sourced excerpts to the chapter you happened to be on', () => {
    const excerpt = buildBookExcerpt({
      text: 'AI 对这一段的理解',
      source: 'chat',
      unitIndex: 4,
      unitLabel: '5 / 21',
      bookTitle: 'Demo',
    });
    expect(excerpt?.source).toBe('chat');
    expect(excerpt?.unitIndex).toBe(-1);
    expect(excerpt?.unitLabel).toBe('');
  });

  it('returns null for blank text', () => {
    expect(
      buildBookExcerpt({ text: '   \n  ', unitIndex: 0, unitLabel: '', bookTitle: '' }),
    ).toBeNull();
  });

  it('clamps very long selections and floors a bad unit index', () => {
    const excerpt = buildBookExcerpt({
      text: 'x'.repeat(BOOK_EXCERPT_MAX_CHARS + 500),
      unitIndex: -3,
      unitLabel: '',
      bookTitle: '',
    });
    expect(excerpt?.text).toHaveLength(BOOK_EXCERPT_MAX_CHARS);
    expect(excerpt?.unitIndex).toBe(0);
  });
});

describe('bookExcerpts storage', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await seedBook();
  });

  it('reads an empty list from a node without excerpts', async () => {
    const node = await db.nodes.get('b1');
    expect(readBookExcerpts(node)).toEqual([]);
    expect(readBookExcerpts(null)).toEqual([]);
  });

  it('appends newest-first and persists', async () => {
    await appendBookExcerpt('b1', makeExcerpt('第一条'));
    await appendBookExcerpt('b1', makeExcerpt('第二条'));
    const node = await db.nodes.get('b1');
    expect(readBookExcerpts(node).map((row) => row.text)).toEqual(['第二条', '第一条']);
  });

  it('does not lose one of two concurrent appends', async () => {
    await Promise.all([
      appendBookExcerpt('b1', makeExcerpt('并发 A')),
      appendBookExcerpt('b1', makeExcerpt('并发 B')),
    ]);
    const node = await db.nodes.get('b1');
    expect(readBookExcerpts(node)).toHaveLength(2);
  });

  it('removes by id and leaves the rest alone', async () => {
    await appendBookExcerpt('b1', makeExcerpt('留下'));
    const doomed = makeExcerpt('删掉');
    await appendBookExcerpt('b1', doomed);
    await removeBookExcerpt('b1', doomed.id);
    const node = await db.nodes.get('b1');
    expect(readBookExcerpts(node).map((row) => row.text)).toEqual(['留下']);
  });

  it('drops the oldest once the cap is reached', async () => {
    const full = Array.from({ length: BOOK_EXCERPT_CAP }, (_, i) =>
      makeExcerpt(`旧-${i}`),
    );
    await db.nodes.update('b1', { bookExcerpts: full });
    await appendBookExcerpt('b1', makeExcerpt('最新'));
    const node = await db.nodes.get('b1');
    const list = readBookExcerpts(node);
    expect(list).toHaveLength(BOOK_EXCERPT_CAP);
    expect(list[0]?.text).toBe('最新');
    expect(list.some((row) => row.text === `旧-${BOOK_EXCERPT_CAP - 1}`)).toBe(false);
  });

  it('no-ops when the node is gone', async () => {
    await expect(appendBookExcerpt('missing', makeExcerpt('无处可放'))).resolves.toEqual([]);
  });

  it('saves a thought on one excerpt and leaves the others alone', async () => {
    const kept = makeExcerpt('留着');
    const target = makeExcerpt('要写想法');
    await appendBookExcerpt('b1', kept);
    await appendBookExcerpt('b1', target);
    await updateBookExcerptNote('b1', target.id, '  这段其实在说反馈回路  ');
    const list = readBookExcerpts(await db.nodes.get('b1'));
    expect(list.find((row) => row.id === target.id)?.note).toBe('这段其实在说反馈回路');
    expect(list.find((row) => row.id === kept.id)?.note).toBeUndefined();
  });

  it('drops the key entirely when the thought is cleared', async () => {
    const row = makeExcerpt('要清掉');
    await appendBookExcerpt('b1', row);
    await updateBookExcerptNote('b1', row.id, '先写一句');
    await updateBookExcerptNote('b1', row.id, '   ');
    const saved = readBookExcerpts(await db.nodes.get('b1'))[0];
    // 存空串的话，「这条到底写没写想法」就有两种答案了。
    expect('note' in (saved as object)).toBe(false);
  });

  it('no-ops on a thought for an unknown excerpt', async () => {
    const row = makeExcerpt('原来那条');
    await appendBookExcerpt('b1', row);
    await updateBookExcerptNote('b1', 'nope', '写不进去');
    expect(readBookExcerpts(await db.nodes.get('b1'))[0]?.note).toBeUndefined();
  });
});

describe('normalizeBookExcerptNote', () => {
  it('keeps the line breaks the user typed and trims the edges', () => {
    expect(normalizeBookExcerptNote('  第一条\n\n第二条  ')).toBe('第一条\n\n第二条');
    expect(normalizeBookExcerptNote(undefined)).toBe('');
  });

  it('clamps a runaway thought', () => {
    expect(normalizeBookExcerptNote('思'.repeat(BOOK_EXCERPT_NOTE_MAX_CHARS + 50))).toHaveLength(
      BOOK_EXCERPT_NOTE_MAX_CHARS,
    );
  });
});

describe('formatExcerptCardContent', () => {
  it('leaves the card text alone when there is no thought', () => {
    expect(formatExcerptCardContent('摘抄正文', '  ', '我的想法')).toBe('摘抄正文');
    expect(formatExcerptCardContent('摘抄正文', undefined, 'My note')).toBe('摘抄正文');
  });

  it('carries the passage and the thought into one card', () => {
    const card = formatExcerptCardContent('摘抄正文', '这跟我手上的项目对得上', '我的想法');
    expect(card).toBe('摘抄正文\n\n我的想法\n这跟我手上的项目对得上');
    // 卡片是纯文本渲染的：正文和想法都得原样在里面，AI 读到的也是这份。
    expect(card).toContain('摘抄正文');
    expect(card).toContain('这跟我手上的项目对得上');
  });

  it('refuses to make a card out of a thought with no passage', () => {
    // 调用方拿返回值当"要不要建这张卡"的判断：空串才拦得住，
    // 只拼想法会造出一张内容是空行加想法的卡片。
    expect(formatExcerptCardContent('   ', '光有想法', '我的想法')).toBe('');
    expect(formatExcerptCardContent('', undefined, '我的想法')).toBe('');
  });
});

describe('countBookExcerptsInSelection', () => {
  const excerpt = (id: string) => ({
    id,
    text: '一条摘抄',
    unitIndex: 0,
    unitLabel: 'Ch1',
    bookTitle: 'B',
    createdAt: 1,
  });

  it('sums the excerpts of every book being deleted', () => {
    expect(
      countBookExcerptsInSelection(
        [
          { id: 'b1', type: 'book', bookExcerpts: [excerpt('a'), excerpt('b')] },
          { id: 'b2', type: 'book', bookExcerpts: [excerpt('c')] },
        ],
        ['b1', 'b2'],
      ),
    ).toBe(3);
  });

  it('says zero when the books hold nothing worth protecting', () => {
    // 数量是 0 时不该弹窗：每天要删好几次卡片，为一张空书打扰只会把人训练成不看。
    expect(
      countBookExcerptsInSelection(
        [
          { id: 'b1', type: 'book', bookExcerpts: [] },
          { id: 'b2', type: 'book' },
        ],
        ['b1', 'b2'],
      ),
    ).toBe(0);
    expect(countBookExcerptsInSelection([], ['b1'])).toBe(0);
  });

  it('ignores nodes that are not in the deletion set', () => {
    // 没被选中的书，里面的摘抄跟这次删除无关。
    expect(
      countBookExcerptsInSelection(
        [
          { id: 'b1', type: 'book', bookExcerpts: [] },
          { id: 'b2', type: 'book', bookExcerpts: [excerpt('a')] },
        ],
        ['b1'],
      ),
    ).toBe(0);
  });

  it('ignores cards that merely carry excerpts in their shape', () => {
    // 非书籍节点身上不会有 bookExcerpts，但规则得写死，免得以后加了字段就误判。
    expect(
      countBookExcerptsInSelection(
        [{ id: 't1', type: 'text', bookExcerpts: [excerpt('a')] }],
        ['t1'],
      ),
    ).toBe(0);
  });
});
