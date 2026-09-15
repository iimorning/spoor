import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  normalizeBookExpandPlan,
  parseBookExpandPlan,
  parseBookVoiceReply,
  resolveBookExpandBranches,
  setBookExpandBranchesCollapsed,
  spawnBookExpandCards,
  bookExpandClusterSize,
  spokenBookVoiceBranchLine,
} from '../../src/services/spawnBookExpandCards';
import { db } from '../../src/db';
import { setCanvasV2Enabled } from '../../src/utils/canvasV2';

describe('normalizeBookExpandPlan', () => {
  it('accepts hub + branches', () => {
    const plan = normalizeBookExpandPlan({
      hub: '偶像经济',
      branches: [
        { title: '一推', content: '最喜欢的成员' },
        { title: '杰尼斯', content: '事务所体系' },
        { title: '消费', content: '应援消费' },
      ],
    });
    expect(plan?.hub).toBe('偶像经济');
    expect(plan?.branches).toHaveLength(3);
    expect(plan?.images).toEqual([]);
  });

  it('reads optional illustration prompts', () => {
    const plan = normalizeBookExpandPlan({
      hub: '偶像经济',
      branches: [
        { title: '一推', content: '最喜欢的成员' },
        { title: '杰尼斯', content: '事务所体系' },
      ],
      images: [{ title: '应援', prompt: 'concert lightsticks in a dark arena' }],
    });
    expect(plan?.images).toEqual([
      { title: '应援', prompt: 'concert lightsticks in a dark arena' },
    ]);
  });

  it('rejects too few branches', () => {
    expect(
      normalizeBookExpandPlan({
        hub: 'Only one',
        branches: [{ title: 'A', content: 'a' }],
      }),
    ).toBeNull();
  });
});

describe('parseBookExpandPlan', () => {
  it('parses fenced JSON', () => {
    const plan = parseBookExpandPlan(`Here you go:
\`\`\`json
{"hub":"主题","branches":[{"title":"一","content":"内容一"},{"title":"二","content":"内容二"},{"title":"三","content":"内容三"}]}
\`\`\``);
    expect(plan?.hub).toBe('主题');
    expect(plan?.branches).toHaveLength(3);
  });
});

describe('parseBookVoiceReply', () => {
  it('extracts spoken summary plus hub/branches', () => {
    const reply = parseBookVoiceReply(JSON.stringify({
      summary: '这页在讲注意力的代价。',
      hub: '注意力经济',
      branches: [
        { title: '稀缺', content: '注意力是有限资源' },
        { title: '争夺', content: '产品在抢夺焦点' },
        { title: '代价', content: '深度思考被挤掉' },
      ],
    }));
    expect(reply?.summary).toBe('这页在讲注意力的代价。');
    expect(reply?.plan.hub).toBe('注意力经济');
    expect(reply?.plan.branches).toHaveLength(3);
    expect(reply?.images).toEqual([]);
  });

  it('parses optional images for GPT-Image', () => {
    const reply = parseBookVoiceReply(JSON.stringify({
      summary: '我来画个示意。',
      hub: '主题',
      branches: [
        { title: '一', content: 'a' },
        { title: '二', content: 'b' },
      ],
      images: [{ title: '示意', prompt: 'two classrooms side by side, soft watercolor' }],
    }));
    expect(reply?.images).toEqual([
      { title: '示意', prompt: 'two classrooms side by side, soft watercolor' },
    ]);
  });

  it('rejects plans without a spoken summary', () => {
    expect(
      parseBookVoiceReply(JSON.stringify({
        hub: '主题',
        branches: [
          { title: '一', content: 'a' },
          { title: '二', content: 'b' },
        ],
      })),
    ).toBeNull();
  });
});

describe('spokenBookVoiceBranchLine', () => {
  it('joins title and content into one spoken line', () => {
    expect(spokenBookVoiceBranchLine({ title: '稀缺', content: '注意力是有限资源' }))
      .toBe('稀缺。注意力是有限资源。');
  });
});

describe('bookExpandClusterSize', () => {
  it('covers hub plus the vertical branch lane', () => {
    const size = bookExpandClusterSize(3);
    expect(size.width).toBeGreaterThan(500);
    expect(size.height).toBeGreaterThan(400);
  });
});

describe('spawnBookExpandCards', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.edges.clear();
    await db.canvasWorkZones.clear();
    localStorage.clear();
    let n = 0;
    vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation((() => `id-${++n}`) as any);
  });

  it('V2: stacks a collapsed pile without auto edges, scoped from the book room', async () => {
    await db.nodes.add({
      id: 'book-1',
      canvasId: 'c1',
      type: 'book',
      content: '',
      x: 100,
      y: 100,
      width: 380,
      height: 520,
    });
    await db.canvasWorkZones.add({
      id: 'zone-a',
      canvasId: 'c1',
      personaNodeId: 'ask-1',
      x: 0,
      y: 0,
      width: 600,
      height: 800,
      createdAt: 0,
    });

    const result = await spawnBookExpandCards({
      bookNodeId: 'book-1',
      canvasId: 'c1',
      bookPos: { x: 100, y: 100, width: 380, height: 520 },
      plan: {
        hub: '中心',
        branches: [
          { title: 'A', content: 'a' },
          { title: 'B', content: 'b' },
          { title: 'C', content: 'c' },
        ],
      },
      staggerMs: 0,
    });

    expect(result.branchIds).toHaveLength(3);
    expect(await db.edges.count()).toBe(0);

    const hub = await db.nodes.get(result.hubId);
    expect(hub?.bookExpandBranchesCollapsed).toBe(true);
    expect(hub?.contextScopeAgentId).toBe('ask-1');

    const stacked = await Promise.all(result.branchIds.map((id) => db.nodes.get(id)));
    expect(stacked.every((n) => n?.contextScopeAgentId === 'ask-1')).toBe(true);
    expect(stacked[0]?.bookExpandParentId).toBe(result.hubId);
    expect(stacked[1]!.x - stacked[0]!.x).toBe(5);
    expect(stacked[2]!.x - stacked[1]!.x).toBe(5);
    expect(typeof stacked[0]?.bookExpandExpandedOffsetX).toBe('number');
  });

  it('V2: book outside every room still spawns an unscoped pile', async () => {
    const result = await spawnBookExpandCards({
      bookNodeId: 'book-out',
      canvasId: 'c1',
      bookPos: { x: 2000, y: 2000, width: 380, height: 520 },
      plan: {
        hub: '中心',
        branches: [
          { title: 'A', content: 'a' },
          { title: 'B', content: 'b' },
        ],
      },
      staggerMs: 0,
    });
    const hub = await db.nodes.get(result.hubId);
    expect(hub?.contextScopeAgentId).toBeUndefined();
    expect(hub?.bookExpandBranchesCollapsed).toBe(true);
    expect(await db.edges.count()).toBe(0);
  });

  it('V1: creates hub + branches linked from the book', async () => {
    setCanvasV2Enabled(false);
    const result = await spawnBookExpandCards({
      bookNodeId: 'book-1',
      canvasId: 'c1',
      bookPos: { x: 100, y: 100, width: 380, height: 520 },
      plan: {
        hub: '中心',
        branches: [
          { title: 'A', content: 'a' },
          { title: 'B', content: 'b' },
          { title: 'C', content: 'c' },
        ],
      },
      staggerMs: 0,
    });

    expect(result.hubId).toBeTruthy();
    expect(result.branchIds).toHaveLength(3);

    const nodes = await db.nodes.toArray();
    expect(nodes.map((n) => n.type).sort()).toEqual(['text', 'text', 'text', 'theme']);

    const edges = await db.edges.toArray();
    expect(edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 'book-1', to: result.hubId }),
        expect.objectContaining({ from: result.hubId, to: result.branchIds[0] }),
        expect.objectContaining({ from: result.hubId, to: result.branchIds[1] }),
        expect.objectContaining({ from: result.hubId, to: result.branchIds[2] }),
      ]),
    );

    const hub = await db.nodes.get(result.hubId);
    expect(hub?.bookExpandBranchesCollapsed).toBe(false);
    const branch = await db.nodes.get(result.branchIds[0]!);
    expect(branch?.bookExpandParentId).toBe(result.hubId);
    expect(branch?.bookExpandIndex).toBe(0);
  });

  it('collapses and expands branch cards beside the hub', async () => {
    const { hubId, branchIds } = await spawnBookExpandCards({
      bookNodeId: 'book-2',
      canvasId: 'c1',
      bookPos: { x: 0, y: 0, width: 380, height: 520 },
      plan: {
        hub: '中心',
        branches: [
          { title: 'A', content: 'a' },
          { title: 'B', content: 'b' },
          { title: 'C', content: 'c' },
        ],
      },
      staggerMs: 0,
    });

    const nodes = await db.nodes.toArray();
    const edges = await db.edges.toArray();
    expect(resolveBookExpandBranches(hubId, nodes, edges)).toHaveLength(3);

    await setBookExpandBranchesCollapsed(hubId, true, { nodes, edges, hubHeight: 160 });
    const collapsedHub = await db.nodes.get(hubId);
    expect(collapsedHub?.bookExpandBranchesCollapsed).toBe(true);

    const stacked = await Promise.all(branchIds.map((id) => db.nodes.get(id)));
    // Pile sits at the nearest branch; indices encode farthest→nearest (0 on top).
    const byIndex = [...stacked].sort(
      (a, b) => (a!.bookExpandIndex ?? 0) - (b!.bookExpandIndex ?? 0),
    );
    expect(byIndex[1]!.x - byIndex[0]!.x).toBe(5);
    expect(byIndex[2]!.x - byIndex[1]!.x).toBe(5);
    expect(byIndex[0]!.bookExpandIndex).toBe(0);

    await setBookExpandBranchesCollapsed(hubId, false, {
      nodes: await db.nodes.toArray(),
      edges: await db.edges.toArray(),
      hubHeight: 160,
    });
    const expanded = await Promise.all(branchIds.map((id) => db.nodes.get(id)));
    expect(expanded[0]!.x).toBe(expanded[1]!.x);
    expect(expanded[1]!.y).toBeGreaterThan(expanded[0]!.y);
  });

  it('stacks manually linked theme notes (either edge direction)', async () => {
    await db.nodes.add({
      id: 'theme-1',
      canvasId: 'c1',
      type: 'theme',
      content: '核心主题',
      x: 100,
      y: 100,
      height: 160,
    });
    await db.nodes.add({
      id: 'note-a',
      canvasId: 'c1',
      type: 'note',
      content: 'A',
      x: 80,
      y: 320,
    });
    await db.nodes.add({
      id: 'note-b',
      canvasId: 'c1',
      type: 'note',
      content: 'B',
      x: 400,
      y: 340,
    });
    // note → theme and theme → note both count
    await db.edges.add({ id: 'e1', canvasId: 'c1', from: 'note-a', to: 'theme-1' });
    await db.edges.add({ id: 'e2', canvasId: 'c1', from: 'theme-1', to: 'note-b' });

    const nodes = await db.nodes.toArray();
    const edges = await db.edges.toArray();
    expect(resolveBookExpandBranches('theme-1', nodes, edges).map((n) => n.id)).toEqual([
      'note-a',
      'note-b',
    ]);

    await setBookExpandBranchesCollapsed('theme-1', true, { nodes, edges, hubHeight: 160 });
    const hub = await db.nodes.get('theme-1');
    expect(hub?.bookExpandBranchesCollapsed).toBe(true);
    const a = await db.nodes.get('note-a');
    const b = await db.nodes.get('note-b');
    expect(a?.bookExpandParentId).toBe('theme-1');
    expect(b?.bookExpandParentId).toBe('theme-1');
    // Nearest is note-a (80,320); farthest note-b sits on top (index 0) at that anchor.
    expect(b!.bookExpandIndex).toBe(0);
    expect(a!.bookExpandIndex).toBe(1);
    expect(b!.x).toBe(80);
    expect(b!.y).toBe(320);
    expect(a!.x).toBe(80 + 5);
    expect(a!.y).toBe(320 + 5);
    expect(a!.bookExpandExpandedOffsetX).toBe(80 - 100);
    expect(b!.bookExpandExpandedOffsetX).toBe(400 - 100);

    await setBookExpandBranchesCollapsed('theme-1', false, {
      nodes: await db.nodes.toArray(),
      edges: await db.edges.toArray(),
      hubHeight: 160,
    });
    const a2 = await db.nodes.get('note-a');
    const b2 = await db.nodes.get('note-b');
    expect(a2!.x).toBe(80);
    expect(a2!.y).toBe(320);
    expect(b2!.x).toBe(400);
    expect(b2!.y).toBe(340);
  });

  it('counts note chains under a theme (Theme→Note→Note)', async () => {
    await db.nodes.add({
      id: 'theme-1',
      canvasId: 'c1',
      type: 'theme',
      content: '核心主题',
      x: 100,
      y: 100,
    });
    await db.nodes.add({
      id: 'note-a',
      canvasId: 'c1',
      type: 'note',
      content: 'A',
      x: 80,
      y: 320,
    });
    await db.nodes.add({
      id: 'note-b',
      canvasId: 'c1',
      type: 'text',
      content: 'B',
      x: 400,
      y: 340,
    });
    await db.nodes.add({
      id: 'ask-1',
      canvasId: 'c1',
      type: 'ask',
      x: 0,
      y: 0,
    });
    await db.nodes.add({
      id: 'side-note',
      canvasId: 'c1',
      type: 'note',
      content: 'via ask',
      x: 10,
      y: 10,
    });
    await db.edges.add({ id: 'e1', canvasId: 'c1', from: 'theme-1', to: 'note-a' });
    await db.edges.add({ id: 'e2', canvasId: 'c1', from: 'note-a', to: 'note-b' });
    // Ask bridge must NOT pull side-note into the theme stack.
    await db.edges.add({ id: 'e3', canvasId: 'c1', from: 'theme-1', to: 'ask-1' });
    await db.edges.add({ id: 'e4', canvasId: 'c1', from: 'ask-1', to: 'side-note' });

    const nodes = await db.nodes.toArray();
    const edges = await db.edges.toArray();
    expect(resolveBookExpandBranches('theme-1', nodes, edges).map((n) => n.id).sort()).toEqual([
      'note-a',
      'note-b',
    ]);
  });

  it('includes a newly edged note after a prior collapse tagged only one', async () => {
    await db.nodes.add({
      id: 'theme-1',
      canvasId: 'c1',
      type: 'theme',
      content: '核心主题',
      x: 100,
      y: 100,
      bookExpandBranchesCollapsed: false,
    });
    await db.nodes.add({
      id: 'note-a',
      canvasId: 'c1',
      type: 'note',
      content: 'A',
      x: 80,
      y: 320,
      bookExpandParentId: 'theme-1',
      bookExpandIndex: 0,
      bookExpandExpandedOffsetX: -20,
      bookExpandExpandedOffsetY: 220,
    });
    await db.nodes.add({
      id: 'note-b',
      canvasId: 'c1',
      type: 'note',
      content: 'B',
      x: 400,
      y: 340,
    });
    await db.edges.add({ id: 'e1', canvasId: 'c1', from: 'theme-1', to: 'note-a' });
    await db.edges.add({ id: 'e2', canvasId: 'c1', from: 'theme-1', to: 'note-b' });

    const nodes = await db.nodes.toArray();
    const edges = await db.edges.toArray();
    expect(resolveBookExpandBranches('theme-1', nodes, edges).map((n) => n.id).sort()).toEqual([
      'note-a',
      'note-b',
    ]);

    await setBookExpandBranchesCollapsed('theme-1', true, { hubHeight: 160 });
    const a = await db.nodes.get('note-a');
    const b = await db.nodes.get('note-b');
    expect(a?.bookExpandParentId).toBe('theme-1');
    expect(b?.bookExpandParentId).toBe('theme-1');
  });
});
