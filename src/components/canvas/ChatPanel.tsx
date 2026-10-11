import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import Markdown from 'react-markdown';
import {
  ArrowUp,
  ChevronLeft,
  FileText,
  GripVertical,
  ListChecks,
  Loader2,
  MessageSquare,
  Mic,
  Plus,
  X,
} from 'lucide-react';
import type { CanvasChatGeneratedImage, EssayChatAttachmentMeta } from '../../db';
import { useAppDialog } from '../AppDialogProvider';
import { ChatSidebarSessionControls } from '../canvas/ChatSidebarSessionControls';
import { findChatSession, type ChatSessionLike } from '../../utils/chatSessionArchive';
import { markdownBodyComponents, markdownGfmPlugins, markdownRehypePlugins } from '../markdownBody';
import {
  CHAT_BUBBLE_BODY_CLASS,
  CHAT_COMPOSER_TEXTAREA_CLASS,
  CHAT_PANEL_LIST_CLASS,
  CHAT_REPLY_DRAG_HANDLE_CLASS,
} from '../canvas/chatPanelStyles';
import { ChatReplyCopyHost } from '../canvas/ChatReplyCopyButton';
import { ChatSearchHits } from '../canvas/ChatSearchHits';
import { ChatSuggestedFollowUps } from '../canvas/ChatSuggestedFollowUps';
import { useTextSelectionToolbar } from '../../hooks/useTextSelectionToolbar';
import { TextSelectionToolbar, TextSelectionToolbarButton } from '../TextSelectionToolbar';
import type { AskSearchHit } from '../../utils/askSearchHits';
import { CANVAS_FILE_UPLOAD_ACCEPT, filesFromDataTransfer } from '../../utils/chatPanelFileUpload';
import { dataTransferHasFiles } from '../../utils/dnd';
import { resolveVoiceInputMode, type VoiceInputMode } from '../../constants/voiceWriting';

/** 面板只依赖消息的这几个字段；长文和书籍各自的消息类型都是它的超集。 */
export interface ChatPanelMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
  attachments?: EssayChatAttachmentMeta[];
  images?: CanvasChatGeneratedImage[];
  searchHits?: AskSearchHit[];
  suggestedFollowUps?: string[];
  /** 长文专用：本轮写入正文的占位符数量。书籍正文只读，永远不设。 */
  editCount?: number;
  /** 侧栏房间：这一条是谁说的。单角色时不设。 */
  speakerAgentId?: string;
  /** 侧栏房间：显示用的名字。留空时气泡不显示说话人前缀。 */
  speakerName?: string;
}

export type ChatPanelSession = ChatSessionLike<ChatPanelMessage>;

export interface ChatPanelProps {
  messages: ChatPanelMessage[];
  sending: boolean;
  error: string | null;
  disabled?: boolean;
  /**
   * 文案查找，入参是键名后缀（如 `no_ai`）。不传时走长文侧的 `reference.essay_chat_*`。
   */
  copy?: (key: string, opts?: Record<string, unknown>) => string;
  /**
   * 选择工具栏与传送门挂到哪个全屏容器下。不传时走长文全屏
   * `[data-testid="essay-fullscreen"]`。
   */
  /**
   * 侧栏房间里不止一个声音时，气泡上显示说话人名字。单一对话挂个名字纯属噪音，
   * 所以由调用方按房间人数决定，而不是消息带不带名字。
   */
  showSpeakerNames?: boolean;
  portalHostSelector?: string;
  selectedText?: string;
  onClearSelection?: () => void;
  /**
   * 用户在别处（书籍的摘抄本）手动挑出来、这一轮会递模型的那几条摘抄。
   *
   * 传大于 0 的数，输入框上方就常驻一条"AI 会读到这几条"的提示——
   * 挑了不等于用户知道挑了，不说的话他只能猜 AI 到底看见了什么。
   * 只报数不报内容：挑了什么左栏本来就看得见，这里只补那句缺失的提示。
   */
  focusedExcerptCount?: number;
  onSend: (text: string, files?: File[]) => void;
  onToggleVoice?: () => void;
  voiceModeActive?: boolean;
  voicePhase?: 'idle' | 'listening' | 'draft' | 'thinking' | 'speaking';
  liveTranscript?: string;
  voiceInputMode?: VoiceInputMode;
  voiceEnabled?: boolean;
  /** Insert markdown into the long-form editor (not the canvas). */
  onExcerpt?: (markdown: string) => void;
  onRetryImage?: (messageId: string, imageId: string) => void;
  onDropReplyAt?: (messageId: string, clientX: number, clientY: number) => void;
  onDropSelectionAt?: (messageId: string, text: string, clientX: number, clientY: number) => void;
  onDropChatImage?: (image: CanvasChatGeneratedImage, clientX: number, clientY: number) => void;
  onDropSearchHitAt?: (
    messageId: string,
    hit: AskSearchHit,
    clientX: number,
    clientY: number,
  ) => void;
  onIngestFiles?: (files: File[]) => unknown;
  onDropPreviewAt?: (clientX: number, clientY: number) => void;
  onDropPreviewEnd?: () => void;
  archivedSessions?: ChatPanelSession[];
  onNewChat?: () => unknown;
  onRestoreSession?: (sessionId: string) => unknown;
  /**
   * 隐藏标题行里的面板名。书籍全屏那一栏用：它常驻在屏幕右侧，
   * 名字是重复的（外层顶栏已经写着书名、也已经有 AI 那一栏的开关），
   * 省下的每一像素都还给了对话正文。翻历史时不受影响——
   * 那时标题位置放的是会话摘要，是唯一说明在看哪段对话的东西。
   */
  hideTitle?: boolean;
  /**
   * 把「历史 / 新建」两个按钮渲染到这个节点里（全屏阅读的顶栏给了这样一个空位）。
   * 给了它，栏里那一行标题就没有内容了——`hideTitle` 时整行不渲染，对话从栏顶开始。
   * 状态不搬家：展开哪段历史、新建前的确认都还在本组件里，这里只换渲染位置。
   */
  headerControlsHost?: HTMLElement | null;

  /**
   * 读者点了「历史 / 新建」这类只动本栏状态的按钮时，通知外面一声。
   *
   * 书籍全屏把这两个按钮挂在顶栏的悬停弹层里，而对话栏那时可能正收着——
   * 动作在一条看不见的栏里发生，等于点了没反应。外面拿这个把栏打开。
   */
  onInteract?: () => void;
}

function clientPointInSelection(sel: Selection, x: number, y: number): boolean {
  for (let i = 0; i < sel.rangeCount; i += 1) {
    const rects = sel.getRangeAt(i).getClientRects();
    for (const rect of rects) {
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return true;
    }
  }
  return false;
}

/**
 * 面板自身文案的查找。入参是键名后缀（如 `no_ai`）。
 * 不传 `copy` 时走长文侧的 `reference.essay_chat_*`；书籍侧传自己的一套。
 * 共享文案（`canvas.v2.*` / `voice.*` 等）不走这里，继续用 `t`。
 */
function usePanelCopy(copy?: (key: string, opts?: Record<string, unknown>) => string) {
  const { t } = useTranslation();
  return useCallback(
    (key: string, opts?: Record<string, unknown>) =>
      copy ? copy(key, opts) : t(`reference.essay_chat_${key}`, opts),
    [copy, t],
  );
}

export function ChatPanel({
  messages,
  sending,
  error,
  disabled,
  copy,
  showSpeakerNames = false,
  portalHostSelector = '[data-testid="essay-fullscreen"]',
  selectedText = '',
  onClearSelection,
  focusedExcerptCount = 0,
  onSend,
  onToggleVoice,
  voiceModeActive = false,
  voicePhase = 'idle',
  liveTranscript = '',
  voiceInputMode,
  voiceEnabled = true,
  onExcerpt,
  onRetryImage,
  onDropReplyAt,
  onDropSelectionAt,
  onDropChatImage,
  onDropSearchHitAt,
  onIngestFiles,
  onDropPreviewAt,
  onDropPreviewEnd,
  archivedSessions = [],
  onNewChat,
  onRestoreSession,
  hideTitle = false,
  headerControlsHost = null,
  onInteract,
}: ChatPanelProps) {
  const { t } = useTranslation();
  const { confirm } = useAppDialog();
  const tr = usePanelCopy(copy);
  const [draft, setDraft] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [fileDragOver, setFileDragOver] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [viewingSession, setViewingSession] = useState<ChatPanelSession | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileDragDepthRef = useRef(0);
  const skipVoiceOverwriteRef = useRef(false);
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const readonly = viewingSession !== null;
  /** 只读（翻历史）时标题位置给会话摘要用，别的布局由 `hideTitle` 说了算。 */
  const showHeaderText = !hideTitle || readonly;
  /**
   * 宿主（比如全屏阅读的顶栏）把这两个按钮借走时，栏里就不用再留一行标题：
   * 对话从栏顶开始，省下的高度全给消息。状态（展开哪段历史、新建前的确认）还在这里，
   * 只有按钮渲染到别处，所以不需要把会话状态搬到宿主里去。
   */
  const controlsInHost = Boolean(headerControlsHost) && !readonly;
  const showHeader = !hideTitle || readonly || !headerControlsHost;
  const dictation = resolveVoiceInputMode(voiceInputMode) === 'dictation';
  const displayMessages = viewingSession?.messages ?? messages;
  const lastAssistant = [...displayMessages].reverse().find((m) => m.role === 'assistant');

  const requestNewChat = async () => {
    if (!onNewChat || messages.length === 0) return;
    const ok = await confirm({ message: tr('new_confirm') });
    if (!ok) return;
    setViewingSession(null);
    onInteract?.();
    await onNewChat();
  };

  /** 稳定引用：它进了 ChatSidebarSessionControls 的 useEffect 依赖，写成内联箭头
      的话，历史菜单开着时那个 document 监听会跟着每次渲染（也就是每次流式吐字）
      摘下再挂一遍。 */
  const handleHistoryOpenChange = useCallback(
    (open: boolean) => {
      if (open) onInteract?.();
      setHistoryOpen(open);
    },
    [onInteract],
  );

  const sessionControls =
    !readonly && onNewChat ? (
      <ChatSidebarSessionControls
        testIdPrefix="chat-panel"
        disabled={disabled}
        busy={sending}
        canNewChat={messages.length > 0}
        archivedSessions={archivedSessions}
        historyOpen={historyOpen}
        onHistoryOpenChange={handleHistoryOpenChange}
        onNewChat={requestNewChat}
        onViewSession={(sessionId) => {
          const session = findChatSession(archivedSessions, sessionId);
          if (session) setViewingSession(session);
        }}
      />
    ) : null;

  const requestRestoreSession = async () => {
    if (!onRestoreSession || !viewingSession) return;
    if (messages.length > 0) {
      const ok = await confirm({ message: tr('restore_confirm') });
      if (!ok) return;
    }
    await onRestoreSession(viewingSession.id);
    setViewingSession(null);
  };

  useLayoutEffect(() => {
    const syncHost = () => {
      const fs = document.fullscreenElement;
      if (fs instanceof HTMLElement) {
        setPortalHost(fs);
        return;
      }
      const host = panelRef.current?.closest(portalHostSelector);
      setPortalHost(host instanceof HTMLElement ? host : document.body);
    };
    syncHost();
    document.addEventListener('fullscreenchange', syncHost);
    return () => document.removeEventListener('fullscreenchange', syncHost);
  }, [portalHostSelector]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [displayMessages.length, sending, viewingSession?.id]);

  useLayoutEffect(() => {
    const el = composerInputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, voiceModeActive, selectedText]);

  useEffect(() => {
    if (voiceModeActive && voicePhase === 'listening') {
      skipVoiceOverwriteRef.current = false;
    }
  }, [voiceModeActive, voicePhase]);

  useEffect(() => {
    if (!dictation || !voiceModeActive || voicePhase !== 'listening') return;
    if (skipVoiceOverwriteRef.current) return;
    if (!liveTranscript) return;
    setDraft(liveTranscript);
  }, [dictation, liveTranscript, voiceModeActive, voicePhase]);

  const handleIngestFiles = (raw: File[]) => {
    if (!onIngestFiles || raw.length === 0 || uploading) return;
    setUploading(true);
    void Promise.resolve(onIngestFiles(raw))
      .then(() => {
        setPendingFiles((prev) => [...prev, ...raw]);
      })
      .finally(() => {
        setUploading(false);
      });
  };

  /** 空着、正在发、或被外部锁住时都按"不能发"处理：这三态在界面上是同一件事。 */
  const sendDisabled =
    sending || disabled || (!draft.trim() && pendingFiles.length === 0);

  const submit = () => {
    const text = draft.trim();
    const files = pendingFiles.length > 0 ? pendingFiles : undefined;
    if ((!text && !files) || sending || disabled) return;
    setDraft('');
    setPendingFiles([]);
    onSend(text, files);
  };

  return (
    <aside
      ref={panelRef}
      data-testid="chat-panel"
      className="flex h-full min-h-0 flex-col bg-white"
    >
      {/* 标题行。四种状态：
          1. 常规（长文那一栏）：名字 + 按钮，56px。
          2. `hideTitle` 且按钮被顶栏借走（书籍全屏）：整行不渲染，对话从栏顶开始。
          3. 翻历史：名字换成会话摘要 + 返回键——那时它是唯一说明在看哪段对话的东西。
          4. `hideTitle` 但没有顶栏（栏收起时）：退回到 40px 的一行，只放那两个按钮，
             免得它们跟着栏一起消失。
             注意书籍全屏现在**永远**给得出空位（弹层容器常驻、只切 hidden），所以这一条
             对那个调用方已经不可达了——留着是为了别的调用方，别因为"书籍走不到"就删掉分支。 */}
      {showHeader ? (
        <div
          className={`relative flex shrink-0 items-center gap-2 border-b border-[#E6E4DF]/70 px-5 font-sans text-base font-bold text-[#1a1a1a] ${
            showHeaderText ? 'h-14' : 'h-10 justify-end'
          }`}
        >
          {showHeaderText ? (
            readonly ? (
              <button
                type="button"
                data-testid="chat-panel-history-back"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#5a5a54] transition-colors hover:bg-[#F4F1ED] hover:text-[#C2410C]"
                onClick={() => setViewingSession(null)}
                title={tr('back_to_current')}
                aria-label={tr('back_to_current')}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            ) : (
              <MessageSquare className="h-4 w-4 shrink-0 text-[#C2410C]" aria-hidden />
            )
          ) : null}
          {showHeaderText ? (
            <span className="min-w-0 flex-1 truncate">
              {readonly ? viewingSession?.preview || tr('history') : tr('title')}
            </span>
          ) : null}
          {sessionControls && !controlsInHost ? sessionControls : null}
        </div>
      ) : null}
      {sessionControls && controlsInHost
        ? createPortal(sessionControls, headerControlsHost as HTMLElement)
        : null}
      <div ref={listRef} className={CHAT_PANEL_LIST_CLASS}>
        {readonly ? (
          <div className="mb-2 flex flex-wrap items-center gap-2 px-0.5">
            <p className="min-w-0 flex-1 text-[11px] tracking-[0.06em] text-[#8c8a84]">
              {tr('history_readonly')}
            </p>
            {onRestoreSession ? (
              <button
                type="button"
                data-testid="chat-panel-restore"
                disabled={disabled || sending}
                className="shrink-0 rounded-full border border-[#C2410C]/30 bg-[#FFF7ED] px-2.5 py-1 text-[11px] tracking-[0.04em] text-[#C2410C] hover:border-[#C2410C]/50 disabled:opacity-40"
                onClick={() => void requestRestoreSession()}
              >
                {tr('restore')}
              </button>
            ) : null}
          </div>
        ) : null}
        {!readonly && messages.length === 0 && !sending ? (
          <p className="font-sans text-sm leading-relaxed tracking-[0.04em] text-[#8c8a84]">
            {tr('empty')}
          </p>
        ) : null}
        {displayMessages.map((msg) => (
          <EssayChatBubble
            key={msg.id}
            message={msg}
            showSpeaker={showSpeakerNames}
            sending={!readonly && sending}
            readonly={readonly}
            copy={copy}
            onExcerpt={readonly ? undefined : onExcerpt}
            onRetryImage={readonly ? undefined : onRetryImage}
            onDropReplyAt={readonly ? undefined : onDropReplyAt}
            onDropSelectionAt={readonly ? undefined : onDropSelectionAt}
            onDropChatImage={readonly ? undefined : onDropChatImage}
            onDropSearchHitAt={readonly ? undefined : onDropSearchHitAt}
            portalHost={portalHost}
            onDropPreviewAt={readonly ? undefined : onDropPreviewAt}
            onDropPreviewEnd={readonly ? undefined : onDropPreviewEnd}
          />
        ))}
        {!readonly &&
        !sending &&
        lastAssistant &&
        lastAssistant.id === displayMessages[displayMessages.length - 1]?.id &&
        (lastAssistant.suggestedFollowUps ?? []).length > 0 ? (
          <ChatSuggestedFollowUps
            questions={lastAssistant.suggestedFollowUps!}
            disabled={disabled}
            onSelect={(question) => {
              setDraft('');
              setPendingFiles([]);
              onSend(question);
            }}
          />
        ) : null}
      </div>
      {error && !readonly ? (
        <p
          className="px-4 pb-1 font-sans text-xs leading-relaxed tracking-[0.04em] text-[#C2410C]"
          data-testid="chat-panel-error"
        >
          {error}
        </p>
      ) : null}
      <div
        className={`shrink-0 px-4 pb-4 pt-3 transition-colors ${
          fileDragOver ? 'bg-[#FFF7ED]/50' : 'bg-white'
        } ${readonly ? 'pointer-events-none opacity-40' : ''}`}
        onDragEnter={(e) => {
          if (readonly || !onIngestFiles || !dataTransferHasFiles(e.dataTransfer)) return;
          e.preventDefault();
          e.stopPropagation();
          fileDragDepthRef.current += 1;
          setFileDragOver(true);
        }}
        onDragOver={(e) => {
          if (!onIngestFiles || !dataTransferHasFiles(e.dataTransfer)) return;
          e.preventDefault();
          e.stopPropagation();
          setFileDragOver(true);
        }}
        onDragLeave={(e) => {
          if (!onIngestFiles) return;
          e.preventDefault();
          e.stopPropagation();
          fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
          if (fileDragDepthRef.current === 0) setFileDragOver(false);
        }}
        onDrop={(e) => {
          if (!onIngestFiles) return;
          e.preventDefault();
          e.stopPropagation();
          fileDragDepthRef.current = 0;
          setFileDragOver(false);
          const files = filesFromDataTransfer(e.dataTransfer);
          if (files.length > 0) handleIngestFiles(files);
        }}
      >
        {/* 摘抄本里勾了几条就一直挂在这儿。勾了不等于用户知道勾了——
            没有这句，他只能猜 AI 到底看见了什么。信息量只到条数，
            具体是哪几条左栏正显示着，不必在这里重复一遍。 */}
        {focusedExcerptCount > 0 ? (
          <div
            data-testid="chat-panel-excerpt-focus"
            className="mb-2 flex items-center gap-2 rounded-lg border border-[#E6E4DF] bg-[#F4F1ED]/80 px-2.5 py-2"
          >
            <ListChecks className="h-3.5 w-3.5 shrink-0 text-[#C2410C]" aria-hidden />
            <p className="min-w-0 flex-1 font-sans text-[11px] leading-relaxed tracking-[0.02em] text-[#5a5a54]">
              {tr('excerpt_focus_label', { count: focusedExcerptCount })}
            </p>
          </div>
        ) : null}
        {selectedText ? (
          <div
            data-testid="chat-panel-selection"
            className="mb-2 rounded-lg border border-[#E6E4DF] bg-[#F4F1ED]/80 px-2.5 py-2"
            onMouseDown={(e) => e.preventDefault()}
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-sans text-[10px] font-bold uppercase tracking-wider text-[#8c8a84]">
                  {tr('selection_label')}
                </p>
                <p className="mt-1 line-clamp-4 whitespace-pre-wrap font-serif text-[13px] leading-relaxed tracking-[0.02em] text-[#2c2c28]">
                  {selectedText}
                </p>
              </div>
              {onClearSelection ? (
                <button
                  type="button"
                  data-testid="chat-panel-selection-clear"
                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#8c8a84] hover:bg-white hover:text-[#1a1a1a]"
                  aria-label={tr('selection_clear')}
                  title={tr('selection_clear')}
                  onClick={onClearSelection}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {pendingFiles.length > 0 ? (
          <div
            data-testid="chat-panel-pending-files"
            className="mb-2 flex flex-wrap gap-1.5"
          >
            {pendingFiles.map((file, index) => (
              <span
                key={`${file.name}-${index}`}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-[#E6E4DF] bg-[#FAF9F6] px-2 py-1 text-[11px] tracking-[0.04em] text-[#5a5a54]"
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-[#8c8a84]" />
                <span className="truncate">{file.name}</span>
                <button
                  type="button"
                  data-testid={`chat-panel-pending-file-remove-${index}`}
                  className="shrink-0 rounded p-0.5 text-[#8c8a84] hover:text-[#C2410C]"
                  aria-label={t('canvas.v2.clear_focus', { defaultValue: '清除' })}
                  onClick={() => {
                    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
                  }}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        {voiceModeActive && voicePhase === 'listening' && !dictation ? (
          <p className="mb-2 px-1 font-sans text-xs leading-relaxed tracking-[0.04em] text-[#C2410C]">
            {liveTranscript.trim() || t('voice.phase_listening')}
          </p>
        ) : voiceModeActive && voicePhase === 'draft' ? (
          <p className="mb-2 px-1 font-sans text-xs leading-relaxed tracking-[0.04em] text-[#C2410C]">
            {t('voice.phase_draft')}
          </p>
        ) : voiceModeActive && voicePhase === 'idle' ? (
          <p className="mb-2 px-1 font-sans text-xs leading-relaxed tracking-[0.04em] text-[#8a8a84]">
            {t('voice.wait_for_chime')}
          </p>
        ) : null}
        <textarea
          ref={composerInputRef}
          data-testid="chat-panel-input"
          value={draft}
          rows={1}
          disabled={sending || disabled || readonly}
          placeholder={
            selectedText
              ? tr('placeholder_selection')
              : tr('placeholder')
          }
          onChange={(e) => {
            const value = e.target.value;
            setDraft(value);
            if (dictation && voicePhase === 'listening' && !skipVoiceOverwriteRef.current) {
              skipVoiceOverwriteRef.current = true;
              onToggleVoice?.();
            } else {
              skipVoiceOverwriteRef.current = true;
            }
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.shiftKey) return;
            e.preventDefault();
            submit();
          }}
          onPaste={(e) => {
            if (!onIngestFiles) return;
            const files = filesFromDataTransfer(e.clipboardData);
            if (files.length === 0) return;
            e.preventDefault();
            handleIngestFiles(files);
          }}
          className={CHAT_COMPOSER_TEXTAREA_CLASS}
        />
        <div className="mt-0.5 flex items-center justify-between gap-2">
            {onIngestFiles ? (
              <>
                <button
                  type="button"
                  data-testid="chat-panel-upload"
                  disabled={sending || disabled || uploading}
                  title={t('canvas.v2.chat_upload', { defaultValue: '上传图片或文件' })}
                  aria-label={t('canvas.v2.chat_upload', { defaultValue: '上传图片或文件' })}
                  onClick={() => fileInputRef.current?.click()}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#5a5a54] transition-colors hover:bg-[#F4F1ED] hover:text-[#C2410C] disabled:opacity-30"
                >
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={CANVAS_FILE_UPLOAD_ACCEPT}
                  className="hidden"
                  data-testid="chat-panel-upload-input"
                  onChange={(e) => {
                    const list = e.target.files;
                    if (list?.length) handleIngestFiles(Array.from(list));
                    e.target.value = '';
                  }}
                />
              </>
            ) : (
              <span className="w-0 shrink-0" aria-hidden />
            )}
            <div className="ml-auto flex items-center gap-1">
              {onToggleVoice ? (
                <button
                  type="button"
                  data-testid="chat-panel-voice"
                  disabled={sending || disabled || !voiceEnabled}
                  onClick={onToggleVoice}
                  aria-pressed={voiceModeActive}
                  aria-label={
                    voiceModeActive ? t('publish.voice_stop') : t('publish.voice_start')
                  }
                  title={
                    !voiceEnabled
                      ? t('publish.voice_disabled_hint')
                      : voiceModeActive
                        ? t('publish.voice_stop')
                        : t('publish.voice_start')
                  }
                  className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors disabled:opacity-30 ${
                    voiceModeActive
                      ? 'bg-[#C2410C] text-white'
                      : 'text-[#5a5a54] hover:bg-[#F4F1ED] hover:text-[#C2410C]'
                  }`}
                >
                  <Mic className="h-4 w-4" />
                </button>
              ) : null}
              <button
                type="button"
                data-testid="chat-panel-send"
                disabled={sendDisabled}
                onClick={submit}
                /* 填色跟着"能不能发"走，而不是常亮或常灭：
                   空着的时候是浅灰的中性圆（rounded-full 没有底色就没有形状，
                   圆会整个消失），能发的时候才填上项目的主橙——一颗实心橙球
                   压在输入区里不再莫名其妙，因为那时它确实有事可做、也确实是
                   这一栏唯一的主操作。 */
                className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
                  sendDisabled
                    ? 'bg-[#F4F1ED] text-[#5a5a54]'
                    : 'bg-[#C2410C] text-white hover:bg-[#a0350a]'
                }`}
                aria-label={tr('send')}
                title={tr('send')}
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            </div>
        </div>
      </div>
    </aside>
  );
}

function EssayChatBubble({
  message,
  sending,
  readonly = false,
  copy,
  onExcerpt,
  onRetryImage,
  onDropReplyAt,
  onDropSelectionAt,
  onDropChatImage,
  onDropSearchHitAt,
  portalHost,
  onDropPreviewAt,
  onDropPreviewEnd,
  showSpeaker = false,
}: {
  message: ChatPanelMessage;
  sending: boolean;
  readonly?: boolean;
  copy?: (key: string, opts?: Record<string, unknown>) => string;
  onExcerpt?: (markdown: string) => void;
  onRetryImage?: (messageId: string, imageId: string) => void;
  onDropReplyAt?: (messageId: string, clientX: number, clientY: number) => void;
  onDropSelectionAt?: (messageId: string, text: string, clientX: number, clientY: number) => void;
  onDropChatImage?: (image: CanvasChatGeneratedImage, clientX: number, clientY: number) => void;
  onDropSearchHitAt?: (
    messageId: string,
    hit: AskSearchHit,
    clientX: number,
    clientY: number,
  ) => void;
  portalHost?: HTMLElement | null;
  onDropPreviewAt?: (clientX: number, clientY: number) => void;
  onDropPreviewEnd?: () => void;
  showSpeaker?: boolean;
}) {
  const { t } = useTranslation();
  const tr = usePanelCopy(copy);
  const isUser = message.role === 'user';
  const bodyRef = useRef<HTMLDivElement>(null);
  const {
    askUi,
    toolbarRef,
    quoteRef,
    updateSelectionAsk,
    dismissSelectionToolbar,
    arm,
    disarm,
  } = useTextSelectionToolbar({
    bodyRef,
    sourceLabel: tr('title'),
    sourceMarkdown: message.text,
    disabled: isUser || sending || readonly,
    toolbarWidth: 148,
    positionMode: 'viewport',
    clampSelector: '[data-testid="chat-panel"]',
  });

  const excerptSelection = () => {
    const quote = quoteRef.current;
    if (!quote || !onExcerpt) return;
    onExcerpt(quote.markdown || quote.text);
    dismissSelectionToolbar();
  };

  const excerptImage = (img: CanvasChatGeneratedImage) => {
    if (!img.url) return;
    const title = (img.title || '').replace(/\n/g, ' ').trim() || 'image';
    onExcerpt?.(`![${title}](${img.url})`);
  };

  const canDragToEditor =
    !readonly && Boolean(onDropReplyAt) && !isUser && !sending && Boolean(message.text.trim());
  const [dragGhost, setDragGhost] = useState<{ x: number; y: number; preview?: string; text?: string } | null>(
    null,
  );

  const beginSelectionDrag = (text: string, originX: number, originY: number) => {
    const snippet = text.replace(/\s+/g, ' ').trim();
    if (!onDropSelectionAt || snippet.length < 2) return;
    let armed = false;
    const onMove = (move: PointerEvent) => {
      const dx = move.clientX - originX;
      const dy = move.clientY - originY;
      if (!armed) {
        if (dx * dx + dy * dy < 16) return;
        armed = true;
      }
      setDragGhost({ x: move.clientX, y: move.clientY, text: snippet });
      onDropPreviewAt?.(move.clientX, move.clientY);
    };
    const onUp = (up: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setDragGhost(null);
      onDropPreviewEnd?.();
      if (!armed) return;
      onDropSelectionAt(message.id, snippet, up.clientX, up.clientY);
      dismissSelectionToolbar();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const onHandlePointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!canDragToEditor || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    let armed = false;
    const onMove = (move: PointerEvent) => {
      const dx = move.clientX - e.clientX;
      const dy = move.clientY - e.clientY;
      if (!armed) {
        if (dx * dx + dy * dy < 16) return;
        armed = true;
      }
      setDragGhost({ x: move.clientX, y: move.clientY });
      onDropPreviewAt?.(move.clientX, move.clientY);
    };
    const onUp = (up: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setDragGhost(null);
      onDropPreviewEnd?.();
      if (!armed) return;
      onDropReplyAt?.(message.id, up.clientX, up.clientY);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  return (
    <div
      data-chat-message-id={message.id}
      className={`flex flex-col gap-1.5 ${isUser ? 'items-end' : 'items-start'}`}
    >
      {/* 说话人前缀。房里有第二个声音时才画——单人对话挂个名字纯属噪音。 */}
      {showSpeaker && !isUser && message.speakerName ? (
        <span
          data-testid="chat-panel-msg-speaker"
          className="px-1 text-[10px] tracking-[0.06em] text-[#8a8a82]"
        >
          {message.speakerName}
        </span>
      ) : null}
      <div className="group/message relative max-w-full">
        {canDragToEditor ? (
          <button
            type="button"
            data-testid="chat-panel-reply-drag-handle"
            onPointerDown={onHandlePointerDown}
            title={tr('drag_reply', { defaultValue: '拖到编辑区' })}
            aria-label={tr('drag_reply', { defaultValue: '拖到编辑区' })}
            className={CHAT_REPLY_DRAG_HANDLE_CLASS}
          >
            <GripVertical className="h-3 w-3" />
          </button>
        ) : null}
        <div
          data-testid={`chat-panel-msg-${message.role}`}
          className={`max-w-full ${CHAT_BUBBLE_BODY_CLASS} ${
            isUser
              ? 'bg-[#C2410C]/10 text-[#2c2c28]'
              : 'border border-[#E6E4DF] bg-white text-[#2c2c28]'
          }`}
        >
          {(message.attachments ?? []).length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {message.attachments!.map((attachment, index) => (
                <span
                  key={`${attachment.name}-${index}`}
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-[#E6E4DF] bg-[#FAF9F6] px-2 py-1 text-[10px] tracking-[0.04em] text-[#5a5a54]"
                >
                  {attachment.kind === 'image' && attachment.previewUrl ? (
                    <img
                      src={attachment.previewUrl}
                      alt=""
                      className="h-4 w-4 rounded object-cover"
                    />
                  ) : (
                    <FileText className="h-3 w-3 shrink-0 text-[#8c8a84]" />
                  )}
                  <span className="truncate">{attachment.name}</span>
                </span>
              ))}
            </div>
          ) : null}
          <div
            ref={bodyRef}
            onMouseUp={updateSelectionAsk}
            onPointerDown={(e) => {
              if (!onDropSelectionAt || sending || e.button !== 0) return;
              const sel = window.getSelection();
              if (!sel || sel.isCollapsed || !bodyRef.current) return;
              if (!bodyRef.current.contains(sel.anchorNode) || !bodyRef.current.contains(sel.focusNode)) {
                return;
              }
              if (!clientPointInSelection(sel, e.clientX, e.clientY)) return;
              const text = sel.toString();
              if (text.replace(/\s+/g, ' ').trim().length < 2) return;
              e.preventDefault();
              e.stopPropagation();
              beginSelectionDrag(text, e.clientX, e.clientY);
            }}
          >
            {message.text ? (
              <ChatReplyCopyHost
                text={message.text}
                showCopy={!isUser && Boolean(message.text.trim())}
              >
                <Markdown
                  remarkPlugins={markdownGfmPlugins}
                  rehypePlugins={markdownRehypePlugins}
                  components={markdownBodyComponents}
                >
                  {message.text}
                </Markdown>
              </ChatReplyCopyHost>
            ) : sending && !isUser && !(message.images ?? []).length ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-[#C2410C]" aria-hidden />
                {/* 可见文案随末尾那行一起去掉了，但"正在生成"这句话读屏仍要能听到 */}
                <span className="sr-only" role="status">
                  {tr('thinking')}
                </span>
              </span>
            ) : null}
          </div>
          {message.role === 'assistant' && message.editCount ? (
            <p className="mt-2 font-sans text-[11px] tracking-[0.04em] text-[#C2410C]">
              {tr('applied_n', { count: message.editCount })}
            </p>
          ) : null}
          {(message.images ?? []).length > 0 ? (
            <div className={`space-y-2 ${message.text ? 'mt-3' : ''}`}>
              {message.images!.map((img) => (
                <div key={img.id} className="overflow-hidden rounded-xl border border-[#E6E4DF] bg-[#FAF9F6]">
                  {img.status === 'ready' && img.url ? (
                    <button
                      type="button"
                      data-testid="chat-panel-generated-image"
                      title={tr('drag_image', { defaultValue: '拖到编辑区' })}
                      aria-label={tr('drag_image', { defaultValue: '拖到编辑区' })}
                      className="block w-full cursor-grab active:cursor-grabbing"
                      onPointerDown={(e) => {
                        if (!onDropChatImage || e.button !== 0) return;
                        e.preventDefault();
                        e.stopPropagation();
                        let armed = false;
                        const onMove = (move: PointerEvent) => {
                          const dx = move.clientX - e.clientX;
                          const dy = move.clientY - e.clientY;
                          if (!armed) {
                            if (dx * dx + dy * dy < 16) return;
                            armed = true;
                          }
                          setDragGhost({ x: move.clientX, y: move.clientY, preview: img.url });
                          onDropPreviewAt?.(move.clientX, move.clientY);
                        };
                        const onUp = (up: PointerEvent) => {
                          window.removeEventListener('pointermove', onMove);
                          window.removeEventListener('pointerup', onUp);
                          window.removeEventListener('pointercancel', onUp);
                          setDragGhost(null);
                          onDropPreviewEnd?.();
                          if (!armed) return;
                          onDropChatImage(img, up.clientX, up.clientY);
                        };
                        window.addEventListener('pointermove', onMove);
                        window.addEventListener('pointerup', onUp);
                        window.addEventListener('pointercancel', onUp);
                      }}
                    >
                      <img src={img.url} alt={img.title} className="max-h-72 w-full object-cover" draggable={false} />
                    </button>
                  ) : img.status === 'error' ? (
                    <div className="flex flex-col items-start gap-2 px-3 py-4">
                      <p className="text-xs text-[#C2410C]">{img.error || t('voice.flux_error', { message: '' })}</p>
                      {onRetryImage ? (
                        <button
                          type="button"
                          data-testid="chat-panel-image-retry"
                          className="rounded-full border border-[#E6E4DF] bg-white px-2.5 py-1 text-[11px] tracking-[0.04em] text-[#2c2c28] hover:border-[#C2410C]/40 hover:text-[#C2410C]"
                          onClick={() => onRetryImage(message.id, img.id)}
                        >
                          {t('nodes.image_retry')}
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <div className="flex h-36 items-center justify-center">
                      <Loader2 className="h-5 w-5 animate-spin text-[#C2410C]" />
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                    {img.title ? (
                      <p className="truncate text-[11px] tracking-[0.04em] text-[#8a8a82]">{img.title}</p>
                    ) : (
                      <span />
                    )}
                    {onExcerpt && img.status === 'ready' && img.url ? (
                      <button
                        type="button"
                        data-testid="chat-panel-image-excerpt"
                        className="shrink-0 rounded-lg border border-[#E6E4DF] bg-white px-1.5 py-1 text-[10px] tracking-[0.04em] text-[#C2410C] hover:border-[#C2410C]/40"
                        onClick={() => excerptImage(img)}
                      >
                        {t('canvas.v2.excerpt_selection', { defaultValue: '摘录' })}
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {!isUser && (message.searchHits ?? []).length > 0 ? (
        <ChatSearchHits
          hits={message.searchHits!}
          dragHitLabel={tr('drag_search_hit', { defaultValue: '拖到编辑区' })}
          onDropHitAt={
            onDropSearchHitAt
              ? (hit, x, y) => onDropSearchHitAt(message.id, hit, x, y)
              : undefined
          }
        />
      ) : null}
      {askUi && !isUser && message.text && (onExcerpt || onDropSelectionAt) ? (
        <TextSelectionToolbar
          top={askUi.top}
          left={askUi.left}
          toolbarRef={toolbarRef}
          onArm={arm}
          onDisarm={disarm}
          placement="fixed"
          portalHost={portalHost}
          zClassName="z-[132]"
        >
          {onDropSelectionAt ? (
            <button
              type="button"
              title={tr('drag_selection', { defaultValue: '拖到编辑区' })}
              aria-label={tr('drag_selection', { defaultValue: '拖到编辑区' })}
              className="flex h-6 w-5 cursor-grab items-center justify-center rounded-md text-[#C2410C] hover:bg-[#FFF7ED] active:cursor-grabbing"
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                e.preventDefault();
                arm();
                const text = quoteRef.current?.text ?? '';
                beginSelectionDrag(text, e.clientX, e.clientY);
              }}
            >
              <GripVertical className="h-3 w-3" />
            </button>
          ) : null}
          {onExcerpt ? (
            <TextSelectionToolbarButton variant="primary" onArm={arm} onAction={excerptSelection}>
              {t('canvas.v2.excerpt_selection', { defaultValue: '摘录' })}
            </TextSelectionToolbarButton>
          ) : null}
        </TextSelectionToolbar>
      ) : null}
      {dragGhost
        ? createPortal(
            <div
              aria-hidden
              className="pointer-events-none fixed z-[132] max-w-xs rounded-2xl border border-[#C2410C]/40 bg-white px-3 py-2 text-xs leading-relaxed text-[#2c2c28] shadow-lg"
              style={{
                left: dragGhost.x,
                top: dragGhost.y,
                transform: 'translate(-8px, -8px)',
              }}
            >
              {dragGhost.preview ? (
                <img src={dragGhost.preview} alt="" className="max-h-24 max-w-[12rem] rounded-lg object-cover" />
              ) : (
                <>
                  {(dragGhost.text ?? message.text).trim().slice(0, 80)}
                  {(dragGhost.text ?? message.text).trim().length > 80 ? '…' : ''}
                </>
              )}
            </div>,
            portalHost ?? document.body,
          )
        : null}
    </div>
  );
}
