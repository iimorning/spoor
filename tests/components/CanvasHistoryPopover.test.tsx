import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CanvasHistoryPopover } from '../../src/components/CanvasHistoryPopover';
import { persistCanvasHistoryDrop } from '../../src/utils/canvasHistoryFolders';
import { DEFAULT_WORKSPACE_COL_GAP } from '../../src/constants/defaultWorkspace';
import { ASK_NODE_SIZE, DEFAULT_NODE_SIZE } from '../../src/utils/canvas';
import { db } from '../../src/db';
import type { Canvas } from '../../src/db';

function canvas(partial: Partial<Canvas> & Pick<Canvas, 'id' | 'name'>): Canvas {
  return {
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

describe('CanvasHistoryPopover', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.edges.clear();
    await db.canvases.clear();
    await db.canvasTemplates.clear();
    await db.canvasFolders.clear();
  });

  it('opens another canvas on a single click anywhere on the row', async () => {
    const user = userEvent.setup();
    const setActiveCanvasId = vi.fn();
    render(
      <CanvasHistoryPopover
        canvases={[canvas({ id: 'c1', name: '画布 4' }), canvas({ id: 'c2', name: '画布 6' })]}
        activeCanvasId="c1"
        setActiveCanvasId={setActiveCanvasId}
      />,
    );

    await user.click(screen.getByTitle(/history|历史/i));
    await user.click(screen.getByTestId('canvas-open-c2'));

    expect(setActiveCanvasId).toHaveBeenCalledTimes(1);
    expect(setActiveCanvasId).toHaveBeenCalledWith('c2');
    expect(screen.queryByTestId('canvas-open-c2')).not.toBeInTheDocument();
  });

  it('shows a delete button beside each canvas name', async () => {
    const user = userEvent.setup();
    render(
      <CanvasHistoryPopover
        canvases={[canvas({ id: 'c1', name: '画布 4' }), canvas({ id: 'c2', name: '画布 6' })]}
        activeCanvasId="c1"
        setActiveCanvasId={() => {}}
      />,
    );

    await user.click(screen.getByTitle(/history|历史/i));
    expect(screen.getByTestId('canvas-delete-c1')).toBeInTheDocument();
    expect(screen.getByTestId('canvas-delete-c2')).toBeInTheDocument();
  });

  it('asks for confirmation and deletes the canvas from IndexedDB', async () => {
    const user = userEvent.setup();
    await db.canvases.bulkAdd([
      canvas({ id: 'c1', name: '画布 4', updatedAt: 20 }),
      canvas({ id: 'c2', name: '画布 6', updatedAt: 10 }),
    ]);
    await db.nodes.add({ id: 'n1', canvasId: 'c2', type: 'note', content: 'x', x: 0, y: 0 });

    const setActiveCanvasId = vi.fn();
    render(
      <CanvasHistoryPopover
        canvases={[
          canvas({ id: 'c1', name: '画布 4', updatedAt: 20 }),
          canvas({ id: 'c2', name: '画布 6', updatedAt: 10 }),
        ]}
        activeCanvasId="c1"
        setActiveCanvasId={setActiveCanvasId}
      />,
    );

    await user.click(screen.getByTitle(/history|历史/i));
    await user.click(screen.getByTestId('canvas-delete-c2'));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/本地和云端都不会再有备份|no local or cloud backup/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /确定|Confirm/i }));

    await waitFor(async () => {
      expect(await db.canvases.get('c2')).toBeUndefined();
    });
    expect(await db.canvases.get('c1')).toBeDefined();
    expect(await db.nodes.get('n1')).toBeUndefined();
    expect(setActiveCanvasId).not.toHaveBeenCalled();
  });

  it('switches away when the active canvas is deleted', async () => {
    const user = userEvent.setup();
    await db.canvases.bulkAdd([
      canvas({ id: 'c1', name: '画布 4', updatedAt: 20 }),
      canvas({ id: 'c2', name: '画布 6', updatedAt: 10 }),
    ]);

    const setActiveCanvasId = vi.fn();
    render(
      <CanvasHistoryPopover
        canvases={[
          canvas({ id: 'c1', name: '画布 4', updatedAt: 20 }),
          canvas({ id: 'c2', name: '画布 6', updatedAt: 10 }),
        ]}
        activeCanvasId="c2"
        setActiveCanvasId={setActiveCanvasId}
      />,
    );

    await user.click(screen.getByTitle(/history|历史/i));
    await user.click(screen.getByTestId('canvas-delete-c2'));
    await user.click(await screen.findByRole('button', { name: /确定|Confirm/i }));

    await waitFor(() => {
      expect(setActiveCanvasId).toHaveBeenCalledWith('c1');
    });
  });

  it('blocks deleting the last remaining canvas', async () => {
    const user = userEvent.setup();
    await db.canvases.add(canvas({ id: 'only', name: '画布 4' }));

    render(
      <CanvasHistoryPopover
        canvases={[canvas({ id: 'only', name: '画布 4' })]}
        activeCanvasId="only"
        setActiveCanvasId={() => {}}
      />,
    );

    await user.click(screen.getByTitle(/history|历史/i));
    await user.click(screen.getByTestId('canvas-delete-only'));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/至少保留一张画布|Keep at least one canvas/i)).toBeInTheDocument();
    expect(await db.canvases.get('only')).toBeDefined();
  });

  it('does not delete when confirmation is cancelled', async () => {
    const user = userEvent.setup();
    await db.canvases.bulkAdd([
      canvas({ id: 'c1', name: '画布 4' }),
      canvas({ id: 'c2', name: '画布 6' }),
    ]);

    render(
      <CanvasHistoryPopover
        canvases={[canvas({ id: 'c1', name: '画布 4' }), canvas({ id: 'c2', name: '画布 6' })]}
        activeCanvasId="c1"
        setActiveCanvasId={() => {}}
      />,
    );

    await user.click(screen.getByTitle(/history|历史/i));
    await user.click(screen.getByTestId('canvas-delete-c2'));
    await user.click(await screen.findByRole('button', { name: /取消|Cancel/i }));

    expect(await db.canvases.get('c2')).toBeDefined();
  });

  it('lists saved templates under new canvas and spawns from one', async () => {
    const user = userEvent.setup();
    const setActiveCanvasId = vi.fn();
    await db.canvasTemplates.add({
      id: 'tpl-intuition',
      name: '直觉泵：思想实验设计',
      description: 'Short intro.\n\n怎么用\n\n步骤\n1. 开始',
      origin: 'user',
      builtinKey: null,
      personaIds: ['agent-1'],
      nodes: [
        {
          key: 'note-start',
          type: 'note',
          contentText: '开始一次',
          xFrac: 0.1,
          yFrac: 0.5,
          wFrac: 0.2,
          hFrac: 0.1,
        },
        {
          key: 'agent-host',
          type: 'agent',
          agentConfigId: 'agent-1',
          xFrac: 0.5,
          yFrac: 0.4,
        },
      ],
      edges: [{ fromKey: 'note-start', toKey: 'agent-host', noteText: '运行' }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    render(
      <CanvasHistoryPopover
        canvases={[canvas({ id: 'c1', name: '画布 4' })]}
        activeCanvasId="c1"
        setActiveCanvasId={setActiveCanvasId}
      />,
    );

    await user.click(screen.getByTitle(/history|历史/i));
    await user.click(screen.getByTestId('canvas-spawn-template-tpl-intuition'));

    await waitFor(() => {
      expect(setActiveCanvasId).toHaveBeenCalled();
    });
    const spawnedId = setActiveCanvasId.mock.calls.at(-1)?.[0] as string;
    const spawnedNodes = await db.nodes.where('canvasId').equals(spawnedId).toArray();
    expect(spawnedNodes.some((n) => n.type === 'note')).toBe(true);
    expect(spawnedNodes.some((n) => n.type === 'agent')).toBe(true);
  });

  it('closes when clicking outside the popover', async () => {
    const user = userEvent.setup();
    render(
      <CanvasHistoryPopover
        canvases={[canvas({ id: 'c1', name: '画布 4' })]}
        activeCanvasId="c1"
        setActiveCanvasId={() => {}}
      />,
    );

    await user.click(screen.getByTitle(/history|历史/i));
    expect(screen.getByTestId('canvas-open-c1')).toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('canvas-open-c1')).not.toBeInTheDocument();
  });

  it('新建空白画布使用与默认工作区同一套 L 形 starter，且不用 default-* id', async () => {
    const user = userEvent.setup();
    const setActiveCanvasId = vi.fn();
    render(
      <CanvasHistoryPopover
        canvases={[canvas({ id: 'c1', name: '画布 4' })]}
        activeCanvasId="c1"
        setActiveCanvasId={setActiveCanvasId}
      />,
    );

    await user.click(screen.getByTitle(/history|历史/i));
    await user.click(screen.getByRole('button', { name: /新建空白画布|New blank canvas/i }));

    await waitFor(() => {
      expect(setActiveCanvasId).toHaveBeenCalled();
    });
    const spawnedId = setActiveCanvasId.mock.calls.at(-1)?.[0] as string;
    const spawned = (await db.nodes.where('canvasId').equals(spawnedId).toArray()).filter(
      (n) => n.type !== 'ambience',
    );
    expect(spawned.map((n) => n.type).sort()).toEqual(['ask', 'note', 'theme']);
    expect(spawned.some((n) => n.id.startsWith('default-'))).toBe(false);

    const ask = spawned.find((n) => n.type === 'ask')!;
    const theme = spawned.find((n) => n.type === 'theme')!;
    const note = spawned.find((n) => n.type === 'note')!;
    expect(ask.x).toBe(100);
    expect(ask.y).toBe(140);
    expect(theme.x).toBe(ask.x! + (ask.width ?? ASK_NODE_SIZE.width) + DEFAULT_WORKSPACE_COL_GAP);
    expect(theme.y).toBe(ask.y);
    expect(note.x).toBe(theme.x! + (theme.width ?? DEFAULT_NODE_SIZE.width) + DEFAULT_WORKSPACE_COL_GAP);
    expect(note.y).toBe(ask.y);

    const edges = await db.edges.where('canvasId').equals(spawnedId).toArray();
    expect(edges).toEqual([]);
  });

  it('creates a folder and nests a canvas after persist', async () => {
    const user = userEvent.setup();
    await db.canvases.bulkAdd([
      canvas({ id: 'c1', name: '画布 4' }),
      canvas({ id: 'c2', name: '给大成的培训' }),
    ]);

    render(
      <CanvasHistoryPopover
        canvases={[canvas({ id: 'c1', name: '画布 4' }), canvas({ id: 'c2', name: '给大成的培训' })]}
        activeCanvasId="c1"
        setActiveCanvasId={() => {}}
      />,
    );

    await user.click(screen.getByTitle(/history|历史/i));
    await user.click(screen.getByTestId('canvas-new-folder'));

    await waitFor(async () => {
      expect(await db.canvasFolders.count()).toBe(1);
    });
    const folder = (await db.canvasFolders.toArray())[0]!;
    expect(await screen.findByTestId(`canvas-folder-${folder.id}`)).toBeInTheDocument();

    await persistCanvasHistoryDrop({
      dragId: 'c2',
      dragKind: 'canvas',
      target: { id: folder.id, kind: 'folder', edge: 'into' },
      canvases: await db.canvases.toArray(),
      folders: await db.canvasFolders.toArray(),
    });
    expect((await db.canvases.get('c2'))?.folderId).toBe(folder.id);
  });
});
