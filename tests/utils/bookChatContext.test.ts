import { describe, it, expect } from 'vitest';
import {
  BOOK_CHAT_CHAPTER_CHARS,
  BOOK_CHAT_EXCERPT_CHARS,
  BOOK_CHAT_EXCERPT_LIMIT,
  BOOK_CHAT_EXCERPT_NOTE_CHARS,
  BOOK_CHAT_EXCERPT_OPEN_LIMIT,
  bookChatOpenExcerptCount,
  buildBookChatContext,
  clampBookChatChapter,
  formatBookChatExcerpts,
} from '../../src/utils/bookChatContext';
import { buildBookExcerpt } from '../../src/utils/bookExcerpts';
import type { BookExcerpt } from '../../src/db';
import type { BookUnit } from '../../src/utils/bookPayload';

function excerptOf(text: string, unitLabel = 'Ch1'): BookExcerpt {
  const excerpt = buildBookExcerpt({ text, unitIndex: 0, unitLabel, bookTitle: 'Demo' });
  if (!excerpt) throw new Error('excerpt not built');
  return excerpt;
}

describe('clampBookChatChapter', () => {
  it('leaves a short chapter untouched', () => {
    expect(clampBookChatChapter('  short chapter  ')).toBe('short chapter');
  });

  it('truncates a long chapter and marks the cut', () => {
    const text = 'a'.repeat(BOOK_CHAT_CHAPTER_CHARS + 200);
    const out = clampBookChatChapter(text);
    expect(out).toHaveLength(BOOK_CHAT_CHAPTER_CHARS + 1);
    expect(out.endsWith('…')).toBe(true);
  });

  it('opens the window around the selection instead of slicing it off', () => {
    const text = `${'开头'.repeat(2000)}这里是被选中的那句话${'结尾'.repeat(2000)}`;
    const out = clampBookChatChapter(text, '这里是被选中的那句话');
    expect(out).toContain('这里是被选中的那句话');
    expect(out.startsWith('…')).toBe(true);
    expect(out.endsWith('…')).toBe(true);
    // 窗口长度仍然受上限约束。
    expect(out.length).toBeLessThanOrEqual(BOOK_CHAT_CHAPTER_CHARS + 2);
  });

  it('falls back to a head slice when the selection is not in the chapter', () => {
    const text = 'a'.repeat(BOOK_CHAT_CHAPTER_CHARS + 200);
    const out = clampBookChatChapter(text, '这段不在这章里');
    expect(out.startsWith('a')).toBe(true);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('formatBookChatExcerpts', () => {
  it('returns an empty string when there is nothing saved', () => {
    expect(formatBookChatExcerpts([])).toBe('');
  });

  it('lists excerpts oldest-first with a location suffix', () => {
    // 存储是新→旧，送进提示词时要翻成阅读顺序。
    const list = [excerptOf('第二处', 'Ch2'), excerptOf('第一处', 'Ch1')];
    expect(formatBookChatExcerpts(list)).toBe('- 第一处 (Ch1)\n- 第二处 (Ch2)');
  });

  it('clamps each excerpt and caps how many are sent', () => {
    const many = Array.from({ length: BOOK_CHAT_EXCERPT_LIMIT + 5 }, (_, i) =>
      excerptOf(`第${i}条`),
    );
    const lines = formatBookChatExcerpts(many).split('\n');
    expect(lines).toHaveLength(BOOK_CHAT_EXCERPT_LIMIT);

    const long = formatBookChatExcerpts([excerptOf('y'.repeat(BOOK_CHAT_EXCERPT_CHARS + 90))]);
    expect(long).toContain(`${'y'.repeat(BOOK_CHAT_EXCERPT_CHARS)} (Ch1)`);
  });

  it('sends the user’s own thought on its own labelled line', () => {
    // 模型得分清哪句是书里的话、哪句是用户的话，所以想法单独一行并带标签。
    const row = { ...excerptOf('第一处', 'Ch1'), note: '  这跟我  手上的项目对得上  ' };
    expect(formatBookChatExcerpts([row], '我的想法')).toBe(
      '- 第一处 (Ch1)\n  我的想法: 这跟我 手上的项目对得上',
    );
  });

  it('says nothing extra for an excerpt without a thought', () => {
    expect(formatBookChatExcerpts([excerptOf('第一处', 'Ch1')], '我的想法')).toBe('- 第一处 (Ch1)');
    expect(formatBookChatExcerpts([{ ...excerptOf('第一处', 'Ch1'), note: '   ' }])).toBe(
      '- 第一处 (Ch1)',
    );
  });

  it('clamps the thought on its own budget', () => {
    const row = {
      ...excerptOf('第一处', 'Ch1'),
      note: 'n'.repeat(BOOK_CHAT_EXCERPT_NOTE_CHARS + 90),
    };
    expect(formatBookChatExcerpts([row], '我的想法')).toBe(
      `- 第一处 (Ch1)\n  我的想法: ${'n'.repeat(BOOK_CHAT_EXCERPT_NOTE_CHARS)}`,
    );
  });

  it('opens up more of the notebook when the caller raises the limit', () => {
    // 默认那 12 条是"顺手附赠最近的几条"；模型点名要看摘抄本时条数才跟着走。
    const many = Array.from({ length: BOOK_CHAT_EXCERPT_OPEN_LIMIT + 8 }, (_, i) =>
      excerptOf(`第${i}条`),
    );
    expect(formatBookChatExcerpts(many).split('\n')).toHaveLength(BOOK_CHAT_EXCERPT_LIMIT);
    expect(formatBookChatExcerpts(many, 'Note', BOOK_CHAT_EXCERPT_OPEN_LIMIT).split('\n')).toHaveLength(
      BOOK_CHAT_EXCERPT_OPEN_LIMIT,
    );
  });
});

describe('bookChatOpenExcerptCount', () => {
  it('never promises more than it sends', () => {
    expect(bookChatOpenExcerptCount(3)).toBe(3);
    expect(bookChatOpenExcerptCount(BOOK_CHAT_EXCERPT_OPEN_LIMIT + 20)).toBe(
      BOOK_CHAT_EXCERPT_OPEN_LIMIT,
    );
    expect(bookChatOpenExcerptCount(0)).toBe(0);
  });
});

describe('buildBookChatContext', () => {
  it('reads only the current unit text, never the serialized book', () => {
    const unit: BookUnit = { title: 'Ch3', text: '第三章正文' };
    const ctx = buildBookChatContext({
      unit,
      selection: '第三章',
      excerpts: [excerptOf('一条摘抄', 'Ch3')],
    });
    expect(ctx.chapterText).toBe('第三章正文');
    expect(ctx.excerptsText).toBe('- 一条摘抄 (Ch3)');
    // 入参里没有 content / payload，函数拿不到 base64 图片那条路。
    expect(Object.keys(ctx).sort()).toEqual(['chapterText', 'excerptsText']);
  });

  it('tolerates a missing unit', () => {
    const ctx = buildBookChatContext({
      unit: undefined,
      selection: '',
      excerpts: [],
    });
    expect(ctx.chapterText).toBe('');
    expect(ctx.excerptsText).toBe('');
  });

  it('honours a raised excerpt limit from the caller', () => {
    const many = Array.from({ length: BOOK_CHAT_EXCERPT_LIMIT + 5 }, (_, i) =>
      excerptOf(`第${i}条`),
    );
    const ctx = buildBookChatContext({
      unit: undefined,
      selection: '',
      excerpts: many,
      excerptLimit: BOOK_CHAT_EXCERPT_OPEN_LIMIT,
    });
    expect(ctx.excerptsText.split('\n')).toHaveLength(BOOK_CHAT_EXCERPT_LIMIT + 5);
  });
});
