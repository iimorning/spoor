import type { AgentConfig, CanvasNode } from '../../db';

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
  onExtractSelectionToCard?: (quote: string, sourceLabel?: string, sourceNodeId?: string) => void;
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
  /** Create a plain text note from the selection (no AI). */
  onExtractSelectionToCard?: (quote: string, sourceLabel?: string, sourceNodeId?: string) => void;
  /** Quote selected text into the toolbar AI context. */
  onAskAboutSelection?: (quote: string, sourceLabel?: string, sourceNodeId?: string) => void;
  /** Expand selected text into a theme hub + linked note cards. */
  onExpandSelection?: (quote: string, sourceLabel?: string) => void;
  isExpanding?: boolean;
  /** Open an immersive reader. Card chrome only. */
  onOpenFullscreen?: (nodeId: string) => void;
  layout?: 'card' | 'immersive';
}
