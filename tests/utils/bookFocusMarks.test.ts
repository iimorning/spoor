import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db';
import {
  BOOK_FOCUS_MARK_MAX_CHARS,
  BOOK_FOCUS_MARK_MIN_CHARS,
  BOOK_FOCUS_MAX_PER_CHAPTER,
  BOOK_FOCUS_NOTE_MIN_CHARS,
  appendBookFocusMarks,
  isChapterFocused,
  normalizeFocusMessage,
  pickFocusMarks,
  readBookFocusMarks,
  removeBookFocusMarks,
  splitStoredTranslation,
} from '../../src/utils/bookFocusMarks';
import { bookFocusSystemEn, bookFocusSystemZh } from '../../src/i18n/bookFocusPrompts';

const CHAPTER = [
  '第一段讲的是旧衣服。',
  '第二段说，真正穿旧衣服的人不讲究旧。',
  '第二段说，穿新衣服的人才不讲究。',
].join('\n\n');

/** 一条合格的说明：足够长，不至于被判成"复述正文"。 */
const NOTE = '这一处其实在偷偷换掉前面那个前提：不是"旧衣服好不好"，而是"谁有资格定义体面"。';
const SHORT_NOTE = '这一段谈到了旧衣服。';

function marksOf(quotes: unknown[], note: unknown = NOTE) {
  return quotes.map((quote) => ({ quote, note }));
}

describe('pickFocusMarks', () => {
  it('keeps a quote that appears exactly once, with its note', () => {
    expect(pickFocusMarks(CHAPTER, marksOf(['真正穿旧衣服的人不讲究旧']))).toEqual([
      { quote: '真正穿旧衣服的人不讲究旧', note: NOTE },
    ]);
  });

  it('drops the whole entry when the note is too short', () => {
    // 这是这套功能最常见的失败：模型把说明写成"这一段谈到了旧衣服"这种复述，
    // 六个字交差。留着它，标注就只剩一块没意义的黄底。
    expect(pickFocusMarks(CHAPTER, marksOf(['真正穿旧衣服的人不讲究旧'], SHORT_NOTE))).toEqual([]);
    expect(pickFocusMarks(CHAPTER, marksOf(['真正穿旧衣服的人不讲究旧'], ''))).toEqual([]);
    expect(
      pickFocusMarks(CHAPTER, marksOf(['真正穿旧衣服的人不讲究旧'], '短'.repeat(BOOK_FOCUS_NOTE_MIN_CHARS - 1))),
    ).toEqual([]);
  });

  it('drops a quote that appears twice', () => {
    // 同一句话出现两处就不知道标哪一处。标错一处比不标更糟：
    // 读者会以为那是作者特意强调的。
    expect(pickFocusMarks(CHAPTER, marksOf(['第二段说']))).toEqual([]);
  });

  it('matches across collapsed line breaks, the way the DOM lookup does', () => {
    // 模型复述时会把引文里的换行压成空格，这里必须照样找得到。
    expect(
      pickFocusMarks(CHAPTER, marksOf(['第一段讲的是旧衣服。 第二段说，真正穿旧衣服的人不讲究旧。'])),
    ).toHaveLength(1);
  });

  it('drops quotes that are too short or too long', () => {
    expect(pickFocusMarks(CHAPTER, marksOf(['第二段', '']))).toEqual([]);
    expect(pickFocusMarks(CHAPTER, marksOf(['真'.repeat(BOOK_FOCUS_MARK_MAX_CHARS + 1)]))).toEqual([]);
    // 刚好卡在下限之上才留。
    const atLimit = '第二段说，真正穿旧衣服的人不讲究旧'.slice(0, BOOK_FOCUS_MARK_MIN_CHARS);
    expect(pickFocusMarks(CHAPTER, marksOf([atLimit]))).toHaveLength(1);
    expect(pickFocusMarks(CHAPTER, marksOf([atLimit.slice(0, -1)]))).toHaveLength(0);
  });

  it('drops overlapping quotes and keeps the first of each pair', () => {
    expect(
      pickFocusMarks(CHAPTER, marksOf(['第一段讲的是旧衣服。第二段说', '第一段讲的是旧衣服'])),
    ).toEqual([{ quote: '第一段讲的是旧衣服。第二段说', note: NOTE }]);
  });

  it('caps how many passages one chapter gets', () => {
    const many = Array.from(
      { length: BOOK_FOCUS_MAX_PER_CHAPTER + 4 },
      (_, i) => `这里是一段独特的话，第 ${i} 段。`,
    );
    const source = many.join('\n\n');
    expect(pickFocusMarks(source, marksOf(many))).toHaveLength(BOOK_FOCUS_MAX_PER_CHAPTER);
  });

  it('ignores entries that are not a quote/note pair', () => {
    expect(
      pickFocusMarks(CHAPTER, [42, null, { quote: 'x' }, { note: NOTE }, { ...marksOf(['真正穿旧衣服的人不讲究旧'])[0] }]),
    ).toHaveLength(1);
    expect(pickFocusMarks(CHAPTER, 'not an array')).toEqual([]);
    // 也认模型偶尔用别名的那一版。
    expect(
      pickFocusMarks(CHAPTER, [{ text: '真正穿旧衣服的人不讲究旧', reason: NOTE }]),
    ).toHaveLength(1);
  });
});

describe('normalizeFocusMessage', () => {
  it('treats an ellipsis as nothing to say', () => {
    // 信封里 message 是必填的，模型拿不准时塞个省略号——那比沉默更糟：
    // 右栏多一个空气泡，用户还得琢磨刚才发生了什么。
    for (const filler of ['…', '...', '。。。', '———', '()']) {
      expect(normalizeFocusMessage(filler)).toBe('');
    }
  });

  it('treats nothing to say as nothing to say', () => {
    // 沉默是这套功能里最常见的正确答案，别把它变成一句废话。
    expect(normalizeFocusMessage('')).toBe('');
    expect(normalizeFocusMessage('   ')).toBe('');
    expect(normalizeFocusMessage(undefined)).toBe('');
    expect(normalizeFocusMessage(42)).toBe('');
  });

  it('trims and caps a real remark', () => {
    expect(normalizeFocusMessage('  这一章和张力有关。  ')).toBe('这一章和张力有关。');
    const long = '话'.repeat(400);
    expect(normalizeFocusMessage(long)).toHaveLength(300);
    expect(normalizeFocusMessage(long).endsWith('…')).toBe(true);
  });
});

describe('readBookFocusMarks', () => {
  it('drops marks left over from the version that had no note', () => {
    // 早期版本只存引文，说明是右栏里一条全局消息。那些标记标得出来却挂不出
    // 任何东西——用户会点开一个空框，而且因为"这章标过了"而永远等不到重读。
    const stale = [{ id: 'a', unitIndex: 2, quote: '真正穿旧衣服的人不讲究旧', createdAt: 1 }];
    expect(readBookFocusMarks({ bookFocusMarks: stale as never })).toEqual([]);
    expect(isChapterFocused({ bookFocusMarks: stale as never }, 2)).toBe(false);
  });

  it('keeps marks that carry a usable note', () => {
    const marks = [{ id: 'a', unitIndex: 2, quote: '真正穿旧衣服的人不讲究旧', note: NOTE, createdAt: 1 }];
    expect(readBookFocusMarks({ bookFocusMarks: marks })).toHaveLength(1);
  });

  it('is empty for a book that never had any', () => {
    expect(readBookFocusMarks(undefined)).toEqual([]);
    expect(readBookFocusMarks({ bookFocusMarks: undefined })).toEqual([]);
  });
});

describe('isChapterFocused', () => {
  it('only counts marks from the same chapter', () => {
    const marks = [{ id: 'a', unitIndex: 2, quote: '真正穿旧衣服的人不讲究旧', note: NOTE, createdAt: 1 }];
    expect(isChapterFocused({ bookFocusMarks: marks }, 2)).toBe(true);
    expect(isChapterFocused({ bookFocusMarks: marks }, 3)).toBe(false);
    expect(isChapterFocused(undefined, 2)).toBe(false);
  });
});

describe('the prompt and the cap agree', () => {
  it('tells the model the same number of entries the parser accepts', () => {
    // 两边各写一个数，迟早会飘。飘了的表现是模型标满 6 条、解析只留 5 条，
    // 或者反过来标一堆被丢掉——都很难看出是哪里出的问题。
    expect(bookFocusSystemEn).toContain(`Zero to ${BOOK_FOCUS_MAX_PER_CHAPTER} entries`);
    expect(bookFocusSystemZh).toContain(`0 到 ${BOOK_FOCUS_MAX_PER_CHAPTER} 条`);
  });

  it('tells the model the shape the parser expects', () => {
    // 输出形状写错在这里看不出来：解析器会安静地返回空，等于这一章白读一次。
    expect(bookFocusSystemEn).toContain('"quote":"exact quote","note":"why it is worth stopping here"');
    expect(bookFocusSystemZh).toContain('"note":"为什么这一句值得停下来看"');
  });
});

describe('bookFocusMarks storage', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.nodes.add({ id: 'b1', type: 'book', x: 0, y: 0, content: 'x' });
  });

  it('stores marks with their notes on the book row, newest first', async () => {
    await appendBookFocusMarks('b1', 0, [{ quote: '真正穿旧衣服的人不讲究旧', note: NOTE }]);
    await appendBookFocusMarks('b1', 1, [{ quote: '第一段讲的是旧衣服', note: '另一条说明。' }]);
    const row = await db.nodes.get('b1');
    expect(row?.bookFocusMarks?.map((m) => m.unitIndex)).toEqual([1, 0]);
    // 说明得跟着一起存：只有引文的话，标出来就只是一块没来由的黄底。
    expect(row?.bookFocusMarks?.[1].note).toBe(NOTE);
  });

  it('removes only the named marks', async () => {
    await appendBookFocusMarks('b1', 0, [
      { quote: '真正穿旧衣服的人不讲究旧', note: NOTE },
      { quote: '第一段讲的是旧衣服', note: '另一条说明。' },
    ]);
    const row = await db.nodes.get('b1');
    const doomed = row?.bookFocusMarks?.at(-1)?.id ?? '';
    await removeBookFocusMarks('b1', [doomed]);
    const after = await db.nodes.get('b1');
    expect(after?.bookFocusMarks).toHaveLength(1);
    expect(after?.bookFocusMarks?.[0].quote).toBe('第一段讲的是旧衣服');
  });

  it('does nothing for a missing book or an empty batch', async () => {
    await expect(appendBookFocusMarks('nope', 0, [{ quote: 'x', note: NOTE }])).resolves.toEqual([]);
    await expect(appendBookFocusMarks('b1', 0, [])).resolves.toEqual([]);
    await expect(removeBookFocusMarks('nope', ['x'])).resolves.toBeUndefined();
  });
});

describe('splitStoredTranslation', () => {
  it('keeps dictionary senses together and splits a sentence translation from its note', () => {
    expect(splitStoredTranslation('n. 繁荣，隆隆声\nvi. 急速发展，发隆隆声')).toEqual({
      text: 'n. 繁荣，隆隆声\nvi. 急速发展，发隆隆声',
      note: '',
    });
    expect(
      splitStoredTranslation('全身心投入的画布\n\n取 all-in 的意思，不是逐字对应。'),
    ).toEqual({
      text: '全身心投入的画布',
      note: '取 all-in 的意思，不是逐字对应。',
    });
  });
});
