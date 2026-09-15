import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSeedData } from '../../src/hooks/useSeedData';
import { resetBuiltinAgentsInDb } from '../../src/dev/resetBuiltinAgents';
import { SEEDED_AGENT_IDS } from '../../src/constants/defaultAgents';
import { db } from '../../src/db';
import i18n from '../../src/i18n';

describe('useSeedData', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.articles.clear();
    await db.agents.clear();
    await db.edges.clear();
    await db.canvases.clear();
    await db.agentSandboxThreads.clear();
    await db.canvasWorkZones.clear();
  });

  it('首次运行创建默认画布', async () => {
    renderHook(() => useSeedData());
    await new Promise((r) => setTimeout(r, 300));

    const canvas = await db.canvases.get('default');
    expect(canvas).toBeDefined();
    expect(canvas?.name).toBe('Main Workspace');
  });

  it('首次运行只创建四个核心 agents，不含造宇宙/角色工坊', async () => {
    renderHook(() => useSeedData());
    await new Promise((r) => setTimeout(r, 300));

    const agents = await db.agents.toArray();
    expect(agents).toHaveLength(SEEDED_AGENT_IDS.length);
    const roles = agents.map((a) => a.role);
    expect(roles).toContain('Journalist');
    expect(roles).toContain('Connector');
    expect(roles).toContain('Editor');
    expect(roles).toContain('Visionary');
    expect(roles).not.toContain('Worldbuilder');
    expect(roles).not.toContain('Cast Designer');
    expect(await db.agents.get('cosmos_weaver')).toBeUndefined();
    expect(await db.agents.get('character_atelier')).toBeUndefined();
  });

  it('画布上仍在使用时保留造宇宙/角色工坊，否则清掉闲置行', async () => {
    await db.agents.bulkPut([
      {
        id: 'cosmos_weaver',
        name: '造宇宙',
        role: 'Worldbuilder',
        prompt: 'keep-me',
        temperature: 0.85,
        creativity: 0.75,
      },
      {
        id: 'character_atelier',
        name: '角色工坊',
        role: 'Cast Designer',
        prompt: 'keep-me-too',
        temperature: 0.8,
        creativity: 0.7,
      },
    ]);
    await db.nodes.add({
      id: 'used-weaver',
      type: 'agent',
      agentConfigId: 'cosmos_weaver',
      content: '',
      x: 0,
      y: 0,
      canvasId: 'default',
    });
    renderHook(() => useSeedData());
    await new Promise((r) => setTimeout(r, 300));

    const weaver = await db.agents.get('cosmos_weaver');
    expect(weaver?.prompt).toBe('keep-me');
    expect(await db.agents.get('character_atelier')).toBeUndefined();
  });

  it('闲置的叙事 Agent 启动时从角色列表移除，不再补齐角色工坊', async () => {
    await db.agents.put({
      id: 'cosmos_weaver',
      name: '造宇宙',
      role: 'Worldbuilder',
      prompt: 'p',
      temperature: 0.85,
      creativity: 0.75,
      knowledgeMarkdownFiles: [{ name: 'grammar.md', content: '创作边界' }],
    });
    renderHook(() => useSeedData());
    await new Promise((r) => setTimeout(r, 300));

    expect(await db.agents.get('cosmos_weaver')).toBeUndefined();
    expect(await db.agents.get('character_atelier')).toBeUndefined();
  });

  it('首次运行在默认画布上放阿狸、主题卡和便签卡（不再装宇宙 starter）', async () => {
    renderHook(() => useSeedData());
    await new Promise((r) => setTimeout(r, 300));

    const nodes = (await db.nodes.toArray()).filter((n) => n.type !== 'ambience');
    expect(nodes.some((n) => n.type === 'ask')).toBe(true);
    expect(nodes.some((n) => n.type === 'theme')).toBe(true);
    expect(nodes.some((n) => n.type === 'note')).toBe(true);
    expect(nodes.some((n) => n.type === 'image')).toBe(true);

    // 默认画布上不应出现 cosmos starter 的角色卡或 cosmos 默认 ID
    expect(nodes.filter((n) => n.type === 'agent').map((n) => n.agentConfigId)).toEqual([]);
    expect(nodes.some((n) => n.id.startsWith('cosmos-default-'))).toBe(false);

    const edges = await db.edges.toArray();
    expect(edges).toEqual([]);

    const zones = await db.canvasWorkZones.toArray();
    expect(zones).toHaveLength(1);
    expect(zones[0]?.personaNodeId).toBe('default-ask');
  });

  it('未改动过的旧 L 形三卡会迁移到引导用工作区布局', async () => {
    await db.canvases.add({
      id: 'default',
      name: 'Main Workspace',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await db.nodes.bulkPut([
      {
        id: 'default-ask',
        type: 'ask',
        content: '',
        x: 80,
        y: 80,
        width: 320,
        height: 180,
        canvasId: 'default',
      },
      {
        id: 'default-theme',
        type: 'theme',
        content: '核心主题',
        x: 456,
        y: 80,
        width: 320,
        height: 200,
        canvasId: 'default',
      },
      {
        id: 'default-note',
        type: 'note',
        content: '便签',
        x: 80,
        y: 360,
        width: 320,
        height: 200,
        canvasId: 'default',
      },
    ]);
    renderHook(() => useSeedData());
    await new Promise((r) => setTimeout(r, 300));

    const ask = await db.nodes.get('default-ask');
    const theme = await db.nodes.get('default-theme');
    const note = await db.nodes.get('default-note');
    const zone = (await db.canvasWorkZones.toArray())[0]!;
    expect(zone.personaNodeId).toBe('default-ask');
    expect(theme!.x).toBeGreaterThan(zone.x + zone.width);
    expect(note!.x).toBeGreaterThan(zone.x + zone.width);
    // Content preserved
    expect(note?.content).toBe('便签');
    expect(ask!.x).toBeGreaterThanOrEqual(zone.x);
    expect(ask!.y).toBeGreaterThanOrEqual(zone.y);
  });

  it('旧 Memory Architect 种子不被覆盖（不删用户数据）', async () => {
    await db.canvases.add({
      id: 'default',
      name: 'Main Workspace',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await db.nodes.bulkPut([
      { id: 'theme', type: 'theme', content: 'The Memory Architect', x: 0, y: 0, canvasId: 'default' },
      { id: 'insp1', type: 'note', content: 'old', x: 0, y: 0, canvasId: 'default' },
      { id: 'ask', type: 'ask', content: '', x: 0, y: 0, canvasId: 'default' },
    ]);
    renderHook(() => useSeedData());
    await new Promise((r) => setTimeout(r, 300));

    // 历史 starter 卡全部保留
    expect(await db.nodes.get('theme')).toBeDefined();
    expect(await db.nodes.get('insp1')).toBeDefined();
    expect(await db.nodes.get('ask')).toBeDefined();
    // 既不灌 cosmos 默认，也不灌新三卡默认
    expect(await db.nodes.get('cosmos-default-agent-weaver')).toBeUndefined();
    expect(await db.nodes.get('cosmos-default-note-four')).toBeUndefined();
    expect(await db.nodes.get('default-theme')).toBeUndefined();
    expect(await db.nodes.get('default-ask')).toBeUndefined();
    expect(await db.nodes.get('default-note')).toBeUndefined();
  });

  it('已有 cosmos starter 的默认画布不被改写（保留 cosmos 内容）', async () => {
    await db.canvases.add({
      id: 'default',
      name: 'Main Workspace',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await db.nodes.bulkPut([
      { id: 'cosmos-default-note-four', type: 'note', content: '四问', x: 0, y: 0, canvasId: 'default' },
      { id: 'cosmos-default-note-pain', type: 'note', content: '痛点', x: 0, y: 0, canvasId: 'default' },
      { id: 'cosmos-default-agent-weaver', type: 'agent', agentConfigId: 'cosmos_weaver', content: '', x: 0, y: 0, canvasId: 'default' },
      { id: 'cosmos-default-agent-atelier', type: 'agent', agentConfigId: 'character_atelier', content: '', x: 0, y: 0, canvasId: 'default' },
    ]);
    renderHook(() => useSeedData());
    await new Promise((r) => setTimeout(r, 300));

    expect(await db.nodes.get('cosmos-default-note-four')).toBeDefined();
    expect(await db.nodes.get('cosmos-default-agent-weaver')).toBeDefined();
    // 新三卡默认不会被叠加上去
    expect(await db.nodes.get('default-theme')).toBeUndefined();
    expect(await db.nodes.get('default-ask')).toBeUndefined();
    expect(await db.nodes.get('default-note')).toBeUndefined();
  });

  it('主画布已有用户添加的卡片时不删除、不灌默认布局', async () => {
    await db.canvases.add({
      id: 'default',
      name: 'Main Workspace',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await db.nodes.bulkPut([
      { id: 'theme', type: 'theme', content: 'The Memory Architect', x: 0, y: 0, canvasId: 'default' },
      { id: 'user-note-1', type: 'note', content: '我自己写的', x: 120, y: 80, canvasId: 'default' },
    ]);
    renderHook(() => useSeedData());
    await new Promise((r) => setTimeout(r, 300));

    expect(await db.nodes.get('user-note-1')).toMatchObject({
      content: '我自己写的',
      x: 120,
      y: 80,
    });
    expect(await db.nodes.get('theme')).toBeDefined();
    expect(await db.nodes.get('cosmos-default-agent-weaver')).toBeUndefined();
    expect(await db.nodes.get('default-theme')).toBeUndefined();
    expect(await db.nodes.get('default-ask')).toBeUndefined();
  });

  it('主画布只有用户卡片、没有官方种子时也不覆盖', async () => {
    await db.canvases.add({
      id: 'default',
      name: 'Main Workspace',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await db.nodes.put({
      id: 'keep-me',
      type: 'note',
      content: 'existing work',
      x: 10,
      y: 10,
      canvasId: 'default',
    });
    renderHook(() => useSeedData());
    await new Promise((r) => setTimeout(r, 300));

    const nodes = (await db.nodes.toArray()).filter((n) => n.type !== 'ambience');
    expect(nodes.map((n) => n.id)).toEqual(['keep-me']);
  });

  it('已存在部分系统 agents 时补齐缺失 id 且仍可播种示例节点', async () => {
    await db.canvases.add({
      id: 'default',
      name: 'Main Workspace',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await db.agents.bulkPut([
      { id: 'interviewer', name: 'The Mirror of Insight', role: 'Journalist', prompt: '', temperature: 0.7, creativity: 0.4 },
      { id: 'synthesizer', name: 'The Weaver', role: 'Connector', prompt: '', temperature: 0.8, creativity: 0.7 },
      { id: 'stylist', name: 'The Smoothing Iron', role: 'Editor', prompt: '', temperature: 0.6, creativity: 0.5 },
      { id: 'futurist', name: 'The Star-Gazer', role: 'Visionary', prompt: '', temperature: 0.9, creativity: 0.9 },
    ]);

    renderHook(() => useSeedData());
    await new Promise((r) => setTimeout(r, 300));

    const canvases = await db.canvases.toArray();
    expect(canvases.length).toBe(1);

    const agents = await db.agents.toArray();
    expect(agents.length).toBe(SEEDED_AGENT_IDS.length);
    expect(await db.agents.get('cosmos_weaver')).toBeUndefined();

    const nodes = await db.nodes.toArray();
    expect(nodes.length).toBeGreaterThanOrEqual(3);
  });

  it('启动时移除已废弃的内置 id challenger', async () => {
    await db.agents.put({
      id: 'challenger',
      name: 'The Touchstone',
      role: 'Debater',
      prompt: 'legacy',
      temperature: 0.7,
      creativity: 0.4,
    });
    renderHook(() => useSeedData());
    await new Promise((r) => setTimeout(r, 300));
    expect(await db.agents.get('challenger')).toBeUndefined();
  });

  it('启动时移除已废弃的内置 id pragmatist', async () => {
    await db.agents.put({
      id: 'pragmatist',
      name: 'The Heartwood',
      role: 'Realist',
      prompt: 'legacy',
      temperature: 0.4,
      creativity: 0.2,
    });
    renderHook(() => useSeedData());
    await new Promise((r) => setTimeout(r, 300));
    expect(await db.agents.get('pragmatist')).toBeUndefined();
  });

  /**
   * 开发者本地同步：等同于从 IndexedDB 删除内置行后再刷新，`useSeedData` 应按当前语言重写字段。
   * @see `globalThis.__SCRIBE_RESET_BUILTIN_AGENTS`（仅 dev）。
   */
  it('清空内置 Agent 后为缺失 ID 按 i18n 重灌默认值', async () => {
    await i18n.changeLanguage('en');
    await db.agents.put({
      id: 'futurist',
      name: 'The Futurist (stale)',
      role: 'Visionary (stale)',
      prompt: 'stale',
      temperature: 0.9,
      creativity: 0.9,
    });
    await resetBuiltinAgentsInDb();
    renderHook(() => useSeedData());
    await new Promise((r) => setTimeout(r, 300));

    const row = await db.agents.get('futurist');
    expect(row?.name).toBe(i18n.t('agents.defaults.futurist.name'));
    expect(row?.role).toBe(i18n.t('agents.defaults.futurist.role'));
    expect(row?.prompt).toBe(i18n.t('agents.defaults.futurist.prompt'));
  });
});
