import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import Markdown from 'react-markdown';
import { ArrowUp, ChevronLeft, FileText, GripVertical, Loader2, MessageCircleMore, Mic, Plus, X } from 'lucide-react';
import {
  db,
  type AgentConfig,
  type CanvasChatGeneratedImage,
  type CanvasChatMessage,
  type CanvasChatSession,
  type CanvasNode,
} from '../../db';
import { useAppDialog } from '../AppDialogProvider';
import { personaThreadId } from '../../utils/agentWorkZone';
import { sortChatMessages } from '../../utils/chatMessageOrder';
import { resolveAgentLocalizedName } from '../../utils/aiI18n';
import { markdownBodyComponents, markdownGfmPlugins, markdownRehypePlugins } from '../markdownBody';
import { useTextSelectionToolbar } from '../../hooks/useTextSelectionToolbar';
import { TextSelectionToolbar, TextSelectionToolbarButton } from '../TextSelectionToolbar';
import { excerptSearchHitToCanvas, excerptToCanvas } from '../../utils/excerptToCanvas';
import type { AskSearchHit } from '../../utils/askSearchHits';
import { canvasOverlayProps } from '../../utils/canvasOverlay';
import { isTextEditingTarget } from '../../utils/noteClipboard';
import { resolveVoiceInputMode, type VoiceInputMode } from '../../constants/voiceWriting';
import {
  composerHasContent,
  EMPTY_COMPOSER,
  formatUserMessageForDisplay,
  normalizeComposerSegments,
  type ComposerSegment,
} from '../../utils/chatComposer';
import { findSentenceRange } from '../../utils/ttsHighlight';
import type { RefObject } from 'react';
import {
  CHAT_BUBBLE_BODY_CLASS,
  CHAT_COMPOSER_WRAP_CLASS,
  CHAT_PANEL_LIST_CLASS,
  CHAT_REPLY_DRAG_HANDLE_CLASS,
} from './chatPanelStyles';
import { ChatReplyCopyHost, ChatReplySpeakButton } from './ChatReplyCopyButton';
import { ChatSearchHits } from './ChatSearchHits';
import { ChatSuggestedFollowUps } from './ChatSuggestedFollowUps';
import { ChatSidebarSessionControls } from './ChatSidebarSessionControls';
import { ChatThinkingTrace, resolveChatThought } from './ChatThinkingTrace';
import { ComposerInlineInput } from './ComposerInlineInput';
import {
  findPersonaChatSession,
  restorePersonaChatSession,
  startNewPersonaChatSession,
} from '../../utils/personaChatSessions';
import { savePersonaComposerDraft } from '../../utils/personaStreamingAi';
import { CANVAS_FILE_UPLOAD_ACCEPT, filesFromDataTransfer } from '../../utils/chatPanelFileUpload';
import { dataTransferHasFiles } from '../../utils/dnd';
import {
  ChatRoomParticipants,
  type ChatRoomInviteCandidate,
} from './ChatRoomParticipants';
import type { RoomParticipant } from '../../utils/personaChatRoom';
import {
  DEFAULT_ROOM_DISCUSSION_ROUNDS,
  ROOM_DISCUSSION_ROUNDS_MAX,
  clampRoomDiscussionRounds,
} from '../../utils/personaChatRoom';

export type CanvasChatPanelProps = {
  canvasId: string;
  agentNode: CanvasNode;
  agentConfig?: AgentConfig;
  /** Override header name (e.g. 阿狸 Ask card). */
  personaDisplayName?: string;
  nodes: CanvasNode[];
  nodesRef: RefObject<Record<string, HTMLElement | null>>;
  composerSegments?: ComposerSegment[];
  onComposerSegmentsChange?: (segments: ComposerSegment[]) => void;
  isStreaming: boolean;
  streamingMessageId: string | null;
  streamingThought: string;
  onClose: () => void;
  ttsHighlightMessageId?: string | null;
  ttsHighlightSentence?: string | null;
  /** 配了 TTS 才给出朗读按钮 */
  canReadAloud?: boolean;
  /** 正在被朗读的那条消息（会话朗读或手动朗读） */
  speakingMessageId?: string | null;
  /** 刚读完的那条：据此把喇叭显示成"重播" */
  lastSpokenMessageId?: string | null;
  onReadMessage?: (messageId: string, text: string) => void;
  onStopSpeaking?: () => void;
  onSend: (segments: ComposerSegment[], onAccepted: () => void) => void | Promise<unknown>;
  /** Paste, drag-drop, or + picker — files become canvas cards beside the persona. */
  onIngestFiles?: (files: File[]) => void | Promise<unknown>;
  onRemoveFocus?: (nodeId: string) => void;
  scrollToMessageId?: string | null;
  /** Place a full assistant reply on the canvas at this screen point. */
  onDropReplyAt?: (messageId: string, clientX: number, clientY: number) => void;
  /** Place a selected excerpt on the canvas at this screen point. */
  onDropSelectionAt?: (messageId: string, text: string, clientX: number, clientY: number) => void;
  onDropChatImage?: (image: CanvasChatGeneratedImage, clientX: number, clientY: number) => void;
  onRetryChatImage?: (messageId: string, imageId: string) => void;
  /** Place the full thinking trace on the canvas. */
  onDropThinkingAt?: (messageId: string, clientX: number, clientY: number) => void;
  /** Place a live-search hit on the canvas at this screen point. */
  onDropSearchHitAt?: (
    messageId: string,
    hit: AskSearchHit,
    clientX: number,
    clientY: number,
  ) => void;
  onToggleVoice?: () => void;
  voiceModeActive?: boolean;
  voicePhase?: 'idle' | 'listening' | 'draft' | 'thinking' | 'speaking';
  liveTranscript?: string;
  voiceInputMode?: VoiceInputMode;
  /** Stamp the composer (e.g. book “问 AI”) after the panel opens. */
  composerPrefill?: {
    personaNodeId: string;
    composerSegments: ComposerSegment[];
    token: number;
  } | null;
  /** 多角色房间：在场角色，主 Agent 恒在首位。空/缺省 = 单人对话。 */
  roomParticipants?: RoomParticipant[];
  /** 画布上已有的其他角色卡。 */
  roomInviteCandidates?: ChatRoomInviteCandidate[];
  /** 角色库里还没上画布的角色，选中会先放到画布上再加入。 */
  roomLibraryCandidates?: ChatRoomInviteCandidate[];
  roomMaxParticipants?: number;
  onAddRoomParticipant?: (nodeId: string) => void;
  onAddRoomFromLibrary?: (agentConfigId: string) => void;
  onRemoveRoomParticipant?: (nodeId: string) => void;
  onToggleRoomParticipantMuted?: (nodeId: string) => void;
  /**
   * 多角色房间：在场各角色的流式状态（按角色卡节点 id）。
   * 有值时气泡按自己的发言人取流式状态，头部跟着当前发言的角色走。
   */
  streamsByPersona?: Record<string, { messageId: string; thought: string }>;
  /** 多角色房间：自动讨论的进度（没有则为 null）。 */
  roomDiscussion?: { round: number; rounds: number } | null;
  /** 多角色房间：一次讨论跑几轮（一轮 = 每个未禁言的声音各说一次）。 */
  roomDiscussionRounds?: number;
  onChangeRoomDiscussionRounds?: (rounds: number) => void;
  onStartRoomDiscussion?: () => void;
  onStopRoomDiscussion?: () => void;
  /** 角色卡上的房间主动发言开关（右上角）。 */
  proactiveEnabled?: boolean;
  onToggleProactive?: (enabled: boolean) => void;
};

export function CanvasChatPanel({
  canvasId,
  agentNode,
  agentConfig,
  personaDisplayName,
  nodes,
  nodesRef,
  composerSegments: composerSegmentsProp,
  onComposerSegmentsChange,
  isStreaming,
  streamingMessageId,
  streamingThought,
  onClose,
  onSend,
  onIngestFiles,
  onRemoveFocus,
  scrollToMessageId,
  ttsHighlightMessageId = null,
  ttsHighlightSentence = null,
  canReadAloud = false,
  speakingMessageId = null,
  lastSpokenMessageId = null,
  onReadMessage,
  onStopSpeaking,
  onDropReplyAt,
  onDropSelectionAt,
  onDropChatImage,
  onRetryChatImage,
  onDropThinkingAt,
  onDropSearchHitAt,
  onToggleVoice,
  voiceModeActive = false,
  voicePhase = 'idle',
  liveTranscript = '',
  voiceInputMode,
  composerPrefill = null,
  roomParticipants,
  roomInviteCandidates,
  roomLibraryCandidates,
  roomMaxParticipants = 3,
  onAddRoomParticipant,
  onAddRoomFromLibrary,
  onRemoveRoomParticipant,
  onToggleRoomParticipantMuted,
  streamsByPersona,
  roomDiscussion = null,
  roomDiscussionRounds = DEFAULT_ROOM_DISCUSSION_ROUNDS,
  onChangeRoomDiscussionRounds,
  onStartRoomDiscussion,
  onStopRoomDiscussion,
  proactiveEnabled = true,
  onToggleProactive,
}: CanvasChatPanelProps) {
  const { t, i18n } = useTranslation();
  const { confirm } = useAppDialog();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [viewingSession, setViewingSession] = useState<CanvasChatSession | null>(null);
  const [localSegments, setLocalSegments] = useState<ComposerSegment[]>(EMPTY_COMPOSER);
  const segments = composerSegmentsProp ?? localSegments;
  const setSegments = onComposerSegmentsChange ?? setLocalSegments;
  const dictation = resolveVoiceInputMode(voiceInputMode) === 'dictation';
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;
  const persistTimerRef = useRef<number | null>(null);
  const [sendHint, setSendHint] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fileDragOver, setFileDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileDragDepthRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToLatestRef = useRef(true);
  const threadId = personaThreadId(canvasId, agentNode.id);
  const hydratedDraftRef = useRef(false);
  const prefillTokenRef = useRef<number | null>(null);
  const skipVoiceOverwriteRef = useRef(false);
  const wasVoiceActiveRef = useRef(false);
  const composerPrefillRef = useRef(composerPrefill);
  composerPrefillRef.current = composerPrefill;

  const persistDraftNow = useCallback(
    (nextSegments: ComposerSegment[]) => {
      if (persistTimerRef.current != null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      void savePersonaComposerDraft({
        canvasId,
        agentNodeId: agentNode.id,
        composerSegments: nextSegments,
      });
    },
    [agentNode.id, canvasId],
  );

  const setSegmentsFromUser = useCallback(
    (next: ComposerSegment[]) => {
      if (dictation && voicePhase === 'listening' && !skipVoiceOverwriteRef.current) {
        skipVoiceOverwriteRef.current = true;
        onToggleVoice?.();
      } else if (dictation) {
        skipVoiceOverwriteRef.current = true;
      }
      setSegments(next);
    },
    [dictation, onToggleVoice, setSegments, voicePhase],
  );

  const thread = useLiveQuery(
    () => db.canvasPersonaThreads.get(threadId),
    [threadId],
  );

  const displayMessages = useMemo(
    () => sortChatMessages(thread?.messages ?? []),
    [thread?.messages],
  );
  const archivedSessions = thread?.sessionArchive ?? [];
  const readonly = viewingSession !== null;
  const listMessages = useMemo(
    () => (viewingSession ? sortChatMessages(viewingSession.messages) : displayMessages),
    [displayMessages, viewingSession],
  );

  const requestNewChat = async () => {
    if (displayMessages.length === 0 || isStreaming || submitting) return;
    const ok = await confirm({ message: t('reference.essay_chat_new_confirm') });
    if (!ok) return;
    setViewingSession(null);
    await startNewPersonaChatSession(threadId);
  };

  const requestRestoreSession = async () => {
    if (!viewingSession || isStreaming || submitting) return;
    if (displayMessages.length > 0) {
      const ok = await confirm({ message: t('reference.essay_chat_restore_confirm') });
      if (!ok) return;
    }
    await restorePersonaChatSession(threadId, viewingSession.id);
    setViewingSession(null);
  };

  useEffect(() => {
    const canvas = canvasId;
    const nodeId = agentNode.id;
    if (composerSegmentsProp !== undefined) {
      hydratedDraftRef.current = true;
      return;
    }
    hydratedDraftRef.current = false;
    let cancelled = false;
    void db.canvasPersonaThreads.get(personaThreadId(canvas, nodeId)).then((row) => {
      if (cancelled) return;
      const pending = composerPrefillRef.current;
      if (pending && pending.personaNodeId === nodeId) {
        setSegments(normalizeComposerSegments(pending.composerSegments));
        prefillTokenRef.current = pending.token;
      } else if (row?.composerSegments?.length) {
        setSegments(normalizeComposerSegments(row.composerSegments));
      } else {
        setSegments([{ type: 'text', content: row?.composerDraft ?? '' }]);
      }
      hydratedDraftRef.current = true;
    });
    return () => {
      cancelled = true;
      if (persistTimerRef.current != null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      if (!hydratedDraftRef.current && !composerHasContent(segmentsRef.current)) return;
      void savePersonaComposerDraft({
        canvasId: canvas,
        agentNodeId: nodeId,
        composerSegments: segmentsRef.current,
      });
    };
  }, [agentNode.id, canvasId, composerSegmentsProp, setSegments]);

  useEffect(() => {
    if (voiceModeActive && voicePhase === 'listening') {
      skipVoiceOverwriteRef.current = false;
    }
  }, [voiceModeActive, voicePhase]);

  useEffect(() => {
    if (wasVoiceActiveRef.current && !voiceModeActive && composerPrefill) {
      prefillTokenRef.current = composerPrefill.token;
    }
    wasVoiceActiveRef.current = voiceModeActive;
  }, [composerPrefill, voiceModeActive]);

  useEffect(() => {
    if (!composerPrefill || composerPrefill.personaNodeId !== agentNode.id) return;
    if (prefillTokenRef.current === composerPrefill.token) return;
    if (dictation && voiceModeActive && (skipVoiceOverwriteRef.current || voicePhase !== 'listening')) {
      // Consume the token so a skipped/stale transcript cannot land after the next listen.
      prefillTokenRef.current = composerPrefill.token;
      return;
    }
    prefillTokenRef.current = composerPrefill.token;
    const next = normalizeComposerSegments(composerPrefill.composerSegments);
    setSegments(next);
    hydratedDraftRef.current = true;
    persistDraftNow(next);
  }, [agentNode.id, composerPrefill, dictation, persistDraftNow, setSegments, voiceModeActive, voicePhase]);

  useEffect(() => {
    if (!hydratedDraftRef.current) return;
    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null;
      void savePersonaComposerDraft({
        canvasId,
        agentNodeId: agentNode.id,
        composerSegments: segments,
      });
    }, 300);
    return () => {
      if (persistTimerRef.current != null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, [agentNode.id, canvasId, segments]);

  const agentName = personaDisplayName
    ?? (agentConfig ? resolveAgentLocalizedName(agentConfig) : t('nodes.agent_fallback_name', { defaultValue: '角色' }));

  const scrollToLatest = useCallback(() => {
    stickToLatestRef.current = true;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const handleIngestFiles = (raw: File[]) => {
    if (!onIngestFiles || raw.length === 0 || uploading) return;
    setUploading(true);
    void Promise.resolve(onIngestFiles(raw)).finally(() => {
      setUploading(false);
    });
  };

  // 自动讨论进行中合成器仍然可用：发出去就是插话接管（先停批次、等当前那句说完）。
  const composerBusy = (isStreaming && !roomDiscussion) || submitting || uploading;

  // 轮数输入用草稿值，让用户能把"10"打完再收口，不在每次按键时夹取。
  const [roundsDraft, setRoundsDraft] = useState<string | null>(null);
  const commitRoomDiscussionRounds = () => {
    if (roundsDraft === null) return;
    const parsed = Number.parseInt(roundsDraft, 10);
    setRoundsDraft(null);
    const next = clampRoomDiscussionRounds(
      Number.isFinite(parsed) ? parsed : roomDiscussionRounds,
    );
    if (next !== roomDiscussionRounds) onChangeRoomDiscussionRounds?.(next);
  };

  const dispatchSend = (payload: ComposerSegment[]) => {
    if (!composerHasContent(payload) || composerBusy) return;
    setSendHint(null);
    setSubmitting(true);
    scrollToLatest();
    let accepted = false;
    void Promise.resolve(
      onSend(payload, () => {
        accepted = true;
        const cleared = [...EMPTY_COMPOSER];
        setSegments(cleared);
        persistDraftNow(cleared);
        setSendHint(null);
        scrollToLatest();
      }),
    ).then(() => {
      if (!accepted) {
        setSendHint(t('canvas.v2.send_busy', { defaultValue: '还有任务在进行，这条没有发出去。' }));
      }
    }).finally(() => {
      setSubmitting(false);
    });
  };

  const handleSubmit = () => {
    dispatchSend(normalizeComposerSegments(segments));
  };

  const handleSuggestedFollowUp = (question: string) => {
    dispatchSend([{ type: 'text', content: question }]);
  };

  useEffect(() => {
    if (!onToggleVoice) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.key !== ' ' && event.code !== 'Space') || event.repeat) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (isTextEditingTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      onToggleVoice();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onToggleVoice]);

  useLayoutEffect(() => {
    stickToLatestRef.current = true;
  }, [threadId]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || !stickToLatestRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [threadId, thread?.messages.length, thread?.updatedAt, isStreaming, streamingThought]);

  useLayoutEffect(() => {
    if (!scrollToMessageId) return;
    const el = document.querySelector(`[data-chat-message-id="${scrollToMessageId}"]`);
    el?.scrollIntoView({ behavior: 'auto', block: 'center' });
  }, [scrollToMessageId, thread?.messages.length]);

  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const syncHost = () => {
      const fs = document.fullscreenElement;
      setPortalHost(fs instanceof HTMLElement ? fs : document.body);
    };
    syncHost();
    document.addEventListener('fullscreenchange', syncHost);
    return () => document.removeEventListener('fullscreenchange', syncHost);
  }, []);

  const excerptSelection = useCallback(
    async (messageId: string, selectedText: string) => {
      const message = thread?.messages.find((m) => m.id === messageId);
      if (!message) return;
      const obstacles = nodes.map((n) => {
        const el = nodesRef.current[n.id];
        return {
          type: n.type,
          x: n.x,
          y: n.y,
          width: n.width && n.width > 0 ? n.width : el?.offsetWidth || undefined,
          height: n.height && n.height > 0 ? n.height : el?.offsetHeight || undefined,
        };
      });
      await excerptToCanvas({
        canvasId,
        agentNodeId: agentNode.id,
        threadId,
        message,
        text: selectedText,
        kind: 'selection',
        nodes,
        obstacles,
      });
    },
    [agentNode.id, canvasId, nodes, nodesRef, thread, threadId],
  );

  const excerptSearchHit = useCallback(
    async (messageId: string, hit: AskSearchHit) => {
      const message = thread?.messages.find((m) => m.id === messageId);
      if (!message) return;
      const obstacles = nodes.map((n) => {
        const el = nodesRef.current[n.id];
        return {
          type: n.type,
          x: n.x,
          y: n.y,
          width: n.width && n.width > 0 ? n.width : el?.offsetWidth || undefined,
          height: n.height && n.height > 0 ? n.height : el?.offsetHeight || undefined,
        };
      });
      await excerptSearchHitToCanvas({
        canvasId,
        agentNodeId: agentNode.id,
        threadId,
        message,
        hit,
        nodes,
        obstacles,
      });
    },
    [agentNode.id, canvasId, nodes, nodesRef, thread, threadId],
  );

  if (!portalHost) return null;

  const lastAssistant = [...displayMessages].reverse().find((m) => m.role === 'assistant');
  const lastStreamingMessageId = [...listMessages].reverse().find((m) => m.role === 'assistant')?.id;
  // 多角色房间：哪个角色在说话，头部就显示谁的名字与思考。
  const speakerNameById = new Map<string, string>([
    [agentNode.id, agentName],
    ...(roomParticipants ?? []).map((p) => [p.nodeId, p.name] as [string, string]),
  ]);
  const streamingSpeaker = streamsByPersona
    ? Object.entries(streamsByPersona).find(
        // 必须按"最后一条回复"来认领槽位：主 Agent 的槽位在整个房间轮次里都还在
        // （插入顺序也在最前），只看"消息在不在列表里"会永远选中它。
        ([, slot]) => slot.messageId === lastStreamingMessageId,
      )
    : undefined;
  // 占着标题的那个声音：有人说话时是说话的人，空闲时归主 Agent。
  const titledNodeId = streamingSpeaker?.[0] ?? agentNode.id;
  // 空闲时头部只认领"占着标题的那个声音自己"的思考。房间里最后发言的可能是别人，
  // 把它的思考挂在主角色的名字下面就是错位 —— 那一份留着，由它自己的气泡显示。
  const idleThoughtOwner = lastAssistant?.speakerNodeId ?? titledNodeId;
  const headerThought = streamingSpeaker
    ? resolveChatThought({
        thinkingTrace:
          lastAssistant?.id === streamingSpeaker[1].messageId
            ? lastAssistant.thinkingTrace
            : undefined,
        isStreaming: true,
        streamingThought: streamingSpeaker[1].thought,
      })
    : lastAssistant && idleThoughtOwner === titledNodeId
      ? resolveChatThought({
          thinkingTrace: lastAssistant.thinkingTrace,
          isStreaming: isStreaming && lastAssistant.id === streamingMessageId,
          streamingThought,
        })
      : '';
  const headerSpeakerName = streamingSpeaker
    ? speakerNameById.get(streamingSpeaker[0]) ?? agentName
    : agentName;
  // 讨论角色并进标题行：名字后面点灯，+ 头像按钮拉人，其他角色以 chip 跟在后面。
  const roomCast =
    roomParticipants && roomParticipants.length > 0 ? (
      <ChatRoomParticipants
        participants={roomParticipants}
        hostNodeId={agentNode.id}
        titledNodeId={titledNodeId}
        candidates={roomInviteCandidates ?? []}
        libraryCandidates={roomLibraryCandidates ?? []}
        maxParticipants={roomMaxParticipants}
        disabled={readonly || isStreaming || submitting}
        onAdd={onAddRoomParticipant}
        onAddFromLibrary={onAddRoomFromLibrary}
        onRemove={(nodeId) => onRemoveRoomParticipant?.(nodeId)}
        onToggleMuted={(nodeId) => onToggleRoomParticipantMuted?.(nodeId)}
      />
    ) : null;

  // 房间里禁言的交互只有一种：点名字。占着标题的那个声音，标题本身就是它的开关
  // （谁占标题谁可点）；它退成 chip 时，开关跟着 chip（由 ChatRoomParticipants 渲染）。
  const roomIsCast = Boolean(roomParticipants && roomParticipants.length > 1);
  const titledVoice = roomIsCast
    ? roomParticipants!.find((p) => p.nodeId === titledNodeId)
    : undefined;
  const titleTextClass = `min-w-0 truncate text-[15px] font-medium tracking-[0.02em] ${
    titledVoice?.muted ? 'text-[#a8a49c] line-through' : 'text-[#2c2c28]'
  }`;

  return createPortal(
    <aside
      {...canvasOverlayProps}
      data-no-drag=""
      data-testid="canvas-chat-panel"
      className="flex flex-col overflow-hidden border-l border-[#E6E4DF] bg-[#FAF9F6] shadow-xl"
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 'min(26rem, 92vw)',
        zIndex: 70,
      }}
    >
      <header className="flex shrink-0 items-start justify-between gap-2 border-b border-[#E6E4DF] px-5 py-4">
        {readonly ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <button
              type="button"
              data-testid="canvas-chat-history-back"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#5a5a54] transition-colors hover:bg-[#F4F1ED] hover:text-[#C2410C]"
              onClick={() => setViewingSession(null)}
              title={t('reference.essay_chat_back_to_current')}
              aria-label={t('reference.essay_chat_back_to_current')}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <p className="min-w-0 truncate text-[15px] font-medium tracking-[0.02em] text-[#2c2c28]">
              {viewingSession?.preview || t('reference.essay_chat_history')}
            </p>
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            <ChatThinkingTrace
              name={
                <>
                  {titledVoice && onToggleRoomParticipantMuted ? (
                    <button
                      type="button"
                      data-testid={`room-mute-${titledVoice.nodeId}`}
                      // 和 chip 上的开关同一个禁用条件：有人正在说的时候不切换禁言，
                      // 免得"点了要等下一轮才生效"；但不压暗 —— 标题不该因为别人在说话就变灰。
                      disabled={readonly || isStreaming || submitting}
                      aria-pressed={titledVoice.muted}
                      title={t(titledVoice.muted ? 'canvas.v2.room_unmute' : 'canvas.v2.room_mute')}
                      aria-label={t(
                        titledVoice.muted ? 'canvas.v2.room_unmute' : 'canvas.v2.room_mute',
                      )}
                      onClick={() => onToggleRoomParticipantMuted(titledVoice.nodeId)}
                      className={`${titleTextClass} text-left transition-colors hover:text-[#C2410C] disabled:hover:text-inherit`}
                    >
                      {headerSpeakerName}
                    </button>
                  ) : (
                    <span className={titleTextClass}>{headerSpeakerName}</span>
                  )}
                  {roomCast}
                </>
              }
              nameClassName="flex min-w-0 items-center gap-2"
              thought={headerThought}
              messageId={lastAssistant?.id ?? ''}
              canEdit={!isStreaming || lastAssistant?.id !== streamingMessageId}
              onExcerptSelection={(text) => {
                if (!lastAssistant) return;
                void excerptSelection(lastAssistant.id, text);
              }}
              onDropThinkingAt={onDropThinkingAt}
              onDropSelectionAt={onDropSelectionAt}
            />
          </div>
        )}
        <div className="flex shrink-0 items-center gap-0.5">
          {!readonly && onToggleProactive ? (
            <button
              type="button"
              data-testid="canvas-chat-proactive-toggle"
              aria-pressed={proactiveEnabled}
              title={proactiveEnabled ? t('canvas.v2.proactive_on') : t('canvas.v2.proactive_off')}
              aria-label={proactiveEnabled ? t('canvas.v2.proactive_on') : t('canvas.v2.proactive_off')}
              onClick={() => onToggleProactive(!proactiveEnabled)}
              className={
                proactiveEnabled
                  ? 'rounded-md p-1.5 text-[#C2410C] hover:bg-[#C2410C]/10'
                  : 'rounded-md p-1.5 text-[#8a8a82] hover:bg-[#C2410C]/10 hover:text-[#C2410C]'
              }
            >
              <MessageCircleMore className="h-4 w-4" />
            </button>
          ) : null}
          {!readonly ? (
            <ChatSidebarSessionControls
              testIdPrefix="canvas-chat"
              disabled={false}
              busy={isStreaming || submitting}
              canNewChat={displayMessages.length > 0}
              archivedSessions={archivedSessions}
              historyOpen={historyOpen}
              onHistoryOpenChange={setHistoryOpen}
              onNewChat={requestNewChat}
              onViewSession={(sessionId) => {
                const session = findPersonaChatSession(archivedSessions, sessionId);
                if (session) setViewingSession(session);
              }}
            />
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-[#8a8a82] hover:bg-[#C2410C]/10 hover:text-[#C2410C]"
            aria-label={t('common.close', { defaultValue: '关闭' })}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div
        ref={listRef}
        className={CHAT_PANEL_LIST_CLASS}
        onScroll={() => {
          const el = listRef.current;
          if (!el) return;
          stickToLatestRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
      >
        {readonly ? (
          <div className="mb-2 flex flex-wrap items-center gap-2 px-0.5">
            <p className="min-w-0 flex-1 text-[11px] tracking-[0.06em] text-[#8c8a84]">
              {t('reference.essay_chat_history_readonly')}
            </p>
            <button
              type="button"
              data-testid="canvas-chat-restore"
              disabled={isStreaming || submitting}
              className="shrink-0 rounded-full border border-[#C2410C]/30 bg-[#FFF7ED] px-2.5 py-1 text-[11px] tracking-[0.04em] text-[#C2410C] hover:border-[#C2410C]/50 disabled:opacity-40"
              onClick={() => void requestRestoreSession()}
            >
              {t('reference.essay_chat_restore')}
            </button>
          </div>
        ) : null}
        {listMessages.map((msg) => {
          // 每个气泡按自己的发言人取流式状态与名字；单人对话走原来的 props。
          const stream = streamsByPersona
            ? streamsByPersona[msg.speakerNodeId ?? agentNode.id]
            : undefined;
          const bubbleStreaming = streamsByPersona
            ? Boolean(
                stream &&
                  stream.messageId === msg.id &&
                  // 主 Agent 的槽位在整个房间轮次里都还在，所以只有"最后一条回复"
                  // 才算在流式，否则它已经答完的气泡会一直挂在忙碌态上。
                  msg.id === lastStreamingMessageId,
              )
            : !readonly && isStreaming && msg.id === streamingMessageId;
          const bubbleThought = streamsByPersona
            ? stream?.messageId === msg.id
              ? stream.thought
              : ''
            : streamingThought;
          const bubbleSpeakerName =
            msg.role === 'assistant' &&
            msg.speakerName &&
            msg.speakerNodeId &&
            msg.speakerNodeId !== agentNode.id
              ? msg.speakerName
              : agentName;
          return (
          <ChatMessageBubble
            key={msg.id}
            message={msg}
            agentName={bubbleSpeakerName}
            isStreaming={bubbleStreaming}
            streamingThought={bubbleThought}
            readonly={readonly}
            ttsHighlightSentence={
              ttsHighlightMessageId === msg.id ? ttsHighlightSentence : null
            }
            onExcerptSelection={(text) => void excerptSelection(msg.id, text)}
            onDropReplyAt={readonly ? undefined : onDropReplyAt}
            onDropSelectionAt={readonly ? undefined : onDropSelectionAt}
            onDropChatImage={readonly ? undefined : onDropChatImage}
            onRetryChatImage={readonly ? undefined : onRetryChatImage}
            onDropThinkingAt={readonly ? undefined : onDropThinkingAt}
            onExcerptSearchHit={readonly ? undefined : (hit) => void excerptSearchHit(msg.id, hit)}
            onDropSearchHitAt={readonly ? undefined : onDropSearchHitAt}
            hideThinkingTrace={Boolean(headerThought && lastAssistant && msg.id === lastAssistant.id)}
            locale={i18n.language}
            canReadAloud={canReadAloud}
            isSpeaking={speakingMessageId === msg.id}
            wasSpoken={lastSpokenMessageId === msg.id}
            onReadMessage={
              onReadMessage && msg.role === 'assistant'
                ? () => onReadMessage(msg.id, msg.text)
                : undefined
            }
            onStopSpeaking={onStopSpeaking}
          />
          );
        })}
        {!readonly &&
        !isStreaming &&
        lastAssistant &&
        lastAssistant.id === listMessages[listMessages.length - 1]?.id &&
        (lastAssistant.suggestedFollowUps ?? []).length > 0 ? (
          <ChatSuggestedFollowUps
            questions={lastAssistant.suggestedFollowUps!}
            disabled={submitting}
            onSelect={handleSuggestedFollowUp}
          />
        ) : null}
      </div>

      <footer className={`shrink-0 px-4 pb-4 pt-2 ${readonly ? 'pointer-events-none opacity-40' : ''}`}>
        {voiceModeActive && voicePhase === 'listening' && !dictation ? (
          <p className="mb-2 px-1 text-xs leading-relaxed tracking-[0.04em] text-[#C2410C]">
            {liveTranscript.trim() || t('voice.phase_listening')}
          </p>
        ) : voiceModeActive && voicePhase === 'draft' ? (
          <p className="mb-2 px-1 text-xs leading-relaxed tracking-[0.04em] text-[#C2410C]">
            {t('voice.phase_draft')}
          </p>
        ) : voiceModeActive && voicePhase === 'idle' ? (
          <p className="mb-2 px-1 text-xs leading-relaxed tracking-[0.04em] text-[#8a8a82]">
            {t('voice.wait_for_chime')}
          </p>
        ) : null}
        {/* 多角色房间：让角色之间自己聊。跑起来之后这里变成进度 + 停止；
            讨论期间输入框仍然可用，发消息就是插话接管。 */}
        {roomParticipants && roomParticipants.length > 1 && onStartRoomDiscussion ? (
          <div className="mb-2 flex items-center gap-2 px-1">
            {roomDiscussion ? (
              <>
                <span
                  data-testid="canvas-chat-discussion-progress"
                  className="min-w-0 flex-1 truncate text-xs tracking-[0.04em] text-[#C2410C]"
                >
                  {t('canvas.v2.room_discussion_running', {
                    round: roomDiscussion.round,
                    rounds: roomDiscussion.rounds,
                  })}
                </span>
                <button
                  type="button"
                  data-testid="canvas-chat-discussion-stop"
                  onClick={onStopRoomDiscussion}
                  className="shrink-0 rounded-full border border-[#E6E4DF] bg-white px-2.5 py-1 text-[11px] tracking-[0.04em] text-[#5a5a54] transition-colors hover:border-[#C2410C]/40 hover:text-[#C2410C]"
                >
                  {t('canvas.v2.room_discussion_stop')}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  data-testid="canvas-chat-discussion-start"
                  disabled={submitting || isStreaming}
                  onClick={onStartRoomDiscussion}
                  className="rounded-full border border-dashed border-[#d1cfca] px-2.5 py-1 text-[11px] tracking-[0.04em] text-[#8a8a82] transition-colors hover:border-[#C2410C]/40 hover:text-[#C2410C] disabled:opacity-40"
                >
                  {displayMessages.some((m) => m.role === 'assistant')
                    ? t('canvas.v2.room_discussion_continue')
                    : t('canvas.v2.room_discussion_start')}
                </button>
                {/* 讨论轮数：一轮 = 每个未禁言的声音各说一次。直接填数字，
                    输入期间不夹取（否则打到"10"会被改成"5"），失焦/回车时收口。 */}
                {onChangeRoomDiscussionRounds ? (
                  <span className="flex shrink-0 items-center gap-0.5 text-[11px] tracking-[0.04em] text-[#8a8a82]">
                    <input
                      type="text"
                      inputMode="numeric"
                      data-testid="canvas-chat-discussion-rounds"
                      disabled={submitting || isStreaming}
                      aria-label={t('canvas.v2.room_discussion_rounds_label')}
                      title={t('canvas.v2.room_discussion_rounds_hint', {
                        min: 1,
                        max: ROOM_DISCUSSION_ROUNDS_MAX,
                      })}
                      value={roundsDraft ?? String(roomDiscussionRounds)}
                      onChange={(e) => setRoundsDraft(e.target.value.replace(/\D/g, '').slice(0, 2))}
                      onBlur={commitRoomDiscussionRounds}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitRoomDiscussionRounds();
                        }
                      }}
                      className="w-6 border-b border-[#d1cfca] bg-transparent py-0.5 text-center tabular-nums text-[#2c2c28] outline-none transition-colors hover:border-[#C2410C]/40 focus:border-[#C2410C] disabled:opacity-40"
                    />
                    <span>{t('canvas.v2.room_discussion_rounds_unit')}</span>
                  </span>
                ) : null}
              </>
            )}
          </div>
        ) : null}
        {sendHint ? (
          <p className="mb-2 px-1 text-xs leading-relaxed tracking-[0.04em] text-[#C2410C]" data-testid="canvas-chat-send-hint">
            {sendHint}
          </p>
        ) : null}
        <div
          className={`flex gap-2 rounded-xl border bg-white px-2 py-1.5 shadow-sm transition-colors ${
            fileDragOver ? 'border-[#C2410C]/45 bg-[#FFF7ED]/50' : 'border-[#E6E4DF]'
          }`}
          onDragEnter={(e) => {
            if (!onIngestFiles || !dataTransferHasFiles(e.dataTransfer)) return;
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
          <div className={CHAT_COMPOSER_WRAP_CLASS}>
          <ComposerInlineInput
            segments={normalizeComposerSegments(segments)}
            onSegmentsChange={setSegmentsFromUser}
            nodes={nodes}
            disabled={composerBusy}
            placeholder={t('canvas.v2.chat_input_placeholder', { defaultValue: '输入消息…' })}
            chipFallback={t('canvas.v2.focus_card', { defaultValue: '卡片' })}
            clearLabel={t('canvas.v2.clear_focus', { defaultValue: '清除' })}
            onSubmit={handleSubmit}
            onPasteFiles={onIngestFiles ? handleIngestFiles : undefined}
            onRemoveFocus={onRemoveFocus}
            onBlurPersist={() => persistDraftNow(segmentsRef.current)}
          />
          <div className="mt-0.5 flex items-center justify-between gap-2">
            {onIngestFiles ? (
              <>
                <button
                  type="button"
                  data-testid="canvas-chat-upload"
                  disabled={composerBusy}
                  title={t('canvas.v2.chat_upload', { defaultValue: '上传图片或文件' })}
                  aria-label={t('canvas.v2.chat_upload', { defaultValue: '上传图片或文件' })}
                  onClick={() => fileInputRef.current?.click()}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#5a5a54] transition-colors hover:bg-[#F4F1ED] hover:text-[#C2410C] disabled:opacity-50"
                >
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={CANVAS_FILE_UPLOAD_ACCEPT}
                  className="hidden"
                  data-testid="canvas-chat-upload-input"
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
                onClick={onToggleVoice}
                title={t('voice.toolbar_mic_with_persona', { name: agentName })}
                aria-label={t('voice.toolbar_mic_with_persona', { name: agentName })}
                aria-pressed={voiceModeActive}
                data-testid="canvas-chat-voice"
                className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
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
              onClick={handleSubmit}
              disabled={composerBusy || !composerHasContent(segments)}
              title={t('canvas.v2.send', { defaultValue: '发送' })}
              aria-label={t('canvas.v2.send', { defaultValue: '发送' })}
              data-testid="canvas-chat-send"
              className="flex h-7 w-7 items-center justify-center rounded-full bg-[#C2410C] text-white transition-opacity hover:bg-[#a0350a] disabled:opacity-30 disabled:hover:bg-[#C2410C]"
            >
              {isStreaming || submitting || uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
            </button>
            </div>
          </div>
          </div>
        </div>
      </footer>
    </aside>,
    portalHost,
  );
}

function ChatTtsFollowAlong({
  content,
  sentence,
  scrollParentRef,
}: {
  content: string;
  sentence: string;
  scrollParentRef: RefObject<HTMLDivElement | null>;
}) {
  const markRef = useRef<HTMLElement | null>(null);
  const range = findSentenceRange(content, sentence);

  useLayoutEffect(() => {
    const mark = markRef.current;
    const parent = scrollParentRef.current;
    if (!mark || !parent) return;
    const parentRect = parent.getBoundingClientRect();
    const markRect = mark.getBoundingClientRect();
    const pad = 12;
    if (markRect.top < parentRect.top + pad || markRect.bottom > parentRect.bottom - pad) {
      mark.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }
  }, [sentence, content, scrollParentRef]);

  if (!range) {
    return (
      <div className="whitespace-pre-wrap" data-chat-reply-prose="">
        {content}
      </div>
    );
  }

  return (
    <div className="whitespace-pre-wrap" data-chat-reply-prose="" data-testid="chat-tts-follow-along">
      <span className="text-[#8a8a82]">{content.slice(0, range.start)}</span>
      <span
        ref={markRef}
        className="text-[#C2410C] underline decoration-[#C2410C]/45 decoration-2 underline-offset-[3px]"
      >
        {content.slice(range.start, range.end)}
      </span>
      <span className="text-[#c4c0b6]">{content.slice(range.end)}</span>
    </div>
  );
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

type BubbleProps = {
  message: CanvasChatMessage;
  agentName: string;
  isStreaming: boolean;
  streamingThought: string;
  ttsHighlightSentence?: string | null;
  onExcerptSelection: (text: string) => void;
  onDropReplyAt?: (messageId: string, clientX: number, clientY: number) => void;
  onDropSelectionAt?: (messageId: string, text: string, clientX: number, clientY: number) => void;
  onDropChatImage?: (image: CanvasChatGeneratedImage, clientX: number, clientY: number) => void;
  onRetryChatImage?: (messageId: string, imageId: string) => void;
  onDropThinkingAt?: (messageId: string, clientX: number, clientY: number) => void;
  onExcerptSearchHit?: (hit: AskSearchHit) => void;
  onDropSearchHitAt?: (
    messageId: string,
    hit: AskSearchHit,
    clientX: number,
    clientY: number,
  ) => void;
  hideThinkingTrace?: boolean;
  readonly?: boolean;
  locale: string;
  /** 配了 TTS 才显示朗读按钮 */
  canReadAloud?: boolean;
  /** 这一条正在被朗读 */
  isSpeaking?: boolean;
  /** 这一条刚被读过（按钮显示"重播"） */
  wasSpoken?: boolean;
  onReadMessage?: () => void;
  onStopSpeaking?: () => void;
};

function ChatMessageBubble({
  message,
  agentName,
  isStreaming,
  streamingThought,
  ttsHighlightSentence = null,
  onExcerptSelection,
  onDropReplyAt,
  onDropSelectionAt,
  onDropChatImage,
  onRetryChatImage,
  onDropThinkingAt,
  onExcerptSearchHit,
  onDropSearchHitAt,
  hideThinkingTrace = false,
  readonly = false,
  canReadAloud = false,
  isSpeaking = false,
  wasSpoken = false,
  onReadMessage,
  onStopSpeaking,
}: BubbleProps) {
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
    sourceLabel: agentName,
    disabled: isUser || isStreaming || readonly,
    toolbarWidth: 148,
    positionMode: 'viewport',
    clampSelector: '[data-testid="canvas-chat-panel"]',
  });

  const runExcerptSelection = () => {
    const quote = quoteRef.current;
    if (!quote) return;
    onExcerptSelection(quote.text);
    dismissSelectionToolbar();
  };

  const canDragToCanvas =
    !readonly && Boolean(onDropReplyAt) && !isUser && !isStreaming && Boolean(message.text.trim());
  const [dragGhost, setDragGhost] = useState<{ x: number; y: number; preview?: string; text?: string } | null>(null);

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
    };
    const onUp = (up: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setDragGhost(null);
      if (!armed) return;
      onDropSelectionAt(message.id, snippet, up.clientX, up.clientY);
      dismissSelectionToolbar();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const onHandlePointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!canDragToCanvas || e.button !== 0) return;
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
    };
    const onUp = (up: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setDragGhost(null);
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
      {!isUser ? (
        <ChatThinkingTrace
          name={agentName}
          nameClassName="truncate text-[11px] tracking-[0.08em] text-[#aaa]"
          thought={
            hideThinkingTrace
              ? ''
              : resolveChatThought({
                  thinkingTrace: message.thinkingTrace,
                  isStreaming,
                  streamingThought,
                })
          }
          messageId={message.id}
          canEdit={!isStreaming}
          onExcerptSelection={onExcerptSelection}
          onDropThinkingAt={onDropThinkingAt}
          onDropSelectionAt={onDropSelectionAt}
        />
      ) : (
        <span className="text-[11px] tracking-[0.08em] text-[#aaa]">
          {t('canvas.v2.you', { defaultValue: '你' })}
        </span>
      )}
      <div className="group/message relative max-w-full">
        {canDragToCanvas ? (
          <button
            type="button"
            data-testid="chat-reply-drag-handle"
            onPointerDown={onHandlePointerDown}
            title={t('canvas.v2.drag_reply_to_canvas')}
            aria-label={t('canvas.v2.drag_reply_to_canvas')}
            className={CHAT_REPLY_DRAG_HANDLE_CLASS}
          >
            <GripVertical className="h-3 w-3" />
          </button>
        ) : null}
        <div
          className={`${CHAT_BUBBLE_BODY_CLASS} ${
            isUser
              ? 'bg-[#C2410C]/10 text-[#2c2c28]'
              : 'bg-white border border-[#E6E4DF] text-[#2c2c28]'
          }`}
        >
        <div
          ref={bodyRef}
          onMouseUp={updateSelectionAsk}
          onPointerDown={(e) => {
            if (!onDropSelectionAt || isStreaming || e.button !== 0) return;
            const sel = window.getSelection();
            if (!sel || sel.isCollapsed || !bodyRef.current) return;
            if (!bodyRef.current.contains(sel.anchorNode) || !bodyRef.current.contains(sel.focusNode)) return;
            if (!clientPointInSelection(sel, e.clientX, e.clientY)) return;
            const text = sel.toString();
            if (text.replace(/\s+/g, ' ').trim().length < 2) return;
            e.preventDefault();
            e.stopPropagation();
            beginSelectionDrag(text, e.clientX, e.clientY);
          }}
          className="cursor-text"
        >
        {isStreaming && !message.text && streamingThought && (
          <p className="text-xs text-[#8a8a82] italic mb-2">{streamingThought}</p>
        )}
        {message.text ? (
          <ChatReplyCopyHost
            text={message.text}
            showCopy={!isUser && Boolean(message.text.trim()) && !isStreaming}
            trailingControls={
              !isUser &&
              !isStreaming &&
              canReadAloud &&
              (isSpeaking ? Boolean(onStopSpeaking) : Boolean(onReadMessage)) ? (
                <ChatReplySpeakButton
                  speaking={isSpeaking}
                  spokenBefore={wasSpoken}
                  onSpeak={onReadMessage}
                  onStop={onStopSpeaking}
                />
              ) : undefined
            }
          >
            {ttsHighlightSentence ? (
              <ChatTtsFollowAlong
                content={message.text}
                sentence={ttsHighlightSentence}
                scrollParentRef={bodyRef}
              />
            ) : (
              <Markdown
                remarkPlugins={markdownGfmPlugins}
                rehypePlugins={markdownRehypePlugins}
                components={markdownBodyComponents}
              >
                {isUser ? formatUserMessageForDisplay(message.text) : message.text}
              </Markdown>
            )}
          </ChatReplyCopyHost>
        ) : isStreaming && !(message.images ?? []).length ? (
          <Loader2 className="w-4 h-4 animate-spin text-[#C2410C]" />
        ) : null}
        {(message.images ?? []).length > 0 ? (
          <div className={`space-y-2 ${message.text ? 'mt-3' : ''}`}>
            {message.images!.map((img) => (
              <div key={img.id} className="overflow-hidden rounded-xl border border-[#E6E4DF] bg-[#FAF9F6]">
                {img.status === 'ready' && img.url ? (
                  <button
                    type="button"
                    data-testid="chat-generated-image"
                    title={t('canvas.v2.drag_image_to_canvas', { defaultValue: '拖到画布' })}
                    aria-label={t('canvas.v2.drag_image_to_canvas', { defaultValue: '拖到画布' })}
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
                      };
                      const onUp = (up: PointerEvent) => {
                        window.removeEventListener('pointermove', onMove);
                        window.removeEventListener('pointerup', onUp);
                        window.removeEventListener('pointercancel', onUp);
                        setDragGhost(null);
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
                    {onRetryChatImage ? (
                      <button
                        type="button"
                        data-testid="chat-image-retry"
                        className="rounded-full border border-[#E6E4DF] bg-white px-2.5 py-1 text-[11px] tracking-[0.04em] text-[#2c2c28] hover:border-[#C2410C]/40 hover:text-[#C2410C]"
                        onClick={() => onRetryChatImage(message.id, img.id)}
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
                {img.title ? (
                  <p className="truncate px-2.5 py-1.5 text-[11px] tracking-[0.04em] text-[#8a8a82]">{img.title}</p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        </div>
        </div>
      </div>
      {!isUser && (message.searchHits ?? []).length > 0 ? (
        <ChatSearchHits
          hits={message.searchHits!}
          onExcerptHit={onExcerptSearchHit}
          onDropHitAt={
            onDropSearchHitAt
              ? (hit, x, y) => onDropSearchHitAt(message.id, hit, x, y)
              : undefined
          }
        />
      ) : null}
      {askUi && !isUser && message.text && (
        <TextSelectionToolbar
          top={askUi.top}
          left={askUi.left}
          toolbarRef={toolbarRef}
          onArm={arm}
          onDisarm={disarm}
          placement="fixed"
        >
          <button
            type="button"
            title={t('canvas.v2.drag_selection_to_canvas')}
            aria-label={t('canvas.v2.drag_selection_to_canvas')}
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
          <TextSelectionToolbarButton variant="primary" onArm={arm} onAction={runExcerptSelection}>
            {t('canvas.v2.excerpt_selection', { defaultValue: '摘录' })}
          </TextSelectionToolbarButton>
        </TextSelectionToolbar>
      )}
      {dragGhost
        ? createPortal(
            <div
              aria-hidden
              className="pointer-events-none fixed z-[80] max-w-xs rounded-2xl border border-[#C2410C]/40 bg-white px-3 py-2 text-xs leading-relaxed text-[#2c2c28] shadow-lg"
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
            document.body,
          )
        : null}
    </div>
  );
}
