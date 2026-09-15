import { db } from '../db';
import i18n from '../i18n';
import { defaultWorkspaceAmbiencePosition } from '../constants/defaultWorkspace';
import {
  AMBIENCE_NODE_SIZE,
  DEFAULT_AMBIENCE_PAYLOAD,
  encodeAmbienceContent,
} from './ambiencePayload';
import { estimateNodeRect, rectsOverlap } from './canvas';
import { stampNewCard } from './stampNewCard';

export const AMBIENCE_NODE_TYPE = 'ambience';

const AMBIENCE_HIDDEN_KEY = 'spoor.ambience.hidden';
/** Keep ambience clear of starter cards on short viewports. */
const AMBIENCE_CLEARANCE_GAP = 48;
const STARTER_TYPES = new Set(['ask', 'theme', 'note']);

/** In-flight ensure per canvas — Strict Mode / fast remount must not double-insert. */
const ensureInflight = new Map<string, Promise<string | null>>();

export function isAmbienceFixtureNode(type: string | undefined): boolean {
  return type === AMBIENCE_NODE_TYPE;
}

function readHiddenMap(): Record<string, true> {
  try {
    const raw = localStorage.getItem(AMBIENCE_HIDDEN_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, true>;
  } catch {
    return {};
  }
}

export function isAmbienceHiddenForCanvas(canvasId: string): boolean {
  return Boolean(readHiddenMap()[canvasId]);
}

export function setAmbienceHiddenForCanvas(canvasId: string, hidden: boolean): void {
  const map = readHiddenMap();
  if (hidden) map[canvasId] = true;
  else delete map[canvasId];
  localStorage.setItem(AMBIENCE_HIDDEN_KEY, JSON.stringify(map));
}

/** Stable-ish corner placement so the player sits like canvas chrome, not content. */
export function ambienceFixturePosition(transform: {
  x: number;
  y: number;
  scale: number;
}): { x: number; y: number } {
  const scale = transform.scale || 1;
  const viewH = typeof window !== 'undefined' ? window.innerHeight : 800;
  return {
    x: (-transform.x) / scale + 28,
    y: (-transform.y) / scale + viewH / scale - AMBIENCE_NODE_SIZE.height - 96,
  };
}

async function listAmbienceNodes(canvasId: string) {
  const onCanvas = await db.nodes
    .where('canvasId')
    .equals(canvasId)
    .filter((n) => n.type === AMBIENCE_NODE_TYPE)
    .toArray();
  if (canvasId !== 'default') return onCanvas;
  const legacy = (await db.nodes.toArray()).filter(
    (n) =>
      n.type === AMBIENCE_NODE_TYPE &&
      (n.canvasId == null || n.canvasId === 'default') &&
      !onCanvas.some((x) => x.id === n.id),
  );
  return [...onCanvas, ...legacy];
}

async function listNonAmbienceNodes(canvasId: string) {
  return (await db.nodes.where('canvasId').equals(canvasId).toArray()).filter(
    (n) => n.type !== AMBIENCE_NODE_TYPE,
  );
}

function ambienceOverlapsNodes(
  pos: { x: number; y: number },
  others: Array<{ type: string; x: number; y: number; width?: number; height?: number }>,
): boolean {
  const amb = {
    x: pos.x,
    y: pos.y,
    width: AMBIENCE_NODE_SIZE.width,
    height: AMBIENCE_NODE_SIZE.height,
  };
  return others.some((n) => rectsOverlap(amb, estimateNodeRect(n), AMBIENCE_CLEARANCE_GAP));
}

/** Prefer an explicit seed spot; otherwise drop below the starter row when the corner collides. */
function resolveAmbienceSpawnPosition(
  preferred: { x: number; y: number } | undefined,
  transform: { x: number; y: number; scale: number },
  others: Array<{ type: string; x: number; y: number; width?: number; height?: number }>,
): { x: number; y: number } {
  if (preferred) return { x: preferred.x, y: Math.max(24, preferred.y) };
  const corner = ambienceFixturePosition(transform);
  const cornerPos = { x: corner.x, y: Math.max(24, corner.y) };
  if (others.length === 0 || !ambienceOverlapsNodes(cornerPos, others)) return cornerPos;
  const safe = defaultWorkspaceAmbiencePosition();
  return { x: safe.x, y: Math.max(24, safe.y) };
}

/**
 * Ensure the active canvas has at most one ambience fixture card.
 * Returns the kept node id, or null when the user dismissed it and none exist.
 *
 * Pass `skip: true` for canvases that should not have an ambience fixture at
 * all (e.g. templates / listings that ship with their own complete cast). In
 * that case existing ambience nodes are removed and the function returns null.
 */
export async function ensureAmbienceNodeForCanvas(opts: {
  canvasId: string;
  transform?: { x: number; y: number; scale: number };
  /** Explicit world position (blank / default workspace seed). */
  position?: { x: number; y: number };
  /** Ignore dismiss flag and (re)create if missing — toolbar restore. */
  force?: boolean;
  /** Do not create an ambience node on this canvas; remove any existing one. */
  skip?: boolean;
}): Promise<string | null> {
  const pending = ensureInflight.get(opts.canvasId);
  if (pending) return pending;

  const run = (async (): Promise<string | null> => {
    if (opts.skip) {
      const existing = await listAmbienceNodes(opts.canvasId);
      if (existing.length > 0) {
        await db.nodes.bulkDelete(existing.map((n) => n.id));
      }
      setAmbienceHiddenForCanvas(opts.canvasId, true);
      return null;
    }

    const all = await listAmbienceNodes(opts.canvasId);
    const [keep, ...dupes] = all;
    if (dupes.length > 0) {
      await db.nodes.bulkDelete(dupes.map((n) => n.id));
    }

    const others = await listNonAmbienceNodes(opts.canvasId);
    const transform = opts.transform ?? { x: 0, y: 0, scale: 1 };

    if (keep) {
      const patch: { canvasId?: string; width?: number; height?: number; x?: number; y?: number } = {};
      if (!keep.canvasId) patch.canvasId = opts.canvasId;
      if (keep.width !== AMBIENCE_NODE_SIZE.width) patch.width = AMBIENCE_NODE_SIZE.width;
      if (keep.height !== AMBIENCE_NODE_SIZE.height) patch.height = AMBIENCE_NODE_SIZE.height;

      if (opts.position) {
        patch.x = opts.position.x;
        patch.y = Math.max(24, opts.position.y);
      } else if (
        others.length > 0 &&
        others.length <= 3 &&
        others.every((n) => STARTER_TYPES.has(n.type)) &&
        ambienceOverlapsNodes({ x: keep.x, y: keep.y }, others)
      ) {
        // Virgin blank/default starters only — nudge ambience out from under 阿狸.
        const safe = defaultWorkspaceAmbiencePosition();
        patch.x = safe.x;
        patch.y = Math.max(24, safe.y);
      }

      if (Object.keys(patch).length > 0) await db.nodes.update(keep.id, patch);
      if (opts.force) setAmbienceHiddenForCanvas(opts.canvasId, false);
      return keep.id;
    }

    if (!opts.force && isAmbienceHiddenForCanvas(opts.canvasId)) {
      return null;
    }

    if (opts.force) setAmbienceHiddenForCanvas(opts.canvasId, false);

    const pos = resolveAmbienceSpawnPosition(opts.position, transform, others);
    const id = crypto.randomUUID();
    await db.nodes.add(
      stampNewCard({
        id,
        canvasId: opts.canvasId,
        type: AMBIENCE_NODE_TYPE,
        content: encodeAmbienceContent({ ...DEFAULT_AMBIENCE_PAYLOAD }),
        description: i18n.t('ambience.card_title'),
        x: pos.x,
        y: pos.y,
        width: AMBIENCE_NODE_SIZE.width,
        height: AMBIENCE_NODE_SIZE.height,
      }),
    );
    return id;
  })();

  ensureInflight.set(opts.canvasId, run);
  try {
    return await run;
  } finally {
    ensureInflight.delete(opts.canvasId);
  }
}
