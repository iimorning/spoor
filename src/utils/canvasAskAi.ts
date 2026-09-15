/** Card types that can open the right-side Ask AI composer. */
const ASK_AI_NODE_TYPES = new Set([
  'note',
  'text',
  'image',
  'video',
  'book',
  'theme',
  'agent',
  'essay',
  'document',
  'ai',
  'ask',
]);

/** Card types that can start a thread without wiring: they *are* the persona. */
const ASK_PERSONA_ANCHOR_TYPES = new Set(['agent', 'ask']);

/** Ambience is a fixture, not a conversation source. */
export function canAskAiOnNode(node: { type: string }): boolean {
  if (node.type === 'ambience') return false;
  return ASK_AI_NODE_TYPES.has(node.type);
}

/** Notes, images, books, and other source cards must sit in a persona component. */
export function askAiRequiresLinkedPersona(node: { type: string }): boolean {
  if (!canAskAiOnNode(node)) return false;
  return !ASK_PERSONA_ANCHOR_TYPES.has(node.type);
}

export function isAskPersonaAnchorType(type: string): boolean {
  return ASK_PERSONA_ANCHOR_TYPES.has(type);
}

/**
 * Node ids in the same undirected component as any agent or Ask (阿狸) card.
 * A source card can Ask AI only when it appears in this set.
 */
export function nodeIdsLinkedToAskPersona(
  nodes: Array<{ id: string; type: string }>,
  edges: Array<{ from: string; to: string }>,
): Set<string> {
  const adj = new Map<string, string[]>();
  const add = (a: string, b: string) => {
    let list = adj.get(a);
    if (!list) {
      list = [];
      adj.set(a, list);
    }
    list.push(b);
  };
  for (const edge of edges) {
    add(edge.from, edge.to);
    add(edge.to, edge.from);
  }

  const linked = new Set<string>();
  for (const node of nodes) {
    if (!ASK_PERSONA_ANCHOR_TYPES.has(node.type) || linked.has(node.id)) continue;
    const queue = [node.id];
    linked.add(node.id);
    while (queue.length > 0) {
      const id = queue.pop()!;
      for (const next of adj.get(id) ?? []) {
        if (linked.has(next)) continue;
        linked.add(next);
        queue.push(next);
      }
    }
  }
  return linked;
}
