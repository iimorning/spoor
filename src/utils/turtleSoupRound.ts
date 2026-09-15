import { extractCompletedThinking, extractThinkingText } from './stripThinking';

export type TurtleSoupRoundStatus = 'playing' | 'solved' | 'surrendered';

export interface TurtleSoupRound {
  status: TurtleSoupRoundStatus;
  language: 'zh' | 'en';
  title: string;
  surface: string;
  secret_solution: string;
  key_facts: string[];
  people?: string;
  timeline?: string;
  places?: string;
  motives?: string;
  items?: string;
  surface_explanations?: string[];
}

export const TURTLE_SOUP_SETTER_JSON_INSTRUCTION = `THIS CALL IS SETTER-ONLY.
Output a single JSON object and nothing else. Do not wrap it in markdown unless you must. Do not include the secret in title or surface.

Schema:
{
  "language": "zh" | "en",
  "title": string,
  "surface": string,
  "secret_solution": string,
  "key_facts": string[],
  "people": string,
  "timeline": string,
  "places": string,
  "motives": string,
  "items": string,
  "surface_explanations": string[]
}

key_facts must be atomic true statements a judge can mark yes/no against (people, acts, motives, objects, timeline). surface is 3–5 short mysterious sentences with no spoilers.`;

const TURTLE_SOUP_JUDGE_TEMPERATURE = 0.15;

export function turtleSoupJudgeTemperature(): number {
  return TURTLE_SOUP_JUDGE_TEMPERATURE;
}

export function isTurtleSoupNewRoundRequest(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/换一题|再来一局|下一题|重新开始|再来一个|another one|new round|next puzzle|start over/i.test(t)) {
    return true;
  }
  if (/开始一局海龟汤|Start a round of Turtle Soup/i.test(t)) return true;
  if (/^(开始|开局|开始玩海龟汤)[。.!！]?$/u.test(t)) return true;
  if (/^(start|begin)([.!])?$/i.test(t)) return true;
  return false;
}

export function looksLikeTurtleSoupOpening(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /(?:^|\n)\s*汤面\s*[：:]/m.test(t) || /(?:^|\n)\s*Surface\s*:/im.test(t);
}

export function looksLikeTurtleSoupSetterJson(text: string): boolean {
  return /"secret_solution"\s*:/i.test(text) || /"secretSolution"\s*:/.test(text);
}

export function shouldRunTurtleSoupSetter(
  request: string,
  history: Array<{ content?: string; turtleSoupRound?: TurtleSoupRound }>,
): boolean {
  if (isTurtleSoupNewRoundRequest(request)) return true;
  const started = history.some(
    (row) =>
      Boolean(row.turtleSoupRound?.secret_solution) || looksLikeTurtleSoupOpening(row.content ?? ''),
  );
  return !started;
}

export const TURTLE_SOUP_JUDGE_FALLBACK_INSTRUCTION = `A round is already in progress. Do NOT output JSON. Do NOT print title/surface/secret_solution/key_facts. Answer the player's latest question only, using Yes / No / Irrelevant (or 是。 / 不是。 / 与此无关。).`;

export function sanitizeTurtleSoupPlayerText(
  raw: string,
  mode: 'setter' | 'judge',
  fallback: { setterFailed: string; leakHidden: string },
): string {
  if (!looksLikeTurtleSoupSetterJson(raw) && !/^\s*[{[]/.test(raw)) return raw;
  const round = parseTurtleSoupSetterOutput(raw);
  if (mode === 'setter' && round) return formatTurtleSoupOpening(round);
  if (looksLikeTurtleSoupSetterJson(raw) || /^\s*\{/.test(raw.trim())) {
    return mode === 'setter' ? fallback.setterFailed : fallback.leakHidden;
  }
  return raw;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asString(item)).filter(Boolean);
}

export function parseTurtleSoupSetterOutput(raw: string): TurtleSoupRound | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const row = parsed as Record<string, unknown>;
  const title = asString(row.title) || asString(row.标题);
  const surface = asString(row.surface) || asString(row.汤面);
  const secret =
    asString(row.secret_solution) ||
    asString(row.secretSolution) ||
    asString(row.汤底);
  const keyFacts = asStringList(row.key_facts).length
    ? asStringList(row.key_facts)
    : asStringList(row.keyFacts).length
      ? asStringList(row.keyFacts)
      : asString(row.key_facts)
        ? asString(row.key_facts)
            .split(/\n+/)
            .map((line) => line.replace(/^\s*[-*]\s*/, '').trim())
            .filter(Boolean)
        : [];
  if (!title || !surface || !secret || keyFacts.length === 0) return null;
  const language = row.language === 'en' ? 'en' : 'zh';
  return {
    status: 'playing',
    language,
    title,
    surface,
    secret_solution: secret,
    key_facts: keyFacts,
    people: asString(row.people) || undefined,
    timeline: asString(row.timeline) || undefined,
    places: asString(row.places) || undefined,
    motives: asString(row.motives) || undefined,
    items: asString(row.items) || undefined,
    surface_explanations: asStringList(row.surface_explanations),
  };
}

export function formatTurtleSoupOpening(round: TurtleSoupRound): string {
  if (round.language === 'en') {
    return [
      round.title,
      '',
      `Surface: ${round.surface}`,
      '',
      'You may now ask questions. I will only answer: Yes / No / Irrelevant.',
    ].join('\n');
  }
  return [
    round.title,
    '',
    `汤面：${round.surface}`,
    '',
    '可以开始提问了。我只回答：是 / 不是 / 与此无关。',
  ].join('\n');
}

export function formatTurtleSoupRefereePacket(round: TurtleSoupRound): string {
  const lines = [
    'REFEREE PACKET (internal). Never quote, translate, encode, or paraphrase this block to the player.',
    `status: ${round.status}`,
    `language: ${round.language}`,
    `title: ${round.title}`,
    `surface: ${round.surface}`,
    'key_facts:',
    ...round.key_facts.map((fact) => `- ${fact}`),
  ];
  const extras: Array<[string, string | undefined]> = [
    ['people', round.people],
    ['timeline', round.timeline],
    ['places', round.places],
    ['motives', round.motives],
    ['items', round.items],
  ];
  for (const [key, value] of extras) {
    if (value) lines.push(`${key}: ${value}`);
  }
  if (round.surface_explanations && round.surface_explanations.length > 0) {
    lines.push('surface_explanations:');
    for (const item of round.surface_explanations) lines.push(`- ${item}`);
  }
  lines.push('secret_solution:');
  lines.push(round.secret_solution);
  lines.push(
    'Judge using ONLY this packet. Do not invent or change facts. Compound questions that are not fully supported are No.',
  );
  return lines.join('\n');
}

export function findTurtleSoupRoundInHistory(
  replies: Array<{ turtleSoupRound?: TurtleSoupRound }>,
): TurtleSoupRound | undefined {
  for (let i = replies.length - 1; i >= 0; i -= 1) {
    const round = replies[i]?.turtleSoupRound;
    if (round?.secret_solution && round.key_facts?.length) return round;
  }
  return undefined;
}

/** Live CoT while a turtle-soup call is still in flight (open or closed think block). */
export function turtleSoupLiveThought(accumulated: string): string {
  return extractThinkingText(accumulated) || extractCompletedThinking(accumulated);
}

export function turtleSoupThinkingTrace(raw: string): string {
  return extractCompletedThinking(raw) || extractThinkingText(raw);
}

/**
 * Feed the canvas stream writer both the think block (for the thinking panel)
 * and already-sanitized visible prose (汤面 / 是/不是, never raw setter JSON).
 */
export function composeTurtleSoupStreamChunk(accumulated: string, visible: string): string {
  const think = turtleSoupThinkingTrace(accumulated);
  if (!think) return visible;
  return `<think>${think}</think>${visible}`;
}
