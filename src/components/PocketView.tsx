import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Check, CircleUser, Plus, Trash2 } from 'lucide-react';
import { db } from '../db';
import { useAppDialog } from './AppDialogProvider';
import { useAdaptiveLayout } from '../hooks/useAdaptiveLayout';
import {
  POCKET_CANVAS_ID,
  createPocketNote,
  deletePocketNote,
  discardEmptyPocketNotes,
  pocketNotePreview,
  pocketNoteTitle,
  sortPocketNotes,
  updatePocketNoteContent,
  formatPocketTime,
} from '../utils/pocketNotes';


export interface PocketViewProps {
  /** Opens Settings → cloud account when Supabase is configured. */
  onOpenLogin?: () => void;
  /** When true, the header control reads as account/sync instead of sign-in. */
  accountSignedIn?: boolean;
}

const LONG_PRESS_MS = 480;
const LONG_PRESS_MOVE_PX = 12;

export function PocketView({
  onOpenLogin,
  accountSignedIn = false,
}: PocketViewProps) {
  const { t, i18n } = useTranslation();
  const { confirm } = useAppDialog();
  const { touchChrome, phone } = useAdaptiveLayout();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const editingIdRef = useRef(editingId);
  editingIdRef.current = editingId;
  const selectModeRef = useRef(selectMode);
  selectModeRef.current = selectMode;
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number; id: string } | null>(null);
  const suppressClickRef = useRef(false);
  const editorHistoryPushedRef = useRef(false);
  const skipEditorPopRef = useRef(false);
  const selectHistoryPushedRef = useRef(false);
  const skipSelectPopRef = useRef(false);

  const rows =
    useLiveQuery(async () => {
      const all = await db.nodes.where('canvasId').equals(POCKET_CANVAS_ID).toArray();
      return sortPocketNotes(all);
    }, []) ?? [];

  const notes = useMemo(
    () => rows.filter((node) => pocketNotePreview(node.content) || node.id === editingId),
    [rows, editingId],
  );

  useEffect(() => {
    void discardEmptyPocketNotes(editingId ?? undefined);
  }, [editingId]);

  useEffect(() => {
    if (!editingId) return;
    const id = window.setTimeout(() => {
      void updatePocketNoteContent(editingId, draftRef.current);
    }, 280);
    return () => window.clearTimeout(id);
  }, [draft, editingId]);

  useEffect(() => {
    if (!editingId) return;
    const id = window.requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
    return () => window.cancelAnimationFrame(id);
  }, [editingId]);

  const flushDraft = useCallback(async () => {
    const id = editingIdRef.current;
    if (!id) return;
    await updatePocketNoteContent(id, draftRef.current);
  }, []);

  const closeEditor = useCallback(async (fromHistory = false) => {
    const id = editingIdRef.current;
    if (!id) return;
    const text = draftRef.current.trim();
    if (!text) await deletePocketNote(id);
    else await updatePocketNoteContent(id, draftRef.current);
    setEditingId(null);
    setDraft('');
    if (fromHistory) {
      editorHistoryPushedRef.current = false;
      return;
    }
    if (editorHistoryPushedRef.current) {
      editorHistoryPushedRef.current = false;
      skipEditorPopRef.current = true;
      window.history.back();
    }
  }, []);

  const exitSelectMode = useCallback((fromHistory = false) => {
    if (!selectModeRef.current) return;
    setSelectMode(false);
    setSelectedIds(new Set());
    if (fromHistory) {
      selectHistoryPushedRef.current = false;
      return;
    }
    if (selectHistoryPushedRef.current) {
      selectHistoryPushedRef.current = false;
      skipSelectPopRef.current = true;
      window.history.back();
    }
  }, []);

  useEffect(() => {
    if (!editingId) return;
    window.history.pushState({ pocketEditor: true }, '');
    editorHistoryPushedRef.current = true;

    const onPopState = () => {
      if (skipEditorPopRef.current) {
        skipEditorPopRef.current = false;
        return;
      }
      if (!editingIdRef.current) return;
      void closeEditor(true);
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [editingId, closeEditor]);

  useEffect(() => {
    if (!selectMode) return;
    window.history.pushState({ pocketSelect: true }, '');
    selectHistoryPushedRef.current = true;

    const onPopState = () => {
      if (skipSelectPopRef.current) {
        skipSelectPopRef.current = false;
        return;
      }
      if (!selectModeRef.current) return;
      exitSelectMode(true);
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [selectMode, exitSelectMode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (editingIdRef.current) {
        void closeEditor();
        return;
      }
      if (selectModeRef.current) exitSelectMode();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeEditor, exitSelectMode]);

  const startNew = async () => {
    exitSelectMode();
    await flushDraft();
    const id = await createPocketNote('');
    setDraft('');
    setEditingId(id);
  };

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
  }, []);

  const openNote = (id: string, content: string) => {
    if (selectModeRef.current) return;
    exitSelectMode();
    setDraft(content);
    setEditingId(id);
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const enterSelectMode = (id: string) => {
    setSelectMode(true);
    setSelectedIds(new Set([id]));
  };

  const onCardPointerDown = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0 && e.pointerType !== 'touch') return;
    if (selectModeRef.current) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* jsdom */
    }
    clearLongPress();
    longPressStartRef.current = { x: e.clientX, y: e.clientY, id };
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      longPressStartRef.current = null;
      suppressClickRef.current = true;
      enterSelectMode(id);
    }, LONG_PRESS_MS);
  };

  const onCardPointerMove = (e: React.PointerEvent) => {
    const start = longPressStartRef.current;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (dx * dx + dy * dy > LONG_PRESS_MOVE_PX * LONG_PRESS_MOVE_PX) {
      clearLongPress();
    }
  };

  const onCardPointerEnd = () => {
    clearLongPress();
  };

  const onCardClick = (id: string, content: string) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (selectModeRef.current) {
      toggleSelected(id);
      return;
    }
    openNote(id, content);
  };

  const removeSelected = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const titles = notes
      .filter((node) => ids.includes(node.id))
      .map((node) => pocketNoteTitle(node.content) || t('pocket.untitled'));
    const ok = await confirm({
      message:
        ids.length === 1
          ? t('pocket.delete_confirm', { title: titles[0] ?? t('pocket.untitled') })
          : t('pocket.delete_n_confirm', { count: ids.length }),
      variant: 'danger',
      confirmLabel: t('dialog.confirm'),
      cancelLabel: t('dialog.cancel'),
    });
    if (!ok) return;
    await Promise.all(ids.map((id) => deletePocketNote(id)));
    exitSelectMode();
  };

  const padClass = phone
    ? 'pt-[calc(1.25rem+env(safe-area-inset-top))] px-7 pb-[calc(1.5rem+env(safe-area-inset-bottom))]'
    : touchChrome
      ? 'pt-[calc(4.75rem+env(safe-area-inset-top))] px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]'
      : 'pl-14 pr-8 py-8';
  const editorPadClass = phone
    ? 'pt-[calc(1.25rem+env(safe-area-inset-top))] px-7 pb-[calc(1.75rem+env(safe-area-inset-bottom))]'
    : touchChrome
      ? 'pt-[calc(4.75rem+env(safe-area-inset-top))] px-7 pb-[calc(1.75rem+env(safe-area-inset-bottom))]'
      : 'pl-16 pr-12 py-8';

  if (editingId) {
    return (
      <div
        className={`relative flex-1 min-h-0 overflow-hidden bg-[#FAF9F6] paper-texture flex flex-col ${editorPadClass}`}
        data-testid="pocket-view"
      >
        <header className="flex items-center justify-end shrink-0 mb-5">
          <button
            type="button"
            data-testid="pocket-back"
            onClick={() => void closeEditor()}
            className="w-10 h-10 flex items-center justify-center rounded-full text-[#5a5a54] hover:text-[#C2410C] hover:bg-white/90 border border-transparent hover:border-[#E6E4DF]"
            aria-label={t('pocket.back')}
            title={t('pocket.back')}
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        </header>
        <textarea
          ref={textareaRef}
          data-testid="pocket-editor"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('pocket.placeholder')}
          className="flex-1 min-h-0 w-full resize-none bg-transparent outline-none px-1 text-[1.125rem] text-[#1a1a1a] placeholder:text-[#8c8a84] pocket-text pocket-text-editor"
        />
      </div>
    );
  }

  return (
    <div
      className={`relative flex-1 min-h-0 overflow-hidden bg-[#FAF9F6] paper-texture flex flex-col ${padClass}`}
      data-testid="pocket-view"
    >
      <header className="shrink-0 mb-6 max-w-xl">
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-serif text-[#1a1a1a]">{t('pocket.title')}</h1>
          </div>
          {selectMode ? (
            <button
              type="button"
              data-testid="pocket-cancel-select"
              onClick={() => exitSelectMode()}
              className="shrink-0 h-10 px-3 rounded-full text-sm font-medium border border-[#E6E4DF] bg-white text-[#5a5a54] hover:text-[#C2410C] inline-flex items-center gap-1.5"
              title={t('pocket.cancel_select')}
            >
              {t('pocket.cancel_select')}
            </button>
          ) : onOpenLogin ? (
            <button
              type="button"
              data-testid="pocket-sign-in"
              onClick={onOpenLogin}
              className="shrink-0 w-10 h-10 flex items-center justify-center text-[#5a5a54] hover:text-[#C2410C] transition-colors"
              aria-label={accountSignedIn ? t('cloud.title') : t('cloud.signIn')}
              title={accountSignedIn ? t('cloud.title') : t('cloud.signIn')}
            >
              <CircleUser className="w-5 h-5" strokeWidth={1.75} />
            </button>
          ) : null}
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto max-w-xl pb-24">
        {notes.length === 0 ? (
          <p className="text-sm text-[#8c8a84] pocket-text leading-[1.75] tracking-[0.03em]" data-testid="pocket-empty">
            {t('pocket.empty')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {notes.map((node) => {
              const preview = pocketNotePreview(node.content);
              const title = pocketNoteTitle(node.content) || t('pocket.untitled');
              const selected = selectedIds.has(node.id);
              return (
                <li key={node.id}>
                  <div
                    role={selectMode ? 'checkbox' : 'button'}
                    aria-checked={selectMode ? selected : undefined}
                    aria-label={title}
                    tabIndex={0}
                    className={`w-full rounded-xl border px-4 py-3 text-left transition-colors select-none touch-manipulation cursor-pointer [-webkit-touch-callout:none] ${
                      selected
                        ? 'border-[#C2410C]/50 bg-white'
                        : 'border-[#E6E4DF] bg-white/80 hover:border-[#C2410C]/40'
                    }`}
                    data-testid={`pocket-item-${node.id}`}
                    data-selected={selected ? 'true' : 'false'}
                    onPointerDown={(e) => onCardPointerDown(e, node.id)}
                    onPointerMove={onCardPointerMove}
                    onPointerUp={onCardPointerEnd}
                    onPointerCancel={onCardPointerEnd}
                    onContextMenu={(e) => e.preventDefault()}
                    onClick={() => onCardClick(node.id, node.content ?? '')}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();
                      onCardClick(node.id, node.content ?? '');
                    }}
                  >
                    <div className={`flex gap-3 ${selectMode ? 'items-center' : 'items-start'}`}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="pocket-text pocket-text-list-title text-[#1a1a1a] line-clamp-1">{title}</span>
                          {!selectMode ? (
                            <span className="text-[11px] font-mono text-[#8c8a84] shrink-0">
                              {formatPocketTime(node.createdAt, i18n.language)}
                            </span>
                          ) : null}
                        </div>
                        {preview && preview !== title ? (
                          <p className="mt-1.5 text-[15px] text-[#5a5a54] line-clamp-2 whitespace-pre-wrap pocket-text pocket-text-list-preview">
                            {preview}
                          </p>
                        ) : null}
                      </div>
                      {selectMode ? (
                        <span
                          className={`w-5 h-5 shrink-0 self-center rounded-full border inline-flex items-center justify-center ${
                            selected
                              ? 'border-[#C2410C] bg-[#C2410C] text-white'
                              : 'border-[#d1cfca] bg-white text-transparent'
                          }`}
                          aria-hidden
                        >
                          <Check className="w-3 h-3" strokeWidth={3} />
                        </span>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {selectMode ? (
        <div className="absolute inset-x-0 bottom-0 px-4 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))] bg-gradient-to-t from-[#FAF9F6] via-[#FAF9F6] to-transparent">
          <button
            type="button"
            data-testid="pocket-select-delete"
            onClick={() => void removeSelected()}
            disabled={selectedIds.size === 0}
            className="w-full h-12 rounded-full bg-[#C2410C] text-white text-sm font-medium shadow-lg inline-flex items-center justify-center gap-2 disabled:opacity-40 disabled:pointer-events-none"
          >
            <Trash2 className="w-4 h-4" />
            {selectedIds.size > 1
              ? `${t('pocket.delete')} (${selectedIds.size})`
              : t('pocket.delete')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          data-testid="pocket-new"
          onClick={() => void startNew()}
          aria-label={t('pocket.new')}
          title={t('pocket.new')}
          className="absolute right-5 bottom-[calc(1.25rem+env(safe-area-inset-bottom))] coarse:right-4 w-14 h-14 rounded-full bg-[#C2410C] text-white shadow-lg shadow-[#C2410C]/25 hover:bg-[#9A3412] inline-flex items-center justify-center"
        >
          <Plus className="w-6 h-6" />
        </button>
      )}
    </div>
  );
}
