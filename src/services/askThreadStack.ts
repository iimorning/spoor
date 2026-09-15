import { db, type CanvasNode, type Edge } from '../db';

/** Neat deck offset when Ask thread replies are collapsed. */
export const ASK_THREAD_STACK_STEP = 5;

/**
 * AI reply cards for this Ask thread, oldest → newest.
 * Prefers `threadRootContextNodeId`; also includes AI cards reachable from the
 * Ask card by walking only through AI nodes (conversation chain), so older
 * replies without the tag still count.
 */
export function listAskThreadReplies(
  askId: string,
  nodes: CanvasNode[],
  edges?: Pick<Edge, 'from' | 'to'>[],
): CanvasNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const found = new Map<string, CanvasNode>();

  for (const n of nodes) {
    if (n.type === 'ai' && n.threadRootContextNodeId === askId) {
      found.set(n.id, n);
    }
  }

  if (edges && edges.length > 0) {
    const visited = new Set<string>([askId]);
    const queue = [askId];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const e of edges) {
        const other = e.from === cur ? e.to : e.to === cur ? e.from : null;
        if (!other || visited.has(other)) continue;
        const n = byId.get(other);
        // Only walk Ask ↔ AI ↔ AI … so note/agent side-chains are ignored.
        if (!n || n.type !== 'ai') continue;
        visited.add(other);
        found.set(other, n);
        queue.push(other);
      }
    }
  }

  return sortAskHistoryAsc([...found.values()]);
}

function sortAskHistoryAsc(nodes: CanvasNode[]): CanvasNode[] {
  return nodes.slice().sort((a, b) => {
    const ra = typeof a.threadRound === 'number' ? a.threadRound : Number.POSITIVE_INFINITY;
    const rb = typeof b.threadRound === 'number' ? b.threadRound : Number.POSITIVE_INFINITY;
    if (ra !== rb) return ra - rb;
    return a.x - b.x || a.y - b.y || a.id.localeCompare(b.id);
  });
}

/**
 * Chat history for an Ask submit: 阿狸 uses the full thread; asking from any
 * other card uses that card (if it is an AI reply) plus follow-ups spawned
 * from it — not the undirected chain of earlier siblings.
 */
export function listAskSourceHistory(
  root: CanvasNode,
  nodes: CanvasNode[],
  edges?: Pick<Edge, 'from' | 'to'>[],
): CanvasNode[] {
  if (root.type === 'ask') {
    return listAskThreadReplies(root.id, nodes, edges);
  }
  const followUps = sortAskHistoryAsc(
    nodes.filter((n) => n.type === 'ai' && n.threadRootContextNodeId === root.id),
  );
  if (root.type === 'ai') {
    return [root, ...followUps.filter((n) => n.id !== root.id)];
  }
  return followUps;
}

/**
 * Deck index for z-order: 0 = latest reply (on top of the pile).
 * Prefers `threadRound`; when missing, farther from Ask counts as later.
 */
export function askThreadStackFrontIndex(
  repliesAsc: CanvasNode[],
  nodeId: string,
  ask?: { x: number; y: number },
): number {
  if (!ask) {
    const i = repliesAsc.findIndex((n) => n.id === nodeId);
    if (i < 0) return 0;
    return Math.max(0, repliesAsc.length - 1 - i);
  }
  const order = sortAskRepliesLatestFirst(ask, repliesAsc);
  const i = order.findIndex((n) => n.id === nodeId);
  return i < 0 ? 0 : i;
}

function dist2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** Latest conversation reply first (top of pile). */
export function sortAskRepliesLatestFirst(
  ask: { x: number; y: number },
  replies: CanvasNode[],
  options?: { preferExpandedOffsets?: boolean },
): CanvasNode[] {
  const preferExpanded = !!options?.preferExpandedOffsets;
  return replies.slice().sort((a, b) => {
    const ra = typeof a.threadRound === 'number' ? a.threadRound : -1;
    const rb = typeof b.threadRound === 'number' ? b.threadRound : -1;
    if (ra !== rb) return rb - ra;
    const pa = preferExpanded ? askThreadReplyLayoutPos(a, ask) : { x: a.x, y: a.y };
    const pb = preferExpanded ? askThreadReplyLayoutPos(b, ask) : { x: b.x, y: b.y };
    // Without rounds, farther from Ask ≈ later in the chain.
    const d = dist2(ask, pb) - dist2(ask, pa);
    if (d !== 0) return d;
    return b.id.localeCompare(a.id);
  });
}

/** Layout position used for distance / expand restore (not the stacked spot). */
export function askThreadReplyLayoutPos(
  reply: CanvasNode,
  ask: { x: number; y: number },
): { x: number; y: number } {
  const ox = reply.askThreadExpandedOffsetX;
  const oy = reply.askThreadExpandedOffsetY;
  if (typeof ox === 'number' && typeof oy === 'number' && Number.isFinite(ox) && Number.isFinite(oy)) {
    return { x: ask.x + ox, y: ask.y + oy };
  }
  return { x: reply.x, y: reply.y };
}

/**
 * Pick the reply closest to the Ask card (by top-left distance).
 * When re-stacking an already-collapsed thread, prefer saved expanded offsets
 * so the pile stays near the real conversation instead of the current deck.
 */
export function pickAskThreadStackAnchor(
  ask: { x: number; y: number },
  replies: CanvasNode[],
  options?: { preferExpandedOffsets?: boolean },
): { x: number; y: number; id: string } {
  const preferExpanded = !!options?.preferExpandedOffsets;
  let best = replies[0]!;
  let bestPos = preferExpanded
    ? askThreadReplyLayoutPos(best, ask)
    : { x: best.x, y: best.y };
  let bestDist = Number.POSITIVE_INFINITY;
  for (const reply of replies) {
    const pos = preferExpanded
      ? askThreadReplyLayoutPos(reply, ask)
      : { x: reply.x, y: reply.y };
    const dx = pos.x - ask.x;
    const dy = pos.y - ask.y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = reply;
      bestPos = pos;
    }
  }
  return { ...bestPos, id: best.id };
}

/** Stack in place around the anchor reply; index 0 is the front (latest) card. */
export function askThreadStackPos(
  base: { x: number; y: number },
  index: number,
): { x: number; y: number } {
  return {
    x: base.x + index * ASK_THREAD_STACK_STEP,
    y: base.y + index * ASK_THREAD_STACK_STEP,
  };
}

/** Higher z for lower front-index so the latest reply sits on top. */
export function askThreadStackZIndex(frontIndex: number): number {
  return 420 - frontIndex;
}

/** Keep stacked replies upright (same as web-search source deck). */
export function askThreadStackTiltDeg(_frontIndex: number): number {
  return 0;
}

function resolveExpandedPos(
  reply: CanvasNode,
  ask: { x: number; y: number },
): { x: number; y: number } {
  return askThreadReplyLayoutPos(reply, ask);
}

/**
 * Collapse Ask-thread reply cards into a photo stack at the reply nearest the
 * Ask card (latest on top), or expand back to positions saved on collapse.
 *
 * Offsets are stored relative to the Ask card so manual rearrangements survive
 * a fold/unfold cycle.
 */
export async function setAskThreadCollapsed(
  askId: string,
  collapsed: boolean,
  options?: {
    nodes?: CanvasNode[];
    edges?: Pick<Edge, 'from' | 'to'>[];
    /** @deprecated Ignored — stack anchors on the nearest reply, not Ask height. */
    anchorHeight?: number;
  },
): Promise<number> {
  const ask = await db.nodes.get(askId);
  if (!ask || ask.type !== 'ask') return 0;

  const nodes = options?.nodes ?? (await db.nodes.toArray());
  const edges = options?.edges ?? (await db.edges.toArray());
  const replies = listAskThreadReplies(askId, nodes, edges);
  if (replies.length === 0) return 0;

  await db.transaction('rw', db.nodes, async () => {
    const freshAsk = (await db.nodes.get(askId)) ?? ask;
    const askPos = { x: freshAsk.x, y: freshAsk.y };
    const wasCollapsed = !!freshAsk.askThreadCollapsed;
    await db.nodes.update(askId, { askThreadCollapsed: collapsed });

    if (collapsed) {
      // Prefer live rows so distance uses up-to-date coords / saved offsets.
      const liveReplies: CanvasNode[] = [];
      for (const listed of replies) {
        liveReplies.push((await db.nodes.get(listed.id)) ?? listed);
      }
      const anchor = pickAskThreadStackAnchor(askPos, liveReplies, {
        preferExpandedOffsets: wasCollapsed,
      });
      const stackBase = { x: anchor.x, y: anchor.y };

      // Latest reply first → front of pile (index 0, highest z).
      const stackOrder = sortAskRepliesLatestFirst(askPos, liveReplies, {
        preferExpandedOffsets: wasCollapsed,
      });
      for (let i = 0; i < stackOrder.length; i++) {
        const reply = stackOrder[i]!;
        const stackPos = askThreadStackPos(stackBase, i);
        // When re-stacking an already-collapsed thread (e.g. a new reply arrived),
        // keep previously saved expanded offsets so expand still restores the
        // user's layout. Only capture offsets for cards that don't have them yet.
        const keepOffsets =
          wasCollapsed &&
          typeof reply.askThreadExpandedOffsetX === 'number' &&
          typeof reply.askThreadExpandedOffsetY === 'number';
        await db.nodes.update(reply.id, {
          ...stackPos,
          ...(keepOffsets
            ? {}
            : {
                askThreadExpandedOffsetX: reply.x - askPos.x,
                askThreadExpandedOffsetY: reply.y - askPos.y,
              }),
        });
      }
    } else {
      for (const listed of replies) {
        const reply = (await db.nodes.get(listed.id)) ?? listed;
        const pos = resolveExpandedPos(reply, askPos);
        await db.nodes.update(reply.id, pos);
      }
    }
  });

  return replies.length;
}

/** Unfold leftover Ask reply piles so V2 does not keep a stack with no toggle. */
export async function expandCollapsedAskThreads(
  nodes: CanvasNode[],
  edges: Pick<Edge, 'from' | 'to'>[],
): Promise<number> {
  const collapsed = nodes.filter((n) => n.type === 'ask' && n.askThreadCollapsed);
  if (collapsed.length === 0) return 0;
  let expanded = 0;
  for (const ask of collapsed) {
    const count = await setAskThreadCollapsed(ask.id, false, { nodes, edges });
    if (count > 0) expanded += 1;
  }
  return expanded;
}
