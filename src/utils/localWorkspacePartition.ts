import { db, type Canvas, type CanvasTemplateDoc, type WorkspacePartitionRecord } from '../db';
import { personaThreadId } from './agentWorkZone';
import { mergeLocalOntoCloud, normalizeCanvasId, type WorkspaceSnapshot } from './mergeCloudWorkspace';
import { withoutSyncHooks } from './syncHookGuard';
import {
  assertMergePreservesWorkspace,
  persistRecoveryBackup,
  RECOVERY_ACTIVE_PREFIX,
  RECOVERY_INCOMING_PREFIX,
} from './workspacePartitionSafety';

const DEFAULT_CANVAS_ID = 'default';

export const ANONYMOUS_WORKSPACE_OWNER = '__anonymous__';

type PartitionSnapshot = WorkspaceSnapshot & {
  canvasTemplates: CanvasTemplateDoc[];
};

const EMPTY_SNAPSHOT: PartitionSnapshot = {
  canvases: [],
  nodes: [],
  edges: [],
  articles: [],
  agents: [],
  sandboxThreads: [],
  archivedCards: [],
  archiveFolders: [],
  canvasFolders: [],
  workZones: [],
  personaThreads: [],
  canvasTemplates: [],
};

const ACTIVE_TABLES = [
  db.canvases,
  db.nodes,
  db.edges,
  db.articles,
  db.agents,
  db.agentSandboxThreads,
  db.archivedCards,
  db.archiveFolders,
  db.canvasFolders,
  db.canvasWorkZones,
  db.canvasPersonaThreads,
  db.canvasTemplates,
] as const;

async function readActiveSnapshot(): Promise<PartitionSnapshot> {
  const [
    canvases,
    nodes,
    edges,
    articles,
    agents,
    sandboxThreads,
    archivedCards,
    archiveFolders,
    canvasFolders,
    workZones,
    personaThreads,
    canvasTemplates,
  ] = await Promise.all([
    db.canvases.toArray(),
    db.nodes.toArray(),
    db.edges.toArray(),
    db.articles.toArray(),
    db.agents.toArray(),
    db.agentSandboxThreads.toArray(),
    db.archivedCards.toArray(),
    db.archiveFolders.toArray(),
    db.canvasFolders.toArray(),
    db.canvasWorkZones.toArray(),
    db.canvasPersonaThreads.toArray(),
    db.canvasTemplates.toArray(),
  ]);
  return {
    canvases,
    nodes,
    edges,
    articles,
    agents,
    sandboxThreads,
    archivedCards,
    archiveFolders,
    canvasFolders,
    workZones,
    personaThreads,
    canvasTemplates,
  };
}

function parseSnapshot(record: WorkspacePartitionRecord | undefined): PartitionSnapshot {
  if (!record?.snapshot || typeof record.snapshot !== 'object') return EMPTY_SNAPSHOT;
  const candidate = record.snapshot as Partial<PartitionSnapshot>;
  return {
    canvases: candidate.canvases ?? [],
    nodes: candidate.nodes ?? [],
    edges: candidate.edges ?? [],
    articles: candidate.articles ?? [],
    agents: candidate.agents ?? [],
    sandboxThreads: candidate.sandboxThreads ?? [],
    archivedCards: candidate.archivedCards ?? [],
    archiveFolders: candidate.archiveFolders ?? [],
    canvasFolders: candidate.canvasFolders ?? [],
    workZones: candidate.workZones ?? [],
    personaThreads: candidate.personaThreads ?? [],
    canvasTemplates: candidate.canvasTemplates ?? [],
  };
}

async function replaceActiveSnapshot(snapshot: PartitionSnapshot): Promise<void> {
  await Promise.all(ACTIVE_TABLES.map((table) => table.clear()));
  await Promise.all([
    snapshot.canvases.length ? db.canvases.bulkPut(snapshot.canvases) : Promise.resolve(),
    snapshot.nodes.length ? db.nodes.bulkPut(snapshot.nodes) : Promise.resolve(),
    snapshot.edges.length ? db.edges.bulkPut(snapshot.edges) : Promise.resolve(),
    snapshot.articles.length ? db.articles.bulkPut(snapshot.articles) : Promise.resolve(),
    snapshot.agents.length ? db.agents.bulkPut(snapshot.agents) : Promise.resolve(),
    snapshot.sandboxThreads.length
      ? db.agentSandboxThreads.bulkPut(snapshot.sandboxThreads)
      : Promise.resolve(),
    snapshot.archivedCards.length
      ? db.archivedCards.bulkPut(snapshot.archivedCards)
      : Promise.resolve(),
    snapshot.archiveFolders.length
      ? db.archiveFolders.bulkPut(snapshot.archiveFolders)
      : Promise.resolve(),
    snapshot.canvasFolders.length
      ? db.canvasFolders.bulkPut(snapshot.canvasFolders)
      : Promise.resolve(),
    snapshot.workZones.length
      ? db.canvasWorkZones.bulkPut(snapshot.workZones)
      : Promise.resolve(),
    snapshot.personaThreads.length
      ? db.canvasPersonaThreads.bulkPut(snapshot.personaThreads)
      : Promise.resolve(),
    snapshot.canvasTemplates.length
      ? db.canvasTemplates.bulkPut(snapshot.canvasTemplates)
      : Promise.resolve(),
  ]);
}

export async function getActiveWorkspaceOwner(): Promise<string | null> {
  return (await db.workspaceState.get('activeOwner'))?.value ?? null;
}

function unionById<T>(base: T[], extra: T[], idOf: (row: T) => string): T[] {
  const map = new Map<string, T>();
  for (const row of base) map.set(String(idOf(row)), row);
  for (const row of extra) {
    const id = String(idOf(row));
    if (!map.has(id)) map.set(id, row);
  }
  return [...map.values()];
}

function incomingHasCanvasWork(snapshot: PartitionSnapshot, canvasId: string): boolean {
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

function remapSnapshotCanvasIds(
  snapshot: PartitionSnapshot,
  idMap: Map<string, string>,
): PartitionSnapshot {
  if (idMap.size === 0) return snapshot;

  const mapCanvasId = (canvasId?: string | null): string | undefined => {
    if (!canvasId) return canvasId;
    return idMap.get(normalizeCanvasId(canvasId)) ?? canvasId;
  };

  return {
    ...snapshot,
    nodes: snapshot.nodes.map((node) => ({
      ...node,
      canvasId: mapCanvasId(node.canvasId) ?? node.canvasId,
    })),
    edges: snapshot.edges.map((edge) => ({
      ...edge,
      canvasId: mapCanvasId(edge.canvasId) ?? edge.canvasId,
    })),
    workZones: snapshot.workZones.map((zone) => ({
      ...zone,
      canvasId: mapCanvasId(zone.canvasId) ?? zone.canvasId,
    })),
    personaThreads: snapshot.personaThreads.map((thread) => {
      const canvasId = mapCanvasId(thread.canvasId) ?? thread.canvasId;
      return {
        ...thread,
        canvasId,
        id: personaThreadId(canvasId, thread.agentNodeId),
      };
    }),
    archivedCards: snapshot.archivedCards.map((row) => ({
      ...row,
      sourceCanvasId: row.sourceCanvasId ? mapCanvasId(row.sourceCanvasId) : row.sourceCanvasId,
    })),
  };
}

/**
 * When ids collide, keep the signed-in canvas and import anonymous work as a new canvas.
 * Also covers default rows that only exist as node.canvasId references.
 */
function remapIncomingCanvasIdCollisions(
  base: PartitionSnapshot,
  incoming: PartitionSnapshot,
  newId: () => string,
): PartitionSnapshot {
  const baseCanvasIds = new Set(base.canvases.map((canvas) => String(canvas.id)));
  const incomingCanvasById = new Map(
    incoming.canvases.map((canvas) => [String(canvas.id), canvas] as const),
  );
  const idMap = new Map<string, string>();

  for (const canvasId of baseCanvasIds) {
    if (!incomingHasCanvasWork(incoming, canvasId)) continue;
    idMap.set(canvasId, newId());
  }

  if (idMap.size === 0) return incoming;

  const remappedCanvases: Canvas[] = incoming.canvases.filter(
    (canvas) => !idMap.has(String(canvas.id)),
  );
  for (const [oldId, nextId] of idMap) {
    const source = incomingCanvasById.get(oldId);
    remappedCanvases.push(
      source
        ? { ...source, id: nextId }
        : {
            id: nextId,
            name: oldId === DEFAULT_CANVAS_ID ? '主工作区' : '导入画布',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
    );
  }

  return remapSnapshotCanvasIds(
    {
      ...incoming,
      canvases: remappedCanvases,
    },
    idMap,
  );
}

/** Same-name canvases are allowed, but disambiguate imported ones in the history list. */
function disambiguateIncomingCanvasNames(
  base: PartitionSnapshot,
  incoming: PartitionSnapshot,
): PartitionSnapshot {
  const baseIds = new Set(base.canvases.map((canvas) => String(canvas.id)));
  const claimedNames = new Set(base.canvases.map((canvas) => canvas.name));
  let changed = false;

  const canvases = incoming.canvases.map((canvas) => {
    if (baseIds.has(String(canvas.id)) || !claimedNames.has(canvas.name)) {
      if (!baseIds.has(String(canvas.id))) claimedNames.add(canvas.name);
      return canvas;
    }

    let suffix = 2;
    let nextName = `${canvas.name} (${suffix})`;
    while (claimedNames.has(nextName)) {
      suffix += 1;
      nextName = `${canvas.name} (${suffix})`;
    }
    claimedNames.add(nextName);
    changed = true;
    return { ...canvas, name: nextName };
  });

  return changed ? { ...incoming, canvases } : incoming;
}

function mergePartitionSnapshots(
  base: PartitionSnapshot,
  incoming: PartitionSnapshot,
): PartitionSnapshot {
  let prepared = remapIncomingCanvasIdCollisions(base, incoming, () => crypto.randomUUID());
  prepared = disambiguateIncomingCanvasNames(base, prepared);
  const merged = mergeLocalOntoCloud(base, prepared);
  return {
    ...merged,
    canvasTemplates: unionById(base.canvasTemplates, incoming.canvasTemplates, (row) => row.id),
  };
}

function isEmptyPartitionSnapshot(snapshot: PartitionSnapshot): boolean {
  return (
    snapshot.canvases.length === 0 &&
    snapshot.nodes.length === 0 &&
    snapshot.edges.length === 0 &&
    snapshot.articles.length === 0 &&
    snapshot.agents.length === 0 &&
    snapshot.sandboxThreads.length === 0 &&
    snapshot.archivedCards.length === 0 &&
    snapshot.archiveFolders.length === 0 &&
    snapshot.canvasFolders.length === 0 &&
    snapshot.workZones.length === 0 &&
    snapshot.personaThreads.length === 0 &&
    snapshot.canvasTemplates.length === 0
  );
}

function nonEmptyIncomingSources(...sources: PartitionSnapshot[]): PartitionSnapshot[] {
  return sources.filter((source) => !isEmptyPartitionSnapshot(source));
}

/**
 * Backup → verify → write → verify again → delete source partitions.
 * Backups are persisted before the transaction so a failed merge never destroys data.
 */
async function commitMergedWorkspaceSnapshot(options: {
  merged: PartitionSnapshot;
  base: PartitionSnapshot;
  incomingSources: PartitionSnapshot[];
  partitionIdsToDelete: string[];
  recoveryTag: string;
}): Promise<void> {
  const incomingSources = nonEmptyIncomingSources(...options.incomingSources);
  assertMergePreservesWorkspace(options.base, incomingSources, options.merged);

  const activeBefore = await readActiveSnapshot();
  await persistRecoveryBackup(RECOVERY_ACTIVE_PREFIX, options.recoveryTag, activeBefore);
  for (const [index, source] of incomingSources.entries()) {
    await persistRecoveryBackup(
      RECOVERY_INCOMING_PREFIX,
      `${options.recoveryTag}:${index}`,
      source,
    );
  }

  await db.transaction(
    'rw',
    [...ACTIVE_TABLES, db.workspacePartitions, db.workspaceState],
    async () => {
      await replaceActiveSnapshot(options.merged);

      const activeAfter = await readActiveSnapshot();
      assertMergePreservesWorkspace(options.base, incomingSources, activeAfter);

      for (const ownerId of options.partitionIdsToDelete) {
        await db.workspacePartitions.delete(ownerId);
      }
    },
  );
}

async function backupPartitionBeforeOverwrite(ownerId: string, tag: string): Promise<void> {
  const existing = await db.workspacePartitions.get(ownerId);
  if (!existing?.snapshot) return;
  await persistRecoveryBackup(RECOVERY_INCOMING_PREFIX, tag, parseSnapshot(existing));
}

/**
 * Recover an anonymous workspace left in workspacePartitions after a prior login.
 * Merges canvases, cards, and related rows into the active user partition locally.
 */
export async function importOrphanedAnonymousWorkspace(): Promise<boolean> {
  const activeOwner = await getActiveWorkspaceOwner();
  if (!activeOwner || activeOwner === ANONYMOUS_WORKSPACE_OWNER) return false;

  return withoutSyncHooks(async () => {
    const record = await db.workspacePartitions.get(ANONYMOUS_WORKSPACE_OWNER);
    if (!record?.snapshot) return false;
    const anonymous = parseSnapshot(record);
    if (isEmptyPartitionSnapshot(anonymous)) {
      await db.workspacePartitions.delete(ANONYMOUS_WORKSPACE_OWNER);
      return false;
    }

    const active = await readActiveSnapshot();
    const merged = mergePartitionSnapshots(active, anonymous);
    await commitMergedWorkspaceSnapshot({
      merged,
      base: active,
      incomingSources: [anonymous],
      partitionIdsToDelete: [ANONYMOUS_WORKSPACE_OWNER],
      recoveryTag: 'import-orphan-anonymous',
    });
    return true;
  });
}

/**
 * Atomically parks the current local workspace and restores the target owner.
 * A pre-v11 database is claimed once by the first observed principal.
 */
export async function switchLocalWorkspaceOwner(targetOwnerId: string): Promise<void> {
  if (!targetOwnerId) throw new Error('Workspace owner is required');

  await withoutSyncHooks(async () => {
    const activeOwner = await getActiveWorkspaceOwner();
    if (!activeOwner) {
      await db.workspaceState.put({ key: 'activeOwner', value: targetOwnerId });
      return;
    }
    if (activeOwner === targetOwnerId) return;

    const activeSnapshot = await readActiveSnapshot();
    const mergeAnonymousIntoUser =
      activeOwner === ANONYMOUS_WORKSPACE_OWNER && targetOwnerId !== ANONYMOUS_WORKSPACE_OWNER;

    if (mergeAnonymousIntoUser) {
      const orphanedAnonymous = parseSnapshot(
        await db.workspacePartitions.get(ANONYMOUS_WORKSPACE_OWNER),
      );
      const userBase = parseSnapshot(await db.workspacePartitions.get(targetOwnerId));
      let merged = mergePartitionSnapshots(userBase, activeSnapshot);
      if (!isEmptyPartitionSnapshot(orphanedAnonymous)) {
        merged = mergePartitionSnapshots(merged, orphanedAnonymous);
      }

      await commitMergedWorkspaceSnapshot({
        merged,
        base: userBase,
        incomingSources: [activeSnapshot, orphanedAnonymous],
        partitionIdsToDelete: [ANONYMOUS_WORKSPACE_OWNER, targetOwnerId],
        recoveryTag: `login-merge:${targetOwnerId}`,
      });
      await db.workspaceState.put({ key: 'activeOwner', value: targetOwnerId });
      return;
    }

    await db.transaction(
      'rw',
      [...ACTIVE_TABLES, db.workspacePartitions, db.workspaceState],
      async () => {
        await backupPartitionBeforeOverwrite(activeOwner, `park:${activeOwner}`);
        await db.workspacePartitions.put({
          ownerId: activeOwner,
          snapshot: activeSnapshot,
          updatedAt: Date.now(),
        });

        await backupPartitionBeforeOverwrite(targetOwnerId, `restore:${targetOwnerId}`);
        const target = parseSnapshot(await db.workspacePartitions.get(targetOwnerId));
        await replaceActiveSnapshot(target);
        await db.workspacePartitions.delete(targetOwnerId);
        await db.workspaceState.put({ key: 'activeOwner', value: targetOwnerId });
      },
    );
  });
}

