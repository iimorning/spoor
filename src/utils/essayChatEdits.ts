import { parseLenientLlmJson } from './llmJson';
import { countExactOccurrences } from './parsePublishArticleResponse';

export const MAX_ESSAY_CHAT_EDITS = 8;
export const MAX_ESSAY_CHAT_FIND_CHARS = 4000;
export const MAX_ESSAY_CHAT_REPLACE_CHARS = 8000;

export interface EssayChatEdit {
  find: string;
  replace: string;
}

export interface ParsedEssayChatResponse {
  reply: string;
  edits: EssayChatEdit[];
  replaceDocument: boolean;
}

export function escapeEssayChatHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function serializeEssayChatEdit(original: string, proposed: string): string {
  return (
    `<span data-ai-essay-edit="true">` +
    `<del data-original="true">${escapeEssayChatHtml(original)}</del>` +
    `<span data-proposed="true">${escapeEssayChatHtml(proposed)}</span>` +
    `</span>`
  );
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function normalizeEdit(raw: unknown): EssayChatEdit | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const find = asString(rec.find ?? rec.original ?? rec.from);
  const replace = asString(rec.replace ?? rec.proposed ?? rec.to);
  if (!find && !replace) return null;
  if (find.length > MAX_ESSAY_CHAT_FIND_CHARS) return null;
  if (replace.length > MAX_ESSAY_CHAT_REPLACE_CHARS) {
    return { find, replace: replace.slice(0, MAX_ESSAY_CHAT_REPLACE_CHARS) };
  }
  return { find, replace };
}

function unwrapEssayChatJsonFence(raw: string): string {
  const trimmed = (raw ?? '').trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\r?\n([\s\S]*?)\n```\s*$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

export function parseEssayChatResponse(raw: string): ParsedEssayChatResponse {
  const trimmed = unwrapEssayChatJsonFence(raw);
  if (!trimmed) return { reply: '', edits: [], replaceDocument: false };
  try {
    const parsed = parseLenientLlmJson(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { reply: trimmed, edits: [], replaceDocument: false };
    }
    const rec = parsed as Record<string, unknown>;
    const reply = asString(rec.reply ?? rec.message ?? rec.summary).trim();
    const replaceDocument = rec.replaceDocument === true || rec.replace_document === true;
    const document = asString(rec.document ?? rec.body ?? rec.content);
    const rawEdits = Array.isArray(rec.edits) ? rec.edits : [];
    const edits: EssayChatEdit[] = [];
    for (const item of rawEdits) {
      if (edits.length >= MAX_ESSAY_CHAT_EDITS) break;
      const edit = normalizeEdit(item);
      if (edit) edits.push(edit);
    }
    if (replaceDocument && document) {
      return { reply: reply || trimmed, edits: [{ find: '', replace: document }], replaceDocument: true };
    }
    return { reply: reply || (edits.length ? '' : trimmed), edits, replaceDocument: false };
  } catch {
    return { reply: trimmed, edits: [], replaceDocument: false };
  }
}

function replaceFirst(haystack: string, needle: string, replacement: string): string | null {
  const idx = haystack.indexOf(needle);
  if (idx < 0) return null;
  return haystack.slice(0, idx) + replacement + haystack.slice(idx + needle.length);
}

export function applyEssayChatEdits(
  markdown: string,
  edits: EssayChatEdit[],
  options?: { replaceDocument?: boolean },
): { markdown: string; applied: number; missed: string[] } {
  const body = markdown ?? '';
  if (options?.replaceDocument) {
    const next = edits[0]?.replace ?? '';
    if (!next || next === body) return { markdown: body, applied: 0, missed: [] };
    return {
      markdown: serializeEssayChatEdit(body, next),
      applied: 1,
      missed: [],
    };
  }

  let current = body;
  let applied = 0;
  const missed: string[] = [];
  for (const edit of edits) {
    const find = edit.find;
    if (!find) {
      missed.push('(empty find)');
      continue;
    }
    if (find.includes('data-ai-essay-edit')) {
      missed.push(find.slice(0, 40));
      continue;
    }
    if (countExactOccurrences(current, find) !== 1) {
      missed.push(find.slice(0, 80));
      continue;
    }
    if (current === find) {
      current = serializeEssayChatEdit(find, edit.replace);
      applied += 1;
      continue;
    }
    const next = replaceFirst(current, find, serializeEssayChatEdit(find, edit.replace));
    if (next == null) {
      missed.push(find.slice(0, 80));
      continue;
    }
    current = next;
    applied += 1;
  }
  return { markdown: current, applied, missed };
}
