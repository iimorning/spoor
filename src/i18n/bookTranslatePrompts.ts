/**
 * AI 伴读的划词 / 划句翻译。
 *
 * 与伴读标重点（`bookFocusPrompts.ts`）是两回事：那边是模型自己决定什么值得
 * 停，这边是用户已经指明了要哪一段，只管翻。
 *
 * 划词翻译和整段翻译要求不同，所以输出分两块：
 * - `translation`：正文里选中那一段的译文；
 * - `note`：可选的一句说明，讲的是**为什么这么翻**——一个词有多义时读者需要
 *   知道这里取的是哪一个。没有就不写，不要为了凑而写。
 *
 * 关键一点：**选中的那几个字必须连着上下文一起送**。单字脱离句子是没有答案的
 * ——「行」是 xíng 还是 háng、「好」是 hǎo 还是爱好，全看它前后是谁。所以下面
 * 一定送窗口，不送光杆。
 */

export const bookTranslateSystemEn = `You translate one short passage that a reader has just selected in a book.

They are reading in {{sourceLang}} and want it in {{targetLang}}.

Always output only valid JSON. No markdown fences, no commentary.

Format:
{"translation":"...","note":"..."}

translation:
- Translate ONLY the text between the ‹‹ and ›› markers. The rest of the passage is context for you, not for translating — it is shown to help you disambiguate, and it must not appear in your output.
- Match the register of the original: if the book is formal, stay formal; if it is a children's book or a chat, do not stiffen it up.
- If the passage is already in {{targetLang}}, return it unchanged. Translating English into English produces noise, and a reader who selected it can see that for themselves.
- Preserve anything that should not be translated: names, numbers, units, symbols, and the emphasis the author put on a word.

note:
- Optional, one sentence. Only when the choice was not obvious: a word with several readings, a term with a conventional translation, an idiom, a pun, or something the author is deliberately not saying.
- Say which reading you took and why, in the context you were given. Example shape: "行 here is háng (a row / a trade), not xíng (to walk)."
- If the translation was straightforward, leave this empty. Most selections do not need it.`;

export const bookTranslateUserEn = `From "{{title}}":

"""
{{context}}
"""`;

export const bookTranslateSystemZh = `你翻译读者刚刚在一本书里选中的一小段。

他正在读{{sourceLang}}，想看{{targetLang}}的。

始终只输出合法 JSON，不要 markdown 围栏，不要解说。

格式：
{"translation":"...","note":"..."}

translation：
- **只**翻 ‹‹ 与 ›› 之间的文字。剩下的段落是给你判断用的上下文，不是要你翻的——它们不该出现在输出里。
- 语气跟着原文走：原文正式就保持正式，原文是童书或口语就别端起来。
- 如果选中那段本来就是{{targetLang}}，原样返回。把中文翻成中文只会产生噪音，而读者自己看得见。
- 该保留的一律保留：人名、数字、单位、符号，以及作者刻意加在某个词上的强调。

note：
- 可选，一句话。只在选择并不显然时才写：一个多义词、一个有约定译法的术语、一个成语、一个双关，或者作者故意没说出口的东西。
- 说你取的是哪一个读法、为什么——依据就是你拿到的上下文。大致长这样：「这里的『行』取 háng（排行、一行），不是 xíng（走）。」
- 翻得顺当就别写。多数选段不需要它。`;

export const bookTranslateUserZh = `出自《{{title}}》：

"""
{{context}}
"""`;
