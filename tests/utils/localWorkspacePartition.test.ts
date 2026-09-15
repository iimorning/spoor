import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/db';
import {
  ANONYMOUS_WORKSPACE_OWNER,
  getActiveWorkspaceOwner,
  importOrphanedAnonymousWorkspace,
  switchLocalWorkspaceOwner,
} from '../../src/utils/localWorkspacePartition';
import { POCKET_CANVAS_ID } from '../../src/utils/pocketNotes';

async function clearPartitionedWorkspace() {
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

describe('local workspace partitions', () => {
  beforeEach(clearPartitionedWorkspace);

  it('claims a legacy workspace once without clearing it', async () => {
    await db.nodes.put({ id: 'legacy-a', type: 'note', content: 'A', x: 0, y: 0 });

    await switchLocalWorkspaceOwner('user-a');

    expect(await getActiveWorkspaceOwner()).toBe('user-a');
    expect(await db.nodes.get('legacy-a')).toBeTruthy();
  });

  it('parks one account before restoring another account', async () => {
    await switchLocalWorkspaceOwner('user-a');
    await db.nodes.put({ id: 'a-only', type: 'note', content: 'A', x: 0, y: 0 });

    await switchLocalWorkspaceOwner('user-b');
    expect(await db.nodes.toArray()).toEqual([]);
    await db.nodes.put({ id: 'b-only', type: 'note', content: 'B', x: 0, y: 0 });

    await switchLocalWorkspaceOwner('user-a');
    expect((await db.nodes.toArray()).map((row) => row.id)).toEqual(['a-only']);

    await switchLocalWorkspaceOwner('user-b');
    expect((await db.nodes.toArray()).map((row) => row.id)).toEqual(['b-only']);
  });

  it('keeps signed-out anonymous data separate until the user signs back in', async () => {
    await switchLocalWorkspaceOwner('user-a');
    await db.nodes.put({ id: 'private-a', type: 'note', content: 'private', x: 0, y: 0 });

    await switchLocalWorkspaceOwner(ANONYMOUS_WORKSPACE_OWNER);
    expect(await db.nodes.get('private-a')).toBeUndefined();
    await db.nodes.put({ id: 'anonymous', type: 'note', content: 'local', x: 0, y: 0 });

    await switchLocalWorkspaceOwner('user-a');
    expect(await db.nodes.get('private-a')).toBeTruthy();
    expect((await db.nodes.get('anonymous'))?.content).toBe('local');
  });

  it('merges anonymous pocket memos and canvas work when signing in', async () => {
    await switchLocalWorkspaceOwner(ANONYMOUS_WORKSPACE_OWNER);
    await db.nodes.put({
      id: 'memo-1',
      type: 'note',
      content: '地铁上想到的',
      canvasId: POCKET_CANVAS_ID,
      x: 0,
      y: 0,
    });
    await db.nodes.put({ id: 'anonymous-canvas', type: 'note', content: 'canvas note', x: 0, y: 0 });

    await switchLocalWorkspaceOwner('user-a');

    expect((await db.nodes.get('memo-1'))?.content).toBe('地铁上想到的');
    expect((await db.nodes.get('anonymous-canvas'))?.content).toBe('canvas note');
    expect(await db.workspacePartitions.get(ANONYMOUS_WORKSPACE_OWNER)).toBeUndefined();
  });

  it('imports anonymous default canvas as a separate canvas when the user already has default', async () => {
    await switchLocalWorkspaceOwner('user-a');
    await db.canvases.put({
      id: 'default',
      name: '我是许凉凉',
      createdAt: 1,
      updatedAt: 1,
    });
    await db.nodes.put({
      id: 'cloud-n1',
      type: 'note',
      content: '账号默认画布',
      canvasId: 'default',
      x: 0,
      y: 0,
    });

    await switchLocalWorkspaceOwner(ANONYMOUS_WORKSPACE_OWNER);
    await db.canvases.put({
      id: 'default',
      name: '主工作区',
      createdAt: 2,
      updatedAt: 2,
    });
    await db.nodes.put({
      id: 'anon-n1',
      type: 'note',
      content: '未登录主工作区卡片',
      canvasId: 'default',
      x: 40,
      y: 40,
    });

    await switchLocalWorkspaceOwner('user-a');

    expect((await db.canvases.get('default'))?.name).toBe('我是许凉凉');
    const importedDefault = (await db.canvases.toArray()).find(
      (canvas) => canvas.id !== 'default' && canvas.name === '主工作区',
    );
    expect(importedDefault).toBeTruthy();
    expect((await db.nodes.get('cloud-n1'))?.content).toBe('账号默认画布');
    expect((await db.nodes.get('anon-n1'))?.canvasId).toBe(importedDefault?.id);
    expect((await db.nodes.get('anon-n1'))?.content).toBe('未登录主工作区卡片');
  });

  it('disambiguates imported canvases when names collide but ids differ', async () => {
    await switchLocalWorkspaceOwner('user-a');
    await db.canvases.put({
      id: 'user-c1',
      name: '画布 2',
      createdAt: 1,
      updatedAt: 1,
    });

    await switchLocalWorkspaceOwner(ANONYMOUS_WORKSPACE_OWNER);
    await db.canvases.put({
      id: 'anon-c1',
      name: '画布 2',
      createdAt: 2,
      updatedAt: 2,
    });
    await db.nodes.put({
      id: 'anon-n1',
      type: 'note',
      content: '匿名同名画布卡片',
      canvasId: 'anon-c1',
      x: 0,
      y: 0,
    });

    await switchLocalWorkspaceOwner('user-a');

    const imported = (await db.canvases.get('anon-c1'))!;
    expect(imported.name).toBe('画布 2 (2)');
    expect((await db.nodes.get('anon-n1'))?.canvasId).toBe('anon-c1');
    expect((await db.canvases.get('user-c1'))?.name).toBe('画布 2');
  });

  it('imports anonymous default work even when the default canvas row is missing', async () => {
    await switchLocalWorkspaceOwner('user-a');
    await db.canvases.put({
      id: 'default',
      name: '我是许凉凉',
      createdAt: 1,
      updatedAt: 1,
    });

    await switchLocalWorkspaceOwner(ANONYMOUS_WORKSPACE_OWNER);
    await db.nodes.put({
      id: 'anon-default-n1',
      type: 'note',
      content: '只有节点引用了 default',
      canvasId: 'default',
      x: 10,
      y: 10,
    });

    await switchLocalWorkspaceOwner('user-a');

    expect((await db.canvases.get('default'))?.name).toBe('我是许凉凉');
    const importedDefault = (await db.canvases.toArray()).find(
      (canvas) => canvas.id !== 'default' && canvas.name === '主工作区',
    );
    expect(importedDefault).toBeTruthy();
    expect((await db.nodes.get('anon-default-n1'))?.canvasId).toBe(importedDefault?.id);
  });

  it('merges both current anonymous work and a previously parked anonymous partition on sign-in', async () => {
    await switchLocalWorkspaceOwner('user-a');
    await db.workspacePartitions.put({
      ownerId: ANONYMOUS_WORKSPACE_OWNER,
      snapshot: {
        canvases: [{ id: 'stuck-c1', name: '旧匿名画布', createdAt: 1, updatedAt: 1 }],
        nodes: [
          {
            id: 'stuck-n1',
            type: 'note',
            content: '上次登录遗留',
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

    await switchLocalWorkspaceOwner(ANONYMOUS_WORKSPACE_OWNER);
    await db.canvases.put({
      id: 'fresh-c1',
      name: '本次匿名画布',
      createdAt: 2,
      updatedAt: 2,
    });
    await db.nodes.put({
      id: 'fresh-n1',
      type: 'note',
      content: '本次登录前新增',
      canvasId: 'fresh-c1',
      x: 0,
      y: 0,
    });

    await switchLocalWorkspaceOwner('user-a');

    expect((await db.nodes.get('stuck-n1'))?.content).toBe('上次登录遗留');
    expect((await db.nodes.get('fresh-n1'))?.content).toBe('本次登录前新增');
    expect(await db.workspacePartitions.get(ANONYMOUS_WORKSPACE_OWNER)).toBeUndefined();
  });

  it('merges anonymous canvases into the active user workspace when signing in', async () => {
    await switchLocalWorkspaceOwner(ANONYMOUS_WORKSPACE_OWNER);
    await db.canvases.put({
      id: 'anon-c1',
      name: '画布 2',
      createdAt: 1,
      updatedAt: 1,
    });
    await db.nodes.put({
      id: 'anon-n1',
      type: 'note',
      content: '未登录画布卡片',
      canvasId: 'anon-c1',
      x: 0,
      y: 0,
    });

    await switchLocalWorkspaceOwner('user-a');

    expect((await db.canvases.get('anon-c1'))?.name).toBe('画布 2');
    expect((await db.nodes.get('anon-n1'))?.content).toBe('未登录画布卡片');
    expect(await db.workspacePartitions.get(ANONYMOUS_WORKSPACE_OWNER)).toBeUndefined();
  });

  it('imports orphaned anonymous workspaces into the active user workspace without switching', async () => {
    await switchLocalWorkspaceOwner('user-a');
    await db.workspacePartitions.put({
      ownerId: ANONYMOUS_WORKSPACE_OWNER,
      snapshot: {
        canvases: [{ id: 'stuck-c1', name: '主工作区', createdAt: 1, updatedAt: 1 }],
        nodes: [
          {
            id: 'memo-stuck',
            type: 'note',
            content: '卡在匿名分区',
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
    expect((await db.nodes.get('memo-stuck'))?.content).toBe('卡在匿名分区');
    expect((await db.canvases.get('stuck-c1'))?.name).toBe('主工作区');
    expect(await importOrphanedAnonymousWorkspace()).toBe(false);
    expect(await db.workspacePartitions.get(ANONYMOUS_WORKSPACE_OWNER)).toBeUndefined();
  });

  it('parks work zones and persona threads when switching accounts', async () => {
    await switchLocalWorkspaceOwner('user-a');
    await db.canvasWorkZones.put({
      id: 'zone-a',
      canvasId: 'c1',
      personaNodeId: 'ask-1',
      x: 0,
      y: 0,
      width: 80,
      height: 80,
      createdAt: 1,
    });
    await db.canvasPersonaThreads.put({
      id: 'c1:ask-1',
      canvasId: 'c1',
      agentNodeId: 'ask-1',
      messages: [{ id: 'm1', role: 'user', text: 'hello a', createdAt: 1 }],
      updatedAt: 1,
    });

    await switchLocalWorkspaceOwner('user-b');
    expect(await db.canvasWorkZones.toArray()).toEqual([]);
    expect(await db.canvasPersonaThreads.toArray()).toEqual([]);

    await switchLocalWorkspaceOwner('user-a');
    expect((await db.canvasWorkZones.get('zone-a'))?.width).toBe(80);
    expect((await db.canvasPersonaThreads.get('c1:ask-1'))?.messages[0]?.text).toBe('hello a');
  });
});
