import React from 'react';
import type { AgentConfig, CanvasNode } from '../../db';
import { ThemeNode } from './ThemeNode';
import { NoteNode } from './NoteNode';
import { AiNode } from './AiNode';
import { ImageNode } from './ImageNode';
import { VideoNode } from './VideoNode';
import { DocumentNode } from './DocumentNode';
import { BookNode } from './BookNode';
import { EssayNode } from './EssayNode';
import { AgentNode } from './AgentNode';
import { AskNode } from './AskNode';
import { AmbienceNode } from './AmbienceNode';

/** 画布对某些 `type` 挂载的控件与各分支对应关系见 `src/constants/nodeCapabilities.ts`。 */
interface NodeRendererProps {
  node: CanvasNode;
  editingNodeId: string | null;
  setEditingNodeId: (id: string | null) => void;
  agentConfigs: AgentConfig[];
  analyzingAgentNodeId: string | null;
  streamingAiNodeId?: string | null;
  streamingThought?: string;
  streamingAskNodeId?: string | null;
  webSearchSourceCount?: number;
  webSearchSourcesCollapsed?: boolean;
  onToggleWebSearchSources?: (nodeId: string) => void;
  ttsHighlightSentence?: string | null;
  onExtractBookSelectionToCard?: (quote: string, sourceLabel?: string, sourceNodeId?: string) => void;
  onAskAboutBookSelection?: (quote: string, sourceLabel?: string, sourceNodeId?: string) => void;
  onExpandBookSelection?: (quote: string, sourceLabel?: string) => void;
  expandingBookNodeId?: string | null;
  bookExpandBranchCount?: number;
  onToggleBookExpandBranches?: (hubId: string) => void;
  notePileCount?: number;
  onToggleNotePile?: (hubId: string) => void;
  /** Ask thread reply count for stack/expand control. */
  askThreadReplyCount?: number;
  onToggleAskThread?: (askId: string) => void;
  /** Stops the current TTS playback without exiting voice mode. */
  onStopTts?: () => void;
  /** True when voice mode is currently reading the matching AI card aloud. */
  isTtsSpeaking?: boolean;
  /** Open essay article in fullscreen reader. */
  onOpenEssay?: (articleId: string, nodeId: string) => void;
  onOpenBookFullscreen?: (nodeId: string) => void;
  essaySourceCount?: number;
  onToggleEssaySources?: (essayId: string) => void;
  essayCollectHover?: boolean;
  essayCollectPulse?: boolean;
  /** Re-run a failed AI image generation in place. */
  onRetryImageGeneration?: (nodeId: string) => void;
  /** Re-run a failed AI reply card in place. */
  onRetryAiGeneration?: (nodeId: string) => void;
  onTranscribeAudio?: (nodeId: string) => void;
  transcribingAudioNodeId?: string | null;
  onContinueDiscussion?: (aiNodeId: string) => void;
  canContinueDiscussion?: (aiNodeId: string) => boolean;
  isContinueDiscussionDisabled?: boolean;
  generatingCoverAgentId?: string | null;
}

export function NodeRenderer({
  node,
  editingNodeId,
  setEditingNodeId,
  agentConfigs,
  analyzingAgentNodeId,
  streamingAiNodeId,
  streamingThought = '',
  streamingAskNodeId,
  webSearchSourceCount,
  webSearchSourcesCollapsed,
  onToggleWebSearchSources,
  ttsHighlightSentence,
  onExtractBookSelectionToCard,
  onAskAboutBookSelection,
  onExpandBookSelection,
  expandingBookNodeId,
  bookExpandBranchCount,
  onToggleBookExpandBranches,
  notePileCount,
  onToggleNotePile,
  askThreadReplyCount,
  onToggleAskThread,
  onStopTts,
  isTtsSpeaking,
  onOpenEssay,
  onOpenBookFullscreen,
  essaySourceCount,
  onToggleEssaySources,
  essayCollectHover,
  essayCollectPulse,
  onRetryImageGeneration,
  onRetryAiGeneration,
  onTranscribeAudio,
  transcribingAudioNodeId,
  onContinueDiscussion,
  canContinueDiscussion,
  isContinueDiscussionDisabled,
  generatingCoverAgentId,
}: NodeRendererProps) {
  switch (node.type) {
    case 'theme':
      return (
        <ThemeNode
          node={node}
          editingNodeId={editingNodeId}
          setEditingNodeId={setEditingNodeId}
          bookExpandBranchCount={bookExpandBranchCount}
          bookExpandBranchesCollapsed={!!node.bookExpandBranchesCollapsed}
          onToggleBookExpandBranches={
            onToggleBookExpandBranches ? () => onToggleBookExpandBranches(node.id) : undefined
          }
        />
      );
    case 'note':
    case 'text':
      return (
        <NoteNode
          node={node}
          editingNodeId={editingNodeId}
          setEditingNodeId={setEditingNodeId}
          webSearchSourceCount={webSearchSourceCount}
          webSearchSourcesCollapsed={webSearchSourcesCollapsed}
          onToggleWebSearchSources={
            onToggleWebSearchSources ? () => onToggleWebSearchSources(node.id) : undefined
          }
          notePileCount={notePileCount}
          notePileCollapsed={!!node.notePileCollapsed}
          onToggleNotePile={
            onToggleNotePile
              ? () => onToggleNotePile(node.notePileParentId || node.id)
              : undefined
          }
        />
      );
    case 'ask':
      return (
        <AskNode
          node={node}
          isSubmitting={streamingAskNodeId === node.id}
          askThreadReplyCount={askThreadReplyCount ?? 0}
          askThreadCollapsed={!!node.askThreadCollapsed}
          onToggleAskThread={onToggleAskThread ? () => onToggleAskThread(node.id) : undefined}
        />
      );
    case 'ai':
      return (
        <AiNode
          node={node}
          editingNodeId={editingNodeId}
          setEditingNodeId={setEditingNodeId}
          isContentStreaming={streamingAiNodeId === node.id}
          streamingThought={streamingAiNodeId === node.id ? streamingThought : ''}
          webSearchSourceCount={webSearchSourceCount}
          webSearchSourcesCollapsed={webSearchSourcesCollapsed}
          onToggleWebSearchSources={
            onToggleWebSearchSources ? () => onToggleWebSearchSources(node.id) : undefined
          }
          ttsHighlightSentence={ttsHighlightSentence}
          isTtsSpeaking={isTtsSpeaking}
          onStopTts={onStopTts}
          onExtractSelectionToCard={onExtractBookSelectionToCard}
          onAskAboutSelection={onAskAboutBookSelection}
          onContinueDiscussion={
            onContinueDiscussion ? () => onContinueDiscussion(node.id) : undefined
          }
          canContinueDiscussion={
            canContinueDiscussion ? canContinueDiscussion(node.id) : false
          }
          isContinueDiscussionDisabled={isContinueDiscussionDisabled}
          onRetry={onRetryAiGeneration}
        />
      );
    case 'image':
      return (
        <ImageNode
          node={node}
          editingNodeId={editingNodeId}
          setEditingNodeId={setEditingNodeId}
          onRetry={onRetryImageGeneration}
        />
      );
    case 'video':
      return (
        <VideoNode
          node={node}
          editingNodeId={editingNodeId}
          setEditingNodeId={setEditingNodeId}
          onTranscribeAudio={onTranscribeAudio}
          isTranscribingAudio={transcribingAudioNodeId === node.id}
        />
      );
    case 'document':
      return <DocumentNode node={node} editingNodeId={editingNodeId} setEditingNodeId={setEditingNodeId} />;
    case 'book':
      return (
        <BookNode
          node={node}
          editingNodeId={editingNodeId}
          setEditingNodeId={setEditingNodeId}
          onExtractSelectionToCard={onExtractBookSelectionToCard}
          onAskAboutSelection={onAskAboutBookSelection}
          onExpandSelection={onExpandBookSelection}
          isExpanding={expandingBookNodeId === node.id}
          onOpenFullscreen={onOpenBookFullscreen}
        />
      );
    case 'essay':
      return (
        <EssayNode
          node={node}
          editingNodeId={editingNodeId}
          setEditingNodeId={setEditingNodeId}
          onOpenEssay={onOpenEssay}
          essaySourceCount={essaySourceCount}
          essaySourcesCollapsed={!!node.essaySourcesCollapsed}
          onToggleEssaySources={
            onToggleEssaySources ? () => onToggleEssaySources(node.id) : undefined
          }
          collectHover={essayCollectHover}
          collectPulse={essayCollectPulse}
        />
      );
    case 'ambience':
      return <AmbienceNode node={node} editingNodeId={editingNodeId} setEditingNodeId={setEditingNodeId} />;
    case 'agent':
      return (
        <AgentNode
          node={node}
          editingNodeId={editingNodeId}
          setEditingNodeId={setEditingNodeId}
          agentConfigs={agentConfigs}
          isAnalyzing={analyzingAgentNodeId === node.id}
          isGeneratingCover={
            Boolean(node.agentConfigId) && generatingCoverAgentId === node.agentConfigId
          }
        />
      );
    default:
      return null;
  }
}
