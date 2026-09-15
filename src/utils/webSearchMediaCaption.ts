import { parseVoiceWebSearchIntent } from './webSearchCommand';

export type WebSearchRelationContext = {
  query?: string;
  parentLabel?: string;
};

function clip(text: string, maxLen: number): string {
  const s = text.replace(/\s+/g, ' ').trim();
  if (s.length <= maxLen) return s;
  return `${s.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

function stripCardBody(content?: string): string {
  return (content ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*`\[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstMeaningfulLine(content?: string): string {
  const line = (content ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .find((l) => l.trim().length > 0)
    ?.trim() ?? '';
  return stripCardBody(line);
}

function topicFromUserTurn(turn: string, maxLen: number): string {
  const trimmed = turn.replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  const intent = parseVoiceWebSearchIntent(trimmed);
  if (intent) {
    const q = intent.explicitQuery.trim();
    if (q) return clip(q, maxLen);
    // Bare “联网搜索 / 搜图” — not a readable topic; fall through to body.
    return '';
  }
  return clip(trimmed, maxLen);
}

/** Short label for the card these search hits belong to (question, then body). */
export function parentCardTopic(
  node: {
    type?: string;
    userTurn?: string;
    content?: string;
    description?: string;
  },
  maxLen = 40,
): string {
  const turn = (node.userTurn ?? '').replace(/\s+/g, ' ').trim();
  if (turn) {
    const fromTurn = topicFromUserTurn(turn, maxLen);
    if (fromTurn) return fromTurn;
  }
  const desc = (node.description ?? '').replace(/\s+/g, ' ').trim();
  if (desc) return clip(desc, maxLen);
  return clip(firstMeaningfulLine(node.content), maxLen);
}

export function joinSearchQueries(queries: Array<string | undefined>, maxLen = 48): string {
  const unique = [
    ...new Set(queries.map((q) => (q ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean)),
  ];
  return clip(unique.join('；'), maxLen);
}

export function webSearchRelationContext(
  node: {
    type?: string;
    userTurn?: string;
    content?: string;
    description?: string;
  },
  query?: string,
): WebSearchRelationContext {
  return {
    query: (query ?? '').replace(/\s+/g, ' ').trim() || undefined,
    parentLabel: parentCardTopic(node) || undefined,
  };
}

/**
 * Optional second line under a search hit title.
 * We only show Metaso snippet text — never meta copy like “检索…得到”.
 */
export function buildWebSearchMediaRelation(opts: {
  query?: string;
  parentLabel?: string;
  snippet?: string;
}): string {
  const snippet = (opts.snippet ?? '').replace(/\s+/g, ' ').trim();
  if (snippet) return clip(snippet, 100);
  return '';
}

/** Persist title + relation in `description` (newline-separated). */
export function formatSearchMediaDescription(title: string, relation: string): string | undefined {
  const t = title.replace(/\s+/g, ' ').trim();
  const r = relation.replace(/\s+/g, ' ').trim();
  if (t && r) return `${t}\n${r}`;
  if (r) return `\n${r}`;
  return t || undefined;
}

export function parseSearchMediaDescription(raw: string | undefined): {
  title: string;
  relation: string;
} {
  const text = raw ?? '';
  if (!text.trim() && !text.includes('\n')) return { title: '', relation: '' };
  const nl = text.search(/\r?\n/);
  if (nl < 0) return { title: text.replace(/\s+/g, ' ').trim(), relation: '' };
  return {
    title: text.slice(0, nl).replace(/\s+/g, ' ').trim(),
    relation: text.slice(nl + 1).replace(/\s+/g, ' ').trim(),
  };
}
