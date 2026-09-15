import { db, type CanvasNode, type Edge } from '../db';
import { isCanvasV2Enabled } from '../utils/canvasV2';
import { stampNewCard } from '../utils/stampNewCard';
import { parseLenientLlmJson } from '../utils/llmJson';
import { normalizeDrawToolImages, type DrawToolSpec } from '../utils/drawTool';
import { findPersonaForNodeInZones } from '../utils/workZoneGeometry';
import { THEME_NODE_SIZE } from '../utils/canvas';

export interface BookExpandBranch {
  title: string;
  content: string;
}

export interface BookExpandPlan {
  hub: string;
  branches: BookExpandBranch[];
  images: DrawToolSpec[];
}

export const BOOK_EXPAND_HUB_OFFSET_X = 420;
export const BOOK_EXPAND_CHILD_OFFSET_X = 340;
export const BOOK_EXPAND_CHILD_GAP_Y = 200;
export const BOOK_EXPAND_HUB_WIDTH = THEME_NODE_SIZE.width;
export const BOOK_EXPAND_HUB_HEIGHT = THEME_NODE_SIZE.height;
export const BOOK_EXPAND_CHILD_WIDTH = 280;
export const BOOK_EXPAND_CHILD_HEIGHT = 180;
export const BOOK_EXPAND_STACK_STEP = 5;
const DEFAULT_STAGGER_MS = 220;

function asNonEmptyString(v: unknown, maxLen: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.slice(0, maxLen);
}

/** Normalize LLM JSON into a hub + 3–6 branch cards. */
export function normalizeBookExpandPlan(raw: unknown): BookExpandPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const hub =
    asNonEmptyString(obj.hub, 80) ||
    asNonEmptyString(obj.title, 80) ||
    asNonEmptyString(obj.theme, 80);
  const list = Array.isArray(obj.branches)
    ? obj.branches
    : Array.isArray(obj.cards)
      ? obj.cards
      : Array.isArray(obj.children)
        ? obj.children
        : null;
  if (!hub || !list) return null;

  const branches: BookExpandBranch[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const title =
      asNonEmptyString(row.title, 60) ||
      asNonEmptyString(row.name, 60) ||
      asNonEmptyString(row.label, 60);
    const content =
      asNonEmptyString(row.content, 600) ||
      asNonEmptyString(row.body, 600) ||
      asNonEmptyString(row.desc, 600) ||
      asNonEmptyString(row.description, 600) ||
      title;
    if (!title || !content) continue;
    branches.push({ title, content });
    if (branches.length >= 6) break;
  }
  if (branches.length < 2) return null;
  return { hub, branches, images: normalizeDrawToolImages(obj) };
}

export function parseBookExpandPlan(text: string): BookExpandPlan | null {
  try {
    return normalizeBookExpandPlan(parseLenientLlmJson(text));
  } catch {
    return null;
  }
}

export type BookVoiceImageSpec = DrawToolSpec;

export type BookVoiceReply = {
  /** Spoken reply for TTS (not the card JSON). */
  summary: string;
  plan: BookExpandPlan;
  /** Optional illustrations (max 2) generated via GPT-Image-2 when a 302 key is set. */
  images: BookVoiceImageSpec[];
};

function normalizeBookVoiceImages(raw: unknown): BookVoiceImageSpec[] {
  return normalizeDrawToolImages(raw);
}

/**
 * Book voice chat returns spoken `summary` plus a hub/branches concept map.
 * Cards use the same shape as selection expand.
 */
export function parseBookVoiceReply(text: string): BookVoiceReply | null {
  try {
    const raw = parseLenientLlmJson(text);
    const plan = normalizeBookExpandPlan(raw);
    if (!plan || !raw || typeof raw !== 'object') return null;
    const summary = asNonEmptyString((raw as Record<string, unknown>).summary, 400);
    if (!summary) return null;
    return { summary, plan, images: normalizeBookVoiceImages(raw) };
  } catch {
    return null;
  }
}

export function bookExpandBranchIndex(node: CanvasNode): number {
  if (typeof node.bookExpandIndex === 'number') return node.bookExpandIndex;
  return 0;
}

function isThemeStackableNote(node: Pick<CanvasNode, 'type'>): boolean {
  return node.type === 'text' || node.type === 'note';
}

/**
 * Notes belonging to a theme hub for stack/expand:
 * - tagged with `bookExpandParentId`, and/or
 * - reachable from the hub by walking only through note/text cards
 *   (so Theme→Note→Note chains count; Ask/AI bridges do not pull side notes in).
 */
export function resolveBookExpandBranches(
  hubId: string,
  nodes: CanvasNode[],
  edges: Pick<Edge, 'from' | 'to'>[],
): CanvasNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const found = new Map<string, CanvasNode>();

  for (const n of nodes) {
    if (n.bookExpandParentId === hubId && isThemeStackableNote(n)) {
      found.set(n.id, n);
    }
  }

  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    if (!adj.has(e.to)) adj.set(e.to, []);
    adj.get(e.from)!.push(e.to);
    adj.get(e.to)!.push(e.from);
  }

  const visited = new Set<string>([hubId]);
  const queue = [hubId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const other of adj.get(cur) ?? []) {
      if (visited.has(other)) continue;
      const n = byId.get(other);
      if (!n || !isThemeStackableNote(n)) continue;
      visited.add(other);
      found.set(other, n);
      queue.push(other);
    }
  }

  return [...found.values()].sort((a, b) => {
    const hasIndex =
      typeof a.bookExpandIndex === 'number' || typeof b.bookExpandIndex === 'number';
    if (hasIndex) {
      const ia = bookExpandBranchIndex(a);
      const ib = bookExpandBranchIndex(b);
      if (ia !== ib) return ia - ib;
    }
    return a.y - b.y || a.x - b.x || a.id.localeCompare(b.id);
  });
}

export function bookExpandBranchLaneY(
  hubY: number,
  index: number,
  count: number,
  hubHeight = BOOK_EXPAND_HUB_HEIGHT,
): number {
  const stackHeight = (count - 1) * BOOK_EXPAND_CHILD_GAP_Y + BOOK_EXPAND_CHILD_HEIGHT;
  const centerY = hubY + Math.max(hubHeight, 1) / 2;
  const firstY = centerY - stackHeight / 2;
  return firstY + index * BOOK_EXPAND_CHILD_GAP_Y;
}

/** Layout position used for distance / expand restore (not the stacked spot). */
export function themeNoteLayoutPos(
  note: CanvasNode,
  hub: { x: number; y: number },
): { x: number; y: number } {
  const ox = note.bookExpandExpandedOffsetX;
  const oy = note.bookExpandExpandedOffsetY;
  if (typeof ox === 'number' && typeof oy === 'number' && Number.isFinite(ox) && Number.isFinite(oy)) {
    return { x: hub.x + ox, y: hub.y + oy };
  }
  return { x: note.x, y: note.y };
}

function dist2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * Pick the note closest to the theme hub.
 * When re-stacking while collapsed, prefer saved expanded offsets.
 */
export function pickThemeStackAnchor(
  hub: { x: number; y: number },
  notes: CanvasNode[],
  options?: { preferExpandedOffsets?: boolean },
): { x: number; y: number; id: string } {
  const preferExpanded = !!options?.preferExpandedOffsets;
  let best = notes[0]!;
  let bestPos = preferExpanded ? themeNoteLayoutPos(best, hub) : { x: best.x, y: best.y };
  let bestDist = Number.POSITIVE_INFINITY;
  for (const note of notes) {
    const pos = preferExpanded ? themeNoteLayoutPos(note, hub) : { x: note.x, y: note.y };
    const d = dist2(hub, pos);
    if (d < bestDist) {
      bestDist = d;
      best = note;
      bestPos = pos;
    }
  }
  return { ...bestPos, id: best.id };
}

/** Farthest → nearest so index 0 (top of pile) is the farthest note. */
export function sortThemeNotesFarthestFirst(
  hub: { x: number; y: number },
  notes: CanvasNode[],
  options?: { preferExpandedOffsets?: boolean },
): CanvasNode[] {
  const preferExpanded = !!options?.preferExpandedOffsets;
  return notes.slice().sort((a, b) => {
    const pa = preferExpanded ? themeNoteLayoutPos(a, hub) : { x: a.x, y: a.y };
    const pb = preferExpanded ? themeNoteLayoutPos(b, hub) : { x: b.x, y: b.y };
    const d = dist2(hub, pb) - dist2(hub, pa);
    if (d !== 0) return d;
    return a.id.localeCompare(b.id);
  });
}

/** Stack in place around the nearest note; index 0 is the front (farthest) card. */
export function bookExpandBranchStackPos(
  base: { x: number; y: number },
  index: number,
  _hubHeight?: number,
): { x: number; y: number } {
  return {
    x: base.x + index * BOOK_EXPAND_STACK_STEP,
    y: base.y + index * BOOK_EXPAND_STACK_STEP,
  };
}

/** Higher z for lower index so farthest (index 0) sits on top of the deck. */
export function bookExpandStackZIndex(index: number): number {
  return 420 - index;
}

function resolveBookExpandExpandedPos(
  branch: CanvasNode,
  hub: { x: number; y: number },
  index: number,
  count: number,
  hubHeight: number,
): { x: number; y: number } {
  const ox = branch.bookExpandExpandedOffsetX;
  const oy = branch.bookExpandExpandedOffsetY;
  if (typeof ox === 'number' && typeof oy === 'number' && Number.isFinite(ox) && Number.isFinite(oy)) {
    return { x: hub.x + ox, y: hub.y + oy };
  }
  return {
    x: hub.x + BOOK_EXPAND_CHILD_OFFSET_X,
    y: bookExpandBranchLaneY(hub.y, index, count, hubHeight),
  };
}

/**
 * Collapse theme-linked notes into a photo stack at the nearest note
 * (farthest note on top), or expand back to saved positions.
 */
export async function setBookExpandBranchesCollapsed(
  hubId: string,
  collapsed: boolean,
  options?: {
    nodes?: CanvasNode[];
    edges?: Pick<Edge, 'from' | 'to'>[];
    hubHeight?: number;
  },
): Promise<number> {
  const hub = await db.nodes.get(hubId);
  if (!hub || hub.type !== 'theme') return 0;

  const nodes = options?.nodes ?? (await db.nodes.toArray());
  const edges = options?.edges ?? (await db.edges.toArray());
  const branches = resolveBookExpandBranches(hubId, nodes, edges);
  if (branches.length === 0) return 0;

  const hubHeight = options?.hubHeight ?? hub.height ?? BOOK_EXPAND_HUB_HEIGHT;

  await db.transaction('rw', db.nodes, async () => {
    const freshHub = (await db.nodes.get(hubId)) ?? hub;
    const hubPos = { x: freshHub.x, y: freshHub.y };
    const wasCollapsed = !!freshHub.bookExpandBranchesCollapsed;
    await db.nodes.update(hubId, { bookExpandBranchesCollapsed: collapsed });

    if (collapsed) {
      const live: CanvasNode[] = [];
      for (const listed of branches) {
        live.push((await db.nodes.get(listed.id)) ?? listed);
      }
      const preferExpanded = wasCollapsed;
      const anchor = pickThemeStackAnchor(hubPos, live, { preferExpandedOffsets: preferExpanded });
      const stackBase = { x: anchor.x, y: anchor.y };
      // Farthest first → front of pile (index 0, highest z).
      const stackOrder = sortThemeNotesFarthestFirst(hubPos, live, {
        preferExpandedOffsets: preferExpanded,
      });

      for (let i = 0; i < stackOrder.length; i++) {
        const branch = stackOrder[i]!;
        const stackPos = bookExpandBranchStackPos(stackBase, i);
        const keepOffsets =
          wasCollapsed &&
          typeof branch.bookExpandExpandedOffsetX === 'number' &&
          typeof branch.bookExpandExpandedOffsetY === 'number';
        await db.nodes.update(branch.id, {
          ...stackPos,
          bookExpandParentId: hubId,
          bookExpandIndex: i,
          ...(keepOffsets
            ? {}
            : {
                bookExpandExpandedOffsetX: branch.x - hubPos.x,
                bookExpandExpandedOffsetY: branch.y - hubPos.y,
              }),
        });
      }
    } else {
      for (let i = 0; i < branches.length; i++) {
        const listed = branches[i]!;
        const branch = (await db.nodes.get(listed.id)) ?? listed;
        const pos = resolveBookExpandExpandedPos(branch, hubPos, i, branches.length, hubHeight);
        await db.nodes.update(branch.id, {
          ...pos,
          bookExpandParentId: hubId,
          bookExpandIndex: i,
        });
      }
    }
  });
  return branches.length;
}

/** Bounding box for a hub + vertical branch lane (used for open-space search). */
export function bookExpandClusterSize(branchCount: number): { width: number; height: number } {
  const n = Math.max(1, branchCount);
  return {
    width: BOOK_EXPAND_HUB_WIDTH + BOOK_EXPAND_CHILD_OFFSET_X + BOOK_EXPAND_CHILD_WIDTH,
    height: Math.max(
      BOOK_EXPAND_HUB_HEIGHT,
      (n - 1) * BOOK_EXPAND_CHILD_GAP_Y + BOOK_EXPAND_CHILD_HEIGHT,
    ),
  };
}

/** Spoken line for one viewpoint card (title + content). */
export function spokenBookVoiceBranchLine(branch: BookExpandBranch): string {
  const title = branch.title.replace(/\s+/g, ' ').trim();
  const content = branch.content.replace(/\s+/g, ' ').trim();
  if (!title) return content;
  if (!content || content === title) {
    return /[。！？!?]$/.test(title) ? title : `${title}。`;
  }
  const body = /[。！？!?]$/.test(content) ? content : `${content}。`;
  return `${title}。${body}`;
}

/** Scope follows the book’s room, even when the pile sits just outside the rectangle. */
export async function resolveBookExpandWorkZoneScope(
  bookNodeId: string,
  canvasId: string,
  bookPos: { x: number; y: number; width?: number; height?: number },
): Promise<string | undefined> {
  if (!isCanvasV2Enabled()) return undefined;
  const [zones, stored] = await Promise.all([
    db.canvasWorkZones.where('canvasId').equals(canvasId).toArray(),
    db.nodes.get(bookNodeId),
  ]);
  const book: CanvasNode = stored ?? {
    id: bookNodeId,
    canvasId,
    type: 'book',
    content: '',
    x: bookPos.x,
    y: bookPos.y,
    width: bookPos.width,
    height: bookPos.height,
  };
  return findPersonaForNodeInZones(book, zones);
}

export async function spawnBookExpandHubCard(options: {
  bookNodeId: string;
  canvasId: string;
  bookPos: { x: number; y: number; width?: number; height?: number };
  hub: string;
  /** Absolute hub top-left; when omitted, place to the right of the book. */
  hubPos?: { x: number; y: number };
  collapsed?: boolean;
  wireEdge?: boolean;
  contextScopeAgentId?: string;
}): Promise<{ hubId: string; hubX: number; hubY: number }> {
  const { bookNodeId, canvasId, bookPos, hub } = options;
  const bookW = bookPos.width ?? 380;
  const bookH = bookPos.height ?? 520;
  const hubId = crypto.randomUUID();
  const hubX = options.hubPos?.x ?? bookPos.x + bookW + 48;
  const hubY =
    options.hubPos?.y ?? bookPos.y + Math.max(0, bookH / 2 - BOOK_EXPAND_HUB_HEIGHT / 2);

  await db.nodes.add(stampNewCard({
    id: hubId,
    canvasId,
    type: 'theme',
    content: hub,
    x: hubX,
    y: hubY,
    width: BOOK_EXPAND_HUB_WIDTH,
    height: BOOK_EXPAND_HUB_HEIGHT,
    bookExpandBranchesCollapsed: !!options.collapsed,
    ...(options.contextScopeAgentId
      ? { contextScopeAgentId: options.contextScopeAgentId }
      : {}),
  }));
  if (options.wireEdge !== false) {
    await db.edges.add({
      id: crypto.randomUUID(),
      canvasId,
      from: bookNodeId,
      to: hubId,
    });
  }
  return { hubId, hubX, hubY };
}

export async function spawnBookExpandBranchCard(options: {
  canvasId: string;
  hubId: string;
  hubX: number;
  hubY: number;
  branch: BookExpandBranch;
  index: number;
  branchCount: number;
  collapsed?: boolean;
  wireEdge?: boolean;
  contextScopeAgentId?: string;
}): Promise<string> {
  const { canvasId, hubId, hubX, hubY, branch, index, branchCount } = options;
  const id = crypto.randomUUID();
  const markdown = `**${branch.title}**\n\n${branch.content}`;
  const expandedX = hubX + BOOK_EXPAND_CHILD_OFFSET_X;
  const expandedY = bookExpandBranchLaneY(hubY, index, branchCount, BOOK_EXPAND_HUB_HEIGHT);
  const pos = options.collapsed
    ? bookExpandBranchStackPos(
        { x: hubX + BOOK_EXPAND_HUB_WIDTH + 16, y: hubY },
        index,
      )
    : { x: expandedX, y: expandedY };
  await db.nodes.add(stampNewCard({
    id,
    canvasId,
    type: 'text',
    content: markdown,
    ...pos,
    width: BOOK_EXPAND_CHILD_WIDTH,
    height: BOOK_EXPAND_CHILD_HEIGHT,
    bookExpandParentId: hubId,
    bookExpandIndex: index,
    ...(options.collapsed
      ? {
          bookExpandExpandedOffsetX: expandedX - hubX,
          bookExpandExpandedOffsetY: expandedY - hubY,
        }
      : {}),
    ...(options.contextScopeAgentId
      ? { contextScopeAgentId: options.contextScopeAgentId }
      : {}),
  }));
  if (options.wireEdge !== false) {
    await db.edges.add({
      id: crypto.randomUUID(),
      canvasId,
      from: hubId,
      to: id,
    });
  }
  return id;
}

/**
 * Spawn a theme hub + branch notes to the right of a book.
 * V2: collapsed pile, no auto edges, scope from the book’s work zone.
 * V1: expanded lane with book → hub → branch edges.
 */
export async function spawnBookExpandCards(options: {
  bookNodeId: string;
  canvasId: string;
  bookPos: { x: number; y: number; width?: number; height?: number };
  plan: BookExpandPlan;
  staggerMs?: number;
}): Promise<{ hubId: string; branchIds: string[] }> {
  const { bookNodeId, canvasId, bookPos, plan } = options;
  const staggerMs = options.staggerMs ?? DEFAULT_STAGGER_MS;
  const v2 = isCanvasV2Enabled();
  const contextScopeAgentId = v2
    ? await resolveBookExpandWorkZoneScope(bookNodeId, canvasId, bookPos)
    : undefined;

  const { hubId, hubX, hubY } = await spawnBookExpandHubCard({
    bookNodeId,
    canvasId,
    bookPos,
    hub: plan.hub,
    collapsed: v2,
    wireEdge: !v2,
    contextScopeAgentId,
  });

  const branchIds: string[] = [];
  for (let i = 0; i < plan.branches.length; i++) {
    if (i > 0) {
      await new Promise((r) => setTimeout(r, staggerMs));
    }
    const id = await spawnBookExpandBranchCard({
      canvasId,
      hubId,
      hubX,
      hubY,
      branch: plan.branches[i]!,
      index: i,
      branchCount: plan.branches.length,
      collapsed: v2,
      wireEdge: !v2,
      contextScopeAgentId,
    });
    branchIds.push(id);
  }

  return { hubId, branchIds };
}
