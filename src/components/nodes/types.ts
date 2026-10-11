import type { AIConfig } from '../../components/AISettingsModal';
import type { AgentConfig, CanvasNode } from '../../db';
import type { ProactiveStatus } from '../../hooks/useRoomProactiveChat';

export interface NodeContentProps {
  node: CanvasNode;
  editingNodeId: string | null;
  setEditingNodeId: (id: string | null) => void;
}

export interface NoteNodeProps extends NodeContentProps {
  /** Linked web-search image/source cards exist beside this note. */
  webSearchSourceCount?: number;
  webSearchSourcesCollapsed?: boolean;
  onToggleWebSearchSources?: () => void;
  /** Free note pile (drag-to-stack). Shown on the top card. */
  notePileCount?: number;
  notePileCollapsed?: boolean;
  onToggleNotePile?: () => void;
}

export interface ThemeNodeProps extends NodeContentProps {
  /** Book-expand branch cards linked from this theme hub. */
  bookExpandBranchCount?: number;
  bookExpandBranchesCollapsed?: boolean;
  onToggleBookExpandBranches?: () => void;
}

export interface AgentNodeProps extends NodeContentProps {
  agentConfigs: AgentConfig[];
  isAnalyzing?: boolean;
  isGeneratingCover?: boolean;
  /** 这个房间的主动发言进度；没有就不渲染。 */
  proactiveStatus?: ProactiveStatus;
}

export interface AiNodeProps extends NodeContentProps {
  /** While model output is streaming into this card, render plain text (not Markdown). */
  isContentStreaming?: boolean;
  /** Live chain-of-thought shown before visible prose exists. */
  streamingThought?: string;
  /** Linked web-search source cards exist beside this answer. */
  webSearchSourceCount?: number;
  webSearchSourcesCollapsed?: boolean;
  onToggleWebSearchSources?: () => void;
  /** Sentence currently being read aloud (voice mode TTS follow-along). */
  ttsHighlightSentence?: string | null;
  /** True when voice mode is currently reading this reply aloud. */
  isTtsSpeaking?: boolean;
  /** Stop the in-progress TTS playback (drops the current queue). */
  onStopTts?: () => void;
  /** Create a plain text note from the selected reply (no AI). */
  onExtractSelectionToCard?: (
    quote: string,
    sourceLabel?: string,
    sourceNodeId?: string,
    /** User's own thought on the excerpt; becomes part of the card text. */
    note?: string,
  ) => void;
  /** Quote selected reply text into the canvas Ask card. */
  onAskAboutSelection?: (quote: string, sourceLabel?: string, sourceNodeId?: string) => void;
  /** Continue a multi-agent discussion for another back-and-forth from this leaf. */
  onContinueDiscussion?: () => void;
  canContinueDiscussion?: boolean;
  isContinueDiscussionDisabled?: boolean;
  /** Re-run generation for a card stuck generating or in the `error` state. */
  onRetry?: (nodeId: string) => void;
}

export interface ImageNodeProps extends NodeContentProps {
  /** Re-run generation for a card stuck generating or in the `error` state. */
  onRetry?: (nodeId: string) => void;
}

export interface VideoNodeProps extends NodeContentProps {
  /** Transcribe in-card audio with Volc ASR into a linked note. */
  onTranscribeAudio?: (nodeId: string) => void;
  isTranscribingAudio?: boolean;
}

export interface BookNodeProps extends NodeContentProps {
  /** Quote selected text into the toolbar AI context. */
  onAskAboutSelection?: (quote: string, sourceLabel?: string, sourceNodeId?: string) => void;
  /** Expand selected text into a theme hub + linked note cards. */
  onExpandSelection?: (quote: string, sourceLabel?: string) => void;
  /**
   * 画布视图下的「摘抄」：把选中段落直接长成画布上的一张卡片。
   *
   * 只有 `layout === 'card'` 会用到它。全屏阅读拿不到这个回调（那边左栏另有「放上画布」），
   * 于是摘抄仍然只记进这本书的摘抄本——**全屏才是"书内部"，画布上就该是一张独立的卡**。
   */
  onExtractSelectionToCard?: (
    quote: string,
    sourceLabel?: string,
    sourceNodeId?: string,
    note?: string,
  ) => void;
  /**
   * 正文选区变化时上报（空串 = 用户在正文里取消了选中）。
   * 全屏阅读用它把选区直接送进右栏的聊天框，不必再点「问 AI」。
   */
  onSelectionPreview?: (text: string) => void;
  /**
   * 划词 / 划句翻译要用的模型配置。
   *
   * 给了才出现「翻译」那颗按钮：没配模型时露出一个点下去必然失败的按钮，
   * 比不露更糟。伴读标重点和伴读对话是自动的，翻译是用户主动点的，所以这个
   * 依赖是显式的而不是从别处捡一个过来。
   */
  aiConfig?: AIConfig | null;
  /**
   * 全屏阅读时顶栏里预留的空位：页码栏借住它，就不用在正文上下各占一行。
   * 和对话栏的「历史 / 新建」借顶栏是同一个办法。没给就照原样留在正文下方。
   */
  pageNavHost?: HTMLElement | null;
  isExpanding?: boolean;
  /** Open an immersive reader. Card chrome only. */
  onOpenFullscreen?: (nodeId: string) => void;
  layout?: 'card' | 'immersive';
  /**
   * 全屏左栏「跳回原文」：切到 `unitIndex` 那一章，并尽力把 `text` 滚进视野。
   * 只在 `nonce` 变化时重新触发（text / unitIndex 是同一次请求的载荷）。
   */
  jumpRequest?: { unitIndex: number; text: string; nonce: number } | null;
  /**
   * 落点高亮已经撤掉（鼠标从那一段上移开了）：这次跳转到此结束。外层顺手把
   * `jumpRequest` 清掉，翻去别的章再翻回来时高亮才不会自己长回来。
   */
  onJumpHighlightDismiss?: () => void;
}
