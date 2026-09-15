import type { CanvasNode, Edge } from '../db';

/**
 * From an AI leaf card, walk backwards along edges (from → to) through consecutive `type === 'ai'` nodes.
 * Returns [rootAi, …, leafAi] in chronological order; empty if leaf missing or not ai'.
 */
export function collectAiThreadChain(nodes: CanvasNode[], edges: Edge[], leafId: string): CanvasNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const chainRev: CanvasNode[] = [];
  let cur = leafId;

  while (true) {
    const node = byId.get(cur);
    if (!node || node.type !== 'ai') break;
    chainRev.push(node);
    const incoming = edges.find((e) => e.to === cur);
    if (!incoming) break;
    const pred = byId.get(incoming.from);
    if (!pred || pred.type !== 'ai') break;
    cur = incoming.from;
  }

  return chainRev.reverse();
}

/** Build a plain-text transcript for the model from root→parent AI cards in a thread. */
export function formatAgentThreadDialogueHistory(chain: CanvasNode[]): string {
  if (chain.length === 0) return '';
  const parts: string[] = [];
  for (let i = 0; i < chain.length; i++) {
    const n = chain[i]!;
    const content = (n.content ?? '').trim();
    if (i === 0) {
      if (content) parts.push(`Assistant:\n${content}`);
      continue;
    }
    const ut = (n.userTurn ?? '').trim();
    if (ut && content) {
      parts.push(`User:\n${ut}\n\nAssistant:\n${content}`);
    } else if (content) {
      parts.push(`Assistant:\n${content}`);
    } else if (ut) {
      parts.push(`User:\n${ut}`);
    }
  }
  return parts.join('\n\n---\n\n');
}

/**
 * Multi-agent discussion transcript.
 * Auto turns store the speaker display name in `userTurn`; user interrupts store the user message there
 * while `threadAgentConfigId` is the agent who replies in `content`.
 */
export function formatAgentDiscussionDialogueHistory(
  chain: CanvasNode[],
  nameByAgentConfigId: (agentConfigId: string) => string,
): string {
  if (chain.length === 0) return '';
  const speakerLabelSet = new Set<string>();
  for (const n of chain) {
    const ids = n.threadDiscussionAgentIds;
    if (!ids?.length) continue;
    for (const id of ids) speakerLabelSet.add(nameByAgentConfigId(id));
  }

  const parts: string[] = [];
  for (const n of chain) {
    const content = (n.content ?? '').trim();
    const ut = (n.userTurn ?? '').trim();
    const speakerId = n.threadAgentConfigId;
    const speakerName = speakerId ? nameByAgentConfigId(speakerId) : '';
    const isAutoSpeakerLabel = Boolean(ut && speakerLabelSet.has(ut));

    if (isAutoSpeakerLabel) {
      if (content) parts.push(`${ut}:\n${content}`);
      else if (ut) parts.push(`${ut}:`);
      continue;
    }

    if (ut && content) {
      parts.push(`User:\n${ut}\n\n${speakerName || 'Assistant'}:\n${content}`);
    } else if (content) {
      parts.push(`${speakerName || 'Assistant'}:\n${content}`);
    } else if (ut) {
      parts.push(`User:\n${ut}`);
    }
  }
  return parts.join('\n\n---\n\n');
}
