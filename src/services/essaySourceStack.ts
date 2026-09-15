import { db, type CanvasNode } from '../db';
import { tryParseEssayContent, ESSAY_NODE_SIZE } from '../utils/essayPayload';

/** Photo-pile offset so later cards peek bottom-right under the first source. */
export const ESSAY_SOURCE_STACK_STEP = 5;
/** Sit the pile just to the right of the essay so the hub (and toggle) stay visible. */
export const ESSAY_SOURCE_STACK_GAP_X = 16;

export function uniqueEssaySourceNodeIds(ids: Array<string | undefined | null>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = (raw ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function listEssaySourceNodes(essay: CanvasNode, nodes: CanvasNode[]): CanvasNode[] {
  const canvasId = essay.canvasId ?? 'default';
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ordered = essay.essaySourceNodeIds ?? [];
  const listed: CanvasNode[] = [];
  for (const id of ordered) {
    if (id === essay.id) continue;
    const node = byId.get(id);
    if (!node) continue;
    if ((node.canvasId ?? 'default') !== canvasId) continue;
    listed.push(node);
  }
  return listed;
}

export function essaySourceStackIndex(essay: CanvasNode, sourceId: string): number {
  const i = (essay.essaySourceNodeIds ?? []).indexOf(sourceId);
  return i >= 0 ? i : 0;
}

/** Higher z for earlier sources so the first generated card sits on top. */
export function essaySourceStackZIndex(index: number): number {
  return 420 - index;
}

export function essaySourceStackPos(
  essay: { x: number; y: number; width?: number },
  index: number,
): { x: number; y: number } {
  const width = essay.width && essay.width > 0 ? essay.width : ESSAY_NODE_SIZE.width;
  return {
    x: essay.x + width + ESSAY_SOURCE_STACK_GAP_X + index * ESSAY_SOURCE_STACK_STEP,
    y: essay.y + index * ESSAY_SOURCE_STACK_STEP,
  };
}

export async function resolveEssaySourceNodeIds(essay: CanvasNode): Promise<string[]> {
  if (essay.essaySourceNodeIds && essay.essaySourceNodeIds.length > 0) {
    return uniqueEssaySourceNodeIds(essay.essaySourceNodeIds);
  }
  const articleId = tryParseEssayContent(essay.content)?.articleId;
  if (!articleId) return [];
  const article = await db.articles.get(articleId);
  return uniqueEssaySourceNodeIds((article?.sourceCards ?? []).map((s) => s.nodeId));
}

/**
 * Collapse essay source cards (hide on canvas), or expand them in a pile beside the essay.
 */
export async function setEssaySourcesCollapsed(
  essayId: string,
  collapsed: boolean,
  options?: {
    nodes?: CanvasNode[];
    anchorHeight?: number;
  },
): Promise<number> {
  const essay = (options?.nodes?.find((n) => n.id === essayId) ?? (await db.nodes.get(essayId))) as
    | CanvasNode
    | undefined;
  if (!essay || essay.type !== 'essay') return 0;

  const sourceIds = await resolveEssaySourceNodeIds(essay);
  const nodes = options?.nodes ?? (await db.nodes.toArray());
  const sources = listEssaySourceNodes({ ...essay, essaySourceNodeIds: sourceIds }, nodes);
  if (sources.length === 0) {
    await db.nodes.update(essayId, {
      essaySourceNodeIds: sourceIds,
      essaySourcesCollapsed: false,
    });
    return 0;
  }

  await db.transaction('rw', db.nodes, async () => {
    const fresh = (await db.nodes.get(essayId)) ?? essay;
    const base = { x: fresh.x, y: fresh.y, width: fresh.width };
    await db.nodes.update(essayId, {
      essaySourceNodeIds: sourceIds,
      essaySourcesCollapsed: collapsed,
    });
    for (let i = 0; i < sources.length; i++) {
      const listed = sources[i]!;
      const source = (await db.nodes.get(listed.id)) ?? listed;
      if (collapsed) {
        await db.nodes.update(source.id, {
          essaySourceParentId: essayId,
          essaySourceIndex: i,
        });
      } else {
        const stackPos = essaySourceStackPos({ ...base, width: fresh.width }, i);
        await db.nodes.update(source.id, {
          ...stackPos,
          essaySourceParentId: essayId,
          essaySourceIndex: i,
          essaySourceExpandedOffsetX: stackPos.x - base.x,
          essaySourceExpandedOffsetY: stackPos.y - base.y,
        });
      }
    }
  });
  return sources.length;
}

let essaySourceBackfillStarted = false;

/** Copy article.sourceCards order onto existing essay hubs once. */
export async function backfillEssaySourceNodeIds(): Promise<void> {
  if (essaySourceBackfillStarted) return;
  essaySourceBackfillStarted = true;
  const essays = await db.nodes.where('type').equals('essay').toArray();
  for (const essay of essays) {
    if (essay.essaySourceNodeIds) continue;
    const ids = await resolveEssaySourceNodeIds(essay);
    await db.nodes.update(essay.id, { essaySourceNodeIds: ids });
  }
}

export function resetEssaySourceBackfillForTests(): void {
  essaySourceBackfillStarted = false;
}
