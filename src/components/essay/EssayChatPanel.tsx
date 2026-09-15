import React, {
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
  Loader2,
  MessageSquare,
  Mic,
  Plus,
  X,
} from 'lucide-react';
import type { CanvasChatGeneratedImage, EssayChatMessage, EssayChatSession } from '../../db';
import { useAppDialog } from '../AppDialogProvider';
import { ChatSidebarSessionControls } from '../canvas/ChatSidebarSessionControls';
import { findEssayChatSession } from '../../utils/essayChatSessions';
import { markdownBodyComponents, markdownGfmPlugins, markdownRehypePlugins } from '../markdownBody';
import {
  CHAT_BUBBLE_BODY_CLASS,
  CHAT_COMPOSER_TEXTAREA_CLASS,
  CHAT_PANEL_LIST_CLASS,
  CHAT_REPLY_DRAG_HANDLE_CLASS,
} from '../canvas/chatPanelStyles';
import { ChatReplyCopyHost } from '../canvas/ChatReplyCopyButton';
import { ChatSearchHits } from '../canvas/ChatSearchHits';
import { useTextSelectionToolbar } from '../../hooks/useTextSelectionToolbar';
import { TextSelectionToolbar, TextSelectionToolbarButton } from '../TextSelectionToolbar';
import type { AskSearchHit } from '../../utils/askSearchHits';
import { CANVAS_FILE_UPLOAD_ACCEPT, filesFromDataTransfer } from '../../utils/chatPanelFileUpload';
import { dataTransferHasFiles } from '../../utils/dnd';

export interface EssayChatPanelProps {
  messages: EssayChatMessage[];
  sending: boolean;
  error: string | null;
  disabled?: boolean;
  selectedText?: string;
  onClearSelection?: () => void;
  onSend: (text: string, files?: File[]) => void;
  onToggleVoice?: () => void;
  voiceModeActive?: boolean;
  voicePhase?: 'idle' | 'listening' | 'thinking' | 'speaking';
  liveTranscript?: string;
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
  onIngestFiles?: (files: File[]) => void | Promise<unknown>;
  onDropPreviewAt?: (clientX: number, clientY: number) => void;
  onDropPreviewEnd?: () => void;
  archivedSessions?: EssayChatSession[];
  onNewChat?: () => void | Promise<void>;
  onRestoreSession?: (sessionId: string) => void | Promise<void>;
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

export function EssayChatPanel({
  messages,
  sending,
  error,
  disabled,
  selectedText = '',
  onClearSelection,
  onSend,
  onToggleVoice,
  voiceModeActive = false,
  voicePhase = 'idle',
  liveTranscript = '',
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
}: EssayChatPanelProps) {
  const { t } = useTranslation();
  const { confirm } = useAppDialog();
  const [draft, setDraft] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [fileDragOver, setFileDragOver] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [viewingSession, setViewingSession] = useState<EssayChatSession | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileDragDepthRef = useRef(0);
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const readonly = viewingSession !== null;
  const displayMessages = viewingSession?.messages ?? messages;

  const requestNewChat = async () => {
    if (!onNewChat || messages.length === 0) return;
    const ok = await confirm({ message: t('reference.essay_chat_new_confirm') });
    if (!ok) return;
    setViewingSession(null);
    await onNewChat();
  };

  const requestRestoreSession = async () => {
    if (!onRestoreSession || !viewingSession) return;
    if (messages.length > 0) {
      const ok = await confirm({ message: t('reference.essay_chat_restore_confirm') });
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
      const essay = panelRef.current?.closest('[data-testid="essay-fullscreen"]');
      setPortalHost(essay instanceof HTMLElement ? essay : document.body);
    };
    syncHost();
    document.addEventListener('fullscreenchange', syncHost);
    return () => document.removeEventListener('fullscreenchange', syncHost);
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [displayMessages.length, sending, viewingSession?.id]);

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
      data-testid="essay-chat-panel"
      className="flex h-full min-h-0 flex-col bg-white"
    >
      <div className="relative flex h-14 shrink-0 items-center gap-2 border-b border-[#E6E4DF]/70 px-5 font-sans text-base font-bold text-[#1a1a1a]">
        {readonly ? (
          <button
            type="button"
            data-testid="essay-chat-history-back"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#5a5a54] transition-colors hover:bg-[#F4F1ED] hover:text-[#C2410C]"
            onClick={() => setViewingSession(null)}
            title={t('reference.essay_chat_back_to_current')}
            aria-label={t('reference.essay_chat_back_to_current')}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        ) : (
          <MessageSquare className="h-4 w-4 shrink-0 text-[#C2410C]" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate">
          {readonly ? viewingSession?.preview || t('reference.essay_chat_history') : t('reference.essay_chat_title')}
        </span>
        {!readonly && onNewChat ? (
          <ChatSidebarSessionControls
            testIdPrefix="essay-chat"
            disabled={disabled}
            busy={sending}
            canNewChat={messages.length > 0}
            archivedSessions={archivedSessions}
            historyOpen={historyOpen}
            onHistoryOpenChange={setHistoryOpen}
            onNewChat={requestNewChat}
            onViewSession={(sessionId) => {
              const session = findEssayChatSession(archivedSessions, sessionId);
              if (session) setViewingSession(session);
            }}
          />
        ) : null}
      </div>
      <div ref={listRef} className={CHAT_PANEL_LIST_CLASS}>
        {readonly ? (
          <div className="mb-2 flex flex-wrap items-center gap-2 px-0.5">
            <p className="min-w-0 flex-1 text-[11px] tracking-[0.06em] text-[#8c8a84]">
              {t('reference.essay_chat_history_readonly')}
            </p>
            {onRestoreSession ? (
              <button
                type="button"
                data-testid="essay-chat-restore"
                disabled={disabled || sending}
                className="shrink-0 rounded-full border border-[#C2410C]/30 bg-[#FFF7ED] px-2.5 py-1 text-[11px] tracking-[0.04em] text-[#C2410C] hover:border-[#C2410C]/50 disabled:opacity-40"
                onClick={() => void requestRestoreSession()}
              >
                {t('reference.essay_chat_restore')}
              </button>
            ) : null}
          </div>
        ) : null}
        {!readonly && messages.length === 0 && !sending ? (
          <p className="font-sans text-sm leading-relaxed tracking-[0.04em] text-[#8c8a84]">
            {t('reference.essay_chat_empty')}
          </p>
        ) : null}
        {displayMessages.map((msg) => (
          <EssayChatBubble
            key={msg.id}
            message={msg}
            sending={!readonly && sending}
            readonly={readonly}
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
        {!readonly && sending ? (
          <div className="flex items-center gap-2 font-sans text-xs tracking-[0.04em] text-[#8c8a84]">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#C2410C]" />
            {t('reference.essay_chat_thinking')}
          </div>
        ) : null}
      </div>
      {error && !readonly ? (
        <p
          className="px-4 pb-1 font-sans text-xs leading-relaxed tracking-[0.04em] text-[#C2410C]"
          data-testid="essay-chat-error"
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
        {selectedText ? (
          <div
            data-testid="essay-chat-selection"
            className="mb-2 rounded-lg border border-[#E6E4DF] bg-[#F4F1ED]/80 px-2.5 py-2"
            onMouseDown={(e) => e.preventDefault()}
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-sans text-[10px] font-bold uppercase tracking-wider text-[#8c8a84]">
                  {t('reference.essay_chat_selection_label')}
                </p>
                <p className="mt-1 line-clamp-4 whitespace-pre-wrap font-serif text-[13px] leading-relaxed tracking-[0.02em] text-[#2c2c28]">
                  {selectedText}
                </p>
              </div>
              {onClearSelection ? (
                <button
                  type="button"
                  data-testid="essay-chat-selection-clear"
                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#8c8a84] hover:bg-white hover:text-[#1a1a1a]"
                  aria-label={t('reference.essay_chat_selection_clear')}
                  title={t('reference.essay_chat_selection_clear')}
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
            data-testid="essay-chat-pending-files"
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
                  data-testid={`essay-chat-pending-file-remove-${index}`}
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
        {voiceModeActive && voicePhase === 'listening' ? (
          <p className="mb-2 px-1 font-sans text-xs leading-relaxed tracking-[0.04em] text-[#C2410C]">
            {liveTranscript.trim() || t('voice.phase_listening')}
          </p>
        ) : voiceModeActive && voicePhase === 'idle' ? (
          <p className="mb-2 px-1 font-sans text-xs leading-relaxed tracking-[0.04em] text-[#8c8a84]">
            {t('voice.wait_for_chime')}
          </p>
        ) : null}
        <textarea
          data-testid="essay-chat-input"
          value={draft}
          rows={1}
          disabled={sending || disabled || readonly}
          placeholder={
            selectedText
              ? t('reference.essay_chat_placeholder_selection')
              : t('reference.essay_chat_placeholder')
          }
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
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
                  data-testid="essay-chat-upload"
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
                  data-testid="essay-chat-upload-input"
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
                  data-testid="essay-chat-voice"
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
                data-testid="essay-chat-send"
                disabled={sending || disabled || (!draft.trim() && pendingFiles.length === 0)}
                onClick={submit}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-[#C2410C] text-white transition-opacity disabled:opacity-30"
                aria-label={t('reference.essay_chat_send')}
                title={t('reference.essay_chat_send')}
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
  onExcerpt,
  onRetryImage,
  onDropReplyAt,
  onDropSelectionAt,
  onDropChatImage,
  onDropSearchHitAt,
  portalHost,
  onDropPreviewAt,
  onDropPreviewEnd,
}: {
  message: EssayChatMessage;
  sending: boolean;
  readonly?: boolean;
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
}) {
  const { t } = useTranslation();
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
    sourceLabel: t('reference.essay_chat_title'),
    sourceMarkdown: message.text,
    disabled: isUser || sending || readonly,
    toolbarWidth: 148,
    positionMode: 'viewport',
    clampSelector: '[data-testid="essay-chat-panel"]',
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
      <div className="group/message relative max-w-full">
        {canDragToEditor ? (
          <button
            type="button"
            data-testid="essay-chat-reply-drag-handle"
            onPointerDown={onHandlePointerDown}
            title={t('reference.essay_chat_drag_reply', { defaultValue: '拖到编辑区' })}
            aria-label={t('reference.essay_chat_drag_reply', { defaultValue: '拖到编辑区' })}
            className={CHAT_REPLY_DRAG_HANDLE_CLASS}
          >
            <GripVertical className="h-3 w-3" />
          </button>
        ) : null}
        <div
          data-testid={`essay-chat-msg-${message.role}`}
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
              <Loader2 className="h-4 w-4 animate-spin text-[#C2410C]" aria-hidden />
            ) : null}
          </div>
          {message.role === 'assistant' && message.editCount ? (
            <p className="mt-2 font-sans text-[11px] tracking-[0.04em] text-[#C2410C]">
              {t('reference.essay_chat_applied_n', { count: message.editCount })}
            </p>
          ) : null}
          {(message.images ?? []).length > 0 ? (
            <div className={`space-y-2 ${message.text ? 'mt-3' : ''}`}>
              {message.images!.map((img) => (
                <div key={img.id} className="overflow-hidden rounded-xl border border-[#E6E4DF] bg-[#FAF9F6]">
                  {img.status === 'ready' && img.url ? (
                    <button
                      type="button"
                      data-testid="essay-chat-generated-image"
                      title={t('reference.essay_chat_drag_image', { defaultValue: '拖到编辑区' })}
                      aria-label={t('reference.essay_chat_drag_image', { defaultValue: '拖到编辑区' })}
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
                          data-testid="essay-chat-image-retry"
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
                        data-testid="essay-chat-image-excerpt"
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
          dragHitLabel={t('reference.essay_chat_drag_search_hit', { defaultValue: '拖到编辑区' })}
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
              title={t('reference.essay_chat_drag_selection', { defaultValue: '拖到编辑区' })}
              aria-label={t('reference.essay_chat_drag_selection', { defaultValue: '拖到编辑区' })}
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
