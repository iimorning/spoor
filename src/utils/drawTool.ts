import { parseLenientLlmJson } from './llmJson';
import { parseImageOrientation, type ImageOrientation } from './imageOrientation';

export type DrawToolSpec = {
  title: string;
  prompt: string;
  orientation?: ImageOrientation;
};

export const DRAW_TOOL_MAX_IMAGES = 4;
/** Poster copy + visual description needs more than a scene caption. */
export const DRAW_PROMPT_MAX_LEN = 1200;

const DRAW_NAMES =
  /^(draw|illustrate|generate_image|generateimage|generate-image|flux|gpt_image|gpt-image|image_gen|img)$/i;

function asNonEmptyString(v: unknown, maxLen: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.slice(0, maxLen);
}

function specFromRow(row: Record<string, unknown>): DrawToolSpec | null {
  const prompt =
    asNonEmptyString(row.prompt, DRAW_PROMPT_MAX_LEN) ||
    asNonEmptyString(row.imagePrompt, DRAW_PROMPT_MAX_LEN) ||
    asNonEmptyString(row.image_prompt, DRAW_PROMPT_MAX_LEN) ||
    asNonEmptyString(row.query, DRAW_PROMPT_MAX_LEN) ||
    asNonEmptyString(row.description, DRAW_PROMPT_MAX_LEN);
  if (!prompt) return null;
  const title =
    asNonEmptyString(row.title, 60) ||
    asNonEmptyString(row.name, 60) ||
    asNonEmptyString(row.label, 60) ||
    prompt.slice(0, 40);
  const orientation =
    parseImageOrientation(row.orientation) ||
    parseImageOrientation(row.aspect) ||
    parseImageOrientation(row.size) ||
    parseImageOrientation(row.direction);
  return {
    title: title || prompt.slice(0, 40),
    prompt,
    ...(orientation ? { orientation } : {}),
  };
}

/** Pull image specs from a parsed object (`images` / `illustrations` / single prompt). */
export function normalizeDrawToolImages(raw: unknown): DrawToolSpec[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  const list = Array.isArray(obj.images)
    ? obj.images
    : Array.isArray(obj.illustrations)
      ? obj.illustrations
      : null;
  const out: DrawToolSpec[] = [];
  if (list) {
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const spec = specFromRow(item as Record<string, unknown>);
      if (!spec) continue;
      out.push(spec);
      if (out.length >= DRAW_TOOL_MAX_IMAGES) break;
    }
    return out;
  }
  const single = specFromRow(obj);
  return single ? [single] : [];
}

function looksLikeDrawPayload(obj: Record<string, unknown>): boolean {
  if ('hub' in obj && ('branches' in obj || 'cards' in obj)) return false;
  if ('outline' in obj && 'summary' in obj) return false;
  const action = String(obj.action ?? obj.name ?? obj.tool ?? '').toLowerCase();
  if (action && DRAW_NAMES.test(action)) return true;
  if (Array.isArray(obj.images) || Array.isArray(obj.illustrations)) return true;
  return false;
}

function specsFromJsonish(body: string): DrawToolSpec[] {
  try {
    const parsed = parseLenientLlmJson(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    const obj = parsed as Record<string, unknown>;
    if (!looksLikeDrawPayload(obj)) return [];
    return normalizeDrawToolImages(obj);
  } catch {
    return [];
  }
}

function specsFromDrawFenceBody(body: string): DrawToolSpec[] {
  try {
    const parsed = parseLenientLlmJson(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    return normalizeDrawToolImages(parsed);
  } catch {
    return [];
  }
}

function specsFromToolCallBody(body: string): DrawToolSpec[] {
  try {
    const parsed = parseLenientLlmJson(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    const obj = parsed as Record<string, unknown>;
    const name = String(obj.name ?? obj.action ?? obj.tool ?? '').toLowerCase();
    const args =
      obj.arguments && typeof obj.arguments === 'object' && !Array.isArray(obj.arguments)
        ? (obj.arguments as Record<string, unknown>)
        : obj.parameters && typeof obj.parameters === 'object' && !Array.isArray(obj.parameters)
          ? (obj.parameters as Record<string, unknown>)
          : obj;
    if (name && !DRAW_NAMES.test(name)) return [];
    if (!name && !looksLikeDrawPayload(args) && !looksLikeDrawPayload(obj)) return [];
    const fromArgs = normalizeDrawToolImages(args);
    if (fromArgs.length > 0) return fromArgs;
    return normalizeDrawToolImages(obj);
  } catch {
    const nameMatch = /name["'\s:=]+([a-z_\-]+)/i.exec(body);
    const name = nameMatch?.[1] ?? '';
    if (!DRAW_NAMES.test(name)) return [];
    const promptMatch =
      /prompt["'\s:=]+["']([^"']{2,500})/i.exec(body) ||
      /<parameter\s+name=["']prompt["']>\s*([^<]+)/i.exec(body);
    const prompt = promptMatch?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
    if (!prompt) return [];
    return [{ title: prompt.slice(0, 40), prompt: prompt.slice(0, 500) }];
  }
}

/**
 * Pull illustration requests out of a model reply and return the user-visible prose.
 * Supports ```draw fences, draw-shaped ```json, trailing draw JSON, and draw tool_call blocks.
 */
export function extractDrawToolFromReply(text: string): { prose: string; images: DrawToolSpec[] } {
  if (!text) return { prose: '', images: [] };
  const images: DrawToolSpec[] = [];
  let s = text;

  s = s.replace(/```draw\s*\r?\n?([\s\S]*?)```/gi, (_, body: string) => {
    images.push(...specsFromDrawFenceBody(body));
    return '\n';
  });

  s = s.replace(/```json\s*\r?\n?([\s\S]*?)```/gi, (full, body: string) => {
    const specs = specsFromJsonish(body);
    if (specs.length === 0) return full;
    images.push(...specs);
    return '\n';
  });

  s = s.replace(
    /(?:```tool_call\s*\r?\n?|\[?<tool_call>)\s*([\s\S]*?)(?:<\/tool_call>|```|$)/gi,
    (full, body: string) => {
      const specs = specsFromToolCallBody(body);
      if (specs.length === 0) return full;
      images.push(...specs);
      return '\n';
    },
  );

  const trimmedEnd = s.match(/\n[ \t]*(\{[\s\S]*\})[ \t]*$/);
  if (trimmedEnd?.[1]) {
    const specs = specsFromJsonish(trimmedEnd[1]);
    if (specs.length > 0) {
      images.push(...specs);
      s = s.slice(0, trimmedEnd.index);
    }
  }

  const deduped: DrawToolSpec[] = [];
  const seen = new Set<string>();
  for (const img of images) {
    const key = img.prompt.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(img);
    if (deduped.length >= DRAW_TOOL_MAX_IMAGES) break;
  }

  return {
    prose: s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trimEnd(),
    images: deduped,
  };
}

/** Hide an unclosed ```draw / draw-shaped ```json while the model is still streaming. */
export function stripOpenDrawFence(text: string): string {
  if (!text) return text;
  const drawIdx = text.lastIndexOf('```draw');
  const jsonIdx = text.lastIndexOf('```json');
  const idx = Math.max(drawIdx, jsonIdx);
  if (idx === -1) return text;
  const afterMarker = text.slice(idx + 3);
  if (afterMarker.includes('```')) return text;
  if (jsonIdx >= drawIdx) {
    const body = text.slice(jsonIdx + 7);
    if (body.trim().length > 0 && !/images|illustrations|"action"\s*:\s*"draw"|draw/i.test(body)) {
      return text;
    }
  }
  return text.slice(0, idx).trimEnd();
}
