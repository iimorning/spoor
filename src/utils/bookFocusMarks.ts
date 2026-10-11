import { db, type BookFocusMark, type CanvasNode } from '../db';
import { compactTtsText } from './ttsFollowAlongDom';
import { hasSubstantiveText } from './substantive';

/** 一章最多标几处。标多了就成划线大赛，正文反而读不下去。 */
export const BOOK_FOCUS_MAX_PER_CHAPTER = 6;
/** 全书最多留多少处标记，超了丢最旧的。 */
export const BOOK_FOCUS_MARK_CAP = 80;
/** 太短的引文在正文里容易撞车（"是的""然后"），也标不出什么。 */
export const BOOK_FOCUS_MARK_MIN_CHARS = 10;
/** 太长的引文多半是模型把整章抄了回来。 */
export const BOOK_FOCUS_MARK_MAX_CHARS = 300;
/**
 * 说明短到这个程度就等于没写。
 *
 * 这条线是照着实际的失败定的：模型很容易把说明写成"这一段谈到了 X"这种复述，
 * 六个字就交差，而那正是标注变得毫无价值的原因。宁可整条丢掉。
 */
export const BOOK_FOCUS_NOTE_MIN_CHARS = 30;
export const BOOK_FOCUS_NOTE_MAX_CHARS = 260;
/** 主动消息的长度上限——是递一个话头，不是写读后感。 */
export const BOOK_FOCUS_MESSAGE_MAX_CHARS = 300;

export type FocusMarkDraft = { quote: string; note: string };

function newId(): string {
  return `bf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanText(raw: unknown, max: number): string {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/**
 * 从模型回的东西里，挑出真正能用的一对（引文，说明）。
 *
 * 引文那三条硬规矩是抄 `parsePublishArticleResponse` 里删除段的判据：
 *
 * 1. **必须在原文里唯一出现**。出现两次就不知道标哪一处，标错一处比不标更糟
 *    ——读者会以为那是作者特意强调的。
 * 2. **不得互相重叠**。两段叠在一起会渲染成一坨，也说明模型没想清楚该标哪段。
 * 3. **说明不能太短**。见 `BOOK_FOCUS_NOTE_MIN_CHARS`：复述正文不叫标注。
 *
 * 比对走「去掉空白」的形式，和 `findPassageRange` 在 DOM 上用的是同一套规范化，
 * 所以这里判得过、那边就一定找得回来。模型复述时顺手归一化的换行和缩进不算错。
 */
export function pickFocusMarks(source: string, raw: unknown): FocusMarkDraft[] {
  if (!Array.isArray(raw)) return [];
  const compactSource = compactTtsText(source);
  if (!compactSource) return [];
  const picked: Array<FocusMarkDraft & { from: number; to: number }> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { quote?: unknown; note?: unknown; text?: unknown; reason?: unknown };
    const note = cleanText(row.note ?? row.reason, BOOK_FOCUS_NOTE_MAX_CHARS);
    if (note.length < BOOK_FOCUS_NOTE_MIN_CHARS) continue;
    const quote = cleanText(row.quote ?? row.text, BOOK_FOCUS_MARK_MAX_CHARS);
    if (quote.length < BOOK_FOCUS_MARK_MIN_CHARS || quote.length > BOOK_FOCUS_MARK_MAX_CHARS) {
      continue;
    }
    const needle = compactTtsText(quote);
    if (needle.length < BOOK_FOCUS_MARK_MIN_CHARS) continue;
    const from = compactSource.indexOf(needle);
    // indexOf 命中后还要确认没有第二处：唯一性是这条路径的前提。
    if (from < 0 || compactSource.indexOf(needle, from + 1) >= 0) continue;
    if (picked.some((p) => from < p.to && p.from < from + needle.length)) continue;
    picked.push({ quote, note, from, to: from + needle.length });
    if (picked.length >= BOOK_FOCUS_MAX_PER_CHAPTER) break;
  }
  return picked.map(({ quote, note }) => ({ quote, note }));
}

/**
 * 模型没开口就不留话：空串、纯空白都当没说。
 *
 * 纯省略号（「…」「...」）也当没说。信封里 `message` 是必填的，模型又拿不准该写什么
 * 时会塞一个省略号——那比沉默更糟：右栏多一个什么都没有的气泡，用户还得琢磨
 * 刚才发生了什么。沉默本来就是这套功能最常见的正确答案。
 */
export function normalizeFocusMessage(raw: unknown): string {
  const text = cleanText(raw, BOOK_FOCUS_MESSAGE_MAX_CHARS + 1);
  if (!hasSubstantiveText(text)) return '';
  return text.length > BOOK_FOCUS_MESSAGE_MAX_CHARS
    ? `${text.slice(0, BOOK_FOCUS_MESSAGE_MAX_CHARS - 1).trim()}…`
    : text;
}

/**
 * 从书籍卡这一行上读出真正能用的标记。
 *
 * 有一类脏数据必须在这里挡掉：**早期版本存下的标记没有 `note`**（那时说明是
 * 右栏里一条全局消息）。它们标得出来、却挂不出任何说明——用户会看到一个点开
 * 是空的黄块，而且因为"这一章标过了"而永远不会重读。
 * 所以没有合格说明的一律当它不存在：这一章会被重新读一遍，拿到带说明的标记。
 */
export function readBookFocusMarks(node: Pick<CanvasNode, 'bookFocusMarks'> | null | undefined): BookFocusMark[] {
  if (!Array.isArray(node?.bookFocusMarks)) return [];
  return node.bookFocusMarks.filter((mark) => {
    if (!mark?.id) return false;
    if (typeof mark.quote !== 'string') return false;
    // 翻译高亮豁免长度门槛。BOOK_FOCUS_MARK_MIN_CHARS 是给 **AI 标注** 定的：
    // AI 会标出"是的""然后"这种太短、正文里又容易撞车的片段，所以要挡。
    // 但读者是自己拖选的——选哪一个 occurrence 他已经定过了，再拿这条去筛，
    // 结果就是 media、pondering 这种词一个都标不出来（实测 media 五字、
    // pondering 九字，都低于 10）。同一条豁免也适用于说明。
    if (mark.origin === 'translate') return true;
    if (mark.quote.trim().length < BOOK_FOCUS_MARK_MIN_CHARS) return false;
    return (
      typeof mark.note === 'string' && mark.note.trim().length >= BOOK_FOCUS_NOTE_MIN_CHARS
    );
  });
}

/**
 * 只留 AI 伴读自己标的那些。
 *
 * 伴读的清单、待读角标、以及"这章标过了就别再读"全都得走这里，而不是直接
 * 读全量：读者自己划词翻译留下的高亮不该进清单，也不该让伴读以为这章已经
 * 处理过而不再跑一遍。过滤只在这一处收口，新增调用点不容易漏。
 */
export function readAiFocusMarks(
  node: Pick<CanvasNode, 'bookFocusMarks'> | null | undefined,
): BookFocusMark[] {
  return readBookFocusMarks(node).filter((m) => m.origin !== 'translate');
}

/** 这一章标过了没有——标过就不再自动跑，翻回去不该再花一次钱。 */
export function isChapterFocused(
  node: Pick<CanvasNode, 'bookFocusMarks'> | null | undefined,
  unitIndex: number,
): boolean {
  return readAiFocusMarks(node).some((m) => m.unitIndex === unitIndex);
}

/**
 * 把这一批标记挂到书上。
 *
 * 读改写放在一个事务里，和 `bookExcerpts.ts` 同一套理由：一次伴读可能落在几章上，
 * 两次写不能互相覆盖。刚标的排最前，这样翻回来看时最新的在最上面。
 */
/**
 * 把存在 `note` 里的译文拆回「译文」和「为什么这么翻」。
 *
 * 划句时这两段用一个空行拼进去。单词查词的义项只用单个换行，这里不会把它们拆散。
 * 再点高亮时要按初次那张浮层来摆，所以得拆回两个字段，不能整段塞进一个脚注。
 */
export function splitStoredTranslation(stored: string): { text: string; note: string } {
  const sep = '\n\n';
  const at = stored.indexOf(sep);
  if (at < 0) return { text: stored, note: '' };
  return { text: stored.slice(0, at), note: stored.slice(at + sep.length) };
}

/**
 * 记下读者刚刚翻译过的那一段。
 *
 * 正文上和 AI 标注共用一层底色，所以划过的地方一眼能找回来。
 * 再点它时不走伴读脚注：那张脚注会把义项、译文和说明拍成一行。
 * 译文存在 `note` 里，点开时拆回初次那张浮层的排版。
 * 同一段重复翻译只留一条，省得翻几次就叠出好几层高亮。
 */
export async function appendBookTranslateHighlight(
  nodeId: string,
  unitIndex: number,
  draft: FocusMarkDraft,
  /** 译文。划句时是「译文 + 空行 + 说明」，查词时是按行分开的义项。 */
  existingNote = '',
): Promise<BookFocusMark[]> {
  return mutateBookFocusMarks(nodeId, (list) => {
    const needle = draft.quote.replace(/\s+/g, ' ').trim();
    const existing = list.findIndex(
      (m) =>
        m.origin === 'translate' &&
        m.unitIndex === unitIndex &&
        m.quote.replace(/\s+/g, ' ').trim() === needle,
    );
    if (existing >= 0) {
      const kept = [...list];
      kept.splice(existing, 1);
      return [
        ...kept,
        // 重新翻了一遍就换成新的译文，别留着旧的。
        { ...list[existing], note: existingNote || list[existing].note, createdAt: Date.now() },
      ];
    }
    return [
      ...list,
      {
        id: newId(),
        unitIndex,
        quote: draft.quote,
        // 译文存在这里。脚注这套机制（点开、复制、清除）本来就是为"一段话
        // 挂在句尾"设计的，译文正好是那一段话——所以它能原样复用。
        note: existingNote,
        createdAt: Date.now(),
        origin: 'translate',
      },
    ];
  });
}

export async function appendBookFocusMarks(
  nodeId: string,
  unitIndex: number,
  drafts: FocusMarkDraft[],
): Promise<BookFocusMark[]> {
  if (drafts.length === 0) return [];
  return mutateBookFocusMarks(nodeId, (list) => {
    const added = drafts.map((draft) => ({
      id: newId(),
      unitIndex,
      quote: draft.quote,
      note: draft.note,
      createdAt: Date.now(),
    }));
    return [...added.reverse(), ...list].slice(0, BOOK_FOCUS_MARK_CAP);
  });
}

/** 删掉用户手动去掉的标记——没标过的段不该由 AI 说了算，也得能自己清掉。 */
export async function removeBookFocusMarks(
  nodeId: string,
  ids: string[],
  dismissedUnitIndex?: number,
): Promise<void> {
  if (ids.length === 0) return;
  await db.transaction('rw', db.nodes, async () => {
    const node = await db.nodes.get(nodeId);
    if (!node) return;
    const list = Array.isArray(node.bookFocusMarks) ? node.bookFocusMarks : [];
    const dismissed = Array.isArray(node.bookFocusDismissedUnits)
      ? node.bookFocusDismissedUnits
      : [];
    await db.nodes.update(nodeId, {
      bookFocusMarks: list.filter((m) => !ids.includes(m.id)),
      // 用户动过这一章，就别再自动读它了。
      ...(dismissedUnitIndex !== undefined && !dismissed.includes(dismissedUnitIndex)
        ? { bookFocusDismissedUnits: [...dismissed, dismissedUnitIndex] }
        : {}),
    });
  });
}

/** 用户是不是已经明确不要这一章的标注了。 */
export function isBookFocusChapterDismissed(
  node: Pick<CanvasNode, 'bookFocusDismissedUnits'> | null | undefined,
  unitIndex: number,
): boolean {
  return (node?.bookFocusDismissedUnits ?? []).includes(unitIndex);
}

async function mutateBookFocusMarks(
  nodeId: string,
  mutate: (list: BookFocusMark[]) => BookFocusMark[],
): Promise<BookFocusMark[]> {
  return db.transaction('rw', db.nodes, async () => {
    const node = await db.nodes.get(nodeId);
    if (!node) return [];
    const next = mutate(Array.isArray(node.bookFocusMarks) ? node.bookFocusMarks : []);
    await db.nodes.update(nodeId, { bookFocusMarks: next });
    return next;
  });
}
