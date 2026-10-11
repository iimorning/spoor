import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import Markdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import {
  Archive,
  ArrowUpRight,
  Folder,
  FolderPlus,
  Inbox,
  Layers,
  Network,
  NotebookPen,
  Pencil,
  Search,
  Trash2,
} from 'lucide-react';
import { db } from '../db';
import { useAppDialog } from './AppDialogProvider';
import type { AIConfig } from './AISettingsModal';
import { CanvasGraphView } from './CanvasGraphView';
import { ArchiveMoveToButton, ArchiveMoveMenuProvider } from './ArchiveMoveToButton';
import { getCanvasCenterPosition } from '../utils/canvas';
import type { CanvasTransformLike } from '../utils/canvas';
import {
  buildArchiveListItem,
  buildPocketArchiveListItem,
  deleteArchivedCard,
  filterAndSortArchiveItems,
  pocketNodeIdFromArchiveItem,
  restoreArchivedCard,
  saveArchivedInsight,
} from '../utils/archiveCards';
import {
  createArchiveFolder,
  deleteArchiveFolder,
  filterArchivedCardsByFolder,
  moveArchivedCard,
  readSelectedArchiveFolderFilter,
  renameArchiveFolder,
  writeSelectedArchiveFolderFilter,
  type ArchiveFolderFilter,
} from '../utils/archiveFolders';
import {
  archivedCardToGraphNode,
  buildArchiveKnowledgeEdges,
  expandInsightWithFolderMates,
} from '../utils/archiveKnowledgeGraph';
import { canvasNodeTypeLabelKey } from '../utils/canvasNodeSearch';
import { markdownBodyComponents, markdownGfmPlugins, markdownRehypePlugins } from './markdownBody';
import {
  POCKET_CANVAS_ID,
  deletePocketNote,
  isPocketImageNode,
  placePocketNoteOnCanvas,
  pocketNotePreview,
  sortPocketNotes,
} from '../utils/pocketNotes';

const ARCHIVE_MARKDOWN_PLUGINS = [...markdownGfmPlugins, remarkBreaks];

export interface ArchiveLibraryProps {
  activeCanvasId: string;
  transformRef: React.RefObject<CanvasTransformLike>;
  aiConfig: AIConfig;
  /** After restoring a card, switch back to canvas. */
  onRestored?: () => void;
}

export function ArchiveLibrary({
  activeCanvasId,
  transformRef,
  aiConfig,
  onRestored,
}: ArchiveLibraryProps) {
  const { t } = useTranslation();
  const { confirm } = useAppDialog();
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [folderFilter, setFolderFilter] = useState<ArchiveFolderFilter>(() =>
    readSelectedArchiveFolderFilter(),
  );
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [showGraph, setShowGraph] = useState(false);
  const [focusArchiveId, setFocusArchiveId] = useState<string | null>(null);

  const folders =
    useLiveQuery(() => db.archiveFolders.orderBy('sortOrder').toArray(), []) ?? [];
  const rows = useLiveQuery(
    () => db.archivedCards.orderBy('archivedAt').reverse().toArray(),
    [],
  ) ?? [];
  // 只喂给关系图谱，而图谱默认关着——按需订阅，别让翻存档的人替它付这笔钱。
  const canvasEdges =
    useLiveQuery(() => (showGraph ? db.edges.toArray() : Promise.resolve([])), [showGraph]) ?? [];
  const pocketNodes =
    useLiveQuery(async () => {
      const all = await db.nodes.where('canvasId').equals(POCKET_CANVAS_ID).toArray();
      return sortPocketNotes(all);
    }, []) ?? [];

  useEffect(() => {
    if (folderFilter === 'all' || folderFilter === 'unfiled' || folderFilter === 'pocket') return;
    if (folders.some((f) => f.id === folderFilter)) return;
    setFolderFilter('all');
    writeSelectedArchiveFolderFilter('all');
  }, [folders, folderFilter]);

  useEffect(() => {
    if (folderFilter === 'pocket') setShowGraph(false);
  }, [folderFilter]);

  const selectFolder = (next: ArchiveFolderFilter) => {
    setFolderFilter(next);
    writeSelectedArchiveFolderFilter(next);
  };

  const pocketItems = useMemo(
    () =>
      pocketNodes
        .filter((node) => isPocketImageNode(node) || pocketNotePreview(node.content))
        .map(buildPocketArchiveListItem),
    [pocketNodes],
  );

  const folderCounts = useMemo(() => {
    let unfiled = 0;
    const byId = new Map<string, number>();
    for (const row of rows) {
      if (!row.folderId) {
        unfiled += 1;
        continue;
      }
      byId.set(row.folderId, (byId.get(row.folderId) ?? 0) + 1);
    }
    return {
      all: rows.length + pocketItems.length,
      unfiled,
      pocket: pocketItems.length,
      byId,
    };
  }, [rows, pocketItems.length]);

  const items = useMemo(() => {
    const archived = filterArchivedCardsByFolder(rows, folderFilter).map(buildArchiveListItem);
    const withPocket =
      folderFilter === 'all' || folderFilter === 'pocket' ? [...archived, ...pocketItems] : archived;
    return filterAndSortArchiveItems(withPocket, query);
  }, [rows, query, folderFilter, pocketItems]);

  const folderRows = useMemo(
    () => filterArchivedCardsByFolder(rows, folderFilter),
    [rows, folderFilter],
  );
  const graphNodes = useMemo(
    () => folderRows.map(archivedCardToGraphNode),
    [folderRows],
  );
  const graphEdges = useMemo(
    () => buildArchiveKnowledgeEdges(folderRows, canvasEdges),
    [folderRows, canvasEdges],
  );

  useEffect(() => {
    if (!focusArchiveId) return;
    const el = document.querySelector(`[data-testid="archive-card-${focusArchiveId}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFocusArchiveId(null);
  }, [focusArchiveId, items]);

  const handleRestore = async (item: (typeof items)[number]) => {
    setBusyId(item.id);
    try {
      if (item.origin === 'pocket') {
        const nodeId = pocketNodeIdFromArchiveItem(item.id);
        const obstacles = (await db.nodes.toArray()).filter(
          (node) =>
            node.canvasId !== POCKET_CANVAS_ID &&
            ((node.canvasId === activeCanvasId) || (!node.canvasId && activeCanvasId === 'default')),
        );
        const ok = await placePocketNoteOnCanvas({
          id: nodeId,
          canvasId: activeCanvasId,
          transform: transformRef.current ?? { x: 0, y: 0, scale: 1 },
          obstacles,
        });
        if (ok) onRestored?.();
        return;
      }
      const pos = getCanvasCenterPosition(transformRef.current ?? { x: 0, y: 0, scale: 1 });
      await restoreArchivedCard(item.id, activeCanvasId, pos);
      onRestored?.();
    } catch (e) {
      console.error('[Spoor] restore archive item failed', e);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (item: (typeof items)[number]) => {
    const ok = await confirm({
      message: t(item.origin === 'pocket' ? 'pocket.delete_confirm' : 'archive.delete_confirm', {
        title: item.title,
      }),
      variant: 'danger',
      confirmLabel: t('dialog.confirm'),
      cancelLabel: t('dialog.cancel'),
    });
    if (!ok) return;
    setBusyId(item.id);
    try {
      if (item.origin === 'pocket') {
        await deletePocketNote(pocketNodeIdFromArchiveItem(item.id));
      } else {
        await deleteArchivedCard(item.id);
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    const folder = await createArchiveFolder(name);
    setCreatingFolder(false);
    setNewFolderName('');
    selectFolder(folder.id);
  };

  const handleRenameFolder = async (id: string) => {
    const name = renameValue.trim();
    if (!name) {
      setRenamingId(null);
      return;
    }
    await renameArchiveFolder(id, name);
    setRenamingId(null);
  };

  const handleDeleteFolder = async (id: string, name: string) => {
    const ok = await confirm({
      message: t('archive.delete_folder_confirm', { name }),
      variant: 'danger',
      confirmLabel: t('dialog.confirm'),
      cancelLabel: t('dialog.cancel'),
    });
    if (!ok) return;
    await deleteArchiveFolder(id);
    if (folderFilter === id) selectFolder('all');
  };

  const handleOpenGraph = () => setShowGraph(true);

  const handleFocusGraphNode = useCallback(
    (node: { id: string }) => {
      setShowGraph(false);
      setQuery('');
      setFocusArchiveId(node.id);
    },
    [],
  );

  const handleSaveInsight = useCallback(
    async (payload: { hubId: string; text: string }) => {
      const entry = await saveArchivedInsight({
        hubId: payload.hubId,
        text: payload.text,
        title: t('canvas.graph_insight_note_title'),
      });
      setShowGraph(false);
      setQuery('');
      const hub = rows.find((r) => r.id === payload.hubId);
      if (hub?.folderId) selectFolder(hub.folderId);
      else selectFolder('unfiled');
      setFocusArchiveId(entry.id);
    },
    [rows, t],
  );

  const expandInsightMemberIds = useCallback(
    (hubId: string, memberIds: string[]) =>
      expandInsightWithFolderMates(hubId, memberIds, folderRows),
    [folderRows],
  );

  const emptyMessage =
    folderFilter === 'pocket'
      ? query.trim()
        ? t('archive.empty_search')
        : t('archive.empty_pocket')
      : rows.length === 0 && pocketItems.length === 0
        ? t('archive.empty')
        : query.trim()
          ? t('archive.empty_search')
          : t('archive.empty_folder');

  const folderNavItem = (active: boolean) =>
    `transition-colors border-l-4 ${
      active
        ? 'bg-[#F4F1ED] border-[#C2410C]'
        : 'border-transparent hover:bg-[#F4F1ED]/50'
    }`;

  const folderNavLabel = (active: boolean) =>
    `font-bold truncate ${active ? 'text-[#1a1a1a]' : 'text-[#5a5a54]'}`;

  const folderNavIcon = (active: boolean) =>
    `w-4 h-4 shrink-0 ${active ? 'text-[#C2410C]' : 'text-[#8c8a84]'}`;

  return (
    <div
      className="relative flex-1 min-h-0 overflow-hidden bg-[#FAF9F6] paper-texture pl-14 flex"
      data-testid="archive-library"
    >
      <nav
        className="w-56 compact:w-48 shrink-0 flex flex-col min-h-0 border-r border-[#E6E4DF] bg-white"
        data-testid="archive-folder-nav"
      >
        <div className="px-4 py-2 text-[10px] font-mono uppercase tracking-wider text-[#8c8a84] border-b border-[#F4F1ED]">
          {t('archive.folders_label')}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <button
            type="button"
            data-testid="archive-folder-all"
            className={`w-full p-4 cursor-pointer text-left flex items-center gap-3 ${folderNavItem(folderFilter === 'all')}`}
            onClick={() => selectFolder('all')}
          >
            <Layers className={folderNavIcon(folderFilter === 'all')} />
            <span className={`flex-1 min-w-0 ${folderNavLabel(folderFilter === 'all')}`}>
              {t('archive.all_folders')}
            </span>
            <span className="text-[10px] font-mono text-[#8c8a84] shrink-0">{folderCounts.all}</span>
          </button>
          <button
            type="button"
            data-testid="archive-folder-unfiled"
            className={`w-full p-4 cursor-pointer text-left flex items-center gap-3 ${folderNavItem(folderFilter === 'unfiled')}`}
            onClick={() => selectFolder('unfiled')}
          >
            <Inbox className={folderNavIcon(folderFilter === 'unfiled')} />
            <span className={`flex-1 min-w-0 ${folderNavLabel(folderFilter === 'unfiled')}`}>
              {t('archive.unfiled')}
            </span>
            <span className="text-[10px] font-mono text-[#8c8a84] shrink-0">{folderCounts.unfiled}</span>
          </button>
          <button
            type="button"
            data-testid="archive-folder-pocket"
            className={`w-full p-4 cursor-pointer text-left flex items-center gap-3 ${folderNavItem(folderFilter === 'pocket')}`}
            onClick={() => selectFolder('pocket')}
          >
            <NotebookPen className={folderNavIcon(folderFilter === 'pocket')} />
            <span className={`flex-1 min-w-0 ${folderNavLabel(folderFilter === 'pocket')}`}>
              {t('archive.pocket')}
            </span>
            <span className="text-[10px] font-mono text-[#8c8a84] shrink-0">{folderCounts.pocket}</span>
          </button>

          {folders.map((folder) => (
            <div key={folder.id} className="group/folder relative">
              {renamingId === folder.id ? (
                <form
                  className="px-4 py-3 border-l-4 border-transparent"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleRenameFolder(folder.id);
                  }}
                >
                  <input
                    autoFocus
                    data-testid={`archive-folder-rename-${folder.id}`}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => void handleRenameFolder(folder.id)}
                    className="w-full bg-white border border-[#C2410C] rounded-lg px-3 py-2 text-xs text-[#1a1a1a] outline-none focus:ring-1 focus:ring-[#C2410C]"
                  />
                </form>
              ) : (
                <div className={`flex items-center ${folderNavItem(folderFilter === folder.id)}`}>
                  <button
                    type="button"
                    data-testid={`archive-folder-${folder.id}`}
                    className="flex-1 min-w-0 flex items-center gap-3 p-4 text-left"
                    onClick={() => selectFolder(folder.id)}
                  >
                    <Folder className={folderNavIcon(folderFilter === folder.id)} />
                    <span className={`flex-1 min-w-0 ${folderNavLabel(folderFilter === folder.id)}`}>
                      {folder.name}
                    </span>
                    <span className="text-[10px] font-mono text-[#8c8a84] shrink-0 transition-opacity group-hover/folder:opacity-0">
                      {folderCounts.byId.get(folder.id) ?? 0}
                    </span>
                  </button>
                  {/* 覆盖在计数之上：计数与默认行对齐，悬停时才让位 */}
                  <div className="absolute right-3 flex items-center gap-0.5 opacity-0 group-hover/folder:opacity-100 transition-opacity">
                    <button
                      type="button"
                      className="p-1.5 rounded-md text-[#8c8a84] hover:text-[#C2410C] hover:bg-[#EAE7E2]"
                      title={t('archive.rename_folder')}
                      aria-label={t('archive.rename_folder')}
                      onClick={() => {
                        setRenamingId(folder.id);
                        setRenameValue(folder.name);
                      }}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      className="p-1.5 rounded-md text-[#8c8a84] hover:text-[#C2410C] hover:bg-[#EAE7E2]"
                      title={t('archive.delete_folder')}
                      aria-label={t('archive.delete_folder')}
                      data-testid={`archive-folder-delete-${folder.id}`}
                      onClick={() => void handleDeleteFolder(folder.id, folder.name)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="border-t border-[#E6E4DF]">
          {creatingFolder ? (
            <form
              className="p-4"
              onSubmit={(e) => {
                e.preventDefault();
                void handleCreateFolder();
              }}
            >
              <input
                autoFocus
                data-testid="archive-folder-create-name"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setCreatingFolder(false);
                    setNewFolderName('');
                  }
                }}
                placeholder={t('archive.folder_name_placeholder')}
                className="w-full bg-white border border-[#C2410C] rounded-lg px-3 py-2 text-xs text-[#1a1a1a] outline-none focus:ring-1 focus:ring-[#C2410C]"
              />
            </form>
          ) : (
            <button
              type="button"
              data-testid="archive-folder-create"
              className="w-full p-4 cursor-pointer text-left flex items-center gap-3 text-sm font-bold text-[#C2410C] hover:bg-[#F4F1ED]/50 transition-colors"
              onClick={() => setCreatingFolder(true)}
            >
              <FolderPlus className="w-4 h-4 shrink-0" />
              {t('archive.new_folder')}
            </button>
          )}
        </div>
      </nav>

      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-8 py-10 md:px-12 md:py-14">
          <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between md:gap-10 mb-12">
            <div className="min-w-0 max-w-xl">
              <h1 className="font-sans text-4xl md:text-5xl font-bold tracking-tight text-[#1a1a1a]">
                {t('archive.title')}
              </h1>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-4 shrink-0">
              <label className="relative flex-1 min-w-[12rem]">
                <span className="sr-only">{t('archive.search_placeholder')}</span>
                <Search className="pointer-events-none absolute left-0 bottom-2.5 w-4 h-4 text-[#8c8a84]" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('archive.search_placeholder')}
                  data-testid="archive-search"
                  className="w-full bg-transparent border-0 border-b border-[#d1cfca] pl-6 pr-2 py-2 text-sm text-[#1a1a1a] placeholder:text-[#a8a6a0] focus:outline-none focus:border-[#C2410C]"
                />
              </label>
              {folderFilter !== 'pocket' ? (
              <button
                type="button"
                data-testid="archive-open-graph"
                onClick={handleOpenGraph}
                className="inline-flex items-center gap-1.5 pb-2 border-b border-[#d1cfca] text-[11px] font-sans font-bold uppercase tracking-wider text-[#C2410C] hover:text-[#a0350a] transition-colors"
              >
                <Network className="w-3.5 h-3.5" />
                {t('archive.open_graph')}
              </button>
              ) : null}
            </div>
          </div>

          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <Archive className="w-10 h-10 text-[#d1cfca] mb-4" />
              <p className="text-sm text-[#8c8a84] font-sans max-w-sm">{emptyMessage}</p>
            </div>
          ) : (
            <ArchiveMoveMenuProvider>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5 md:gap-6">
              {items.map((item) => (
                <article
                  key={item.id}
                  data-testid={`archive-card-${item.id}`}
                  className="group flex flex-col h-[19.5rem] rounded-xl border border-[#E6E4DF] bg-white/80 p-4 transition-colors hover:border-[#C2410C]/40"
                >
                  <div className="flex items-center justify-between gap-3 mb-2 shrink-0">
                    <span className="text-[10px] font-sans font-bold uppercase tracking-[0.18em] text-[#C2410C]">
                      {item.origin === 'pocket' ? t('archive.pocket') : t(canvasNodeTypeLabelKey(item.type))}
                    </span>
                    <span className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 border border-[#E6E4DF] text-[#8c8a84]">
                      {item.dateLabel}
                    </span>
                  </div>

                  <h2 className="font-sans text-sm font-bold tracking-wide text-[#1a1a1a] leading-snug line-clamp-2 mb-2 shrink-0">
                    {item.title}
                  </h2>

                  <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1 mb-3">
                    {item.thumbnailUrl ? (
                      <img
                        src={item.thumbnailUrl}
                        alt=""
                        className="w-full h-24 object-cover rounded-lg border border-[#E6E4DF] bg-[#F4F1ED] mb-2"
                      />
                    ) : null}
                    {item.body ? (
                      <div className="markdown-body text-xs leading-relaxed text-[#5a5a54] font-serif">
                        <Markdown
                          remarkPlugins={ARCHIVE_MARKDOWN_PLUGINS}
                          rehypePlugins={markdownRehypePlugins}
                          components={markdownBodyComponents}
                        >
                          {item.body}
                        </Markdown>
                      </div>
                    ) : !item.thumbnailUrl ? (
                      <p className="text-xs leading-relaxed text-[#8c8a84] font-serif italic">
                        {t('archive.no_excerpt')}
                      </p>
                    ) : null}
                  </div>

                  <div className="pt-3 border-t border-[#E6E4DF] flex items-center justify-between gap-2 shrink-0">
                    <div className="flex items-center gap-1 min-w-0">
                      {item.origin === 'pocket' ? null : (
                        <ArchiveMoveToButton
                          cardId={item.id}
                          folderId={item.folderId ?? null}
                          folderName={
                            item.folderId
                              ? (folders.find((f) => f.id === item.folderId)?.name ?? null)
                              : null
                          }
                          disabled={busyId === item.id}
                          onMove={(next) => void moveArchivedCard(item.id, next)}
                        />
                      )}
                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => void handleDelete(item)}
                        data-testid={`archive-delete-${item.id}`}
                        title={t('archive.delete')}
                        aria-label={t('archive.delete')}
                        className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-[#8c8a84] hover:text-[#C2410C] hover:bg-[#F4F1ED] disabled:opacity-40 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" aria-hidden />
                      </button>
                    </div>
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => void handleRestore(item)}
                      data-testid={`archive-restore-${item.id}`}
                      title={item.origin === 'pocket' ? t('pocket.place') : t('archive.restore')}
                      aria-label={item.origin === 'pocket' ? t('pocket.place') : t('archive.restore')}
                      className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[#C2410C] text-white hover:bg-[#a0350a] disabled:opacity-40 transition-colors shrink-0"
                    >
                      <ArrowUpRight className="w-4 h-4" aria-hidden />
                    </button>
                  </div>
                </article>
              ))}
            </div>
            </ArchiveMoveMenuProvider>
          )}
        </div>
      </div>

      {showGraph ? (
        <CanvasGraphView
          nodes={graphNodes}
          edges={graphEdges}
          aiConfig={aiConfig}
          onClose={() => setShowGraph(false)}
          onFocusNode={handleFocusGraphNode}
          onSaveInsight={handleSaveInsight}
          expandInsightMemberIds={expandInsightMemberIds}
        />
      ) : null}
    </div>
  );
}
