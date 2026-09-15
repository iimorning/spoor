import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  GripVertical,
  Link2,
  Loader2,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  SidebarClose,
  SidebarOpen,
  Trash2,
  X,
} from 'lucide-react';
import { useAdaptiveLayout } from '../hooks/useAdaptiveLayout';
import { useOverlayDismiss } from '../hooks/useOverlayDismiss';
import { db } from '../db';
import type { SourceCardSegment } from '../db';
import { isContentBlurPersistenceDisabled } from '../config/persistence';
import { tryParseEssayContent } from '../utils/essayPayload';
import {
  countEssayChars,
  essayBodyMarkdown,
  isSourceSegmentInBody,
  sourceCardInBody,
} from '../utils/essayWordCount';
import { ESSAY_SOURCE_DRAG_MIME, repairEssayCollectedMedia, sourceCardPreviewImageSrc } from '../services/essayCollect';
import { articleHasLegacyMedia, extractEmbeddedArticleMedia } from '../utils/articleMedia';
import { persistEssayEditorBody } from '../utils/persistEssayEditorBody';
import { useAppDialog } from './AppDialogProvider';
import { EssayBodyEditor, type EssayBodyEditorHandle } from './essay/EssayBodyEditor';
import { EssayChatPanel } from './essay/EssayChatPanel';
import { EssayCopyButton } from './essay/EssayCopyButton';
import { EssayExportMenu } from './essay/EssayExportMenu';
import { formatSearchHitEssayMarkdown } from '../utils/askSearchHits';
import { useEssayChat } from '../hooks/useEssayChat';
import { useEssayChatVoice } from '../hooks/useEssayChatVoice';
import { hasMinimaxTtsAccess } from '../lib/serverConfig';
import { hasVolcAsrCredentials } from '../services/volcAsr';
import type { AIConfig } from './AISettingsModal';

export interface EssayFullscreenProps {
  articleId: string;
  onClose: () => void;
  /** Jump to a linked source canvas (closes fullscreen). */
  onOpenCanvas?: (canvasId: string) => void;
  aiConfig?: AIConfig | null;
}

export function EssayFullscreen({ articleId, onClose, onOpenCanvas, aiConfig = null }: EssayFullscreenProps) {
  const { t } = useTranslation();
  const { confirm } = useAppDialog();
  const canvases = useLiveQuery(() => db.canvases.toArray(), []) ?? [];
  // `undefined` = still loading; `null` = looked up and missing. Dexie's get()
  // returns undefined for both, which used to flash "deleted" then freeze on parse.
  const article = useLiveQuery(async () => {
    const row = await db.articles.get(articleId);
    return row ?? null;
  }, [articleId]);

  const [draftAuthor, setDraftAuthor] = useState('');
  const [draftDateField, setDraftDateField] = useState('');
  const [sidebarEditId, setSidebarEditId] = useState<string | null>(null);
  const [sidebarEditText, setSidebarEditText] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [mediaObjectUrls, setMediaObjectUrls] = useState<Record<string, string>>({});
  const [bodySeed, setBodySeed] = useState({ id: '', markdown: '', syncKey: 0 });
  const [bodyDropActive, setBodyDropActive] = useState(false);
  const [draggingSourceId, setDraggingSourceId] = useState<string | null>(null);
  const [sourceImagePreview, setSourceImagePreview] = useState<{ src: string; title: string } | null>(
    null,
  );

  const closeSourceImagePreview = useCallback(() => setSourceImagePreview(null), []);
  const { onBackdropMouseDown: onSourceImagePreviewBackdropMouseDown } = useOverlayDismiss(
    Boolean(sourceImagePreview),
    closeSourceImagePreview,
  );

  const authorMetaDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dateMetaDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sidebarEditDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyEditorRef = useRef<EssayBodyEditorHandle>(null);

  const needsMediaMigration = article ? articleHasLegacyMedia(article) : false;
  const sourceCards = article && !needsMediaMigration ? article.sourceCards ?? [] : [];
  const hasSourceCards = sourceCards.length > 0;
  const linkedIds = article?.linkedCanvasIds ?? [];
  const wordCount = useMemo(
    () => (article && !needsMediaMigration ? countEssayChars(essayBodyMarkdown(article)) : 0),
    [article, needsMediaMigration],
  );

  useEffect(() => {
    if (!article || !needsMediaMigration) return;
    let cancelled = false;
    void extractEmbeddedArticleMedia(article)
      .then(async (migrated) => {
        if (!cancelled) await db.articles.put(migrated);
      })
      .catch((error) => console.error('[Spoor] article media migration failed', error));
    return () => {
      cancelled = true;
    };
  }, [article, needsMediaMigration]);

  useEffect(() => {
    if (!article || needsMediaMigration || article.generating) return;
    void repairEssayCollectedMedia(article.id).catch((error) =>
      console.error('[Spoor] essay collected media repair failed', error),
    );
  }, [article?.id, needsMediaMigration, article?.generating]);

  useEffect(() => {
    const create = URL.createObjectURL?.bind(URL);
    const revoke = URL.revokeObjectURL?.bind(URL);
    if (!article?.media?.length || !create) {
      setMediaObjectUrls({});
      return;
    }
    const urls: Record<string, string> = {};
    for (const media of article.media) urls[media.id] = create(media.blob);
    setMediaObjectUrls(urls);
    return () => {
      if (revoke) Object.values(urls).forEach((url) => revoke(url));
    };
  }, [article?.id, article?.media]);

  const generatingRef = useRef(false);

  useEffect(() => {
    if (!article || needsMediaMigration) return;
    const md = essayBodyMarkdown(article);
    const wasGenerating = generatingRef.current;
    generatingRef.current = Boolean(article.generating);
    if (article.generating || wasGenerating) {
      setBodySeed((seed) => {
        if (seed.id === article.id && seed.markdown === md) return seed;
        return {
          id: article.id,
          markdown: md,
          syncKey: seed.id === article.id ? seed.syncKey + 1 : 1,
        };
      });
      return;
    }
    setBodySeed((seed) => {
      if (seed.id === article.id) return seed;
      return { id: article.id, markdown: md, syncKey: 0 };
    });
  }, [article, needsMediaMigration]);

  useEffect(() => {
    setSidebarEditId(null);
    setChatSelection('');
    setDraftAuthor(article?.author ?? '');
    setDraftDateField(article?.date ?? '');
    if (authorMetaDebounceRef.current) {
      clearTimeout(authorMetaDebounceRef.current);
      authorMetaDebounceRef.current = null;
    }
    if (dateMetaDebounceRef.current) {
      clearTimeout(dateMetaDebounceRef.current);
      dateMetaDebounceRef.current = null;
    }
  }, [article?.id]);

  useEffect(() => {
    return () => {
      if (authorMetaDebounceRef.current) clearTimeout(authorMetaDebounceRef.current);
      if (dateMetaDebounceRef.current) clearTimeout(dateMetaDebounceRef.current);
      if (sidebarEditDebounceRef.current) clearTimeout(sidebarEditDebounceRef.current);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { compact } = useAdaptiveLayout();
  // Below xl the side rails eat too much of the viewport, so they
  // collapse into slide-in drawers the user toggles from the top bar.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [railsCollapsed, setRailsCollapsed] = useState(false);
  const [chatSelection, setChatSelection] = useState('');

  const toggleRailsCollapsed = useCallback(() => {
    setRailsCollapsed((prev) => {
      const next = !prev;
      if (next) {
        setDrawerOpen(false);
        setChatOpen(false);
      } else if (compact) {
        setChatOpen(true);
      }
      return next;
    });
  }, [compact]);

  useEffect(() => {
    if (!compact) setDrawerOpen(true);
  }, [compact]);
  useEffect(() => {
    if (!compact && !railsCollapsed) setChatOpen(true);
  }, [compact, railsCollapsed]);

  const persistSourceCards = useCallback(
    async (next: SourceCardSegment[]) => {
      if (!article) return;
      if (article.contentDrivesBody) {
        await db.articles.update(article.id, { sourceCards: next });
        return;
      }
      const content = next.filter(sourceCardInBody).map((s) => s.segmentText).join('\n\n');
      await db.articles.update(article.id, { sourceCards: next, content });
      setBodySeed((seed) => ({
        id: article.id,
        markdown: content,
        syncKey: seed.id === article.id ? seed.syncKey + 1 : 1,
      }));
    },
    [article],
  );

  /**
   * When the user adopts or removes an AI-added transition, mirror the change to
   * `sourceCards[].transitions` so the sidebar previews and any future
   * regeneration see the up-to-date transition list. The transition text is
   * unique per AI emission, so removing by exact match across all sourceCards
   * is safe.
   *
   * IMPORTANT: do NOT route through `persistSourceCards` here. That helper
   * rebuilds `Article.content` from `sourceCards[i].segmentText` (which never
   * contains AI-added transitions) and force-refreshes the editor's bodySeed —
   * both would silently destroy the adopted transition text that the user just
   * confirmed. The editor's own `onUpdate` debounce persists the new content
   * correctly; we only need to update the metadata here.
   */
  const handleTransitionDecided = useCallback(
    async (text: string) => {
      if (!article) return;
      const sourceCards = article.sourceCards;
      if (!sourceCards) return;
      const next = sourceCards.map((sc) => ({
        ...sc,
        transitions: (sc.transitions ?? []).filter((t) => t !== text),
      }));
      await db.articles.update(article.id, { sourceCards: next });
    },
    [article],
  );

  const handleTransitionAdopted = useCallback(
    (text: string) => {
      void handleTransitionDecided(text);
    },
    [handleTransitionDecided],
  );

  const handleTransitionRemoved = useCallback(
    (text: string) => {
      void handleTransitionDecided(text);
    },
    [handleTransitionDecided],
  );

  const handleDeletionAdopted = useCallback(
    async (text: string) => {
      if (!article) return;
      const sourceCards = article.sourceCards;
      if (!sourceCards) return;
      const next = sourceCards.map((sc) => {
        const deletions = sc.deletions ?? [];
        if (!deletions.includes(text)) return sc;
        const idx = sc.segmentText.indexOf(text);
        return {
          ...sc,
          deletions: deletions.filter((d) => d !== text),
          segmentText:
            idx >= 0
              ? `${sc.segmentText.slice(0, idx)}${sc.segmentText.slice(idx + text.length)}`
              : sc.segmentText,
        };
      });
      await db.articles.update(article.id, { sourceCards: next });
    },
    [article],
  );

  const handleDeletionRejected = useCallback(
    async (text: string) => {
      if (!article) return;
      const sourceCards = article.sourceCards;
      if (!sourceCards) return;
      const next = sourceCards.map((sc) => ({
        ...sc,
        deletions: (sc.deletions ?? []).filter((d) => d !== text),
      }));
      await db.articles.update(article.id, { sourceCards: next });
    },
    [article],
  );

  const persistBodyFromEditor = useCallback(
    (markdown: string) => {
      if (!article || article.generating) return;
      void persistEssayEditorBody(article.id, markdown);
      setBodySeed((seed) => ({
        id: article.id,
        markdown,
        syncKey: seed.id === article.id ? seed.syncKey : 0,
      }));
    },
    [article],
  );

  const applyChatEdits = useCallback(
    (edits: { find: string; replace: string }[], options?: { replaceDocument?: boolean }) => {
      return (
        bodyEditorRef.current?.applyChatEdits(edits, options) ?? { applied: 0, missed: [] }
      );
    },
    [],
  );

  const insertChatExcerpt = useCallback(
    (markdown: string, at?: { clientX: number; clientY: number }) => {
      bodyEditorRef.current?.insertExcerpt(markdown, at);
    },
    [],
  );

  const previewDropAt = useCallback((clientX: number, clientY: number) => {
    const over = bodyEditorRef.current?.previewDropAt(clientX, clientY) ?? false;
    setBodyDropActive(over);
    return over;
  }, []);

  const clearDropPreview = useCallback(() => {
    bodyEditorRef.current?.clearDropPreview();
    setBodyDropActive(false);
  }, []);

  const dropChatOntoEditor = useCallback(
    (clientX: number, clientY: number, markdown: string) => {
      const hit = document.elementFromPoint(clientX, clientY);
      if (hit?.closest('[data-testid="essay-chat-panel"]')) {
        clearDropPreview();
        return;
      }
      if (!previewDropAt(clientX, clientY)) {
        clearDropPreview();
        return;
      }
      insertChatExcerpt(markdown, { clientX, clientY });
      clearDropPreview();
    },
    [clearDropPreview, insertChatExcerpt, previewDropAt],
  );

  const {
    sending: chatSending,
    error: chatError,
    send: sendEssayChat,
    retryChatImage,
    startNewChat,
    restoreChatSession,
  } = useEssayChat({
    articleId,
    articleTitle: article?.title ?? '',
    messages: article?.chatMessages ?? [],
    aiConfig,
    t,
    getBodyMarkdown: () =>
      bodyEditorRef.current?.getMarkdown() ??
      (article && !needsMediaMigration ? essayBodyMarkdown(article) : ''),
      getSelectedText: () => chatSelection || (bodyEditorRef.current?.getSelectedText() ?? ''),
    applyChatEdits,
  });

  const essayVoiceEnabled = useMemo(
    () =>
      Boolean(
        aiConfig &&
          hasVolcAsrCredentials({
            apiKey: aiConfig.volcAsrApiKey,
            appId: aiConfig.volcAsrAppId,
            accessToken: aiConfig.volcAsrAccessToken,
            resourceId: aiConfig.volcAsrResourceId,
          }) &&
          hasMinimaxTtsAccess(aiConfig.minimaxApiKey),
      ),
    [aiConfig],
  );

  const {
    active: essayVoiceActive,
    phase: essayVoicePhase,
    partialTranscript: essayVoiceTranscript,
    toggle: toggleEssayVoice,
    stop: stopEssayVoice,
  } = useEssayChatVoice({
    aiConfig,
    disabled:
      !article ||
      needsMediaMigration ||
      Boolean(article?.generating) ||
      chatSending ||
      !essayVoiceEnabled,
    sendMessage: sendEssayChat,
  });

  useEffect(() => () => {
    stopEssayVoice();
  }, [stopEssayVoice]);

  const getExportDoc = useCallback(() => {
    if (!article) {
      throw new Error('essay not ready');
    }
    const markdown =
      bodyEditorRef.current?.getMarkdown() ??
      (bodySeed.id === article.id ? bodySeed.markdown : essayBodyMarkdown(article));
    return {
      title: article.title,
      author: draftAuthor || article.author,
      date: draftDateField || article.date,
      markdown,
      media: article.media,
    };
  }, [article, bodySeed, draftAuthor, draftDateField]);

  const liveBodyMarkdown = useMemo(() => {
    if (!article || needsMediaMigration) return '';
    if (bodySeed.id === article.id) return bodySeed.markdown;
    return article.contentDrivesBody ? article.content ?? '' : essayBodyMarkdown(article);
  }, [article, bodySeed, needsMediaMigration]);

  const associateSourceCard = useCallback(
    (nodeId: string, at?: { clientX: number; clientY: number }) => {
      const seg = sourceCards.find((s) => s.nodeId === nodeId);
      if (!seg) return;
      const body = bodyEditorRef.current?.getMarkdown() ?? liveBodyMarkdown;
      if (!isSourceSegmentInBody(seg.segmentText, body)) {
        bodyEditorRef.current?.insertExcerpt(seg.segmentText, at);
      }
      void db.articles.update(articleId, {
        sourceCards: sourceCards.map((s) => (s.nodeId === nodeId ? { ...s, inBody: true } : s)),
      });
    },
    [articleId, liveBodyMarkdown, sourceCards],
  );

  const isEssaySourceDrag = useCallback(
    (e: React.DragEvent) =>
      Boolean(draggingSourceId) || e.dataTransfer.types.includes(ESSAY_SOURCE_DRAG_MIME),
    [draggingSourceId],
  );

  const handleBodyDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!isEssaySourceDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
      setBodyDropActive(previewDropAt(e.clientX, e.clientY));
    },
    [isEssaySourceDrag, previewDropAt],
  );

  const handleBodyDrop = useCallback(
    (e: React.DragEvent) => {
      if (!isEssaySourceDrag(e)) return;
      const nodeId =
        draggingSourceId || e.dataTransfer.getData(ESSAY_SOURCE_DRAG_MIME).trim();
      setDraggingSourceId(null);
      if (!nodeId) {
        clearDropPreview();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      associateSourceCard(nodeId, { clientX: e.clientX, clientY: e.clientY });
      clearDropPreview();
    },
    [associateSourceCard, clearDropPreview, draggingSourceId, isEssaySourceDrag],
  );

  const handleDragStart = (idx: number) => setDragIndex(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIndex(idx);
  };
  const handleDrop = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    const from = dragIndex;
    setDragIndex(null);
    setDragOverIndex(null);
    if (from === null || from === idx) return;
    const next = [...sourceCards];
    const [moved] = next.splice(from, 1);
    next.splice(idx, 0, moved);
    void persistSourceCards(next);
  };

  const handleDeleteSourceCard = async (nodeId: string) => {
    const ok = await confirm({
      message: article?.contentDrivesBody
        ? t('reference.delete_card_unlink_confirm')
        : t('reference.delete_card_confirm'),
      variant: 'danger',
      confirmLabel: t('dialog.confirm'),
      cancelLabel: t('dialog.cancel'),
    });
    if (!ok) return;
    const next = sourceCards.filter((s) => s.nodeId !== nodeId);
    await persistSourceCards(next);
    if (sidebarEditId === nodeId) setSidebarEditId(null);
  };

  const startSidebarEdit = (seg: SourceCardSegment) => {
    setSidebarEditId(seg.nodeId);
    setSidebarEditText(seg.segmentText);
    if (sidebarEditDebounceRef.current) clearTimeout(sidebarEditDebounceRef.current);
  };

  const onSidebarEditTextChange = (v: string) => {
    setSidebarEditText(v);
    if (!article || !sidebarEditId) return;
    if (sidebarEditDebounceRef.current) clearTimeout(sidebarEditDebounceRef.current);
    sidebarEditDebounceRef.current = setTimeout(async () => {
      const next = sourceCards.map((s) =>
        s.nodeId === sidebarEditId ? { ...s, segmentText: v } : s,
      );
      await persistSourceCards(next);
    }, 500);
  };

  const commitSidebarEdit = async () => {
    if (sidebarEditDebounceRef.current) {
      clearTimeout(sidebarEditDebounceRef.current);
      sidebarEditDebounceRef.current = null;
    }
    if (article && sidebarEditId) {
      const next = sourceCards.map((s) =>
        s.nodeId === sidebarEditId ? { ...s, segmentText: sidebarEditText } : s,
      );
      await persistSourceCards(next);
    }
    setSidebarEditId(null);
  };

  const openCanvasAndClose = (canvasId: string) => {
    onOpenCanvas?.(canvasId);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[125] flex flex-col bg-[#FAF9F6] paper-texture"
      data-testid="essay-fullscreen"
      role="dialog"
      aria-modal="true"
      aria-label={article?.title || t('nodes.essay')}
    >
      <div className="h-11 shrink-0 bg-[#FAF9F6] paper-texture border-b border-black/10 flex items-center justify-between px-4 z-10">
        <span className="text-xs font-sans font-bold uppercase tracking-wider text-[#8c8a84] flex items-center gap-2">
          {t('nodes.essay')}
          <button
            type="button"
            data-testid="essay-fullscreen-toggle-rails"
            onClick={toggleRailsCollapsed}
            aria-pressed={railsCollapsed}
            title={
              railsCollapsed
                ? t('reference.essay_show_rails', { defaultValue: '展开侧栏' })
                : t('reference.essay_hide_rails', { defaultValue: '收起侧栏' })
            }
            aria-label={
              railsCollapsed
                ? t('reference.essay_show_rails', { defaultValue: '展开侧栏' })
                : t('reference.essay_hide_rails', { defaultValue: '收起侧栏' })
            }
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#8c8a84] transition-colors hover:bg-[#EAE7E2] hover:text-[#C2410C]"
          >
            {railsCollapsed ? (
              <SidebarOpen className="h-4 w-4" aria-hidden />
            ) : (
              <SidebarClose className="h-4 w-4" aria-hidden />
            )}
          </button>
          {article?.generating ? (
            <span
              data-testid="essay-generating"
              className="inline-flex items-center gap-1.5 normal-case tracking-normal font-medium text-[#C2410C]"
            >
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {t('reference.generating_body')}
            </span>
          ) : null}
        </span>
        <div className="flex items-center gap-2">
          {compact ? (
            <button
              type="button"
              data-testid="essay-fullscreen-toggle-drawer"
              onClick={() => {
                setDrawerOpen((v) => {
                  const next = !v;
                  if (next) setRailsCollapsed(false);
                  return next;
                });
              }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#8c8a84] transition-colors hover:bg-[#EAE7E2] hover:text-[#C2410C]"
              title={drawerOpen ? t('nodes.essay_close') : t('reference.linked_drafts')}
              aria-label={drawerOpen ? t('nodes.essay_close') : t('reference.linked_drafts')}
              aria-expanded={drawerOpen}
            >
              {drawerOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
            </button>
          ) : null}
          {compact ? (
            <button
              type="button"
              data-testid="essay-fullscreen-toggle-chat"
              onClick={() => {
                setChatOpen((v) => {
                  const next = !v;
                  if (next) setRailsCollapsed(false);
                  return next;
                });
              }}
              className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[#EAE7E2] hover:text-[#C2410C] ${
                chatOpen ? 'bg-[#FFF7ED] text-[#C2410C]' : 'text-[#8c8a84]'
              }`}
              title={t('reference.essay_chat_title')}
              aria-label={t('reference.essay_chat_title')}
              aria-expanded={chatOpen}
            >
              <MessageSquare className="h-4 w-4" />
            </button>
          ) : null}
          <EssayCopyButton
            disabled={!article || needsMediaMigration}
            getDoc={getExportDoc}
          />
          <EssayExportMenu
            disabled={!article || needsMediaMigration}
            getDoc={getExportDoc}
          />
          <button
            type="button"
            data-testid="essay-fullscreen-close"
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#8c8a84] transition-colors hover:bg-[#EAE7E2] hover:text-[#C2410C]"
            title={t('nodes.essay_close')}
            aria-label={t('nodes.essay_close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className={`flex-1 flex min-h-0 overflow-hidden ${compact ? '' : 'gap-3 p-3'}`}>
        <div
          className={`bg-white flex flex-col overflow-hidden font-sans text-sm transition-all duration-200 ${
            compact
              ? `fixed inset-y-11 left-0 z-20 w-[min(280px,90vw)] border-r border-[#E6E4DF] shadow-[12px_0_32px_rgba(0,0,0,0.08)] ${
                  drawerOpen && !railsCollapsed ? 'translate-x-0' : '-translate-x-full'
                }`
              : railsCollapsed
                ? 'w-0 min-w-0 shrink overflow-hidden border-0 opacity-0 pointer-events-none'
                : 'w-72 shrink-0 rounded-xl border border-[#E6E4DF] shadow-sm'
          }`}
          aria-hidden={railsCollapsed || (compact && !drawerOpen) ? true : undefined}
        >
          <div className="px-3.5 py-4 font-bold text-[#1a1a1a] text-base h-14 flex items-center">
            {hasSourceCards ? (
              t('reference.linked_drafts')
            ) : (
              <div className="flex items-center gap-2 w-full min-w-0">
                <span className="shrink-0">{t('reference.linked_drafts')}</span>
                {linkedIds.map((cid) => {
                  const c = canvases.find((x) => x.id === cid);
                  return (
                    <button
                      key={cid}
                      type="button"
                      onClick={() => openCanvasAndClose(cid)}
                      disabled={!onOpenCanvas}
                      className="flex items-center gap-1.5 min-w-0 font-semibold text-[#1a1a1a] text-sm hover:text-[#C2410C] hover:underline disabled:opacity-40"
                    >
                      <Link2 className="w-4 h-4 text-[#C2410C] shrink-0" />
                      <span className="truncate font-normal">{c?.name ?? cid}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="p-3 space-y-2.5 overflow-y-auto flex-1 min-h-0">
            {article === undefined || needsMediaMigration ? (
              <p className="text-sm text-[#8c8a84]">{t('nodes.essay_loading')}</p>
            ) : hasSourceCards ? (
              <div className="space-y-3">
                {sourceCards.map((seg, idx) => {
                  const isEditing = sidebarEditId === seg.nodeId;
                  const isDragOver = dragOverIndex === idx && dragIndex !== null && dragIndex !== idx;
                  const previewRaw = seg.segmentText
                    .replace(/[#>*`\[\]()!|-]/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                  const preview =
                    previewRaw.length > 90 ? `${previewRaw.slice(0, 90)}…` : previewRaw;
                  const previewImage = sourceCardPreviewImageSrc(seg.segmentText, mediaObjectUrls);
                  const linked = isSourceSegmentInBody(seg.segmentText, liveBodyMarkdown);
                  return (
                    <div
                      key={seg.nodeId}
                      data-testid={`reference-source-card-${idx}`}
                      draggable={!isEditing}
                      onDragStart={(e) => {
                        handleDragStart(idx);
                        setDraggingSourceId(seg.nodeId);
                        e.dataTransfer.setData(ESSAY_SOURCE_DRAG_MIME, seg.nodeId);
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                      onDragOver={(e) => handleDragOver(e, idx)}
                      onDrop={(e) => handleDrop(e, idx)}
                      onDragEnd={() => {
                        setDragIndex(null);
                        setDragOverIndex(null);
                        setDraggingSourceId(null);
                        clearDropPreview();
                      }}
                      className={`flex items-start gap-2 p-3 bg-[#FAF9F6] border rounded-xl transition-all ${
                        isDragOver
                          ? 'border-[#C2410C] bg-[#F4F1ED] shadow-sm'
                          : 'border-[#E6E4DF]'
                      } ${dragIndex === idx ? 'opacity-50' : ''}`}
                    >
                      <GripVertical
                        className="w-5 h-5 text-[#8c8a84] mt-0.5 shrink-0 cursor-grab"
                        aria-label={t('reference.drag_card')}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => openCanvasAndClose(seg.canvasId)}
                            className="font-semibold text-[#1a1a1a] text-sm leading-snug text-left hover:text-[#C2410C] hover:underline min-w-0 line-clamp-2"
                            disabled={!onOpenCanvas}
                            title={seg.title}
                          >
                            {seg.title || t('reference.untitled_card')}
                          </button>
                          <span
                            data-testid={`reference-source-card-status-${idx}`}
                            className={`mt-1 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${
                              linked
                                ? 'bg-[#EAE7E2] text-[#8c8a84]'
                                : 'bg-[#FFF7ED] text-[#C2410C]'
                            }`}
                          >
                            {linked ? t('reference.source_linked') : t('reference.source_unlinked')}
                          </span>
                          <div className="flex shrink-0 items-center gap-1">
                            {article?.contentDrivesBody || !linked ? null : (
                              <button
                                type="button"
                                data-testid={`reference-source-card-edit-${idx}`}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() =>
                                  isEditing ? void commitSidebarEdit() : startSidebarEdit(seg)
                                }
                                className={`rounded-md p-1.5 hover:bg-[#EAE7E2] ${
                                  isEditing
                                    ? 'text-[#C2410C] bg-[#FFF7ED]'
                                    : 'text-[#8c8a84] hover:text-[#1a1a1a]'
                                }`}
                                title={isEditing ? t('reference.done_edit_card') : t('reference.edit_card')}
                                aria-label={isEditing ? t('reference.done_edit_card') : t('reference.edit_card')}
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              type="button"
                              data-testid={`reference-source-card-delete-${idx}`}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => void handleDeleteSourceCard(seg.nodeId)}
                              className="rounded-md p-1.5 text-[#8c8a84] hover:bg-[#EAE7E2] hover:text-[#C2410C]"
                              title={t('reference.delete_card')}
                              aria-label={t('reference.delete_card')}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        {!isEditing && previewImage ? (
                          <button
                            type="button"
                            data-testid={`reference-source-card-image-${idx}`}
                            title={t('nodes.image_lightbox_hint')}
                            aria-label={t('nodes.image_lightbox_hint')}
                            className="mt-2 block w-full cursor-zoom-in rounded-lg border-0 bg-transparent p-0 text-left [-webkit-user-drag:none]"
                            onPointerDown={(e) => e.stopPropagation()}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              setSourceImagePreview({
                                src: previewImage,
                                title: seg.title || t('reference.untitled_card'),
                              });
                            }}
                          >
                            <img
                              src={previewImage}
                              alt=""
                              draggable={false}
                              className="max-h-28 w-full rounded-lg object-cover pointer-events-none"
                            />
                          </button>
                        ) : !isEditing && preview ? (
                          <p className="mt-2 text-[13px] leading-relaxed text-[#5a5a54]">{preview}</p>
                        ) : null}
                        {isEditing && (
                          <div className="mt-3">
                            <textarea
                              data-testid={`reference-source-card-textarea-${idx}`}
                              value={sidebarEditText}
                              onChange={(e) => onSidebarEditTextChange(e.target.value)}
                              onBlur={() => void commitSidebarEdit()}
                              autoFocus
                              className="w-full h-40 bg-white border border-[#E6E4DF] rounded-lg p-3 text-[#5a5a54] resize-none focus:outline-none font-sans text-sm leading-relaxed"
                              placeholder={t('reference.edit_card_placeholder')}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : linkedIds.length === 0 ? (
              <p className="text-sm text-[#8c8a84]">{t('reference.linked_empty')}</p>
            ) : null}
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="relative min-h-0 flex-1 overflow-y-auto px-2">
          {article === undefined || needsMediaMigration ? (
            <div
              className="max-w-2xl mx-auto flex min-h-full flex-col items-center justify-center gap-3 px-6 py-24 text-[#8c8a84] text-sm font-sans"
              data-testid="essay-fullscreen-loading"
            >
              <Loader2 className="w-5 h-5 animate-spin text-[#C2410C]" aria-hidden />
              <span>{t('nodes.essay_loading')}</span>
            </div>
          ) : article === null ? (
            <div className="max-w-2xl mx-auto flex min-h-full items-center justify-center px-6 py-24 text-center text-[#8c8a84] text-sm font-sans">
              {t('nodes.essay_missing')}
            </div>
          ) : (
            <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col" key={article.id}>
              <div
                className={`relative flex min-h-full flex-1 flex-col bg-white border shadow-md transition-[box-shadow,border-color] ${
                  bodyDropActive
                    ? 'border-[#C2410C] shadow-[0_0_0_4px_rgba(194,65,12,0.16)]'
                    : 'border-[#E6E4DF]'
                }`}
                data-testid="essay-body-drop-target"
                onDragOverCapture={handleBodyDragOver}
                onDropCapture={handleBodyDrop}
                onDragLeave={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                  clearDropPreview();
                }}
              >
              <div className="absolute -top-px -left-px -right-px h-1 bg-[#C2410C]" />
              <div className="p-16">
                <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-10 border-b border-black/10 pb-6 mb-10">
                  <div className="min-w-0 flex-1 pr-2">
                    <div className="text-[#8c8a84] font-mono text-xs uppercase tracking-widest mb-3 flex flex-wrap items-center gap-x-1">
                      <span>{t('reference.document_prefix')}</span>
                      <input
                        className="bg-transparent border-0 border-b border-transparent focus:border-[#C2410C] outline-none min-w-[5rem] max-w-[12rem] font-mono text-[#8c8a84]"
                        value={article.type}
                        onChange={(e) => void db.articles.update(article.id, { type: e.target.value })}
                        aria-label={t('reference.document_prefix')}
                      />
                    </div>
                    <h1
                      className="font-serif text-4xl font-bold text-[#1a1a1a] leading-tight max-w-full focus:outline-none hover:bg-[#EAE7E2]/50 focus:bg-[#EAE7E2]/50 rounded px-2 -mx-2 transition-colors cursor-text"
                      contentEditable
                      suppressContentEditableWarning
                      onBlur={(e) => {
                        if (isContentBlurPersistenceDisabled()) return;
                        const title = e.currentTarget.innerText;
                        void (async () => {
                          await db.articles.update(article.id, { title });
                          const essayNodes = await db.nodes.where('type').equals('essay').toArray();
                          await Promise.all(
                            essayNodes
                              .filter((n) => tryParseEssayContent(n.content)?.articleId === article.id)
                              .map((n) => db.nodes.update(n.id, { description: title })),
                          );
                        })();
                      }}
                    >
                      {article.title}
                    </h1>
                  </div>
                  <div className="flex shrink-0 w-full flex-col gap-3 text-xs font-sans text-[#5a5a54] sm:w-auto sm:max-w-[11rem] md:items-end md:text-right">
                    <label className="flex flex-col gap-0.5 sm:items-stretch md:items-end">
                      <span className="shrink-0 font-bold">{t('reference.author_label')}:</span>
                      <input
                        type="text"
                        data-testid="reference-meta-author"
                        className="w-full shrink-0 min-w-0 border-0 bg-transparent px-0.5 py-1 text-[#5a5a54] outline-none rounded-sm hover:bg-[#F4F1ED]/80 focus-visible:bg-[#F4F1ED]/80 focus-visible:ring-1 focus-visible:ring-[#C2410C]/35 md:text-right"
                        value={draftAuthor}
                        aria-label={t('reference.author_label')}
                        onChange={(e) => {
                          const v = e.target.value;
                          setDraftAuthor(v);
                          const id = article.id;
                          if (authorMetaDebounceRef.current) clearTimeout(authorMetaDebounceRef.current);
                          authorMetaDebounceRef.current = setTimeout(() => {
                            authorMetaDebounceRef.current = null;
                            void db.articles.update(id, { author: v });
                          }, 450);
                        }}
                        onBlur={(e) => {
                          if (authorMetaDebounceRef.current) {
                            clearTimeout(authorMetaDebounceRef.current);
                            authorMetaDebounceRef.current = null;
                          }
                          void db.articles.update(article.id, { author: e.currentTarget.value });
                        }}
                      />
                    </label>
                    <label className="flex flex-col gap-0.5 sm:items-stretch md:items-end">
                      <span className="shrink-0 font-bold">{t('reference.published_label')}:</span>
                      <input
                        type="text"
                        data-testid="reference-meta-date"
                        className="w-full shrink-0 min-w-0 border-0 bg-transparent px-0.5 py-1 text-[#5a5a54] outline-none rounded-sm hover:bg-[#F4F1ED]/80 focus-visible:bg-[#F4F1ED]/80 focus-visible:ring-1 focus-visible:ring-[#C2410C]/35 md:text-right"
                        value={draftDateField}
                        aria-label={t('reference.published_label')}
                        onChange={(e) => {
                          const v = e.target.value;
                          setDraftDateField(v);
                          const id = article.id;
                          if (dateMetaDebounceRef.current) clearTimeout(dateMetaDebounceRef.current);
                          dateMetaDebounceRef.current = setTimeout(() => {
                            dateMetaDebounceRef.current = null;
                            void db.articles.update(id, { date: v });
                          }, 450);
                        }}
                        onBlur={(e) => {
                          if (dateMetaDebounceRef.current) {
                            clearTimeout(dateMetaDebounceRef.current);
                            dateMetaDebounceRef.current = null;
                          }
                          void db.articles.update(article.id, { date: e.currentTarget.value });
                        }}
                      />
                    </label>
                    <div className="flex flex-col gap-0.5 sm:items-stretch md:items-end">
                      <span className="shrink-0 font-bold">{t('reference.word_count_label')}:</span>
                      <span
                        data-testid="essay-word-count"
                        className="px-0.5 py-1 tabular-nums text-[#5a5a54] md:text-right"
                      >
                        {wordCount.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="font-serif text-lg leading-relaxed tracking-[0.05em] text-[#1a1a1a]">
                  <EssayBodyEditor
                    ref={bodyEditorRef}
                    key={article.id}
                    articleId={article.id}
                    markdown={
                      bodySeed.id === article.id ? bodySeed.markdown : essayBodyMarkdown(article)
                    }
                    syncKey={bodySeed.id === article.id ? bodySeed.syncKey : 0}
                    placeholder={
                      article.generating
                        ? t('reference.generating_body')
                        : t('reference.empty_body')
                    }
                    disablePersist={Boolean(article.generating)}
                    mediaObjectUrls={mediaObjectUrls}
                    onPersist={persistBodyFromEditor}
                    onTransitionAdopted={handleTransitionAdopted}
                    onTransitionRemoved={handleTransitionRemoved}
                    onDeletionAdopted={(text) => {
                      void handleDeletionAdopted(text);
                    }}
                    onDeletionRejected={(text) => {
                      void handleDeletionRejected(text);
                    }}
                    onChatSelectionChange={setChatSelection}
                  />
                </div>
              </div>
              </div>
            </div>
          )}
          </div>
        </div>

        <div
          className={`bg-white flex flex-col overflow-hidden font-sans text-sm transition-all duration-200 ${
            compact
              ? `fixed inset-y-11 right-0 z-20 w-[min(320px,90vw)] border-l border-[#E6E4DF] shadow-[-12px_0_32px_rgba(0,0,0,0.08)] ${
                  chatOpen && !railsCollapsed ? 'translate-x-0' : 'translate-x-full'
                }`
              : railsCollapsed
                ? 'w-0 min-w-0 shrink overflow-hidden border-0 opacity-0 pointer-events-none'
                : 'w-[20rem] shrink-0 rounded-xl border border-[#E6E4DF] shadow-sm'
          }`}
          aria-hidden={railsCollapsed || (compact && !chatOpen) ? true : undefined}
        >
          <EssayChatPanel
            messages={article?.chatMessages ?? []}
            archivedSessions={article?.chatSessionArchive ?? []}
            onNewChat={() => startNewChat()}
            onRestoreSession={(sessionId) => restoreChatSession(sessionId)}
            sending={chatSending}
            error={chatError}
            disabled={!article || needsMediaMigration || Boolean(article?.generating)}
            selectedText={chatSelection}
            onClearSelection={() => setChatSelection('')}
            onSend={(text, files) => {
              void sendEssayChat(text, files);
            }}
            onToggleVoice={essayVoiceEnabled ? toggleEssayVoice : undefined}
            voiceModeActive={essayVoiceActive}
            voicePhase={essayVoicePhase}
            liveTranscript={essayVoiceTranscript}
            voiceEnabled={essayVoiceEnabled}
            onExcerpt={insertChatExcerpt}
            onRetryImage={(messageId, imageId) => {
              void retryChatImage(messageId, imageId);
            }}
            onDropReplyAt={(messageId, clientX, clientY) => {
              const msg = article?.chatMessages?.find((m) => m.id === messageId);
              if (!msg?.text.trim()) return;
              dropChatOntoEditor(clientX, clientY, msg.text);
            }}
            onDropSelectionAt={(_messageId, text, clientX, clientY) => {
              dropChatOntoEditor(clientX, clientY, text);
            }}
            onDropChatImage={(img, clientX, clientY) => {
              if (!img.url) return;
              const title = (img.title || '').replace(/\n/g, ' ').trim() || 'image';
              dropChatOntoEditor(clientX, clientY, `![${title}](${img.url})`);
            }}
            onDropSearchHitAt={(_messageId, hit, clientX, clientY) => {
              dropChatOntoEditor(clientX, clientY, formatSearchHitEssayMarkdown(hit));
            }}
            onIngestFiles={
              !article || needsMediaMigration || Boolean(article?.generating)
                ? undefined
                : (files) => files
            }
            onDropPreviewAt={previewDropAt}
            onDropPreviewEnd={clearDropPreview}
          />
        </div>
      </div>

      {sourceImagePreview
        ? createPortal(
            <div
              className="fixed inset-0 z-[130] flex items-center justify-center bg-[#1a1a1a]/88 p-6"
              data-testid="essay-source-image-lightbox"
              role="dialog"
              aria-modal="true"
              aria-label={sourceImagePreview.title || t('nodes.image_lightbox')}
              onMouseDown={onSourceImagePreviewBackdropMouseDown}
              onPointerDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                data-testid="essay-source-image-lightbox-close"
                onClick={closeSourceImagePreview}
                className="absolute top-4 right-4 inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#E6E4DF] bg-white/95 text-[#5a5a54] shadow-md transition-colors hover:border-[#C2410C]/45 hover:text-[#1a1a1a]"
                title={t('nodes.image_lightbox_close')}
                aria-label={t('nodes.image_lightbox_close')}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
              <img
                src={sourceImagePreview.src}
                alt={sourceImagePreview.title || t('nodes.image_lightbox')}
                className="max-h-[92vh] max-w-[92vw] object-contain shadow-2xl"
                draggable={false}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  closeSourceImagePreview();
                }}
              />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
