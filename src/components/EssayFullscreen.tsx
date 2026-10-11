import React, { useState, useRef, useMemo, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  GripVertical,
  Loader2,
  Highlighter,
  MessageSquare,
  Pencil,
  SidebarClose,
  SidebarOpen,
  Trash2,
  X,
} from 'lucide-react';
import { useAdaptiveLayout } from '../hooks/useAdaptiveLayout';
import { useOverlayDismiss } from '../hooks/useOverlayDismiss';
import { db } from '../db';
import type { ArticleMedia, SourceCardSegment } from '../db';
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
import { dataTransferHasFiles } from '../utils/dnd';
import { isAutoAnnotationEnabled } from '../utils/autoAnnotation';
import { useAutoAnnotation } from '../hooks/useAutoAnnotation';
import {
  appendEssayFocusMarks,
  clearEssayFocusMarks,
  readEssayFocusMarks,
  removeEssayFocusMarks,
  shouldRunEssayFocusPass,
} from '../utils/essayFocusMarks';
import { runEssayFocusPass } from '../services/essayFocusPass';
import { surfaceAnswerer } from '../utils/surfacePersonaRoom';
import { spoorLlmSessionId } from '../utils/openRouterPromptCache';
import { formatAiError } from '../services/ai';
import { persistEssayEditorBody } from '../utils/persistEssayEditorBody';
import { useAppDialog } from './AppDialogProvider';
import { EssayBodyEditor, type EssayBodyEditorHandle } from './essay/EssayBodyEditor';
import { ChatPanel } from './canvas/ChatPanel';
import { SurfacePersonaStrip } from './SurfacePersonaStrip';
import {
  EMPTY_SURFACE_ROOM,
  readSurfaceRoom,
  type SurfaceRoomState,
} from '../utils/surfacePersonaRoom';
import { EssayExportMenu } from './essay/EssayExportMenu';
import { formatSearchHitEssayMarkdown } from '../utils/askSearchHits';
import { useEssayChat } from '../hooks/useEssayChat';
import { useChatVoice } from '../hooks/useChatVoice';
import { hasMinimaxTtsAccess } from '../lib/serverConfig';
import { resolveVoiceInputMode } from '../constants/voiceWriting';
import { hasVolcAsrCredentials } from '../services/volcAsr';
import type { AIConfig } from './AISettingsModal';

export interface EssayFullscreenProps {
  articleId: string;
  onClose: () => void;
  onOpenCanvas?: (canvasId: string) => void;
  aiConfig?: AIConfig | null;
}

/**
 * 停笔多久之后才让 AI 去读。抄书籍那边的 1500ms，理由一样：连续打字会把定时器
 * 一直重置，只在真的停下来之后才跑。
 */
const ESSAY_FOCUS_TRIGGER_DELAY_MS = 1500;

export function EssayFullscreen({ articleId, onClose, onOpenCanvas, aiConfig = null }: EssayFullscreenProps) {
  const { t } = useTranslation();
  const { confirm } = useAppDialog();
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

  /** 侧栏房间：谁在说话。空 = 沿用内置助手。 */
  const agentConfigs = useLiveQuery(() => db.agents.toArray(), []) ?? [];
  const [essayRoom, setEssayRoom] = useState<SurfaceRoomState>(EMPTY_SURFACE_ROOM);
  const roomSeededForRef = useRef('');
  useEffect(() => {
    if (!article || roomSeededForRef.current === articleId) return;
    roomSeededForRef.current = articleId;
    setEssayRoom(readSurfaceRoom(article.chatPersonaIds, article.chatMutedPersonaIds));
  }, [article, articleId]);

  /**
   * 房间名单跟着这篇文章走，不跟着面板走：换一篇就该换一个说话的人。
   */
  const persistEssayRoom = useCallback(
    (room: SurfaceRoomState) => {
      setEssayRoom(room);
      void db.articles.update(articleId, {
        chatPersonaIds: room.personaIds,
        chatMutedPersonaIds: room.mutedIds,
      });
    },
    [articleId],
  );

  /* ── AI 标注 ── */
  const [focusBusy, setFocusBusy] = useState(false);
  const [focusListOpen, setFocusListOpen] = useState(false);
  // 开关状态要先定下来：下面 holdFocusList 要拿它决定弹不弹。
  // 全局的，不是这一篇的——在任何一篇上关掉，所有长文都停。
  const [focusEnabled, setFocusEnabled] = useAutoAnnotation('essay');
  const focusListCloseRef = useRef<number | null>(null);
  const focusListWrapRef = useRef<HTMLDivElement | null>(null);
  const holdFocusList = useCallback(() => {
    // 关掉之后不弹清单：里面只剩一句"还没有标注"，对着一个关着的功能弹这个很莫名其妙。
    if (!focusEnabled) return;
    if (focusListCloseRef.current !== null) {
      window.clearTimeout(focusListCloseRef.current);
      focusListCloseRef.current = null;
    }
    setFocusListOpen(true);
  }, [focusEnabled]);
  // 键盘用户打开之后就关不掉了：清单只认悬停，Tab 进去之后指针根本没在按钮上。
  // Escape 和点外面这两条是照对话那颗按钮的弹层补的。
  useEffect(() => {
    if (!focusListOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node)) return;
      if (focusListWrapRef.current?.contains(e.target)) return;
      setFocusListOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setFocusListOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [focusListOpen]);

  const releaseFocusList = useCallback(() => {
    if (focusListCloseRef.current !== null) {
      window.clearTimeout(focusListCloseRef.current);
    }
    // 延一下再关：指针从按钮挪到弹层中间那段空隙会让 hover 直接断掉。
    focusListCloseRef.current = window.setTimeout(() => {
      focusListCloseRef.current = null;
      setFocusListOpen(false);
    }, 180);
  }, []);
  // `focusEnabled` 必须进依赖：标注是按全局开关过滤的，article 这边不变，
// 只盯着 article 的话，在 A 篇关掉标注、切到 B 篇，那一屏黄底还挂着上一轮的。
const focusMarks = useMemo(() => readEssayFocusMarks(article), [article, focusEnabled]);
  const bodyChars = useMemo(
    () => (article ? countEssayChars(essayBodyMarkdown(article)) : 0),
    [article],
  );

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

  const focusRunRef = useRef(0);
  const runFocusPass = useCallback(async () => {
    if (!article || !aiConfig) return;
    if (!essayBodyMarkdown(article).trim()) return;
    const token = ++focusRunRef.current;
    setFocusBusy(true);
    try {
      // 用户在模型返回之前说过话就不插这条了：往对话栏里塞一句 AI 的自言自语，
      // 会盖掉他刚问的那句，看起来像是回答了他，其实不是。
      const messagesAtStart = (await db.articles.get(article.id))?.chatMessages?.length ?? 0;
      const result = await runEssayFocusPass({
        config: aiConfig,
        title: article.title ?? '',
        body: essayBodyMarkdown(article),
        lastScanChars: article.essayFocusLastScanChars,
        agent: surfaceAnswerer(essayRoom, agentConfigs),
        t,
        sessionId: spoorLlmSessionId('essay-focus', article.id),
      });
      // 期间用户可能已经把文章删了，或者在别的长文上把标注关了（全局开关）。
      if (token !== focusRunRef.current) return;
      const row = await db.articles.get(article.id);
      if (!row || !isAutoAnnotationEnabled('essay')) return;

      await appendEssayFocusMarks(article.id, result.marks);
      await db.articles.update(article.id, {
        essayFocusLastScanChars: Math.max(
          row.essayFocusLastScanChars ?? 0,
          countEssayChars(essayBodyMarkdown(row)),
        ),
      });
      if (result.message) {
        const after = await db.articles.get(article.id);
        if (after && (after.chatMessages?.length ?? 0) === messagesAtStart) {
          await db.articles.update(article.id, {
            chatMessages: [
              ...(after.chatMessages ?? []),
              {
                id: `ec-focus-${Date.now().toString(36)}`,
                role: 'assistant' as const,
                text: result.message,
                createdAt: Date.now(),
              },
            ],
          });
        }
      }
    } catch (e) {
      // 失败要有个能说话的地方。挂到对话栏的错误位上——那是这块界面本来就有、
      // 用户认得的出口，另造一个提示等于多一个他找不到的地方。
      setChatError(t('reference.essay_focus_failed', { reason: formatAiError(e) }));
    } finally {
      if (token === focusRunRef.current) setFocusBusy(false);
    }
  }, [aiConfig, agentConfigs, article, essayRoom, t]);

  /**
   * 写到一定字数就让 AI 读一遍。防抖抄书籍那边：连续打字会把定时器一直重置，
   * 只在停笔之后才跑，跑的时候是最新那一份。
   */
  useEffect(() => {
    if (!article || !focusEnabled || focusBusy || needsMediaMigration || article.generating) {
      return;
    }
    if (!shouldRunEssayFocusPass(bodyChars, article.essayFocusLastScanChars)) return;
    const timer = window.setTimeout(() => {
      void runFocusPass();
    }, ESSAY_FOCUS_TRIGGER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [article, bodyChars, focusBusy, focusEnabled, needsMediaMigration, runFocusPass]);

  /** 清单里点一条：把那个想法在正文里打开。定位不到就当这条已经过期了。 */
  const onOpenFocusMark = useCallback((id: string) => {
    bodyEditorRef.current?.openFocusMark(id);
  }, []);

  const onDeleteFocusMark = useCallback((id: string) => {
    void removeEssayFocusMarks(articleId, [id]);
  }, [articleId]);

  const onClearFocus = useCallback(() => {
    setFocusListOpen(false);
    void clearEssayFocusMarks(articleId);
  }, [articleId]);

  /**
   * 全局开关的来回。关掉**不删**已经标上的东西——标了就是标了，全局一关就
   * 把每一篇都清干净是毁数据，不是关开关。已经标上的那些改由 `readEssayFocusMarks`
   * 藏起来，开回来原样还在。要真的删，清单底部那颗单独删。
   */
  const onToggleFocus = useCallback(() => {
    setFocusEnabled(!focusEnabled);
  }, [focusEnabled, setFocusEnabled]);

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
  // 左右两栏各管各的（和书籍全屏一个模型）：折叠按钮只收左侧「关联便签」，
  // 对话按钮只收右侧对话栏。原来是一颗按钮同时收两栏，加了独立的对话按钮
  // 之后那种耦合就多余了——收对话不该顺手动到便签。
  const [leftCollapsed, setLeftCollapsed] = useState(compact);
  const [chatCollapsed, setChatCollapsed] = useState(compact);
  const [chatSelection, setChatSelection] = useState('');

  const toggleLeftCollapsed = useCallback(() => setLeftCollapsed((v) => !v), []);
  const toggleChatCollapsed = useCallback(() => setChatCollapsed((v) => !v), []);

  useEffect(() => {
    setLeftCollapsed(compact);
    setChatCollapsed(compact);
  }, [compact]);

  /**
   * 「历史 / 新建」的空位。按钮由 ChatPanel 自己拥有（翻哪段历史、新建前的确认
   * 都在它那儿），这里只给一个容器让它 portal 过来——状态不搬家。空位在角色条
   * 那一行的右边，和房间里的人并排。
   */
  const [chatControlsHost, setChatControlsHost] = useState<HTMLElement | null>(null);
  const captureChatControlsHost = useCallback((node: HTMLElement | null) => {
    setChatControlsHost(node);
  }, []);

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

  /**
   * 编辑器粘贴进来的图片在这里落地成 media 行。
   *
   * 重新 `get` 一遍而不是直接用闭包里的 `article`：粘贴到落盘之间文章可能又被写过
   * 好几轮（正文持久化、来源卡编辑），拿旧快照覆盖回去会把那些改动连带 media 一起
   * 抹掉。
   */
  const storeEditorMedia = useCallback(
    async (media: ArticleMedia[]) => {
      if (media.length === 0) return;
      const row = await db.articles.get(articleId);
      if (!row) return;
      await db.articles.update(articleId, { media: [...(row.media ?? []), ...media] });
    },
    [articleId],
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
      if (hit?.closest('[data-testid="chat-panel"]')) {
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
    discussing: chatDiscussing,
    error: chatError,
    setError: setChatError,
    send: sendEssayChat,
    discuss: discussEssayRoom,
    retryChatImage,
    startNewChat,
    restoreChatSession,
  } = useEssayChat({
    articleId,
    articleTitle: article?.title ?? '',
    messages: article?.chatMessages ?? [],
    aiConfig,
    room: essayRoom,
    agents: agentConfigs,
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
    commitComposer: commitEssayVoice,
  } = useChatVoice({
    aiConfig,
    disabled:
      !article ||
      needsMediaMigration ||
      Boolean(article?.generating) ||
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

  /**
   * 正文区要不要接下这次拖放。
   *
   * 文件拖放也算：`dragover` 阶段受保护模式限制，`dataTransfer.files` 是空的，只看得到
   * `types` 里有 `Files`，没法提前分辨里面是不是图片。所以只能先把这类拖放都当落图接下，
   * 真的落下非图片时 `insertDroppedFiles` 会一个字节都不写——但这一步必须接：浏览器在
   * 没被 preventDefault 时会拿这个文件把整个页面顶掉（直接下载，或导航到它）。
   */
  const bodyAcceptsDrop = useCallback(
    (e: React.DragEvent) => isEssaySourceDrag(e) || dataTransferHasFiles(e.dataTransfer),
    [isEssaySourceDrag],
  );

  const handleBodyDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!bodyAcceptsDrop(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
      setBodyDropActive(previewDropAt(e.clientX, e.clientY));
    },
    [bodyAcceptsDrop, previewDropAt],
  );

  const handleBodyDrop = useCallback(
    (e: React.DragEvent) => {
      const fileDrop = dataTransferHasFiles(e.dataTransfer);
      if (!fileDrop && !isEssaySourceDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (fileDrop) {
        bodyEditorRef.current?.insertDroppedFiles(e.dataTransfer, {
          clientX: e.clientX,
          clientY: e.clientY,
        });
        clearDropPreview();
        return;
      }
      const nodeId =
        draggingSourceId || e.dataTransfer.getData(ESSAY_SOURCE_DRAG_MIME).trim();
      setDraggingSourceId(null);
      if (!nodeId) {
        clearDropPreview();
        return;
      }
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
      {/* z-30 不是随手写的：z-index 作用在 flex item 上会**建立层叠上下文**，
          里面那颗对话按钮的弹层 z-30 只在这个上下文内有效。顶栏压着 z-10 时，
          窄屏抽屉（根层级 z-20、top-11 起）会盖住探出栏外的弹层——读者看见对话栏
          滑上来、菜单不见了。抬到 30 才高得过它们。 */}
      <div className="h-11 shrink-0 bg-[#FAF9F6] paper-texture border-b border-black/10 flex items-center justify-between px-4 z-30">
        <span className="text-xs font-sans font-bold uppercase tracking-wider text-[#8c8a84] flex items-center gap-2">
          {/* 「长文」这个标题去掉了：全屏里读者要的是正文，抬眼就看见"长文"没有信息量。
              左栏的名字顶上来，既占了原本的标题位，又省掉左栏自己那行 56px 的标题
              ——那行原本只是把同一个词又说了一遍，便签区却因此少了一屏。 */}
          {t('reference.linked_drafts')}
          <button
            type="button"
            data-testid="essay-fullscreen-toggle-rails"
            onClick={toggleLeftCollapsed}
            aria-expanded={!leftCollapsed}
            title={
              leftCollapsed
                ? t('reference.essay_show_rails', { defaultValue: '展开侧栏' })
                : t('reference.essay_hide_rails', { defaultValue: '收起侧栏' })
            }
            aria-label={
              leftCollapsed
                ? t('reference.essay_show_rails', { defaultValue: '展开侧栏' })
                : t('reference.essay_hide_rails', { defaultValue: '收起侧栏' })
            }
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#8c8a84] transition-colors hover:bg-[#EAE7E2] hover:text-[#C2410C]"
          >
            {leftCollapsed ? (
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
          {/* 「历史 / 新建」现在和房间里的人并排放在对话栏顶部那一行的右边
              （见 SurfacePersonaStrip）。顶栏这颗按钮回归成纯粹的开关：开合右栏。
              按钮本身仍然由 ChatPanel 拥有，这里和角色条之间只传一个空位。 */}
          <button
            type="button"
            data-testid="essay-fullscreen-toggle-chat"
            onClick={toggleChatCollapsed}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#8c8a84] transition-colors hover:bg-[#EAE7E2] hover:text-[#C2410C]"
            title={t('reference.essay_chat_title')}
            aria-label={t('reference.essay_chat_title')}
            aria-expanded={!chatCollapsed}
          >
            <MessageSquare className="h-4 w-4" aria-hidden />
          </button>
          {/* 标注开关 + 清单。悬停/聚焦都能开，键盘用户才够得到——和对话那颗
              按钮同一个做法，不因为它不常驻就省掉焦点通路。 */}
          <div
            ref={focusListWrapRef}
            className="relative shrink-0"
            onPointerEnter={holdFocusList}
            onPointerLeave={releaseFocusList}
            onFocus={holdFocusList}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) releaseFocusList();
            }}
          >
            <button
              type="button"
              data-testid="essay-fullscreen-toggle-focus"
              onClick={onToggleFocus}
              aria-pressed={focusEnabled}
              aria-busy={focusBusy}
              title={
                focusBusy
                  ? t('reference.essay_focus_reading')
                  : focusEnabled
                    ? t('reference.essay_focus_toggle_on')
                    : t('reference.essay_focus_toggle')
              }
              aria-label={t('reference.essay_focus_toggle')}
              className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                // 已开要和书卡那颗一样亮起来。启用态原来也是灰的（#8c8a84），
                // 跟禁用态几乎分不出来——所以看不出标注已经开了。
                focusEnabled
                  ? 'bg-[#C2410C]/10 text-[#C2410C] hover:bg-[#C2410C]/15'
                  : 'text-[#b5b1a9] hover:bg-[#EAE7E2] hover:text-[#C2410C]'
              }`}
            >
              {focusBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Highlighter className="h-4 w-4" aria-hidden />
              )}
            </button>
            {focusEnabled && focusMarks.length > 0 ? (
              <span
                data-testid="essay-fullscreen-focus-badge"
                className="absolute -right-1 -top-1 min-w-[14px] rounded-full bg-[#C2410C] px-1 text-center text-[9px] leading-[14px] text-white"
              >
                {focusMarks.length > 99 ? '99+' : focusMarks.length}
              </span>
            ) : null}
            {/* 容器常驻、只切 hidden：条件渲染会让弹层一关，焦点就丢了。 */}
            <div
              data-testid="essay-fullscreen-focus-list"
              hidden={!focusListOpen}
              onPointerEnter={holdFocusList}
              onPointerLeave={releaseFocusList}
              className="absolute right-0 top-full z-30 mt-1 max-h-72 w-72 overflow-y-auto overscroll-contain rounded-xl border border-[#E6E4DF] bg-white p-1 shadow-lg"
            >
              {focusMarks.length === 0 ? (
                <p className="px-2 py-1.5 text-[11px] leading-relaxed text-[#8a8a82]">
                  {t('reference.essay_focus_list_empty')}
                </p>
              ) : (
                focusMarks.map((mark) => (
                  <button
                    key={mark.id}
                    type="button"
                    data-testid={`essay-fullscreen-focus-item-${mark.id}`}
                    onClick={() => {
                      onOpenFocusMark(mark.id);
                      releaseFocusList();
                    }}
                    className="block w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[#FFF7ED]"
                  >
                    <span className="block truncate text-[11px] font-semibold text-[#2c2c28]">
                      {mark.quote}
                    </span>
                    <span className="mt-0.5 block line-clamp-2 text-[11px] leading-relaxed text-[#8a8a82]">
                      {mark.note}
                    </span>
                  </button>
                ))
              )}
              {focusMarks.length > 0 ? (
                <button
                  type="button"
                  data-testid="essay-fullscreen-focus-clear"
                  onClick={onClearFocus}
                  className="mt-1 w-full rounded-lg border-t border-[#E6E4DF] px-2 py-1.5 text-left text-[11px] text-[#8a8a82] transition-colors hover:bg-[#FFF7ED] hover:text-[#C2410C]"
                >
                  {t('reference.essay_focus_off')}
                </button>
              ) : null}
            </div>
          </div>
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
                  leftCollapsed ? '-translate-x-full' : 'translate-x-0'
                }`
              : leftCollapsed
                ? 'w-0 min-w-0 shrink overflow-hidden border-0 opacity-0 pointer-events-none'
                : 'w-72 shrink-0 rounded-xl border border-[#E6E4DF] shadow-sm'
          }`}
          aria-hidden={leftCollapsed ? true : undefined}
          // `pointer-events-none` + `w-0`/`translate-x-full` 只挡得住鼠标，Tab 照样能
          // 走进一条看不见的栏（来源卡的编辑/删除按钮、正文 textarea 都在里面）。
          // `inert` 才是连键盘一起挡掉的那个；单给 aria-hidden 而里面有可聚焦元素，
          // 本身就是硬性无障碍违规。
          inert={leftCollapsed || undefined}
        >
          {/* 左栏不再有自己的标题行：名字已经顶到顶栏去了。这里原来那行 56px
              只是把同一个词又说了一遍，却把便签区压掉一小屏。 */}
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
                    focusMarks={focusMarks}
                    onFocusMarkDelete={onDeleteFocusMark}
                    onStoreMedia={storeEditorMedia}
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
                  chatCollapsed ? 'translate-x-full' : 'translate-x-0'
                }`
              : chatCollapsed
                ? 'w-0 min-w-0 shrink overflow-hidden border-0 opacity-0 pointer-events-none'
                : 'w-[20rem] shrink-0 rounded-xl border border-[#E6E4DF] shadow-sm'
          }`}
          aria-hidden={chatCollapsed ? true : undefined}
          inert={chatCollapsed || undefined}
        >
          <SurfacePersonaStrip
            room={essayRoom}
            onRoomChange={persistEssayRoom}
            controlsHostRef={captureChatControlsHost}
            disabled={!article || needsMediaMigration || Boolean(article?.generating)}
            onDiscuss={() => void discussEssayRoom()}
            discussing={chatDiscussing}
          />
          {/* ChatPanel 的根是 h-full——它按父容器满高算。直接和角色条并排的话，
              满高 + 顶框那一行就溢出了，外层 overflow-hidden 会把底部的输入框裁掉。
              给它一个占剩余高度的壳，h-full 就落在这个壳上。 */}
          <div className="flex min-h-0 flex-1 flex-col">
            <ChatPanel
              hideTitle
              headerControlsHost={chatControlsHost}
              showSpeakerNames={essayRoom.personaIds.length > 1}
              messages={article?.chatMessages ?? []}
              archivedSessions={article?.chatSessionArchive ?? []}
              onNewChat={() => startNewChat()}
              onRestoreSession={(sessionId) => restoreChatSession(sessionId)}
              sending={chatSending}
              error={chatError}
              disabled={!article || needsMediaMigration || Boolean(article?.generating)}
              selectedText={chatSelection}
              onClearSelection={() => setChatSelection('')}
              // 历史 / 新建现在挂在顶栏的悬停弹层里，对话栏收着的时候点它们等于点在
              // 一条看不见的栏上——先把它拉开。
              onInteract={() => setChatCollapsed(false)}
              onSend={(text, files) => {
                if (
                  !files?.length &&
                  essayVoiceActive &&
                  resolveVoiceInputMode(aiConfig?.voiceInputMode) === 'dictation'
                ) {
                  void commitEssayVoice(text);
                  return;
                }
                void sendEssayChat(text, files);
              }}
              onToggleVoice={essayVoiceEnabled ? toggleEssayVoice : undefined}
              voiceModeActive={essayVoiceActive}
              voicePhase={essayVoicePhase}
              liveTranscript={essayVoiceTranscript}
              voiceInputMode={resolveVoiceInputMode(aiConfig?.voiceInputMode)}
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
