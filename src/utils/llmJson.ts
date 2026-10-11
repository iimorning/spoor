/**
 * Best-effort parsing for JSON emitted by LLMs (markdown fences, preamble,
 * trailing commas, extra prose around a single object/array).
 */

function extractBalanced(s: string, startIdx: number, open: '{' | '['): string | null {
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIdx; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (c === '\\') {
        escape = true;
        continue;
      }
      if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return s.slice(startIdx, i + 1);
    }
  }
  return null;
}

export function extractFirstJsonFragment(s: string): string | null {
  const t = s.trim();
  const idx = t.search(/[\[{]/);
  if (idx === -1) return null;
  const open = t[idx] as '{' | '[';
  return extractBalanced(t, idx, open);
}

/** Removes trailing commas before `}` or `]` outside of JSON strings. */
export function removeTrailingCommas(json: string): string {
  let out = '';
  let inString = false;
  let escape = false;

  for (let i = 0; i < json.length; i++) {
    const c = json[i];
    if (escape) {
      out += c;
      escape = false;
      continue;
    }
    if (inString) {
      if (c === '\\') {
        escape = true;
        out += c;
        continue;
      }
      if (c === '"') {
        inString = false;
      }
      out += c;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === ',') {
      let j = i + 1;
      while (j < json.length && /\s/.test(json[j])) j++;
      const next = json[j];
      if (next === '}' || next === ']') {
        continue;
      }
    }
    out += c;
  }
  return out;
}

function stripCodeFences(raw: string): string {
  return raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
}

/**
 * 把 JSON 字符串字面量内部的裸控制字符转义掉。
 *
 * 模型经常把段落分隔写成真换行，而不是 `\n` 两个字符：
 *   {"reply":"第一段。
 *
 * 第二段。"}
 * 这在 JSON 规范里是非法的，`JSON.parse` 会直接抛错，调用方只能把整段原文
 * 当成回复吐回给用户——气泡里就会显示一串带引号的 JSON。
 *
 * 已经写成 `\n` 的保持原样（反斜杠本身不属于控制字符，不动它）。
 */
function escapeControlCharsInsideStrings(raw: string): string {
  let out = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (escape) {
      out += c;
      escape = false;
      continue;
    }
    if (inString) {
      if (c === '\\') {
        out += c;
        escape = true;
        continue;
      }
      if (c === '"') {
        inString = false;
        out += c;
        continue;
      }
      if (c === '\n') {
        out += '\\n';
        continue;
      }
      if (c === '\r') {
        out += '\\r';
        continue;
      }
      if (c === '\t') {
        out += '\\t';
        continue;
      }
      out += c;
      continue;
    }
    if (c === '"') inString = true;
    out += c;
  }
  return out;
}

/**
 * Parse JSON from an LLM response; throws SyntaxError if nothing worked.
 */
export function parseLenientLlmJson(text: string): unknown {
  const stripped = stripCodeFences(text);
  const attempts: string[] = [stripped];
  const frag = extractFirstJsonFragment(stripped);
  if (frag && frag !== stripped) attempts.push(frag);

  for (const base of attempts) {
    // 裸换行先修掉再试；修过的版本放在最后，避免掩盖本来就能过的正常 JSON。
    const variants = [base, removeTrailingCommas(base), escapeControlCharsInsideStrings(base)];
    for (const v of variants) {
      try {
        return JSON.parse(v);
      } catch {
        /* try next variant */
      }
    }
  }
  throw new SyntaxError('Could not parse JSON from LLM response');
}
