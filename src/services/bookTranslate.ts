import type { AIConfig } from '../components/AISettingsModal';
import { callUniversalAI } from './ai';
import { parseLenientLlmJson } from '../utils/llmJson';
import { partialJsonStringField } from '../utils/partialJsonField';
import { withBookModel } from '../utils/bookAiModel';
import {
  bookTranslateSystemEn,
  bookTranslateSystemZh,
  bookTranslateUserEn,
  bookTranslateUserZh,
} from '../i18n/bookTranslatePrompts';

export type BookTranslateResult = {
  translation: string;
  /** 选段多义或术语有约定译法时的一句说明；不需要就是空串。 */
  note: string;
};

/** 标出"只翻这一段"的两端。用书里几乎不会出现的一对符号，模型不容易误读成引文。 */
const OPEN = '‹‹';
const CLOSE = '››';

/** 送进模型的上下文上限。划词要的是精准，不是全章——窗口越小越快、越便宜。 */
const CONTEXT_MAX_CHARS = 1600;
/** 单次最多标这么多字。超过这个长度的选段就只标开头一段——整段塞进去既贵又容易把模型带偏。 */
const MAX_MARKED_CHARS = 400;

/**
 * 把选中那段挖出来，连同它前后的文字包成一段带标记的上下文。
 *
 * 为什么不用 `clampBookChatChapter`：那个函数只管开窗，不告诉你选区在窗里的
 * 位置，模型于是分不清哪几个字才是要翻的。这里在切片时直接把标记插进去。
 *
 * 定位用「归一化后的前 80 字」去找，和 `clampBookChatChapter` 同一套办法——
 * 用户拖选出来的空白、换行和模型那边看到的未必一致，但字是那些字。找不到就
 * 退回「选段 + 前面一段」，宁可上下文差一点，也不能让模型去翻错东西。
 */
export function buildTranslateContext(
  body: string,
  selection: string,
  maxChars = CONTEXT_MAX_CHARS,
): { context: string; located: boolean } {
  const text = body.trim();
  const wanted = selection.replace(/\s+/g, ' ').trim();
  if (!text || !wanted) return { context: '', located: false };

  // 先用整段选中的归一化文本去找：划句常常比 80 字长，只拿前缀去定位的话，
  // 标记会落在选区中间，模型收到的"要翻的那段"就是残的。
  // 找不到（空白差异太大）才退到前缀——那种情况下标记的是选区开头的一段，
  // 好过什么都没标。
  const whole = wanted.slice(0, MAX_MARKED_CHARS);
  let at = text.indexOf(whole);
  let marked = whole;
  if (at < 0) {
    const head = wanted.slice(0, 80);
    at = head ? text.indexOf(head) : -1;
    marked = head;
  }
  if (at < 0) {
    // 仍然没能定位：把选段原样标出来送过去，只是没带上文。
    return { context: `${OPEN}${selection}${CLOSE}`, located: false };
  }

  // 窗口以选区为中心，前后各留一半。start 永远 ≤ at，所以它不可能切进选区里；
  // 而 end 必须够到选区末尾，否则右标记会落在选段中间。
  const half = Math.floor((maxChars - marked.length) / 2);
  const start = Math.max(0, at - Math.max(half, 0));
  const end = Math.min(text.length, at + marked.length + Math.max(half, 0));
  const context =
    `${start > 0 ? '…' : ''}` +
    text.slice(start, at) + OPEN + text.slice(at, at + marked.length) + CLOSE +
    text.slice(at + marked.length, end) +
    `${end < text.length ? '…' : ''}`;
  return { context, located: true };
}

/**
 * 把模型回的东西拆成「译文」和「为什么这么翻」。
 *
 * 拆开是为了能脱离模型单独测——这里所有的"宁可不写"判据都在下面，模型某次
 * 换了说法，校验放松了，用户就会看到一段空白的浮层。
 */
export function parseBookTranslate(raw: unknown): BookTranslateResult {
  let parsed: unknown = null;
  try {
    // 有些上游不认 enabled:false，照样先吐一段思考链。信封是 JSON，前面挂一段
    // <think>…</think> 会被当成"前置废话"勉强跳过，但思考里只要出现过 { }，
    // 抽取第一个平衡括号就可能抽到思考里的片段——解析器对文本里的括号没有戒心。
    parsed = parseLenientLlmJson(stripThink(typeof raw === 'string' ? raw : ''));
  } catch {
    // 划词翻译是用户点一下才跑的，模型不按信封说话不该炸掉整页——最差是
    // 浮层里一句"没翻出来"，而用户还能重新选一次。
    return { translation: '', note: '' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { translation: '', note: '' };
  }
  const obj = parsed as Record<string, unknown>;
  const pick = (v: unknown): string =>
    typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  const translation = pick(obj.translation ?? obj.text ?? obj.target);
  const note = pick(obj.note ?? obj.remark).slice(0, 300);
  // 没有译文就整条丢掉：浮层里显示一个孤零零的说明比什么都不显示更糟。
  if (!translation) return { translation: '', note: '' };
  return { translation, note };
}

/**
 * 剥掉开头的思考链。
 *
 * `llmReasoningStream` 会把 reasoning 和正文拼成 `<think>…</think>` + 内容。
 * 伴读对话要保留它（那是给人看的），但这里要的是一段 JSON——信封前面挂一段思考
 * 只是噪音，而思考里出现花括号就足以让"抽第一个平衡括号"抽错地方。
 */
function stripThink(text: string): string {
  const open = text.indexOf('<think>');
  if (open < 0) return text;
  const close = text.indexOf('</think>', open);
  if (close < 0) return text.slice(open + '<think>'.length);
  return text.slice(close + '</think>'.length);
}

export async function runBookTranslate({
  config,
  title,
  selection,
  body,
  targetLang,
  sourceLang,
  sessionId,
  onPartial,
}: {
  config: AIConfig;
  title: string;
  selection: string;
  /** 选区所在的那一章正文。 */
  body: string;
  targetLang: string;
  sourceLang: string;
  sessionId?: string;
  /**
   * 流式过程中的译文增量（**已剥掉 JSON 信封**，直接就是给读者看的那几个字）。
   * 不给这个回调就走非流式，行为和以前一样。
   *
   * 增量是"到目前为止收到的全部"，不是这一帧新添的那几个字——重试时要把上一趟
   * 留下的字清掉，所以调用方得能拿到空串，意思是"从头再来"，不是"这一帧没变"。
   */
  onPartial?: (translation: string) => void;
}): Promise<BookTranslateResult> {
  const picked = selection.replace(/\s+/g, ' ').trim();
  if (!picked) return { translation: '', note: '' };
  const { context } = buildTranslateContext(body, picked);
  if (!context) return { translation: '', note: '' };

  // 跟伴读对话、伴读标注同一条路：读书这一路钉住同一个模型，译文和批注才像
  // 一个人写的，跨段落也不会换个语气。
  const bookModel = withBookModel(config);
  const zh = targetLang.toLowerCase().startsWith('zh');
  // 语言名要写成模型读得懂的词，而且用**提示词自己的语言**写：让中文提示词里
  // 冒出 "Chinese" 会让模型把"翻成中文"这件事和"用中文回答"混在一起。
  const langName = (code: string, own: { zh: string; en: string }) =>
    code.toLowerCase().startsWith('zh')
      ? own.zh
      : code.toLowerCase().startsWith('en')
        ? own.en
        : code;
  const system = (zh ? bookTranslateSystemZh : bookTranslateSystemEn)
    .replace(/\{\{sourceLang\}\}/g, langName(sourceLang, { zh: '中文', en: 'English' }))
    .replace(/\{\{targetLang\}\}/g, langName(targetLang, { zh: '中文', en: 'Chinese' }));
  // 计时：划词是读者盯着屏幕等的那一下，只说"慢"没法定位。分段报出来才知道
  // 慢在词表命中、提示长度、还是网络往返——这三个的量级差得很远。
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  // 记录每一次重试。28 秒这种事光看总耗时分不出是"一次往返"还是"三次重试在救场"，
  // 而这两种的修法完全相反：前者该想流式，后者该查上游为什么不稳。
  const retries: Array<{ 第几次: number; 原因: string; 退避毫秒: number }> = [];
  // 首字节：从点下去到浮层上冒出第一个字。这才是读者真正在等的那一下——
  // 总耗时里还混着网关冷启动和上游排队，分开报才知道慢在哪。
  let firstTokenAt: number | null = null;
  let lastPartial = '';
  const elapsed = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const raw = await callUniversalAI({
    onRetry: (attempt, error, delayMs) => {
      retries.push({
        第几次: attempt + 1,
        原因: error instanceof Error ? error.message.slice(0, 120) : String(error).slice(0, 120),
        退避毫秒: delayMs,
      });
      // 上一趟已经吐出来的字要清掉。重试是**从头**再问一遍，不接着上一趟往下写——
      // 两趟的译文拼在一起，浮层上就是一句前后不搭的话。
      if (onPartial && lastPartial) {
        lastPartial = '';
        onPartial('');
      }
    },
    onStreamChunk: onPartial
      ? (accumulated) => {
          if (firstTokenAt === null) firstTokenAt = elapsed();
          // 累加文本是模型原样吐的东西：可能挂着 <think>，也可能连引号都还没到。
          // 剥掉思考、抽掉信封，剩下才是能给人看的字。
          const partial = partialJsonStringField(stripThink(accumulated), 'translation');
          if (partial === lastPartial) return;
          lastPartial = partial;
          onPartial(partial);
        }
      : undefined,
    // 翻译要的是一段 JSON，深思对它只有坏处：多花 token、多花时间，而思考里冒出
    // 花括号还会干扰信封抽取。用户在设置里为伴读开的深度思考，不该由翻译这一环
    // 替他付账。模型由 withBookModel 定，思考由这里定——两件事分开管。
    config: { ...bookModel.config, reasoningMode: 'off' },
    lockModel: bookModel.lockModel,
    systemInstruction: system,
    messages: [
      {
        role: 'user',
        content: (zh ? bookTranslateUserZh : bookTranslateUserEn)
          .replace('{{title}}', title)
          .replace('{{context}}', context),
      },
    ],
    // 翻译没有发挥空间：同一段原文翻两次不一样，用户只会以为出了 bug。
    temperature: 0.2,
    topP: 0.9,
    sessionId,
  });
  const parsed = parseBookTranslate(raw);
  // 首字节时间单独一栏。改成流式之后，"总耗时"已经不再是读者在等的那件事了——
  // 总耗时只影响高亮的落库时机，而读者盯着的是"多久开始出字"。两个都要报。
  const firstTokenMs = firstTokenAt === null ? null : Math.round(firstTokenAt - startedAt);
  // 空译文也是"慢"的一种：用户等了半天什么都没等到。单独报，别让它混进正常那次。
  if (!parsed.translation) {
    console.warn('[Spoor] 划词翻译空结果', {
      ms: Math.round(elapsed() - startedAt),
      首字毫秒: firstTokenMs ?? '未收到',
      上下文字符: context.length,
      重试: retries.length ? retries : '无',
    });
  }
  const result = parsed;
  console.info('[Spoor] 划词翻译用时', {
    ms: Math.round(elapsed() - startedAt),
    首字毫秒: firstTokenMs ?? '未收到',
    流式: onPartial ? '开' : '关',
    上下文字符: context.length,
    提示字符: system.length,
    模型: bookModel.config.model,
    重试: retries.length ? retries : '无',
  });
  return result;
}
