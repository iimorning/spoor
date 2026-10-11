/**
 * 从**没收完的** JSON 文本里，取某个字符串字段当前已经到达的值。
 *
 * 划词翻译改流式之后，浮层要在模型还在写的时候就显示译文。模型吐的是
 * `{"translation":"...","note":"..."}`，直接拿累加文本去显示，读者看到的前几秒
 * 是 `{"trans` —— 信封的皮被翻给用户看了。这一层负责把信封剥掉，只还译文。
 *
 * 三个坑：
 * 1. 累加文本随时可能停在半个转义上（末尾一个孤零零的 `\`、或者 `\u4`），
 *    那半个必须先扣掉再显示，否则浮层上会闪出一个反斜杠，下一帧又没了。
 * 2. 键名可能出现在别的值里面（译文里正好提到 "note"）。所以不能只搜
 *    `"translation"`，要找**后面跟着冒号**的那一处——值里的引号后面不会是冒号。
 * 3. 只认第一个符合的键。翻译的格式约定了 translation 在前，够了；真要改
 *    提示词约定顺序，这里得跟着改。
 */

const SIMPLE_ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

/** 位置 i 之后跳过 JSON 里的空白。 */
function skipWhitespace(text: string, from: number): number {
  let i = from;
  while (i < text.length && (text[i] === ' ' || text[i] === '\n' || text[i] === '\t' || text[i] === '\r')) {
    i += 1;
  }
  return i;
}

/** 找到 `"key"` 后面就是冒号的那一处，返回冒号之后的位置；找不到返回 -1。 */
function findKeyColon(text: string, key: string): number {
  const needle = `"${key}"`;
  let at = text.indexOf(needle);
  while (at >= 0) {
    const afterColon = skipWhitespace(text, at + needle.length);
    if (text[afterColon] === ':') return skipWhitespace(text, afterColon + 1);
    at = text.indexOf(needle, at + 1);
  }
  return -1;
}

/** 解码到第一个未转义的右引号为止；文本没收完就停在它最后能解的地方。 */
function decodeUntilClosingQuote(text: string, from: number): string {
  let out = '';
  let i = from;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') return out;
    if (ch !== '\\') {
      out += ch;
      i += 1;
      continue;
    }
    const next = text[i + 1];
    if (next === undefined) return out; // 末尾一个光秃秃的反斜杠，还没到
    if (next === 'u') {
      const hex = text.slice(i + 2, i + 6);
      if (hex.length < 4) return out; // \u 只到了一半
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
        out += next; // 不是合法转义，原样放行，别把后面的字吞掉
        i += 2;
        continue;
      }
      out += String.fromCharCode(parseInt(hex, 16));
      i += 6;
      continue;
    }
    // 模型偶尔吐 JSON 不允许的转义（\ 后面跟个字母）。JSON.parse 到这里已经
    // 崩了，但流式显示不该跟着崩：把这个字符当普通字符放行。
    out += SIMPLE_ESCAPES[next] ?? next;
    i += 2;
  }
  return out;
}

export function partialJsonStringField(raw: string, key: string): string {
  if (!raw || !key) return '';
  const quoteAt = findKeyColon(raw, key);
  if (quoteAt < 0) return '';
  if (raw[quoteAt] !== '"') return ''; // 值还没吐出来（或者模型没给字符串）
  return decodeUntilClosingQuote(raw, quoteAt + 1);
}