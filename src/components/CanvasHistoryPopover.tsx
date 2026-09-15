import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Edit3, Folder, FolderOpen, History, Plus, Trash2 } from 'lucide-react';
import { db } from '../db';
import type { Canvas, CanvasFolder, CanvasTemplateDoc } from '../db';
import { ensureAmbienceNodeForCanvas } from '../utils/ensureAmbienceNode';
import { getSystemCanvasTemplates, spawnCanvasFromTemplate } from '../utils/canvasTemplate';
import { stampNewCards } from '../utils/stampNewCard';
import { buildDefaultWorkspace, defaultWorkspaceAmbiencePosition } from '../constants/defaultWorkspace';
import { ensureDefaultAskWorkZone } from '../utils/seedDefaultAskWorkZone';
import { deleteCanvasWithContents } from '../utils/deleteCanvasWithContents';
import {
  CANVAS_HISTORY_LONG_PRESS_MS,
  canvasesInFolder,
  createCanvasFolder,
  deleteCanvasFolder,
  hitTestHistoryDrop,
  nextCanvasSortOrder,
  persistCanvasHistoryDrop,
  renameCanvasFolder,
  sortCanvasFolders,
  type HistoryDragKind,
  type HistoryDropTarget,
} from '../utils/canvasHistoryFolders';
import { useAppDialog } from './AppDialogProvider';
import { canvasOverlayProps, canvasOverlayScrollClassName } from '../utils/canvasOverlay';

export interface CanvasHistoryPopoverProps {
  canvases: Canvas[];
  activeCanvasId: string;
  setActiveCanvasId: (id: string) => void;
}

type DragState = {
  id: string;
  kind: HistoryDragKind;
  drop: HistoryDropTarget | null;
};

function collectDropRects(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>('[data-history-drop]')].map((el) => {
    const box = el.getBoundingClientRect();
    return {
      id: el.dataset.historyId ?? '',
      kind: (el.dataset.historyKind ?? 'canvas') as HistoryDragKind | 'unfiled',
      top: box.top,
      bottom: box.bottom,
    };
  });
}

export function CanvasHistoryPopover({ canvases, activeCanvasId, setActiveCanvasId }: CanvasHistoryPopoverProps) {
  const { t } = useTranslation();
  const { confirm, alert: appAlert } = useAppDialog();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const [isOpen, setIsOpen] = useState(false);
  const [editingCanvasId, setEditingCanvasId] = useState<string | null>(null);
  const [editingCanvasName, setEditingCanvasName] = useState('');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState('');
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [spawnableTemplates, setSpawnableTemplates] = useState<CanvasTemplateDoc[]>([]);
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<DragState | null>(null);

  const folders = useLiveQuery(() => db.canvasFolders.toArray(), []) ?? [];
  const sortedFolders = useMemo(() => sortCanvasFolders(folders), [folders]);
  const unfiledCanvases = useMemo(
    () => canvasesInFolder(canvases, null, folders),
    [canvases, folders],
  );

  const close = useCallback(() => {
    setIsOpen(false);
    setEditingCanvasId(null);
    setEditingFolderId(null);
    setDrag(null);
    dragRef.current = null;
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[role="dialog"]')) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [isOpen, close]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void (async () => {
      const userRows = await db.canvasTemplates.toArray();
      if (cancelled) return;
      const system = getSystemCanvasTemplates().filter((tpl) => tpl.listed !== false);
      const user = userRows.filter((row) => row.origin === 'user');
      setSpawnableTemplates([...system, ...user]);
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const renameCanvas = async (id: string, newName: string) => {
    if (!newName.trim()) return;
    await db.canvases.update(id, { name: newName, updatedAt: Date.now() });
    setEditingCanvasId(null);
  };

  const deleteCanvas = async (canvas: Canvas) => {
    if (deletingId) return;
    if (canvases.length <= 1) {
      await appAlert({ message: t('canvas.delete_canvas_last') });
      return;
    }
    const ok = await confirm({
      title: t('canvas.delete_canvas'),
      message: t('canvas.delete_canvas_confirm', { name: canvas.name }),
      variant: 'danger',
      confirmLabel: t('dialog.confirm'),
      cancelLabel: t('dialog.cancel'),
    });
    if (!ok) return;
    setDeletingId(canvas.id);
    try {
      const remaining = canvases.filter((c) => c.id !== canvas.id);
      await deleteCanvasWithContents(canvas.id);
      if (activeCanvasId === canvas.id) {
        const next = [...remaining].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
        if (next) setActiveCanvasId(next.id);
      }
    } finally {
      setDeletingId(null);
    }
  };

  const translateTemplateName = (tpl: CanvasTemplateDoc) => {
    if (tpl.origin === 'system') return t(tpl.name);
    return tpl.name;
  };

  const createCanvasFromTemplate = async (template: CanvasTemplateDoc) => {
    if (creating) return;
    setCreating(true);
    try {
      const baseName = translateTemplateName(template);
      const canvasId = await spawnCanvasFromTemplate(template, {
        canvasName: `${baseName}（${t('canvas.from_template_name', { name: '' })}）`,
      });
      setActiveCanvasId(canvasId);
      close();
    } finally {
      setCreating(false);
    }
  };

  const createBlankCanvas = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const id = crypto.randomUUID();
      const sortOrder = await nextCanvasSortOrder();
      await db.canvases.add({
        id,
        name: t('canvas.default_name', { number: canvases.length + 1 }),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        template: 'blank',
        sortOrder,
      });
      const askId = crypto.randomUUID();
      const { nodes } = buildDefaultWorkspace({
        canvasId: id,
        themeContent: t('canvas.starter.blank_theme'),
        noteContent: t('canvas.starter.blank_note'),
        ids: {
          theme: crypto.randomUUID(),
          note: crypto.randomUUID(),
          ask: askId,
        },
      });
      await db.nodes.bulkPut(stampNewCards(nodes));
      await ensureDefaultAskWorkZone({ canvasId: id, askNodeId: askId });
      await ensureAmbienceNodeForCanvas({
        canvasId: id,
        position: defaultWorkspaceAmbiencePosition(),
      });
      setActiveCanvasId(id);
      close();
    } finally {
      setCreating(false);
    }
  };

  const handleCreateFolder = async () => {
    const folder = await createCanvasFolder(
      t('canvas.new_folder_name', { number: folders.length + 1 }),
    );
    setCollapsedFolderIds((prev) => {
      const next = new Set(prev);
      next.delete(folder.id);
      return next;
    });
    setEditingFolderId(folder.id);
    setEditingFolderName(folder.name);
  };

  const handleRenameFolder = async (id: string, name: string) => {
    if (!name.trim()) {
      setEditingFolderId(null);
      return;
    }
    await renameCanvasFolder(id, name);
    setEditingFolderId(null);
  };

  const handleDeleteFolder = async (folder: CanvasFolder) => {
    const ok = await confirm({
      title: t('canvas.delete_folder'),
      message: t('canvas.delete_folder_confirm', { name: folder.name }),
      variant: 'danger',
      confirmLabel: t('dialog.confirm'),
      cancelLabel: t('dialog.cancel'),
    });
    if (!ok) return;
    await deleteCanvasFolder(folder.id);
  };

  const beginLongPressDrag = useCallback(
    (e: React.PointerEvent, id: string, kind: HistoryDragKind) => {
      if (e.button !== 0) return;
      if (editingCanvasId || editingFolderId) return;
      const target = e.target;
      if (target instanceof Element && target.closest('button, input, form')) return;

      e.preventDefault();
      const pointerId = e.pointerId;
      const startX = e.clientX;
      const startY = e.clientY;
      const el = e.currentTarget as HTMLElement;
      const isTouch = e.pointerType === 'touch';
      let armed = false;
      let cancelled = false;

      const arm = () => {
        if (armed || cancelled) return;
        armed = true;
        suppressClickRef.current = true;
        const next: DragState = { id, kind, drop: null };
        dragRef.current = next;
        setDrag(next);
        try {
          el.setPointerCapture(pointerId);
        } catch {
          /* jsdom */
        }
      };

      const timer = window.setTimeout(() => {
        if (isTouch) arm();
      }, CANVAS_HISTORY_LONG_PRESS_MS);

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
        if (!armed) {
          if (isTouch) {
            if (dist > 10) {
              cancelled = true;
              window.clearTimeout(timer);
            }
            return;
          }
          if (dist < 6) return;
          window.clearTimeout(timer);
          arm();
        }
        ev.preventDefault();
        const root = listRef.current;
        if (!root) return;
        const drop = hitTestHistoryDrop(ev.clientY, collectDropRects(root), { id, kind });
        const prev = dragRef.current;
        const same =
          prev?.drop?.id === drop?.id &&
          prev?.drop?.kind === drop?.kind &&
          prev?.drop?.edge === drop?.edge;
        if (same) return;
        const next: DragState = { id, kind, drop };
        dragRef.current = next;
        setDrag(next);
      };

      const finish = async (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        window.clearTimeout(timer);
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('pointerup', finish, true);
        window.removeEventListener('pointercancel', finish, true);
        const current = dragRef.current;
        dragRef.current = null;
        setDrag(null);
        try {
          el.releasePointerCapture(pointerId);
        } catch {
          /* already released */
        }
        if (armed && current?.drop) {
          await persistCanvasHistoryDrop({
            dragId: current.id,
            dragKind: current.kind,
            target: current.drop,
            canvases,
            folders,
          });
          if (current.drop.kind === 'folder' && current.drop.edge === 'into') {
            setCollapsedFolderIds((prev) => {
              const next = new Set(prev);
              next.delete(current.drop!.id);
              return next;
            });
          }
        }
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      };

      window.addEventListener('pointermove', onMove, { capture: true });
      window.addEventListener('pointerup', finish, { capture: true });
      window.addEventListener('pointercancel', finish, { capture: true });
    },
    [canvases, editingCanvasId, editingFolderId, folders],
  );

  const dropHighlight = (id: string, kind: HistoryDragKind | 'unfiled') => {
    if (!drag?.drop) return '';
    if (drag.drop.id !== id && !(kind === 'unfiled' && drag.drop.kind === 'unfiled')) return '';
    if (drag.drop.kind !== kind && !(kind === 'unfiled' && drag.drop.kind === 'unfiled')) return '';
    if (drag.drop.edge === 'into') return 'ring-1 ring-[#C2410C] bg-[#F4F1ED]';
    if (drag.drop.edge === 'before') return 'shadow-[inset_0_2px_0_0_#C2410C]';
    return 'shadow-[inset_0_-2px_0_0_#C2410C]';
  };

  const renderCanvasRow = (canvas: Canvas, nested: boolean) => (
    <div
      key={canvas.id}
      data-testid={`canvas-open-${canvas.id}`}
      data-history-drop=""
      data-history-id={canvas.id}
      data-history-kind="canvas"
      role="button"
      tabIndex={0}
      onPointerDown={(e) => {
        e.stopPropagation();
        beginLongPressDrag(e, canvas.id, 'canvas');
      }}
      onClick={() => {
        if (suppressClickRef.current) return;
        if (editingCanvasId === canvas.id) return;
        setActiveCanvasId(canvas.id);
        close();
      }}
      onKeyDown={(e) => {
        if (editingCanvasId === canvas.id) return;
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        setActiveCanvasId(canvas.id);
        close();
      }}
      title={t('canvas.history_drag_hint')}
      className={`group w-full text-left px-3 py-2 text-sm rounded-lg mb-1 transition-colors flex flex-col select-none ${
        nested ? 'ml-3 w-[calc(100%-0.75rem)]' : ''
      } ${drag?.id === canvas.id ? 'cursor-grabbing opacity-50' : 'cursor-grab'} ${
        activeCanvasId === canvas.id ? 'bg-[#F4F1ED] border border-[#E6E4DF]' : 'hover:bg-[#F4F1ED]'
      } ${dropHighlight(canvas.id, 'canvas')}`}
    >
      {editingCanvasId === canvas.id ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void renameCanvas(canvas.id, editingCanvasName);
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            autoFocus
            value={editingCanvasName}
            onChange={(e) => setEditingCanvasName(e.target.value)}
            onBlur={() => void renameCanvas(canvas.id, editingCanvasName)}
            className="flex-1 bg-white border border-[#C2410C] px-2 py-0.5 rounded outline-none text-xs text-[#1a1a1a]"
          />
        </form>
      ) : (
        <div className="font-bold flex items-center justify-between gap-1">
          <span className="flex-1 text-left truncate min-w-0">{canvas.name}</span>
          <div className="flex items-center gap-1.5 shrink-0">
            {canvas.template === 'cosmos' && (
              <span className="text-[9px] font-mono font-bold uppercase tracking-wide text-[#8c8a84] border border-[#E6E4DF] px-1 py-0.5 rounded">
                {t('canvas.template_cosmos_badge')}
              </span>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setEditingCanvasId(canvas.id);
                setEditingCanvasName(canvas.name);
              }}
              className="p-1 hover:text-[#C2410C] opacity-0 group-hover:opacity-100 transition-opacity"
              title={t('canvas.rename')}
            >
              <Edit3 className="w-3 h-3" />
            </button>
            <button
              type="button"
              data-testid={`canvas-delete-${canvas.id}`}
              disabled={deletingId === canvas.id}
              onClick={(e) => {
                e.stopPropagation();
                void deleteCanvas(canvas);
              }}
              className="p-1 text-[#8c8a84] hover:text-[#C2410C] disabled:opacity-40"
              title={t('canvas.delete_canvas')}
              aria-label={t('canvas.delete_canvas')}
            >
              <Trash2 className="w-3 h-3" />
            </button>
            {activeCanvasId === canvas.id && <div className="w-1.5 h-1.5 rounded-full bg-[#C2410C]" />}
          </div>
        </div>
      )}
      <div className="text-[10px] text-[#8c8a84]">{new Date(canvas.createdAt).toLocaleString()}</div>
    </div>
  );

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        data-testid="canvas-history"
        onClick={() => (isOpen ? close() : setIsOpen(true))}
        className="bg-white text-[#1a1a1a] p-2 rounded-full shadow-md hover:bg-[#F4F1ED] hover:text-[#C2410C] focus-visible:text-[#C2410C] transition-all flex items-center justify-center border border-[#E6E4DF] group"
        title={t('canvas.history')}
        aria-label={t('canvas.history')}
      >
        <History className="w-4 h-4 transition-transform group-hover:rotate-[-10deg]" />
      </button>

      {isOpen && (
        <div
          {...canvasOverlayProps}
          className="absolute top-full right-0 mt-2 w-72 bg-white border border-[#E6E4DF] rounded-xl shadow-2xl p-1 z-50"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2 border-b border-[#F4F1ED] mb-1 flex items-center justify-between gap-2">
            <div className="text-[10px] font-bold text-[#8c8a84] uppercase tracking-wider font-mono">
              {t('canvas.history')}
            </div>
            <button
              type="button"
              data-testid="canvas-new-folder"
              onClick={() => void handleCreateFolder()}
              className="text-[10px] font-bold text-[#C2410C] hover:bg-[#F4F1ED] rounded-md px-1.5 py-0.5 flex items-center gap-1 shrink-0 transition-colors"
            >
              <Folder className="w-3 h-3" />
              {t('canvas.new_folder')}
            </button>
          </div>
          <div
            ref={listRef}
            className={`max-h-72 overflow-y-auto ${canvasOverlayScrollClassName}`}
          >
            {sortedFolders.map((folder) => {
              const expanded = !collapsedFolderIds.has(folder.id);
              const members = canvasesInFolder(canvases, folder.id, folders);
              const FolderIcon = expanded ? FolderOpen : Folder;
              return (
                <div key={folder.id} className="mb-1">
                  <div
                    data-testid={`canvas-folder-${folder.id}`}
                    data-history-drop=""
                    data-history-id={folder.id}
                    data-history-kind="folder"
                    role="button"
                    tabIndex={0}
                    title={t('canvas.history_drag_hint')}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      beginLongPressDrag(e, folder.id, 'folder');
                    }}
                    onClick={() => {
                      if (suppressClickRef.current) return;
                      if (editingFolderId === folder.id) return;
                      setCollapsedFolderIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(folder.id)) next.delete(folder.id);
                        else next.add(folder.id);
                        return next;
                      });
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();
                      setCollapsedFolderIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(folder.id)) next.delete(folder.id);
                        else next.add(folder.id);
                        return next;
                      });
                    }}
                    className={`group w-full text-left px-3 py-2 text-sm rounded-lg transition-colors flex items-center gap-1.5 select-none hover:bg-[#F4F1ED] ${
                      drag?.id === folder.id ? 'cursor-grabbing opacity-50' : 'cursor-grab'
                    } ${dropHighlight(folder.id, 'folder')}`}
                  >
                    <ChevronRight
                      className={`w-3 h-3 text-[#8c8a84] shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
                    />
                    <FolderIcon className="w-3.5 h-3.5 text-[#C2410C] shrink-0" />
                    {editingFolderId === folder.id ? (
                      <form
                        className="flex-1 min-w-0"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void handleRenameFolder(folder.id, editingFolderName);
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          autoFocus
                          data-testid={`canvas-folder-rename-${folder.id}`}
                          value={editingFolderName}
                          onChange={(e) => setEditingFolderName(e.target.value)}
                          onBlur={() => void handleRenameFolder(folder.id, editingFolderName)}
                          className="w-full bg-white border border-[#C2410C] px-2 py-0.5 rounded outline-none text-xs text-[#1a1a1a]"
                        />
                      </form>
                    ) : (
                      <span className="flex-1 font-bold truncate min-w-0">{folder.name}</span>
                    )}
                    <span className="text-[10px] font-mono text-[#8c8a84] shrink-0">{members.length}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingFolderId(folder.id);
                        setEditingFolderName(folder.name);
                      }}
                      className="p-1 hover:text-[#C2410C] opacity-0 group-hover:opacity-100 transition-opacity"
                      title={t('canvas.rename_folder')}
                    >
                      <Edit3 className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      data-testid={`canvas-folder-delete-${folder.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDeleteFolder(folder);
                      }}
                      className="p-1 text-[#8c8a84] hover:text-[#C2410C] opacity-0 group-hover:opacity-100 transition-opacity"
                      title={t('canvas.delete_folder')}
                      aria-label={t('canvas.delete_folder')}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  {expanded && members.map((canvas) => renderCanvasRow(canvas, true))}
                </div>
              );
            })}
            {unfiledCanvases.map((canvas) => renderCanvasRow(canvas, false))}
            {sortedFolders.length > 0 && (
              <div
                data-history-drop=""
                data-history-id="unfiled"
                data-history-kind="unfiled"
                data-testid="canvas-history-unfiled-drop"
                className={`h-6 rounded-lg mb-1 ${dropHighlight('unfiled', 'unfiled')}`}
              />
            )}
          </div>
          <div className="p-1 mt-1 border-t border-[#F4F1ED] flex flex-col gap-0.5">
            <button
              type="button"
              data-testid="canvas-new-blank"
              onClick={() => void createBlankCanvas()}
              disabled={creating}
              className="w-full text-left px-3 py-2 text-sm text-[#C2410C] font-bold hover:bg-[#F4F1ED] rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              {t('canvas.new_blank_canvas')}
            </button>
            {spawnableTemplates.map((template) => (
              <button
                key={template.id}
                type="button"
                data-testid={`canvas-spawn-template-${template.id}`}
                disabled={creating}
                onClick={() => void createCanvasFromTemplate(template)}
                className="w-full text-left px-3 py-2 text-sm text-[#5a5a54] hover:bg-[#F4F1ED] rounded-lg transition-colors disabled:opacity-50 truncate"
              >
                {translateTemplateName(template)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
