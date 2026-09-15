/**
 * OpenRouter chat completions may arrive as:
 * - one JSON object
 * - SSE (`data: {...}` / multiline data / `: comments`)
 * - JSONL (one object per line, no `data:` prefix)
 *
 * Pro Search requires streaming; citations often land only on a later chunk
 * (`annotations` / `citations`), not as a top-level `search_results` on every delta.
 */

export function assembleOpenRouterChatResponse(raw: string): unknown {
  const chunks = extractOpenRouterChunks(raw);
  if (chunks.length === 0) return { choices: [{ message: { content: '' } }] };
  return mergeOpenRouterChatChunks(chunks);
}

export function assembleOpenRouterSseChat(raw: string): Record<string, unknown> {
  return mergeOpenRouterChatChunks(extractOpenRouterChunks(raw));
}

function looksLikeSse(raw: string): boolean {
  return /(?:^|\n)\s*data:\s*/.test(raw);
}

function extractOpenRouterChunks(raw: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (looksLikeSse(raw)) {
    for (const payload of sseDataPayloads(raw)) {
      const obj = parseChunkJson(payload);
      if (obj) out.push(obj);
    }
    if (out.length > 0) return out;
  }

  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    const whole = parseChunkJson(trimmed);
    if (whole) return [whole];
    for (const line of trimmed.split(/\r?\n/)) {
      const obj = parseChunkJson(line.trim());
      if (obj) out.push(obj);
    }
    if (out.length > 0) return out;
  }

  return out;
}

function sseDataPayloads(raw: string): string[] {
  const payloads: string[] = [];
  let buffer = '';
  const tryFlush = () => {
    const obj = parseChunkJson(buffer);
    if (!obj && buffer.trim() !== '[DONE]') return false;
    if (buffer.trim() && buffer.trim() !== '[DONE]') payloads.push(buffer);
    buffer = '';
    return true;
  };
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('data:')) {
      const piece = line.slice(5).replace(/^\s/, '');
      buffer = buffer ? `${buffer}\n${piece}` : piece;
      if (parseChunkJson(buffer) || buffer.trim() === '[DONE]') tryFlush();
      continue;
    }
    if (line.trim() === '') tryFlush();
  }
  tryFlush();
  return payloads;
}

function parseChunkJson(payload: string): Record<string, unknown> | null {
  const t = payload.trim();
  if (!t || t === '[DONE]') return null;
  try {
    const v = JSON.parse(t) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    return null;
  }
  return null;
}

type Harvest = {
  searchResults: unknown[];
  citations: unknown[];
  annotations: unknown[];
};

function harvestCitations(node: unknown, bags: Harvest, depth = 0): void {
  if (depth > 10 || node == null) return;
  if (Array.isArray(node)) {
    for (const item of node) harvestCitations(item, bags, depth + 1);
    return;
  }
  if (typeof node !== 'object') return;
  const o = node as Record<string, unknown>;
  if (o.type === 'url_citation' || (o.url_citation && typeof o.url_citation === 'object')) {
    bags.annotations.push(o);
  }
  for (const [k, v] of Object.entries(o)) {
    if (!Array.isArray(v) || v.length === 0) continue;
    const key = k.replace(/-/g, '_').toLowerCase();
    if (key === 'search_results' || key === 'searchresults') bags.searchResults.push(...v);
    else if (key === 'citations') bags.citations.push(...v);
    else if (key === 'annotations') bags.annotations.push(...v);
  }
  for (const [k, v] of Object.entries(o)) {
    const key = k.replace(/-/g, '_').toLowerCase();
    if (key === 'content' && typeof v === 'string') continue;
    if (key === 'search_results' || key === 'searchresults' || key === 'citations' || key === 'annotations') {
      continue;
    }
    harvestCitations(v, bags, depth + 1);
  }
}

function deltaText(delta: Record<string, unknown> | undefined): string {
  if (!delta) return '';
  const c = delta.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
          return (part as { text: string }).text;
        }
        return '';
      })
      .join('');
  }
  return '';
}

export function mergeOpenRouterChatChunks(chunks: Record<string, unknown>[]): Record<string, unknown> {
  const bags: Harvest = { searchResults: [], citations: [], annotations: [] };
  let model: unknown;
  let id: unknown;
  let content = '';

  for (const chunk of chunks) {
    if (chunk.model) model = chunk.model;
    if (chunk.id) id = chunk.id;
    harvestCitations(chunk, bags);
    const choice = Array.isArray(chunk.choices)
      ? (chunk.choices[0] as Record<string, unknown> | undefined)
      : undefined;
    const delta = choice?.delta as Record<string, unknown> | undefined;
    content += deltaText(delta);
    const message = choice?.message as Record<string, unknown> | undefined;
    if (typeof message?.content === 'string' && message.content.length >= content.length) {
      content = message.content;
    }
  }

  const message: Record<string, unknown> = { content };
  if (bags.annotations.length > 0) message.annotations = bags.annotations;

  const out: Record<string, unknown> = {
    id,
    model,
    choices: [{ message }],
  };
  if (bags.searchResults.length > 0) out.search_results = bags.searchResults;
  if (bags.citations.length > 0) out.citations = bags.citations;
  return out;
}

export function perplexityAssistantText(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const root = data as Record<string, unknown>;
  const message = Array.isArray(root.choices)
    ? ((root.choices[0] as { message?: { content?: unknown } } | undefined)?.message ?? undefined)
    : undefined;
  return typeof message?.content === 'string' ? message.content.replace(/\s+/g, ' ').trim() : '';
}
