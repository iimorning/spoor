import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../../src/db';
import { countEssayChars } from '../../src/utils/essayWordCount';
import { setAutoAnnotationEnabled } from '../../src/utils/autoAnnotation';
import {
  appendEssayFocusMarks,
  clearEssayFocusMarks,
  ESSAY_FOCUS_GAIN_CHARS,
  ESSAY_FOCUS_MARK_MAX_CHARS,
  ESSAY_FOCUS_MARK_MIN_CHARS,
  ESSAY_FOCUS_MAX_PER_PASS,
  ESSAY_FOCUS_MIN_CHARS,
  ESSAY_FOCUS_NOTE_MIN_CHARS,
  normalizeEssayFocusMessage,
  pickEssayFocusMarks,
  readEssayFocusMarks,
  removeEssayFocusMarks,
  shouldRunEssayFocusPass,
  splitNewTextForScan,
} from '../../src/utils/essayFocusMarks';
import { parseEssayFocusPass } from '../../src/services/essayFocusPass';
import {
  essayFocusSystemEn,
  essayFocusSystemZh,
} from '../../src/i18n/essayFocusPrompts';

const SOURCE = [
  '接你写的东西，不是接模型。像OpenRouter聚合了',
  '几十家端点，比自己配省事，但陷阱得知道。',
  '比如deepseek官方端点没有报价。',
].join('\n');

const NOTE = '这句话把"接模型"和"接你写的东西"并排放，却没说清后者才是重点，读到这里的人多半会滑过去。';

describe('pickEssayFocusMarks', () => {
  it('留下引文唯一、说明够长的那一对', () => {
    const picked = pickEssayFocusMarks(SOURCE, [
      { quote: '几十家端点，比自己配省事', note: NOTE },
    ]);
    expect(picked).toEqual([{ quote: '几十家端点，比自己配省事', note: NOTE }]);
  });

  it('说明太短就丢掉——复述正文不叫标注', () => {
    expect(pickEssayFocusMarks(SOURCE, [{ quote: '几十家端点，比自己配省事', note: '讲陷阱' }])).toEqual([]);
  });

  it('说明恰好卡在下限上才留', () => {
    const edge = 'x'.repeat(ESSAY_FOCUS_NOTE_MIN_CHARS);
    expect(pickEssayFocusMarks(SOURCE, [{ quote: '几十家端点，比自己配省事', note: edge }])).toHaveLength(1);
  });

  it('引文必须逐字出现在正文里，转述的一律不要', () => {
    expect(
      pickEssayFocusMarks(SOURCE, [{ quote: '但有个陷阱得知道才是', note: NOTE }]),
    ).toEqual([]);
  });

  it('引文在正文里出现两次就丢掉，不猜是哪一处', () => {
    const twice = '这句话他说了两遍。这句话他说了两遍。';
    expect(pickEssayFocusMarks(twice, [{ quote: '这句话他说了两遍', note: NOTE }])).toEqual([]);
  });

  it('太短的引文不要，它在正文里必然撞车', () => {
    expect(pickEssayFocusMarks(SOURCE, [{ quote: '知道', note: NOTE }])).toEqual([]);
  });

  it('太长的引文多半是模型把整段抄了回来', () => {
    const huge = '啊'.repeat(ESSAY_FOCUS_MARK_MAX_CHARS + 1);
    expect(pickEssayFocusMarks(SOURCE, [{ quote: huge, note: NOTE }])).toEqual([]);
  });

  it('长度下界照收', () => {
    const short = '一'.repeat(ESSAY_FOCUS_MARK_MIN_CHARS);
    const body = `前面一段。${short}后面一段。`;
    expect(pickEssayFocusMarks(body, [{ quote: short, note: NOTE }])).toHaveLength(1);
  });

  it('两条重叠只留第一条', () => {
    const picked = pickEssayFocusMarks(SOURCE, [
      { quote: '接你写的东西，不是接模型。像OpenRouter', note: NOTE },
      { quote: '不是接模型。像OpenRouter聚合了几十家端点', note: NOTE },
    ]);
    expect(picked).toHaveLength(1);
  });

  it('每轮封顶', () => {
    const many = Array.from({ length: ESSAY_FOCUS_MAX_PER_PASS + 4 }, (_, i) => ({
      quote: `第${i}个不同的句子在这里出现过一次`,
      note: NOTE,
    }));
    const body = many.map((m) => m.quote).join('\n');
    expect(pickEssayFocusMarks(body, many)).toHaveLength(ESSAY_FOCUS_MAX_PER_PASS);
  });

  it('别名照收：highlights/text/reason/remark', () => {
    expect(
      pickEssayFocusMarks(SOURCE, [{ text: '几十家端点，比自己配省事', reason: NOTE }]),
    ).toHaveLength(1);
  });

  it('不是数组就当它什么都没说', () => {
    expect(pickEssayFocusMarks(SOURCE, null)).toEqual([]);
    expect(pickEssayFocusMarks(SOURCE, 'nope')).toEqual([]);
    expect(pickEssayFocusMarks(SOURCE, 42)).toEqual([]);
  });

  it('正文是空的就别标', () => {
    expect(pickEssayFocusMarks('', [{ quote: '几十家端点，比自己配省事', note: NOTE }])).toEqual([]);
  });
});

describe('normalizeEssayFocusMessage', () => {
  it('省略号一家当没说', () => {
    expect(normalizeEssayFocusMessage('…')).toBe('');
    expect(normalizeEssayFocusMessage('...')).toBe('');
    expect(normalizeEssayFocusMessage('———')).toBe('');
  });

  it('空串、空白、非字符串都是没说', () => {
    expect(normalizeEssayFocusMessage('')).toBe('');
    expect(normalizeEssayFocusMessage('   ')).toBe('');
    expect(normalizeEssayFocusMessage(undefined)).toBe('');
    expect(normalizeEssayFocusMessage(42)).toBe('');
  });

  it('真话留着，并压到上限', () => {
    const long = '问'.repeat(400);
    expect(normalizeEssayFocusMessage(long).endsWith('…')).toBe(true);
    expect(normalizeEssayFocusMessage(long).length).toBeLessThanOrEqual(300);
  });
});

describe('parseEssayFocusPass', () => {
  it('拿到引文、说明和一句插话', () => {
    const raw = JSON.stringify({
      marks: [{ quote: '几十家端点，比自己配省事', note: NOTE }],
      message: '你现在在搭中转站，还是在评估要不要用？',
    });
    const result = parseEssayFocusPass(SOURCE, raw);
    expect(result.marks).toHaveLength(1);
    expect(result.message).toContain('中转站');
  });

  it.each([
    ['', '空响应'],
    ['   ', '纯空白'],
    ['sure! here you go', '模型加了别的话'],
    ['[]', '空数组'],
    ['{"marks":"nope"}', 'marks 不是数组'],
    ['null', 'null'],
    ['42', '数字'],
  ])('%s（%s）变成"没有标注"，不抛错', (raw) => {
    expect(() => parseEssayFocusPass(SOURCE, raw)).not.toThrow();
    expect(parseEssayFocusPass(SOURCE, raw).marks).toEqual([]);
  });

  it('坏输出也不会让插话冒出来', () => {
    expect(parseEssayFocusPass(SOURCE, 'nope').message).toBe('');
  });
});

describe('提示词和上限对得上', () => {
  // 提示词里写死了一个数字，解析器里也有一个。两者对不上时模型会被要求交 8 条、
  // 而我们只留 6 条，多出来的两条静默消失——没有任何地方会报错。所以在这里钉住。
  it.each([
    ['en', essayFocusSystemEn],
    ['zh', essayFocusSystemZh],
  ])('%s 提示词里写明了每轮上限和信封字段名', (_lang, system) => {
    expect(system).toContain(String(ESSAY_FOCUS_MAX_PER_PASS));
    expect(system).toContain('"quote"');
    expect(system).toContain('"note"');
    expect(system).toContain('"message"');
  });
});

describe('shouldRunEssayFocusPass', () => {
  it('没到首次阈值不去', () => {
    expect(shouldRunEssayFocusPass(ESSAY_FOCUS_MIN_CHARS - 1, 0)).toBe(false);
  });

  it('首次达标去一趟', () => {
    expect(shouldRunEssayFocusPass(ESSAY_FOCUS_MIN_CHARS, 0)).toBe(true);
  });

  it('之后每多写够一整段才去', () => {
    const scanned = 2000;
    expect(shouldRunEssayFocusPass(scanned + ESSAY_FOCUS_GAIN_CHARS - 1, scanned)).toBe(false);
    expect(shouldRunEssayFocusPass(scanned + ESSAY_FOCUS_GAIN_CHARS, scanned)).toBe(true);
  });

  it('没记过扫到哪就当第一次', () => {
    expect(shouldRunEssayFocusPass(1000, undefined)).toBe(true);
  });
});

describe('splitNewTextForScan', () => {
  const body = ['第一段落有十个字左右。', '第二段落也有十个字左右。', '第三段落继续写。'].join(
    '\n\n',
  );

  it('没扫过时整篇都是新的', () => {
    const { contextBefore, newText } = splitNewTextForScan(body, 0);
    expect(newText).toBe(body);
    expect(contextBefore).toBe('');
  });

  it('按段落切，不在半个句子里下刀', () => {
    // 切点从 countEssayChars 自己算，别在手写一个字数——标点算不算、markdown 剥不剥，
    // 口径一变那个数就悄悄对不上了。
    const firstPara = '第一段落有十个字左右。';
    const { newText } = splitNewTextForScan(body, countEssayChars(firstPara));
    expect(newText).toBe('第二段落也有十个字左右。\n\n第三段落继续写。');
  });

  it('切点落在段落中间时，那一整段算新的', () => {
    // 只扫到第一段落中间：宁可多读一段（可能重标），也不漏掉用户新写的那两三个字。
    // 漏掉的代价是"这一段永远不会被标注"，多读的代价只是多花一次模型调用。
    const { newText } = splitNewTextForScan(body, 1);
    expect(newText.startsWith('第一段落')).toBe(true);
  });

  it('前文只带一小截做连贯性', () => {
    // 首次没有前文。
    expect(splitNewTextForScan(body, 0).contextBefore).toBe('');
    // 扫过一次之后才有。
    const firstPara = '第一段落有十个字左右。';
    expect(splitNewTextForScan(body, countEssayChars(firstPara)).contextBefore).toContain(
      '第一段落',
    );
  });

  it('已经扫到头了就没有新的可读，返回空', () => {
    const { newText } = splitNewTextForScan(body, 10_000);
    expect(newText).toBe('');
  });
});

describe('存储', () => {
  beforeEach(async () => {
    await db.articles.clear();
    await db.articles.add({
      id: 'a1',
      title: '一篇',
      content: '正文',
      date: '2026',
      type: 'GEN',
      tags: [],
    });
  });

  it('新标注排在最前面', async () => {
    await appendEssayFocusMarks('a1', [{ quote: '几十家端点，比自己配省事', note: NOTE }]);
    await appendEssayFocusMarks('a1', [{ quote: 'deepseek官方端点', note: NOTE }]);
    const row = await db.articles.get('a1');
    expect(row?.essayFocusMarks?.[0]?.quote).toBe('deepseek官方端点');
  });

  it('没有草稿就什么都不写', async () => {
    const { added } = await appendEssayFocusMarks('a1', []);
    expect(added).toBe(0);
    const row = await db.articles.get('a1');
    expect(row?.essayFocusMarks).toBeUndefined();
  });

  it('文章不在就不写', async () => {
    const { added } = await appendEssayFocusMarks('ghost', [
      { quote: '几十家端点，比自己配省事', note: NOTE },
    ]);
    expect(added).toBe(0);
  });

  it('只删点名的那些', async () => {
    await appendEssayFocusMarks('a1', [
      { quote: '几十家端点，比自己配省事', note: NOTE },
      { quote: 'deepseek官方端点', note: NOTE },
    ]);
    const row = await db.articles.get('a1');
    const victim = row!.essayFocusMarks![0]!.id;
    await removeEssayFocusMarks('a1', [victim]);
    const after = await db.articles.get('a1');
    expect(after?.essayFocusMarks).toHaveLength(1);
  });

  it('关掉就一条都不给读', async () => {
    await appendEssayFocusMarks('a1', [{ quote: '几十家端点，比自己配省事', note: NOTE }]);
    expect(readEssayFocusMarks(await db.articles.get('a1'))).toHaveLength(1);
    await clearEssayFocusMarks('a1');
    const row = await db.articles.get('a1');
    expect(row?.essayFocusMarks).toEqual([]);
    expect(readEssayFocusMarks(row)).toEqual([]);
  });
});

describe('readEssayFocusMarks', () => {
  // 这个 describe 里的其他用例都假设"全局开着"，测完得把开关还回去。
  afterEach(() => {
    localStorage.clear();
  });

  it('丢掉脏数据：没有说明的行会渲染成一块没内容的黄底', () => {
    const dirty = {
      id: 'a1',
      title: 't',
      content: 'c',
      date: '2026',
      type: 'GEN',
      tags: [],
      essayFocusMarks: [{ id: 'm1', quote: '这是一段足够长的引文', note: '', createdAt: 1 }],
    };
    expect(readEssayFocusMarks(dirty)).toEqual([]);
  });

  it('丢掉太短的引文', () => {
    const dirty = {
      id: 'a1',
      title: 't',
      content: 'c',
      date: '2026',
      type: 'GEN',
      tags: [],
      essayFocusMarks: [{ id: 'm1', quote: '短', note: NOTE, createdAt: 1 }],
    };
    expect(readEssayFocusMarks(dirty)).toEqual([]);
  });

  it('全局关掉就一条都不给', () => {
    setAutoAnnotationEnabled('essay', false);
    const row = {
      id: 'a1',
      title: 't',
      content: 'c',
      date: '2026',
      type: 'GEN',
      tags: [],
      essayFocusMarks: [{ id: 'm1', quote: '这是一段足够长的引文', note: NOTE, createdAt: 1 }],
    };
    expect(readEssayFocusMarks(row)).toEqual([]);
    // 标注本身没被删——只是不往外端。
    expect(row.essayFocusMarks).toHaveLength(1);
  });

  it('没有文章时是空的', () => {
    expect(readEssayFocusMarks(null)).toEqual([]);
    expect(readEssayFocusMarks(undefined)).toEqual([]);
  });
});
