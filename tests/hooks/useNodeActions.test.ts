import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { useRef, useState } from 'react';
import { useNodeActions } from '../../src/hooks/useNodeActions';
import { db } from '../../src/db';
import i18n from '../../src/i18n';
import { AppDialogProvider } from '../../src/components/AppDialogProvider';
import { encodeEssayContent, tryParseEssayContent } from '../../src/utils/essayPayload';

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(AppDialogProvider, null, children);
}

function useTestNodeActions() {
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const edges: { from: string; to: string }[] = [];
  const nodesRef = useRef<Record<string, HTMLElement | null>>({});
  const transformRef = useRef({ x: 0, y: 0, scale: 1 });

  const actions = useNodeActions({
    activeCanvasId: 'default',
    nodesRef: nodesRef as React.RefObject<Record<string, HTMLElement | null>>,
    connectingFrom,
    setConnectingFrom,
    edges,
    selectedNodes,
    setSelectedNodes,
    transformRef: transformRef as React.RefObject<{ x: number; y: number; scale: number }>,
  });
  return { ...actions, selectedNodes, setSelectedNodes };
}

describe('useNodeActions', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.edges.clear();
    await db.articles.clear();
    await db.canvasWorkZones.clear();
    await db.canvasPersonaThreads.clear();
    localStorage.clear();
  });

  it('addTextNode 在数据库中创建 text 类型节点', async () => {
    const { result } = renderHook(() => useTestNodeActions(), { wrapper });

    await act(async () => {
      await result.current.addTextNode();
    });

    const nodes = await db.nodes.toArray();
    expect(nodes.length).toBe(1);
    expect(nodes[0].type).toBe('text');
    expect(nodes[0].content).toBe('');
    expect(nodes[0].canvasId).toBe('default');
    expect(typeof nodes[0].x).toBe('number');
    expect(typeof nodes[0].y).toBe('number');
  });

  it('addThemeNode 在数据库中创建 theme 类型节点', async () => {
    const { result } = renderHook(() => useTestNodeActions(), { wrapper });

    await act(async () => {
      await result.current.addThemeNode();
    });

    const nodes = await db.nodes.toArray();
    expect(nodes.length).toBe(1);
    expect(nodes[0].type).toBe('theme');
    expect(nodes[0].content).toBe(i18n.t('nodes.new_theme_title'));
    expect(nodes[0].canvasId).toBe('default');
  });

  it('addEssayNode 创建空白长文卡，不把选中卡写成来源或连线', async () => {
    await db.nodes.bulkAdd([
      { id: 'note-a', canvasId: 'default', type: 'note', content: 'a', x: 0, y: 0 },
      { id: 'note-b', canvasId: 'default', type: 'note', content: 'b', x: 40, y: 0 },
    ]);
    const { result } = renderHook(() => useTestNodeActions(), { wrapper });
    await act(async () => {
      result.current.setSelectedNodes(new Set(['note-a', 'note-b']));
    });
    await act(async () => {
      await result.current.addEssayNode();
    });

    const essays = (await db.nodes.toArray()).filter((n) => n.type === 'essay');
    expect(essays).toHaveLength(1);
    expect(essays[0]!.essaySourceNodeIds).toBeUndefined();
    expect(essays[0]!.description).toBe(i18n.t('nodes.essay_untitled'));
    const parsed = tryParseEssayContent(essays[0]!.content);
    const saved = await db.articles.get(parsed!.articleId);
    expect(saved?.sourceCards).toBeUndefined();
    expect(saved?.title).toBe(i18n.t('nodes.essay_untitled'));
    expect(await db.edges.count()).toBe(0);
    expect(result.current.selectedNodes).toEqual(new Set([essays[0]!.id]));
  });

  it('createLinkedNoteAt 在指定坐标创建便签并连到源卡', async () => {
    await db.nodes.add({
      id: 'src',
      canvasId: 'default',
      type: 'theme',
      content: 'Hub',
      x: 0,
      y: 0,
    });
    const { result } = renderHook(() => useTestNodeActions(), { wrapper });

    let newId: string | null = null;
    await act(async () => {
      newId = await result.current.createLinkedNoteAt('src', 120, 80);
    });

    expect(newId).toBeTruthy();
    const note = await db.nodes.get(newId!);
    expect(note).toMatchObject({
      type: 'text',
      content: '',
      x: 120,
      y: 80,
      canvasId: 'default',
    });
    expect(typeof note?.createdAt).toBe('number');
    const edges = await db.edges.toArray();
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ from: 'src', to: newId });
  });

  it('createLinkedNoteAt 落在已绑定房间内时写入 contextScopeAgentId', async () => {
    await db.canvasWorkZones.add({
      id: 'zone-a',
      canvasId: 'default',
      personaNodeId: 'agent-a',
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      createdAt: 0,
    });
    await db.nodes.add({
      id: 'src',
      canvasId: 'default',
      type: 'theme',
      content: 'Hub',
      x: 0,
      y: 0,
    });
    const { result } = renderHook(() => useTestNodeActions(), { wrapper });

    let newId: string | null = null;
    await act(async () => {
      newId = await result.current.createLinkedNoteAt('src', 80, 60);
    });

    const note = await db.nodes.get(newId!);
    expect(note?.contextScopeAgentId).toBe('agent-a');
  });

  it('createLinkedNoteAt 源卡不存在时返回 null', async () => {
    const { result } = renderHook(() => useTestNodeActions(), { wrapper });
    let newId: string | null = 'sentinel';
    await act(async () => {
      newId = await result.current.createLinkedNoteAt('missing', 0, 0);
    });
    expect(newId).toBeNull();
    expect(await db.nodes.count()).toBe(0);
  });

  it('addFileNode 一次可上传多个文件', async () => {
    const { result } = renderHook(() => useTestNodeActions(), { wrapper });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', {
      value: [
        new File(['one'], 'one.png', { type: 'image/png' }),
        new File(['two'], 'two.png', { type: 'image/png' }),
      ],
    });

    await act(async () => {
      await result.current.addFileNode({
        target: input,
      } as React.ChangeEvent<HTMLInputElement>);
    });

    const nodes = await db.nodes.toArray();
    expect(nodes.length).toBe(2);
    expect(nodes.every((n) => n.type === 'image')).toBe(true);
    expect(new Set(nodes.map((n) => n.x)).size).toBe(2);
  });

  it('deleteEdge 删除指定边', async () => {
    await db.edges.add({ id: 'e1', canvasId: 'default', from: 'a', to: 'b' });
    await db.edges.add({ id: 'e2', canvasId: 'default', from: 'c', to: 'd' });
    const { result } = renderHook(() => useTestNodeActions(), { wrapper });

    act(() => {
      result.current.deleteEdge('e1');
    });

    await new Promise(r => setTimeout(r, 50));
    const edges = await db.edges.toArray();
    expect(edges.length).toBe(1);
    expect(edges[0].id).toBe('e2');
  });

  it('removeNodeId 删除节点及其关联边', async () => {
    await db.nodes.add({ id: 'n1', canvasId: 'default', type: 'text', content: '', x: 0, y: 0 });
    await db.nodes.add({ id: 'n2', canvasId: 'default', type: 'text', content: '', x: 0, y: 0 });
    await db.edges.add({ id: 'e1', canvasId: 'default', from: 'n1', to: 'n2' });
    await db.edges.add({ id: 'e2', canvasId: 'default', from: 'n2', to: 'n1' });

    const { result } = renderHook(() => useTestNodeActions(), { wrapper });

    await act(async () => {
      result.current.removeNodeId('n1');
      await new Promise(r => setTimeout(r, 50));
    });

    const nodes = await db.nodes.toArray();
    expect(nodes.length).toBe(1);
    expect(nodes[0].id).toBe('n2');

    const edges = await db.edges.toArray();
    expect(edges.length).toBe(0);
  });

  it('removeNodeIds 批量删除多个节点并清理所有关联边', async () => {
    await db.nodes.add({ id: 'n1', canvasId: 'default', type: 'text', content: '', x: 0, y: 0 });
    await db.nodes.add({ id: 'n2', canvasId: 'default', type: 'text', content: '', x: 0, y: 0 });
    await db.nodes.add({ id: 'n3', canvasId: 'default', type: 'text', content: '留守', x: 0, y: 0 });
    await db.edges.add({ id: 'e1', canvasId: 'default', from: 'n1', to: 'n2' });
    await db.edges.add({ id: 'e2', canvasId: 'default', from: 'n2', to: 'n1' });
    await db.edges.add({ id: 'e3', canvasId: 'default', from: 'n1', to: 'n3' });
    await db.edges.add({ id: 'e_keep', canvasId: 'default', from: 'n3', to: 'n3' });

    const { result } = renderHook(() => useTestNodeActions(), { wrapper });

    await act(async () => {
      await result.current.removeNodeIds(['n1', 'n2']);
    });

    const nodes = await db.nodes.toArray();
    expect(nodes.length).toBe(1);
    expect(nodes[0].id).toBe('n3');

    const edges = await db.edges.toArray();
    expect(edges.length).toBe(1);
    expect(edges[0].id).toBe('e_keep');
  });

  it('removeNodeIds 对重复输入会自动去重', async () => {
    await db.nodes.add({ id: 'n1', canvasId: 'default', type: 'text', content: '', x: 0, y: 0 });
    await db.nodes.add({ id: 'n2', canvasId: 'default', type: 'text', content: '', x: 0, y: 0 });
    await db.edges.add({ id: 'e1', canvasId: 'default', from: 'n1', to: 'n2' });

    const { result } = renderHook(() => useTestNodeActions(), { wrapper });

    await act(async () => {
      await result.current.removeNodeIds(['n1', 'n1', 'n2']);
    });

    const nodes = await db.nodes.toArray();
    expect(nodes.length).toBe(0);

    const edges = await db.edges.toArray();
    expect(edges.length).toBe(0);
  });

  it('removeNodeIds 对空输入是 no-op（不报错也不动数据库）', async () => {
    await db.nodes.add({ id: 'n1', canvasId: 'default', type: 'text', content: '', x: 0, y: 0 });
    await db.edges.add({ id: 'e1', canvasId: 'default', from: 'n1', to: 'n1' });

    const { result } = renderHook(() => useTestNodeActions(), { wrapper });

    await act(async () => {
      await result.current.removeNodeIds([]);
    });

    expect(await db.nodes.count()).toBe(1);
    expect(await db.edges.count()).toBe(1);
  });

  it('删除共享文章的一张长文卡时保留文章与另一张卡', async () => {
    const user = userEvent.setup();
    await db.articles.add({
      id: 'art-1',
      title: 'Shared Essay',
      content: 'Body',
      date: '2026',
      type: 'GEN',
    });
    await db.nodes.bulkAdd([
      {
        id: 'e1',
        canvasId: 'default',
        type: 'essay',
        content: encodeEssayContent({ articleId: 'art-1' }),
        description: 'Shared Essay',
        x: 0,
        y: 0,
      },
      {
        id: 'e2',
        canvasId: 'default',
        type: 'essay',
        content: encodeEssayContent({ articleId: 'art-1' }),
        description: 'Shared Essay',
        x: 40,
        y: 0,
      },
    ]);

    const { result } = renderHook(() => useTestNodeActions(), { wrapper });
    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = result.current.removeNodeId('e1');
    });
    await user.click(await screen.findByRole('button', { name: i18n.t('dialog.confirm') }));
    await act(async () => {
      await pending;
    });

    expect(await db.nodes.get('e1')).toBeUndefined();
    expect(await db.nodes.get('e2')).toBeTruthy();
    expect(await db.articles.get('art-1')).toBeTruthy();
  });

  it('toggleNodeSelection 把卡片加入或移出选区', () => {
    const { result } = renderHook(() => useTestNodeActions(), { wrapper });
    act(() => {
      result.current.toggleNodeSelection('a');
      result.current.toggleNodeSelection('b');
    });
    expect([...result.current.selectedNodes].sort()).toEqual(['a', 'b']);
    act(() => {
      result.current.toggleNodeSelection('a');
    });
    expect([...result.current.selectedNodes]).toEqual(['b']);
  });

  it('removeNodeId unbinds the room and deletes the persona thread', async () => {
    await db.nodes.add({
      id: 'ask-1',
      canvasId: 'default',
      type: 'ask',
      content: '',
      x: 40,
      y: 40,
    });
    await db.canvasWorkZones.add({
      id: 'zone-a',
      canvasId: 'default',
      personaNodeId: 'ask-1',
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      createdAt: 0,
    });
    await db.canvasPersonaThreads.add({
      id: 'default:ask-1',
      canvasId: 'default',
      agentNodeId: 'ask-1',
      messages: [{ id: 'm1', role: 'user', text: 'hi', createdAt: 1 }],
      updatedAt: 1,
    });

    const { result } = renderHook(() => useTestNodeActions(), { wrapper });
    await act(async () => {
      await result.current.removeNodeId('ask-1');
    });

    expect(await db.nodes.get('ask-1')).toBeUndefined();
    expect((await db.canvasWorkZones.get('zone-a'))?.personaNodeId).toBeUndefined();
    expect(await db.canvasPersonaThreads.get('default:ask-1')).toBeUndefined();
  });
});
