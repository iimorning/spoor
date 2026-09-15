import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { ArchiveLibrary } from '../../src/components/ArchiveLibrary';
import { db } from '../../src/db';
import {
  SELECTED_ARCHIVE_FOLDER_STORAGE_KEY,
} from '../../src/utils/archiveFolders';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) =>
        ({
          'archive.title': 'Knowledge Archive',
          'archive.intro': 'Intro',
          'archive.search_placeholder': 'Search knowledge archive…',
          'archive.empty': 'Nothing saved yet.',
          'archive.empty_search': 'No matches.',
          'archive.empty_folder': 'This folder is empty.',
          'archive.card_badge': 'Saved',
          'archive.no_excerpt': 'No preview',
          'archive.restore': 'Restore to canvas',
          'archive.delete': 'Delete forever',
          'archive.delete_confirm': 'Delete {{title}}?',
          'archive.folders_label': 'Folders',
          'archive.all_folders': 'All',
          'archive.unfiled': 'Unfiled',
          'archive.pocket': 'Memo',
          'archive.empty_pocket': 'No phone memos waiting.',
          'pocket.place': 'Pin to canvas',
          'pocket.delete_confirm': 'Delete {{title}}?',
          'pocket.untitled': 'Untitled memo',
          'archive.new_folder': 'New folder',
          'archive.folder_name_placeholder': 'Folder name',
          'archive.rename_folder': 'Rename folder',
          'archive.delete_folder': 'Delete folder',
          'archive.delete_folder_confirm': 'Delete folder {{name}}?',
          'archive.move_to': 'Move to',
          'archive.open_graph': 'Relationship graph',
          'canvas.graph_insight_note_title': 'Knowledge insight',
          'canvas.search_type_note': 'Note',
          'dialog.confirm': 'OK',
          'dialog.cancel': 'Cancel',
        }[key] ?? key),
    }),
  };
});

vi.mock('../../src/components/AppDialogProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/components/AppDialogProvider')>();
  return {
    ...actual,
    useAppDialog: () => ({
      confirm: vi.fn(async () => true),
      alert: vi.fn(async () => {}),
    }),
  };
});

vi.mock('../../src/components/CanvasGraphView', () => ({
  CanvasGraphView: ({
    onClose,
    onFocusNode,
    onSaveInsight,
  }: {
    onClose: () => void;
    onFocusNode: (node: { id: string }) => void;
    onSaveInsight: (payload: { hubId: string; memberIds: string[]; text: string }) => void | Promise<void>;
  }) => (
    <div data-testid="canvas-graph-view">
      <button type="button" data-testid="canvas-graph-close" onClick={onClose}>
        close
      </button>
      <button type="button" data-testid="canvas-graph-focus" onClick={() => onFocusNode({ id: 'a1' })}>
        focus
      </button>
      <button
        type="button"
        data-testid="canvas-graph-insight-save"
        onClick={() => void onSaveInsight({ hubId: 'a1', memberIds: ['a1'], text: 'Cluster insight body' })}
      >
        save
      </button>
    </div>
  ),
}));

const dummyAiConfig = {
  provider: 'doubao',
  apiKey: '',
  baseUrl: '',
  model: 'x',
};

function renderLibrary() {
  const transformRef = createRef<{ x: number; y: number; scale: number }>();
  transformRef.current = { x: 0, y: 0, scale: 1 };
  return render(
    <ArchiveLibrary
      activeCanvasId="default"
      transformRef={transformRef}
      aiConfig={dummyAiConfig}
    />,
  );
}

describe('ArchiveLibrary', () => {
  beforeEach(async () => {
    localStorage.removeItem(SELECTED_ARCHIVE_FOLDER_STORAGE_KEY);
    await db.archivedCards.clear();
    await db.archiveFolders.clear();
    await db.nodes.clear();
    await db.canvases.clear();
    await db.canvases.add({ id: 'default', name: 'Main', createdAt: 1, updatedAt: 1 });
  });

  it('shows empty state when archive is empty', async () => {
    renderLibrary();
    expect(await screen.findByText('Nothing saved yet.')).toBeInTheDocument();
  });

  it('lists archived cards and filters by search', async () => {
    await db.archivedCards.bulkAdd([
      {
        id: 'a1',
        archivedAt: Date.now(),
        node: { id: 'n1', type: 'note', content: 'Spatial memory notes', x: 0, y: 0 },
      },
      {
        id: 'a2',
        archivedAt: Date.now() - 1000,
        node: { id: 'n2', type: 'note', content: 'Unrelated topic', x: 0, y: 0 },
      },
    ]);
    renderLibrary();
    expect(await screen.findByTestId('archive-card-a1')).toBeInTheDocument();
    expect(screen.getByTestId('archive-card-a2')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('archive-search'), {
      target: { value: 'Spatial' },
    });
    expect(await screen.findByTestId('archive-card-a1')).toBeInTheDocument();
    expect(screen.queryByTestId('archive-card-a2')).not.toBeInTheDocument();
  });

  it('creates a folder and filters archived cards by it', async () => {
    await db.archiveFolders.add({
      id: 'f1',
      name: 'Quotes',
      createdAt: 1,
      sortOrder: 0,
    });
    await db.archivedCards.bulkAdd([
      {
        id: 'a1',
        archivedAt: Date.now(),
        folderId: 'f1',
        node: { id: 'n1', type: 'note', content: 'In quotes', x: 0, y: 0 },
      },
      {
        id: 'a2',
        archivedAt: Date.now() - 1000,
        node: { id: 'n2', type: 'note', content: 'Unfiled note', x: 0, y: 0 },
      },
    ]);
    renderLibrary();
    expect(await screen.findByTestId('archive-card-a1')).toBeInTheDocument();
    expect(screen.getByTestId('archive-card-a2')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('archive-folder-f1'));
    await waitFor(() => {
      expect(screen.getByTestId('archive-card-a1')).toBeInTheDocument();
      expect(screen.queryByTestId('archive-card-a2')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('archive-folder-unfiled'));
    await waitFor(() => {
      expect(screen.getByTestId('archive-card-a2')).toBeInTheDocument();
      expect(screen.queryByTestId('archive-card-a1')).not.toBeInTheDocument();
    });
  });

  it('creates a folder from the sidebar', async () => {
    renderLibrary();
    fireEvent.click(await screen.findByTestId('archive-folder-create'));
    const input = screen.getByTestId('archive-folder-create-name');
    fireEvent.change(input, { target: { value: 'Research' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(async () => {
      const folders = await db.archiveFolders.toArray();
      expect(folders.some((f) => f.name === 'Research')).toBe(true);
    });
    expect(await screen.findByText('Research')).toBeInTheDocument();
  });

  it('opens and closes the knowledge graph overlay', async () => {
    await db.archivedCards.add({
      id: 'a1',
      archivedAt: Date.now(),
      node: { id: 'n1', type: 'note', content: 'Spatial memory notes', x: 0, y: 0 },
    });
    renderLibrary();
    fireEvent.click(await screen.findByTestId('archive-open-graph'));
    expect(await screen.findByTestId('canvas-graph-view')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('canvas-graph-close'));
    await waitFor(() => {
      expect(screen.queryByTestId('canvas-graph-view')).not.toBeInTheDocument();
    });
  });

  it('saves a graph insight as an archived knowledge card', async () => {
    await db.archiveFolders.add({
      id: 'f1',
      name: 'Quotes',
      createdAt: 1,
      sortOrder: 0,
    });
    await db.archivedCards.add({
      id: 'a1',
      archivedAt: Date.now(),
      folderId: 'f1',
      node: { id: 'n1', type: 'note', content: 'Spatial memory notes', x: 0, y: 0 },
    });
    Element.prototype.scrollIntoView = vi.fn();
    renderLibrary();
    fireEvent.click(await screen.findByTestId('archive-open-graph'));
    fireEvent.click(await screen.findByTestId('canvas-graph-insight-save'));
    await waitFor(async () => {
      const cards = await db.archivedCards.toArray();
      expect(cards.some((c) => c.node.content?.includes('Cluster insight body'))).toBe(true);
    });
    await waitFor(() => {
      expect(screen.queryByTestId('canvas-graph-view')).not.toBeInTheDocument();
    });
    const saved = (await db.archivedCards.toArray()).find((c) =>
      c.node.content?.includes('Cluster insight body'),
    );
    expect(saved?.folderId).toBe('f1');
    expect(saved?.node.description).toBe('Knowledge insight');
  });

  it('lists phone memos in All and in the Pocket folder', async () => {
    await db.archivedCards.add({
      id: 'a1',
      archivedAt: Date.now(),
      node: { id: 'n1', type: 'note', content: 'Canvas snapshot', x: 0, y: 0 },
    });
    await db.nodes.add({
      id: 'p1',
      type: 'note',
      content: 'Phone memo waiting',
      x: 0,
      y: 0,
      canvasId: '__pocket__',
      createdAt: Date.now(),
    });
    renderLibrary();
    expect(await screen.findByTestId('archive-card-a1')).toBeInTheDocument();
    expect(screen.getByTestId('archive-card-pocket:p1')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('archive-folder-pocket'));
    await waitFor(() => {
      expect(screen.getByTestId('archive-card-pocket:p1')).toBeInTheDocument();
      expect(screen.queryByTestId('archive-card-a1')).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId('archive-open-graph')).not.toBeInTheDocument();
    expect(screen.queryByTestId('archive-move-pocket:p1')).not.toBeInTheDocument();
  });

  it('restoring a pocket memo pins it onto the current canvas', async () => {
    await db.nodes.add({
      id: 'p1',
      type: 'note',
      content: 'Pin me',
      x: 0,
      y: 0,
      canvasId: '__pocket__',
      createdAt: Date.now(),
    });
    const onRestored = vi.fn();
    const transformRef = createRef<{ x: number; y: number; scale: number }>();
    transformRef.current = { x: 0, y: 0, scale: 1 };
    render(
      <ArchiveLibrary
        activeCanvasId="default"
        transformRef={transformRef}
        aiConfig={dummyAiConfig}
        onRestored={onRestored}
      />,
    );
    fireEvent.click(await screen.findByTestId('archive-restore-pocket:p1'));
    await waitFor(async () => {
      expect((await db.nodes.get('p1'))?.canvasId).toBe('default');
    });
    expect(onRestored).toHaveBeenCalled();
  });

  it('shows pocket empty copy in the Pocket folder', async () => {
    renderLibrary();
    fireEvent.click(await screen.findByTestId('archive-folder-pocket'));
    expect(await screen.findByText('No phone memos waiting.')).toBeInTheDocument();
  });
});
