/** Helpers for the Canvas Template system: instantiating from data + small scale utils. */
import i18n from '../i18n';
import { db } from '../db';
import { nextCanvasSortOrder } from './canvasHistoryFolders';
import type {
  CanvasNode,
  CanvasTemplateDoc,
  Edge,
  TemplateEdge,
  TemplateNode,
} from '../db';
import { BUILTIN_CANVAS_TEMPLATES } from '../constants/builtInCanvasTemplates';
import { stampNewCard } from './stampNewCard';
import { ensureAmbienceNodeForCanvas } from './ensureAmbienceNode';

const t = (key: string) => i18n.t(key);

/** Reference design canvas dimensions used to author templates. */
export const TEMPLATE_DESIGN_WIDTH = 1200;
export const TEMPLATE_DESIGN_HEIGHT = 800;

export interface MaterializeAxis {
  width: number;
  height: number;
}

const DEFAULT_MATERIALIZE_AXIS: MaterializeAxis = {
  width: TEMPLATE_DESIGN_WIDTH,
  height: TEMPLATE_DESIGN_HEIGHT,
};

/**
 * Round a 0..1 design-canvas fraction to a pixel offset on the runtime canvas.
 * Values outside [0,1] are clamped so a slightly-bad template still spawns safely.
 */
export function scaleFractionToViewport(frac01: number, axisSize: number): number {
  if (!Number.isFinite(frac01) || !Number.isFinite(axisSize)) return 0;
  const clamped = Math.max(0, Math.min(1, frac01));
  return Math.round(clamped * axisSize);
}

/** Built-in templates shown as defaults in Agents Studio. Hidden templates stay spawnable by key. */
export function getSystemCanvasTemplates(): readonly CanvasTemplateDoc[] {
  return BUILTIN_CANVAS_TEMPLATES.filter((tpl) => tpl.listed !== false);
}

/**
 * Look up a built-in template by `builtinKey` (e.g. `'cosmos'`). Returns
 * `undefined` if no built-in matches — callers should fall back gracefully.
 */
export function getSystemCanvasTemplateByKey(
  builtinKey: string,
): CanvasTemplateDoc | undefined {
  return BUILTIN_CANVAS_TEMPLATES.find((tpl) => tpl.builtinKey === builtinKey);
}

/**
 * Resolve the content string for a `TemplateNode`. Order:
 * 1. `contentKey` — i18n lookup (returns the key itself if missing, so it's visible).
 * 2. `contentText` — literal fallback (user-typed text).
 */
function resolveTemplateNodeContent(node: TemplateNode): string {
  if (node.contentKey) {
    const translated = t(node.contentKey);
    // i18next returns the key unchanged on miss; that's still useful, but a
    // user-supplied contentText wins for non-system templates.
    if (translated && translated !== node.contentKey) return String(translated);
  }
  return node.contentText ?? '';
}

function resolveTemplateEdgeNote(edge: TemplateEdge): string | undefined {
  if (edge.noteKey) {
    const translated = t(edge.noteKey);
    if (translated && translated !== edge.noteKey) return String(translated);
  }
  return edge.noteText;
}

export interface MaterializedTemplate {
  nodes: CanvasNode[];
  edges: Edge[];
}

export interface MaterializeOptions {
  axis?: MaterializeAxis;
  /**
   * Optional id prefix for spawned nodes. When provided, each node's id is
   * `${idPrefix}${templateNode.key}`. Useful for systems that identify
   * template-spawned nodes by suffix (e.g. cosmos canvas pruning).
   * Default: a fresh UUID per node.
   */
  idPrefix?: string;
}

/**
 * Build the actual `CanvasNode[]` + `Edge[]` from a template, ready to write
 * into IndexedDB under `canvasId`.
 *
 * - Each template node gets a fresh UUID (or `${idPrefix}${key}` if provided).
 * - Each template edge's `fromKey`/`toKey` are remapped to those ids.
 * - Position fractions are scaled via `axis.width / axis.height` (defaults to 1200×800,
 *   preserving the original cosmos layout exactly).
 * - `content` is filled by i18n lookup of `contentKey`, falling back to `contentText`.
 */
export function materilizeTemplateForCanvas(
  template: CanvasTemplateDoc,
  canvasId: string,
  options: MaterializeOptions = {},
): MaterializedTemplate {
  const { axis = DEFAULT_MATERIALIZE_AXIS, idPrefix } = options;
  const { width, height } = axis;

  const keyToNodeId = new Map<string, string>();
  const spawnedNodes: CanvasNode[] = template.nodes.map((n) => {
    const id = idPrefix ? `${idPrefix}${n.key}` : crypto.randomUUID();
    keyToNodeId.set(n.key, id);
    const node: CanvasNode = {
      id,
      canvasId,
      type: n.type,
      // Stamp the template-local key so UI (e.g. canvas onboarding tours)
      // can target the original template cards even after their UUIDs are
      // remapped during community listing apply.
      templateKey: n.key,
      x: scaleFractionToViewport(n.xFrac, width),
      y: scaleFractionToViewport(n.yFrac, height),
    };
    if (n.type === 'theme' || n.type === 'note') {
      node.content = resolveTemplateNodeContent(n);
    }
    if (n.type === 'theme' && n.descriptionText) {
      node.description = n.descriptionText;
    }
    if (n.type === 'agent' && n.agentConfigId) {
      node.agentConfigId = n.agentConfigId;
    }
    if (n.wFrac !== undefined) {
      node.width = scaleFractionToViewport(n.wFrac, width);
    }
    if (n.hFrac !== undefined) {
      node.height = scaleFractionToViewport(n.hFrac, height);
    }
    return stampNewCard(node);
  });

  const spawnedEdges: Edge[] = template.edges.flatMap((e): Edge[] => {
    const from = keyToNodeId.get(e.fromKey);
    const to = keyToNodeId.get(e.toKey);
    if (!from || !to) return [];
    const note = resolveTemplateEdgeNote(e);
    const spawned: Edge = {
      id: crypto.randomUUID(),
      canvasId,
      from,
      to,
      ...(note ? { note } : {}),
    };
    return [spawned];
  });

  return { nodes: spawnedNodes, edges: spawnedEdges };
}

/**
 * Convert an existing canvas row's runtime coords back into design-canvas
 * fractions. Useful when "snapshot this canvas as a template" features
 * are added later — not used by the spawn-from-template flow.
 */
export function canvasNodeToTemplateFraction(
  node: Pick<CanvasNode, 'x' | 'y' | 'width' | 'height'>,
  axis: MaterializeAxis = DEFAULT_MATERIALIZE_AXIS,
): { xFrac: number; yFrac: number; wFrac?: number; hFrac?: number } {
  const { width, height } = axis;
  const result = {
    xFrac: width > 0 ? node.x / width : 0,
    yFrac: height > 0 ? node.y / height : 0,
    ...(node.width !== undefined ? { wFrac: width > 0 ? node.width / width : 0 } : {}),
    ...(node.height !== undefined ? { hFrac: height > 0 ? node.height / height : 0 } : {}),
  };
  return result;
}

/** Merge the theme-howto card body into the template meta description for editing. */
export function enrichTemplateDescriptionFromHowto(template: CanvasTemplateDoc): CanvasTemplateDoc {
  const howto = template.nodes.find((n) => n.key === 'theme-howto' && n.type === 'theme');
  const body = howto?.descriptionText?.trim();
  if (!body) return template;

  const short = (template.description ?? '').trim();
  if (short.includes(body)) return template;

  const title = howto?.contentText?.trim();
  const howtoBlock = title ? `${title}\n\n${body}` : body;
  const description = short ? `${short}\n\n${howtoBlock}` : howtoBlock;
  return { ...template, description };
}

/** Community game templates omit the default Ask card — skip ambience when spawning them. */
export function shouldSkipAmbienceForTemplate(template: CanvasTemplateDoc): boolean {
  return template.nodes.some((n) => n.type === 'agent') && !template.nodes.some((n) => n.type === 'ask');
}

/** Instantiate a fresh canvas row + nodes/edges from a stored template doc. */
export async function spawnCanvasFromTemplate(
  template: CanvasTemplateDoc,
  options?: {
    canvasName?: string;
    skipAmbience?: boolean;
  },
): Promise<string> {
  const newCanvasId = crypto.randomUUID();
  const sortOrder = await nextCanvasSortOrder();
  await db.canvases.add({
    id: newCanvasId,
    name: options?.canvasName ?? template.name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    template: template.builtinKey === 'cosmos' ? 'cosmos' : 'blank',
    sortOrder,
  });
  const { nodes, edges } = materilizeTemplateForCanvas(template, newCanvasId);
  await db.transaction('rw', db.nodes, db.edges, async () => {
    await db.nodes.bulkPut(nodes);
    await db.edges.bulkPut(edges);
  });
  await ensureAmbienceNodeForCanvas({
    canvasId: newCanvasId,
    skip: options?.skipAmbience ?? shouldSkipAmbienceForTemplate(template),
  });
  return newCanvasId;
}

/** Persist a freshly-minted user template row. */
export async function saveUserCanvasTemplate(
  template: Omit<CanvasTemplateDoc, 'id' | 'origin' | 'builtinKey' | 'createdAt' | 'updatedAt'>,
): Promise<CanvasTemplateDoc> {
  const now = Date.now();
  const row: CanvasTemplateDoc = {
    ...template,
    id: crypto.randomUUID(),
    origin: 'user',
    builtinKey: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.canvasTemplates.put(row);
  return row;
}

export async function updateUserCanvasTemplate(
  id: string,
  patch: Partial<Omit<CanvasTemplateDoc, 'id' | 'origin' | 'builtinKey' | 'createdAt'>>,
): Promise<void> {
  await db.canvasTemplates.update(id, { ...patch, updatedAt: Date.now() });
}

export async function deleteUserCanvasTemplate(id: string): Promise<void> {
  // Only user templates may be deleted; guard against accidentally
  // removing a `builtinKey: 'cosmos'` row (shouldn't exist in user space anyway).
  const row = await db.canvasTemplates.get(id);
  if (!row || row.origin !== 'user') return;
  await db.canvasTemplates.delete(id);
}

/**
 * Clone a (usually built-in) template into the user's table so they can
 * edit it freely. Returns the new user template row.
 */
export async function cloneCanvasTemplateForUser(
  source: CanvasTemplateDoc,
  overrides?: { name?: string; description?: string },
): Promise<CanvasTemplateDoc> {
  return saveUserCanvasTemplate({
    name: overrides?.name ?? source.name,
    description: overrides?.description ?? source.description,
    personaIds: [...source.personaIds],
    nodes: source.nodes.map((n) => ({ ...n })),
    edges: source.edges.map((e) => ({ ...e })),
  });
}
