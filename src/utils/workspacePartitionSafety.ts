import { db, type Canvas, type CanvasNode } from '../db';
import type { WorkspaceSnapshot } from './mergeCloudWorkspace';
import { normalizeCanvasId } from './mergeCloudWorkspace';

export const RECOVERY_ACTIVE_PREFIX = '__recovery__:active:';
export const RECOVERY_ANONYMOUS_PREFIX = '__recovery__:anonymous:';
export const RECOVERY_INCOMING_PREFIX = '__recovery__:incoming:';

const RECOVERY_KEEP_LIMIT = 12;

export class WorkspaceMergeSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceMergeSafetyError';
  }
}

type CountableSnapshot = WorkspaceSnapshot & {
  canvasTemplates?: Array<{ id: string }>;
};

function snapshotCounts(snapshot: CountableSnapshot) {
  return {
    canvases: snapshot.canvases.length,
    nodes: snapshot.nodes.length,
    edges: snapshot.edges.length,
    articles: snapshot.articles.length,
    agents: snapshot.agents.length,
    sandboxThreads: snapshot.sandboxThreads.length,
    archivedCards: snapshot.archivedCards.length,
    archiveFolders: snapshot.archiveFolders.length,
    canvasFolders: snapshot.canvasFolders.length,
    workZones: snapshot.workZones.length,
    personaThreads: snapshot.personaThreads.length,
    canvasTemplates: snapshot.canvasTemplates?.length ?? 0,
  };
}

function nodePreservationKey(node: CanvasNode): string {
  return [
    node.type,
    node.content ?? '',
    node.description ?? '',
    normalizeCanvasId(node.canvasId),
  ].join('\0');
}

function nodeContentKey(node: CanvasNode): string {
  return [node.type, node.content ?? '', node.description ?? ''].join('\0');
}

function incomingHasCanvasWork(snapshot: CountableSnapshot, canvasId: string): boolean {
  const normalized = normalizeCanvasId(canvasId);
  const usesCanvas = (id?: string | null) => normalizeCanvasId(id) === normalized;
  return (
    snapshot.nodes.some((node) => usesCanvas(node.canvasId)) ||
    snapshot.edges.some((edge) => usesCanvas(edge.canvasId)) ||
    snapshot.workZones.some((zone) => usesCanvas(zone.canvasId)) ||
    snapshot.personaThreads.some((thread) => usesCanvas(thread.canvasId)) ||
    snapshot.archivedCards.some((row) => row.sourceCanvasId && usesCanvas(row.sourceCanvasId))
  );
}

function incomingCanvasPreserved(
  canvas: Canvas,
  source: CountableSnapshot,
  merged: CountableSnapshot,
): boolean {
  if (merged.canvases.some((row) => String(row.id) === String(canvas.id))) return true;
  if (!incomingHasCanvasWork(source, canvas.id)) return true;

  const canvasNodes = source.nodes.filter(
    (node) => normalizeCanvasId(node.canvasId) === normalizeCanvasId(canvas.id),
  );
  if (canvasNodes.length === 0) return true;

  const mergedByContent = new Set(merged.nodes.map(nodeContentKey));
  if (canvasNodes.every((node) => mergedByContent.has(nodeContentKey(node)))) return true;

  const namesToMatch = new Set<string>([canvas.name]);
  if (canvas.name.endsWith(' (2)')) namesToMatch.add(canvas.name.replace(/ \(\d+\)$/, ''));

  return merged.canvases.some((row) => namesToMatch.has(row.name));
}

function incomingNodePreserved(node: CanvasNode, merged: CountableSnapshot): boolean {
  if (merged.nodes.some((row) => row.id === node.id)) return true;

  const fullKey = nodePreservationKey(node);
  if (merged.nodes.some((row) => nodePreservationKey(row) === fullKey)) return true;

  const contentKey = nodeContentKey(node);
  return merged.nodes.some((row) => nodeContentKey(row) === contentKey);
}

/** Throws before any destructive write when merge would drop rows. */
export function assertMergePreservesWorkspace(
  base: CountableSnapshot,
  incomingSources: CountableSnapshot[],
  merged: CountableSnapshot,
): void {
  for (const node of base.nodes) {
    if (!merged.nodes.some((row) => row.id === node.id)) {
      throw new WorkspaceMergeSafetyError(`merge would drop active node ${node.id}`);
    }
  }

  for (const canvas of base.canvases) {
    if (!merged.canvases.some((row) => row.id === canvas.id)) {
      throw new WorkspaceMergeSafetyError(`merge would drop active canvas ${canvas.id}`);
    }
  }

  const baseCounts = snapshotCounts(base);
  const mergedCounts = snapshotCounts(merged);
  for (const [table, count] of Object.entries(baseCounts)) {
    const mergedCount = mergedCounts[table as keyof typeof mergedCounts];
    if (mergedCount < count) {
      throw new WorkspaceMergeSafetyError(
        `merge would shrink ${table}: ${count} -> ${mergedCount}`,
      );
    }
  }

  for (const source of incomingSources) {
    for (const node of source.nodes) {
      if (!incomingNodePreserved(node, merged)) {
        throw new WorkspaceMergeSafetyError(`merge would drop incoming node ${node.id}`);
      }
    }

    for (const canvas of source.canvases) {
      if (!incomingCanvasPreserved(canvas, source, merged)) {
        throw new WorkspaceMergeSafetyError(`merge would drop incoming canvas ${canvas.id}`);
      }
    }
  }
}

export function isRecoveryPartitionOwner(ownerId: string): boolean {
  return (
    ownerId.startsWith(RECOVERY_ACTIVE_PREFIX) ||
    ownerId.startsWith(RECOVERY_ANONYMOUS_PREFIX) ||
    ownerId.startsWith(RECOVERY_INCOMING_PREFIX)
  );
}

function recoveryKey(prefix: string, tag: string): string {
  return `${prefix}${tag}:${Date.now()}`;
}

async function pruneRecoveryBackups(prefix: string, keep = RECOVERY_KEEP_LIMIT): Promise<void> {
  const rows = (await db.workspacePartitions.toArray())
    .filter((row) => row.ownerId.startsWith(prefix))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  for (const row of rows.slice(keep)) {
    await db.workspacePartitions.delete(row.ownerId);
  }
}

/** Persist a point-in-time snapshot before any destructive merge. Never overwrites. */
export async function persistRecoveryBackup(
  prefix: string,
  tag: string,
  snapshot: CountableSnapshot,
): Promise<string> {
  const ownerId = recoveryKey(prefix, tag);
  await db.workspacePartitions.put({
    ownerId,
    snapshot,
    updatedAt: Date.now(),
  });
  await pruneRecoveryBackups(prefix);
  return ownerId;
}

export async function listRecoveryPartitionBackups(): Promise<
  Array<{ ownerId: string; updatedAt: number }>
> {
  return (await db.workspacePartitions.toArray())
    .filter((row) => isRecoveryPartitionOwner(row.ownerId))
    .map((row) => ({ ownerId: row.ownerId, updatedAt: row.updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
