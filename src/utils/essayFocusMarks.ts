import { db, type Article, type EssayFocusMark } from '../db';
import { compactTtsText } from './ttsFollowAlongDom';
import { hasSubstantiveText } from './substantive';
import { countEssayChars } from './essayWordCount';
import { isAutoAnnotationEnabled } from './autoAnnotation';

/**
 * 长文标注的校验与存储。
 *
 * 五条硬规矩和书籍那边的 `pickFocusMarks` 完全一致（唯一、够长、不重叠、说明不能是
 * 复述、每轮封顶），比对也用同一个 `compactTtsText`。这不是巧合：`findQuoteRange`
 * 在 ProseMirror 文档里定位时用的是同一套规范化，两边必须一致，否则会出现
 * "校验说它唯一存在、渲染却找不到位置"。
 *
 * 与书籍那边的差别只有一处：这里没有"章节"这个单位，所以"每章上限"变成"每轮上限"，
 * "清掉某一章"变成整篇开关。
 */

/** 一轮最多标几行。标多了就成划线大赛，正文反而读不下去。 */
export const ESSAY_FOCUS_MAX_PER_PASS = 6;
/** 全文最多留多少处，超了丢最旧的。 */
export const ESSAY_FOCUS_MARK_CAP = 60;
/** 太短的引文在正文里容易撞车（"是的""然后"），也标不出什么。 */
export const ESSAY_FOCUS_MARK_MIN_CHARS = 10;
/** 太长的引文多半是模型把整段抄了回来。 */
export const ESSAY_FOCUS_MARK_MAX_CHARS = 300;
/**
 * 说明短到这个程度就等于没写。
 *
 * 这条线是照着实际的失败定的：模型很容易把说明写成"这一段谈到了 X"这种复述，
 * 六个字就交差，而那正是标注变得毫无价值的原因。宁可整条丢掉。
 */
export const ESSAY_FOCUS_NOTE_MIN_CHARS = 30;
export const ESSAY_FOCUS_NOTE_MAX_CHARS = 260;
/** 主动消息的长度上限——是递一个话头，不是写读后感。 */
export const ESSAY_FOCUS_MESSAGE_MAX_CHARS = 300;

/** 首次触发要写到这么多字。 */
export const ESSAY_FOCUS_MIN_CHARS = 800;
/** 之后每多写这么多字再跑一趟。 */
export const ESSAY_FOCUS_GAIN_CHARS = 800;
/** 送去给模型时，新段落之外还带多少字的前文做连贯性。 */
export const ESSAY_FOCUS_CONTEXT_CHARS = 400;

export type EssayFocusMarkDraft = { quote: string; note: string };

function newId(): string {
  return `ef-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanText(raw: unknown, max: number): string {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/**
 * 从模型回的东西里，挑出真正能用的一对（引文，说明）。
 *
 * `source` 传的是**整篇正文**，不是送去读的那一段新正文。这是为了和 `findQuoteRange`
 * 站在同一条口径上：那边是在整篇文档里搜引文的，校验若只在新段里判"唯一"，就会放行
 * 一条"在新段里唯一、但整篇里出现两次"的标注——它存得进去，却永远渲染不出来，
 * 变成一条看不见的死数据。
 */
export function pickEssayFocusMarks(source: string, raw: unknown): EssayFocusMarkDraft[] {
  if (!Array.isArray(raw)) return [];
  const compactSource = compactTtsText(source);
  if (!compactSource) return [];
  const picked: Array<EssayFocusMarkDraft & { from: number; to: number }> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { quote?: unknown; note?: unknown; text?: unknown; reason?: unknown };
    const note = cleanText(row.note ?? row.reason, ESSAY_FOCUS_NOTE_MAX_CHARS);
    if (note.length < ESSAY_FOCUS_NOTE_MIN_CHARS) continue;
    const quote = cleanText(row.quote ?? row.text, ESSAY_FOCUS_MARK_MAX_CHARS);
    if (quote.length < ESSAY_FOCUS_MARK_MIN_CHARS || quote.length > ESSAY_FOCUS_MARK_MAX_CHARS) {
      continue;
    }
    const needle = compactTtsText(quote);
    if (needle.length < ESSAY_FOCUS_MARK_MIN_CHARS) continue;
    const from = compactSource.indexOf(needle);
    // indexOf 命中后还要确认没有第二处：唯一性是这条路径的前提。
    if (from < 0 || compactSource.indexOf(needle, from + 1) >= 0) continue;
    if (picked.some((p) => from < p.to && p.from < from + needle.length)) continue;
    picked.push({ quote, note, from, to: from + needle.length });
    if (picked.length >= ESSAY_FOCUS_MAX_PER_PASS) break;
  }
  return picked.map(({ quote, note }) => ({ quote, note }));
}

/**
 * 模型没开口就不留话：空串、纯空白都当没说。
 *
 * 纯省略号也当没说——信封里 `message` 是必填的，模型拿不准时会塞一个省略号，
 * 那比沉默更糟：对话栏多一个什么都没有的气泡。
 */
export function normalizeEssayFocusMessage(raw: unknown): string {
  const text = cleanText(raw, ESSAY_FOCUS_MESSAGE_MAX_CHARS + 1);
  if (!hasSubstantiveText(text)) return '';
  return text.length > ESSAY_FOCUS_MESSAGE_MAX_CHARS
    ? `${text.slice(0, ESSAY_FOCUS_MESSAGE_MAX_CHARS - 1).trim()}…`
    : text;
}

/**
 * 从文章这一行上读出真正能用的标注。
 *
 * 全局关掉时这里是唯一的一道闸：标注本身还躺在库里（用户随时开回来），但不往外端。
 * 谁想显示这些黄底，谁就得先过这一关——漏一处就等于开关名存实亡。
 */
export function readEssayFocusMarks(article: Article | null | undefined): EssayFocusMark[] {
  if (!article || !isAutoAnnotationEnabled('essay')) return [];
  const out: EssayFocusMark[] = [];
  for (const mark of article.essayFocusMarks ?? []) {
    if (!mark || typeof mark !== 'object') continue;
    if (typeof mark.id !== 'string' || !mark.id) continue;
    if (typeof mark.quote !== 'string') continue;
    // 短引文和没有说明的行都是历史脏数据：短引文在正文里必然撞车，没有说明的
    // 标在正文上只是一块没内容的黄底，留着只会让人以为坏了。
    if (mark.quote.trim().length < ESSAY_FOCUS_MARK_MIN_CHARS) continue;
    if (typeof mark.note !== 'string' || mark.note.trim().length < ESSAY_FOCUS_NOTE_MIN_CHARS) continue;
    out.push(mark);
  }
  return out;
}

/** 新的在前，整篇封顶，超了丢最旧的。 */
export async function appendEssayFocusMarks(
  articleId: string,
  drafts: EssayFocusMarkDraft[],
): Promise<{ added: number }> {
  if (drafts.length === 0) return { added: 0 };
  const row = await db.articles.get(articleId);
  if (!row) return { added: 0 };
  const added = drafts.map((draft) => ({
    id: newId(),
    quote: draft.quote,
    note: draft.note,
    createdAt: Date.now(),
  }));
  const next = [...added, ...(row.essayFocusMarks ?? [])].slice(0, ESSAY_FOCUS_MARK_CAP);
  await db.articles.update(articleId, { essayFocusMarks: next });
  return { added: added.length };
}

export async function removeEssayFocusMarks(
  articleId: string,
  ids: string[],
): Promise<{ removed: number }> {
  if (ids.length === 0) return { removed: 0 };
  const row = await db.articles.get(articleId);
  if (!row) return { removed: 0 };
  const drop = new Set(ids);
  const next = (row.essayFocusMarks ?? []).filter((m) => !drop.has(m.id));
  if (next.length === (row.essayFocusMarks ?? []).length) return { removed: 0 };
  await db.articles.update(articleId, { essayFocusMarks: next });
  return { removed: ids.length };
}

/**
 * 清掉这一篇已经标上的东西。注意它**不动全局开关**——关开关和删标注是两件事，
 * 别的地方把开关拨回来时，这些标的不该凭空回来，所以这里是真的删。
 */
export async function clearEssayFocusMarks(articleId: string): Promise<void> {
  await db.articles.update(articleId, { essayFocusMarks: [] });
}

/**
 * 该不该再跑一趟：没到首次阈值不去；到了之后，每多写够一整段才去。
 *
 * 差值而不是绝对值：用户回头改前面的段落不会让字数倒退到"该重跑了"，
 * 只有真的又写进去一截才继续。
 */
export function shouldRunEssayFocusPass(
  totalChars: number,
  lastScanChars: number | undefined,
): boolean {
  const scanned = lastScanChars ?? 0;
  if (totalChars < ESSAY_FOCUS_MIN_CHARS) return false;
  if (scanned === 0) return true;
  return totalChars - scanned >= ESSAY_FOCUS_GAIN_CHARS;
}

/**
 * 把正文切成"已扫过的部分"和"新写的部分"。
 *
 * 按**段落**切，不按字数切。字数是"去掉空白后的字符数"，拿它去换 markdown 里的
 * 字符下标要另写一套映射，而那个映射一旦和 `countEssayChars` 的口径错开一位，
 * 切出来的边界就会落在半个词中间，模型从半个句子里复制引文，那条标注永远定位不上。
 * 按段落切没有这个风险，而且引文本来也是句级的。
 */
export function splitNewTextForScan(
  body: string,
  lastScanChars: number | undefined,
): { contextBefore: string; newText: string } {
  const scanned = lastScanChars ?? 0;
  if (scanned <= 0) return { contextBefore: '', newText: body };
  const paragraphs = body.split(/\n{2,}/);
  let seen = 0;
  let cut = paragraphs.length;
  for (let i = 0; i < paragraphs.length; i += 1) {
    const next = seen + countEssayChars(paragraphs[i]!);
    if (next > scanned) {
      cut = i;
      break;
    }
    seen = next;
  }
  if (cut >= paragraphs.length) return { contextBefore: '', newText: '' };
  const before = paragraphs.slice(0, cut).join('\n\n');
  return {
    contextBefore: tailChars(before, ESSAY_FOCUS_CONTEXT_CHARS),
    newText: paragraphs.slice(cut).join('\n\n'),
  };
}

function tailChars(text: string, max: number): string {
  if (text.length <= max) return text;
  return `…${text.slice(text.length - max)}`;
}
