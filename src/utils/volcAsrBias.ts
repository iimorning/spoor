import type { AgentConfig, CanvasChatMessage, CanvasNode, Edge } from '../db';
import { db } from '../db';
import { collectWorkZoneNodeIds, personaThreadId } from './agentWorkZone';
import { visibleAiReplyText } from './visibleAiReply';

/** Bidirectional streaming hotword budget (Volc: 100 tokens). */
export const VOLC_ASR_HOTWORD_CHAR_BUDGET = 80;
/** Dialog context budget (Volc: 800 tokens / 20 turns). */
export const VOLC_ASR_CONTEXT_CHAR_BUDGET = 720;
const MAX_CONTEXT_SNIPPETS = 12;
const MAX_SNIPPET_CHARS = 280;

const STOPWORDS = new Set([
  '的',
  '了',
  '吗',
  '呢',
  '吧',
  '啊',
  '呀',
  '哦',
  '嗯',
  '是',
  '在',
  '我',
  '你',
  '他',
  '她',
  '它',
  '这',
  '那',
  '就',
  '都',
  '也',
  '还',
  '很',
  '可以',
  '不是',
  '一个',
  '没有',
  '什么',
  '怎么',
  '为什么',
  '因为',
  '所以',
  '如果',
  '但是',
  '然后',
  '这个',
  '那个',
  '自己',
  '我们',
  '你们',
  '他们',
  '以及',
  '或者',
  '还有',
  '一下',
  '一样',
  '这么',
  '那么',
  '只是',
  '已经',
  '为了',
  '关于',
  '可能',
  '需要',
  '进行',
  '问题',
  '回答',
  '请问',
  '用户',
  '助手',
  '内容',
]);

export type VolcAsrBiasInput = {
  /** Newest first. Persona, 汤面, recent replies. */
  snippets: string[];
  /** Always-include terms: persona names, theme titles. */
  seedTerms?: string[];
};

type VolcAsrCorpusContext = {
  hotwords?: { word: string }[];
  context_type?: 'dialog_ctx';
  context_data?: { text: string }[];
};

export function stripAsrBiasText(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max);
}

function isHanToken(token: string): boolean {
  return /^\p{Script=Han}+$/u.test(token);
}

export function extractAsrHotwords(texts: string[], seedTerms: string[] = []): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const push = (raw: string) => {
    const word = raw.trim();
    if (!word || STOPWORDS.has(word) || seen.has(word)) return;
    if (isHanToken(word)) {
      if (word.length < 2 || word.length > 8) return;
    } else if (!/^[A-Za-z][A-Za-z0-9'\-]{1,23}$/.test(word)) {
      return;
    }
    seen.add(word);
    ordered.push(word);
  };

  for (const seed of seedTerms) {
    for (const part of stripAsrBiasText(seed).split(/[^\p{Script=Han}A-Za-z0-9]+/u)) {
      push(part);
    }
  }

  for (const text of texts) {
    for (const part of stripAsrBiasText(text).split(/[^\p{Script=Han}A-Za-z0-9]+/u)) {
      if (!part) continue;
      if (isHanToken(part) && part.length > 8) {
        const candidates: string[] = [];
        for (const n of [3, 4]) {
          for (let i = part.length - n; i >= 0; i--) {
            const slice = part.slice(i, i + n);
            if (!STOPWORDS.has(slice)) candidates.push(slice);
          }
        }
        for (const word of [...new Set(candidates)].slice(0, 8)) {
          push(word);
        }
        continue;
      }
      push(part);
    }
  }

  const picked: string[] = [];
  let used = 0;
  for (const word of ordered) {
    const cost = word.length + 1;
    if (used + cost > VOLC_ASR_HOTWORD_CHAR_BUDGET) continue;
    picked.push(word);
    used += cost;
  }
  return picked;
}

export function buildVolcAsrCorpusContext(input: VolcAsrBiasInput): string | undefined {
  const snippets: string[] = [];
  let used = 0;
  for (const raw of input.snippets) {
    const text = clip(stripAsrBiasText(raw), MAX_SNIPPET_CHARS);
    if (!text) continue;
    if (used + text.length > VOLC_ASR_CONTEXT_CHAR_BUDGET) {
      const remain = VOLC_ASR_CONTEXT_CHAR_BUDGET - used;
      if (remain >= 12) snippets.push(clip(text, remain));
      break;
    }
    snippets.push(text);
    used += text.length;
    if (snippets.length >= MAX_CONTEXT_SNIPPETS) break;
  }

  const hotwords = extractAsrHotwords(snippets, input.seedTerms ?? []).map((word) => ({ word }));
  if (snippets.length === 0 && hotwords.length === 0) return undefined;

  const payload: VolcAsrCorpusContext = {};
  if (hotwords.length > 0) payload.hotwords = hotwords;
  if (snippets.length > 0) {
    payload.context_type = 'dialog_ctx';
    payload.context_data = snippets.map((text) => ({ text }));
  }
  return JSON.stringify(payload);
}

function nodeAsrText(node: CanvasNode): string {
  if (node.type === 'image') return '';
  const body = node.type === 'ai' ? visibleAiReplyText(node.content ?? '') : (node.content ?? '');
  return stripAsrBiasText([body, node.userTurn ?? '', node.description ?? '', node.themeTag ?? ''].join('\n'));
}

function seedTermsForPersona(
  persona: CanvasNode,
  agents: AgentConfig[],
): string[] {
  if (persona.type !== 'agent' || !persona.agentConfigId) return [];
  const agent = agents.find((a) => a.id === persona.agentConfigId);
  if (!agent) return [];
  return [agent.name, agent.role].filter((part) => Boolean(part?.trim()));
}

function snippetsFromTextNodeIds(
  textNodeIds: string[],
  byId: Map<string, CanvasNode>,
): { ai: CanvasNode[]; other: CanvasNode[] } {
  const ai = textNodeIds
    .map((id) => byId.get(id))
    .filter((n): n is CanvasNode => !!n && n.type === 'ai')
    .sort(
      (a, b) =>
        (b.threadRound ?? -1) - (a.threadRound ?? -1) || (b.createdAt ?? 0) - (a.createdAt ?? 0),
    );
  const other = textNodeIds
    .map((id) => byId.get(id))
    .filter((n): n is CanvasNode => !!n && n.type !== 'ai')
    .sort((a, b) => nodeAsrText(b).length - nodeAsrText(a).length);
  return { ai, other };
}

function pushNodeSnippets(snippets: string[], ai: CanvasNode[], other: CanvasNode[]): void {
  for (const n of ai.slice(0, 6)) {
    const text = nodeAsrText(n);
    if (text) snippets.push(text);
  }
  for (const n of other.slice(0, 4)) {
    const text = nodeAsrText(n);
    if (text) snippets.push(text);
  }
}

export function buildVolcAsrBiasFromCanvas(args: {
  askNodeId: string;
  nodes: CanvasNode[];
  edges: Edge[];
  agents: AgentConfig[];
  threadMessages?: CanvasChatMessage[];
}): string | undefined {
  const byId = new Map(args.nodes.map((n) => [n.id, n]));
  const persona = byId.get(args.askNodeId);
  if (!persona) return undefined;

  const seedTerms = seedTermsForPersona(persona, args.agents);
  const snippets: string[] = [];
  if (seedTerms.length > 0) {
    snippets.push(`语音对话角色：${seedTerms.join('、')}`);
  }
  const recentChat = [...(args.threadMessages ?? [])]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 8);
  for (const message of recentChat) {
    const text = stripAsrBiasText(message.text);
    if (text) snippets.push(text);
  }
  const { ai, other } = snippetsFromTextNodeIds(
    collectWorkZoneNodeIds(args.askNodeId, args.nodes),
    byId,
  );
  pushNodeSnippets(snippets, ai, other);
  return buildVolcAsrCorpusContext({ snippets, seedTerms });
}

/** IndexedDB loader used when opening a Volc ASR session for a persona thread. */
export async function loadVolcAsrBiasForAskCard(
  askNodeId: string,
  canvasId: string,
): Promise<string | undefined> {
  const [nodes, edges, agents, thread] = await Promise.all([
    db.nodes.where('canvasId').equals(canvasId).toArray(),
    db.edges.where('canvasId').equals(canvasId).toArray(),
    db.agents.toArray(),
    db.canvasPersonaThreads.get(personaThreadId(canvasId, askNodeId)),
  ]);
  return buildVolcAsrBiasFromCanvas({
    askNodeId,
    nodes,
    edges,
    agents,
    threadMessages: thread?.messages,
  });
}
