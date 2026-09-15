import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db';
import {
  ANONYMOUS_WORKSPACE_OWNER,
  importOrphanedAnonymousWorkspace,
  switchLocalWorkspaceOwner,
} from '../../src/utils/localWorkspacePartition';
import {
  assertMergePreservesWorkspace,
  isRecoveryPartitionOwner,
  listRecoveryPartitionBackups,
  RECOVERY_ACTIVE_PREFIX,
  RECOVERY_INCOMING_PREFIX,
  WorkspaceMergeSafetyError,
} from '../../src/utils/workspacePartitionSafety';

async function clearWorkspace() {
  await db.transaction(
    'rw',
    [
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
      db.workspacePartitions,
      db.workspaceState,
    ],
    async () => {
      await Promise.all([
        db.canvases.clear(),
        db.nodes.clear(),
        db.edges.clear(),
        db.articles.clear(),
        db.agents.clear(),
        db.agentSandboxThreads.clear(),
        db.archivedCards.clear(),
        db.archiveFolders.clear(),
        db.canvasFolders.clear(),
        db.canvasWorkZones.clear(),
        db.canvasPersonaThreads.clear(),
        db.canvasTemplates.clear(),
        db.workspacePartitions.clear(),
        db.workspaceState.clear(),
      ]);
    },
  );
}

describe('workspace partition safety', () => {
  beforeEach(clearWorkspace);
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects merges that would drop incoming nodes before writing', () => {
    expect(() =>
      assertMergePreservesWorkspace(
        { canvases: [], nodes: [], edges: [], articles: [], agents: [], sandboxThreads: [], archivedCards: [], archiveFolders: [], canvasFolders: [], workZones: [], personaThreads: [] },
        [{
          canvases: [],
          nodes: [{ id: 'lost-n1', type: 'note', content: '会丢', x: 0, y: 0 }],
          edges: [],
          articles: [],
          agents: [],
          sandboxThreads: [],
          archivedCards: [],
          archiveFolders: [],
          canvasFolders: [],
          workZones: [],
          personaThreads: [],
        }],
        { canvases: [], nodes: [], edges: [], articles: [], agents: [], sandboxThreads: [], archivedCards: [], archiveFolders: [], canvasFolders: [], workZones: [], personaThreads: [] },
      ),
    ).toThrow(WorkspaceMergeSafetyError);
  });

  it('writes recovery backups and keeps anonymous partition when the merge transaction fails', async () => {
    await switchLocalWorkspaceOwner('user-a');
    await db.workspacePartitions.put({
      ownerId: ANONYMOUS_WORKSPACE_OWNER,
      snapshot: {
        canvases: [{ id: 'stuck-c1', name: '封存画布', createdAt: 1, updatedAt: 1 }],
        nodes: [
          {
            id: 'stuck-n1',
            type: 'note',
            content: '封存卡片',
            canvasId: 'stuck-c1',
            x: 0,
            y: 0,
          },
        ],
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
      },
      updatedAt: Date.now(),
    });

    vi.spyOn(db.nodes, 'bulkPut').mockRejectedValueOnce(new Error('forced write failure'));

    await expect(importOrphanedAnonymousWorkspace()).rejects.toThrow('forced write failure');
    expect(await db.workspacePartitions.get(ANONYMOUS_WORKSPACE_OWNER)).toBeTruthy();
    expect(await db.nodes.get('stuck-n1')).toBeUndefined();

    const backups = await listRecoveryPartitionBackups();
    expect(backups.some((row) => row.ownerId.startsWith(RECOVERY_ACTIVE_PREFIX))).toBe(true);
    expect(backups.some((row) => row.ownerId.startsWith(RECOVERY_INCOMING_PREFIX))).toBe(true);
    expect((await db.workspacePartitions.toArray()).some((row) => isRecoveryPartitionOwner(row.ownerId))).toBe(true);
  });

  it('creates recovery backups on successful anonymous import', async () => {
    await switchLocalWorkspaceOwner('user-a');
    await db.workspacePartitions.put({
      ownerId: ANONYMOUS_WORKSPACE_OWNER,
      snapshot: {
        canvases: [{ id: 'stuck-c1', name: '封存画布', createdAt: 1, updatedAt: 1 }],
        nodes: [
          {
            id: 'stuck-n1',
            type: 'note',
            content: '封存卡片',
            canvasId: 'stuck-c1',
            x: 0,
            y: 0,
          },
        ],
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
      },
      updatedAt: Date.now(),
    });

    expect(await importOrphanedAnonymousWorkspace()).toBe(true);
    expect(await db.workspacePartitions.get(ANONYMOUS_WORKSPACE_OWNER)).toBeUndefined();
    expect((await db.nodes.get('stuck-n1'))?.content).toBe('封存卡片');

    const backups = await listRecoveryPartitionBackups();
    expect(backups.length).toBeGreaterThanOrEqual(2);
  });
});
