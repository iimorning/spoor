import { describe, it, expect, beforeEach } from 'vitest';
import { db, MyDatabase } from '../src/db';
import type {
  CanvasNode,
  Canvas,
  Article,
  AgentConfig,
  Edge,
} from '../src/db';

describe('MyDatabase', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.articles.clear();
    await db.agents.clear();
    await db.edges.clear();
    await db.canvases.clear();
    await db.agentSandboxThreads.clear();
    await db.archivedCards.clear();
    await db.archiveFolders.clear();
    await db.canvasFolders.clear();
  });

  // --- 节点 (nodes) ---
  describe('nodes 表', () => {
    it('能添加和读取节点', async () => {
      const node: CanvasNode = { id: 'n1', type: 'note', content: 'Hello', x: 100, y: 200 };
      await db.nodes.add(node);
      const result = await db.nodes.get('n1');
      expect(result).toBeDefined();
      expect(result?.content).toBe('Hello');
      expect(result?.x).toBe(100);
    });

    it('能按 canvasId 过滤节点', async () => {
      await db.nodes.bulkAdd([
        { id: 'n1', type: 'note', canvasId: 'c1', content: 'A', x: 0, y: 0 },
        { id: 'n2', type: 'note', canvasId: 'c2', content: 'B', x: 0, y: 0 },
        { id: 'n3', type: 'note', canvasId: 'c1', content: 'C', x: 0, y: 0 },
      ]);

      const c1Nodes = await db.nodes.where('canvasId').equals('c1').toArray();
      expect(c1Nodes).toHaveLength(2);
    });

    it('能按 type 过滤节点', async () => {
      await db.nodes.bulkAdd([
        { id: 'n1', type: 'theme', x: 0, y: 0 },
        { id: 'n2', type: 'note', x: 0, y: 0 },
        { id: 'n3', type: 'ai', x: 0, y: 0 },
      ]);

      const themes = await db.nodes.where('type').equals('theme').toArray();
      expect(themes).toHaveLength(1);
      expect(themes[0].id).toBe('n1');
    });

    it('能更新节点内容', async () => {
      await db.nodes.add({ id: 'n1', type: 'note', content: 'old', x: 0, y: 0 });
      await db.nodes.update('n1', { content: 'new', x: 50 });
      const result = await db.nodes.get('n1');
      expect(result?.content).toBe('new');
      expect(result?.x).toBe(50);
    });

    it('能删除节点', async () => {
      await db.nodes.add({ id: 'n1', type: 'note', x: 0, y: 0 });
      await db.nodes.delete('n1');
      const result = await db.nodes.get('n1');
      expect(result).toBeUndefined();
    });

    it('能批量添加节点', async () => {
      await db.nodes.bulkAdd([
        { id: 'n1', type: 'note', x: 0, y: 0 },
        { id: 'n2', type: 'ai', x: 10, y: 10 },
        { id: 'n3', type: 'theme', x: 20, y: 20 },
      ]);
      const count = await db.nodes.count();
      expect(count).toBe(3);
    });

    it('支持可选属性 userTurn（AI 对话链卡片）', async () => {
      await db.nodes.add({
        id: 'n-thread',
        type: 'ai',
        x: 0,
        y: 0,
        userTurn: '用户追问',
        content: 'AI 回复正文',
      });
      const result = await db.nodes.get('n-thread');
      expect(result?.userTurn).toBe('用户追问');
      expect(result?.content).toBe('AI 回复正文');
    });

    it('支持可选属性 followUpSent', async () => {
      await db.nodes.add({
        id: 'n-sent',
        type: 'ai',
        x: 0,
        y: 0,
        content: 'reply',
        followUpSent: true,
      });
      const result = await db.nodes.get('n-sent');
      expect(result?.followUpSent).toBe(true);
    });

    it('支持可选属性 width, height, layout', async () => {
      await db.nodes.add({
        id: 'n1', type: 'note', x: 0, y: 0,
        width: 400, height: 300, layout: 2
      });
      const result = await db.nodes.get('n1');
      expect(result?.width).toBe(400);
      expect(result?.height).toBe(300);
      expect(result?.layout).toBe(2);
    });

    it('支持 agentConfigId 关联', async () => {
      await db.nodes.add({ id: 'n1', type: 'agent', agentConfigId: 'a1', x: 0, y: 0 });
      const result = await db.nodes.get('n1');
      expect(result?.agentConfigId).toBe('a1');
    });

    it('支持 themeTag 主题卡页脚标签', async () => {
      await db.nodes.add({ id: 'n-theme', type: 'theme', x: 0, y: 0, themeTag: 'Custom Label' });
      const result = await db.nodes.get('n-theme');
      expect(result?.themeTag).toBe('Custom Label');
      await db.nodes.update('n-theme', { themeTag: 'Updated' });
      expect((await db.nodes.get('n-theme'))?.themeTag).toBe('Updated');
    });

    it('支持 theme 节点 description 正文说明', async () => {
      await db.nodes.add({
        id: 'n-theme-desc',
        type: 'theme',
        content: '主题标题',
        description: '研究目标说明',
        x: 0,
        y: 0,
      });
      const result = await db.nodes.get('n-theme-desc');
      expect(result?.description).toBe('研究目标说明');
      await db.nodes.update('n-theme-desc', { description: '更新后的说明' });
      expect((await db.nodes.get('n-theme-desc'))?.description).toBe('更新后的说明');
    });
  });

  // --- 文章 (articles) ---
  describe('articles 表', () => {
    it('能添加和读取文章', async () => {
      const article: Article = {
        id: 'a1', title: 'Test Article', content: 'Body text',
        date: '2024', type: 'GEN-001'
      };
      await db.articles.add(article);
      const result = await db.articles.get('a1');
      expect(result?.title).toBe('Test Article');
    });

    it('能按 type 过滤文章', async () => {
      await db.articles.bulkAdd([
        { id: 'a1', title: 'A', content: '', date: '2024', type: 'REF-001' },
        { id: 'a2', title: 'B', content: '', date: '2024', type: 'GEN-002' },
      ]);

      const refs = await db.articles.where('type').equals('REF-001').toArray();
      expect(refs).toHaveLength(1);
    });

    it('能用 put 更新已有文章', async () => {
      await db.articles.put({ id: 'a1', title: 'old', content: '', date: '2024', type: 'GEN' });
      await db.articles.put({ id: 'a1', title: 'updated', content: 'new content', date: '2025', type: 'GEN' });
      const result = await db.articles.get('a1');
      expect(result?.title).toBe('updated');
      expect(result?.content).toBe('new content');
    });

    it('能删除文章', async () => {
      await db.articles.add({ id: 'a1', title: 'X', content: '', date: '2024', type: 'REF' });
      await db.articles.delete('a1');
      const count = await db.articles.count();
      expect(count).toBe(0);
    });

    it('可存 tags、linkedCanvasIds 等扩展字段', async () => {
      await db.articles.add({
        id: 'a-ext',
        title: 'T',
        content: 'c',
        date: '2024',
        type: 'REF',
        tags: ['x'],
        privateNotes: 'note',
        linkedCanvasIds: ['default'],
        author: 'Me',
      });
      const r = await db.articles.get('a-ext');
      expect(r?.tags).toEqual(['x']);
      expect(r?.privateNotes).toBe('note');
      expect(r?.linkedCanvasIds).toEqual(['default']);
      expect(r?.author).toBe('Me');
    });
  });

  // --- AI 代理配置 (agents) ---
  describe('agents 表', () => {
    it('能添加和读取代理配置', async () => {
      const agent: AgentConfig = {
        id: 'ag1', name: 'Challenger', role: 'Debater',
        prompt: 'Challenge everything', temperature: 0.7, creativity: 0.4, color: '#ff0000'
      };
      await db.agents.add(agent);
      const result = await db.agents.get('ag1');
      expect(result?.name).toBe('Challenger');
      expect(result?.role).toBe('Debater');
    });

    it('能按 role 过滤代理', async () => {
      await db.agents.bulkAdd([
        { id: 'ag1', name: 'A', role: 'Editor', prompt: '' },
        { id: 'ag2', name: 'B', role: 'Writer', prompt: '' },
        { id: 'ag3', name: 'C', role: 'Editor', prompt: '' },
      ]);
      const editors = await db.agents.where('role').equals('Editor').toArray();
      expect(editors).toHaveLength(2);
    });

    it('能更新代理配置', async () => {
      await db.agents.add({ id: 'ag1', name: 'Old', role: 'R', prompt: 'P' });
      await db.agents.update('ag1', { name: 'New', temperature: 0.9 });
      const result = await db.agents.get('ag1');
      expect(result?.name).toBe('New');
      expect(result?.temperature).toBe(0.9);
    });

    it('能删除代理配置', async () => {
      await db.agents.add({ id: 'ag1', name: 'X', role: 'R', prompt: 'P' });
      await db.agents.delete('ag1');
      const count = await db.agents.count();
      expect(count).toBe(0);
    });

    it('支持可选参数（temperature, creativity, color）', async () => {
      await db.agents.add({ id: 'ag1', name: 'A', role: 'R', prompt: 'P' });
      const result = await db.agents.get('ag1');
      expect(result?.temperature).toBeUndefined();
      expect(result?.creativity).toBeUndefined();
      expect(result?.color).toBeUndefined();
    });

    it('能读写 coverImageUrl', async () => {
      await db.agents.add({
        id: 'ag1',
        name: 'A',
        role: 'R',
        prompt: 'P',
        coverImageUrl: 'https://img.example/cover.jpg',
      });
      expect((await db.agents.get('ag1'))?.coverImageUrl).toBe('https://img.example/cover.jpg');
      await db.agents.update('ag1', { coverImageUrl: 'https://img.example/next.jpg' });
      expect((await db.agents.get('ag1'))?.coverImageUrl).toBe('https://img.example/next.jpg');
    });
  });

  // --- 边 (edges) ---
  describe('edges 表', () => {
    it('能添加和读取边', async () => {
      const edge: Edge = { id: 'e1', from: 'n1', to: 'n2' };
      await db.edges.add(edge);
      const result = await db.edges.get('e1');
      expect(result?.from).toBe('n1');
      expect(result?.to).toBe('n2');
    });

    it('能按 from 过滤边', async () => {
      await db.edges.bulkAdd([
        { id: 'e1', from: 'n1', to: 'n2' },
        { id: 'e2', from: 'n1', to: 'n3' },
        { id: 'e3', from: 'n2', to: 'n3' },
      ]);
      const fromN1 = await db.edges.where('from').equals('n1').toArray();
      expect(fromN1).toHaveLength(2);
    });

    it('能按 canvasId 过滤边', async () => {
      await db.edges.bulkAdd([
        { id: 'e1', from: 'n1', to: 'n2', canvasId: 'c1' },
        { id: 'e2', from: 'n2', to: 'n3', canvasId: 'c2' },
      ]);
      const c1Edges = await db.edges.where('canvasId').equals('c1').toArray();
      expect(c1Edges).toHaveLength(1);
    });

    it('删除节点时能级联删除关联的边', async () => {
      await db.nodes.bulkAdd([
        { id: 'n1', type: 'note', x: 0, y: 0 },
        { id: 'n2', type: 'note', x: 100, y: 100 },
      ]);
      await db.edges.bulkAdd([
        { id: 'e1', from: 'n1', to: 'n2' },
        { id: 'e2', from: 'n2', to: 'n1' },
      ]);

      // 模拟 App 中 removeNodeId 的逻辑
      const nodeId = 'n1';
      await db.nodes.delete(nodeId);
      await db.edges.where('from').equals(nodeId).or('to').equals(nodeId).delete();

      const remaining = await db.edges.toArray();
      expect(remaining).toHaveLength(0);
    });
  });

  // --- 画布 (canvases) ---
  describe('canvases 表', () => {
    it('能添加和读取画布', async () => {
      const canvas: Canvas = {
        id: 'default', name: 'Main Workspace',
        createdAt: Date.now(), updatedAt: Date.now()
      };
      await db.canvases.add(canvas);
      const result = await db.canvases.get('default');
      expect(result?.name).toBe('Main Workspace');
    });

    it('能重命名画布', async () => {
      await db.canvases.add({
        id: 'c1', name: 'Old Name', createdAt: 1000, updatedAt: 1000
      });
      await db.canvases.update('c1', { name: 'New Name', updatedAt: 2000 });
      const result = await db.canvases.get('c1');
      expect(result?.name).toBe('New Name');
      expect(result?.updatedAt).toBe(2000);
    });

    it('能删除画布', async () => {
      await db.canvases.add({ id: 'c1', name: 'X', createdAt: 0, updatedAt: 0 });
      await db.canvases.delete('c1');
      const count = await db.canvases.count();
      expect(count).toBe(0);
    });

    it('能列出所有画布', async () => {
      await db.canvases.bulkAdd([
        { id: 'c1', name: 'A', createdAt: 1, updatedAt: 1 },
        { id: 'c2', name: 'B', createdAt: 2, updatedAt: 2 },
      ]);
      const all = await db.canvases.toArray();
      expect(all).toHaveLength(2);
    });
  });

  describe('agentSandboxThreads 表', () => {
    it('能按 agentId 写入与读取沙盒对话', async () => {
      await db.agentSandboxThreads.put({
        agentId: 'sandbox-agent-1',
        messages: [{ role: 'user', text: 'Hi' }],
        updatedAt: Date.now(),
      });
      const got = await db.agentSandboxThreads.get('sandbox-agent-1');
      expect(got?.messages).toEqual([{ role: 'user', text: 'Hi' }]);
    });
  });

  // --- 数据库结构完整性 ---
  describe('数据库结构', () => {
    it('导出的 db 实例是 MyDatabase 的实例', () => {
      expect(db).toBeInstanceOf(MyDatabase);
    });

    it('数据库名称为 CortexLocalDB', () => {
      expect(db.name).toBe('CortexLocalDB');
    });

    it('包含画布相关数据表', () => {
      expect(db.tables.map((t) => t.name).sort()).toEqual(
        [
          'agentSandboxThreads',
          'agents',
          'archiveFolders',
          'archivedCards',
          'articles',
          'canvasFolders',
          'canvasPersonaThreads',
          'canvasTemplates',
          'canvasWorkZones',
          'canvases',
          'edges',
          'nodes',
          'workspacePartitions',
          'workspaceState',
        ],
      );
    });
  });
});
