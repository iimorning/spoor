import type { AIConfig } from '../components/AISettingsModal';
import { callUniversalAI } from './ai';
import { parseLenientLlmJson } from '../utils/llmJson';
import { normalizeFocusMessage, pickFocusMarks } from '../utils/bookFocusMarks';
import { clampBookChatChapter } from '../utils/bookChatContext';
import { withBookModel } from '../utils/bookAiModel';

export type BookFocusPassResult = {
  /** 已经过唯一性校验、能回到正文里定位的（引文，说明）对。 */
  marks: Array<{ quote: string; note: string }>;
  /** 值得递一个话头时才有内容，否则空串——沉默是常态。 */
  message: string;
};

/**
 * 把模型回的那个信封拆成「标哪些」和「说不说」。
 *
 * 拆开是为了能脱离模型单独测：这里所有的"宁可不标"判据都在 `pickFocusQuotes`
 * 里，而那段是这套功能最容易悄悄退化的部分——模型某次换了引文风格，
 * 校验一旦放松，用户就会看到标在错误段落上的高亮。
 */
export function parseBookFocusPass(raw: unknown, chapterText: string): BookFocusPassResult {
  // `parseLenientLlmJson` 解析不了是抛异常而不是返回空。伴读是自动触发的，
  // 模型某次不按信封说话（比如先写一句"好的，我来读"）不该把这一趟炸掉——
  // 解析器的职责是把任何东西都变成一个可用的结果，这里最差也就是"什么都不标"。
  let parsed: unknown = null;
  try {
    parsed = parseLenientLlmJson(typeof raw === 'string' ? raw : '');
  } catch {
    return { marks: [], message: '' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { marks: [], message: '' };
  }
  const obj = parsed as Record<string, unknown>;
  const marks = pickFocusMarks(chapterText, obj.marks ?? obj.highlights ?? obj.passages);
  return { marks, message: normalizeFocusMessage(obj.message ?? obj.note ?? obj.remark) };
}

/**
 * 读一遍当前这一章，标出重点，必要时插一句嘴。
 *
 * 不传流式回调：这一趟的结果是结构化标记，要在正文里画出来、还要决定要不要
 * 往右栏插消息，没有"边写边看"的形态。真正会流式的是伴读对话（`useBookChat`）。
 */
export async function runBookFocusPass({
  config,
  bookTitle,
  unitLabel,
  chapterText,
  t,
  sessionId,
}: {
  config: AIConfig;
  bookTitle: string;
  unitLabel: string;
  chapterText: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
  sessionId?: string;
}): Promise<BookFocusPassResult> {
  const text = clampBookChatChapter(chapterText, '');
  if (!text) return { marks: [], message: '' };
  // 和伴读对话同一个模型：读书这一路换上一代 Flash，标出来的说明才像人话。
  const bookModel = withBookModel(config);
  // 把"我们以为发出去的"打出来：模型钉不住这种事，界面上和模型正常回答长得
  // 一模一样，只能靠日志分辨是钉丢了、还是模型那边真的回的 4.1。
  console.info('[Spoor] AI 伴读标注 · 请求', {
    provider: bookModel.config.provider,
    model: bookModel.config.model,
    lockModel: bookModel.lockModel,
  });
  const raw = await callUniversalAI({
    config: bookModel.config,
    lockModel: bookModel.lockModel,
    systemInstruction: t('ai.prompts.bookFocusSystem'),
    messages: [
      {
        role: 'user',
        content: t('ai.prompts.bookFocusUser', {
          title: bookTitle,
          chapter: unitLabel,
          chapterText: text,
        }),
      },
    ],
    // 标重点这件事没有发挥空间：同一段正文，标出两批不同的重点只会显得不认真。
    temperature: 0.3,
    topP: 0.9,
    sessionId,
  });
  // 校验用的是**整章**原文，不是发给模型的那段截断窗口：
  // 引文只要在整章里唯一就够定位，只在窗口里唯一反而会漏掉正文后半段重复的句子。
  const result = parseBookFocusPass(raw, chapterText);
  // 模型回了几条、留下了几条——这两数一比就知道是模型没给还是我们拒了。
  // 拒的那批没有任何去处，日志是唯一能看见它们的地方。
  let offered = 0;
  try {
    const parsed = parseLenientLlmJson(String(raw)) as { marks?: unknown } | null;
    offered = Array.isArray(parsed?.marks) ? parsed.marks.length : 0;
  } catch {
    offered = -1;
  }
  console.info(
    `[Spoor] AI 伴读标注 · 模型给了 ${offered} 条，通过校验 ${result.marks.length} 条`,
  );
  return result;
}