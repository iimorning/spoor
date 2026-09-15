import React, { useCallback, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, MessagesSquare, RefreshCw, Square, StickyNote, Wand2 } from 'lucide-react';
import Markdown from 'react-markdown';
import type { AiNodeProps } from './types';
import { CANVAS_NODE_CONTEXT_TEXT_ATTR } from '../../utils/canvasNodeContextText';
import {
  AI_CARD_AUTO_MAX_HEIGHT_PX,
  AI_CARD_SCROLL_MAX_HEIGHT_PX,
  AI_THINKING_SCROLL_MAX_HEIGHT_PX,
} from '../../utils/canvas';
import { findSentenceRange } from '../../utils/ttsHighlight';
import { WebSearchSourcesToggle } from './WebSearchSourcesToggle';
import { markdownBodyComponents, markdownGfmPlugins, markdownRehypePlugins } from '../markdownBody';
import { useTextSelectionToolbar } from '../../hooks/useTextSelectionToolbar';
import { TextSelectionToolbar, TextSelectionToolbarButton } from '../TextSelectionToolbar';
import { wrapTtsSentenceInElement, unwrapTtsMarks } from '../../utils/ttsFollowAlongDom';
import { unwrapSoleMarkdownFence } from '../../utils/visibleAiReply';
import { formatAiCardError } from '../../utils/aiCardGeneration';

/**
 * Scroll-style keyboard navigation for an AI reply body.
 *
 * Wheel already scrolls the body; this lets the same content be browsed
 * with the keyboard. Mirrors the wheel feel:
 *   ArrowDown / ArrowUp  — one line-height at a time
 *   PageDown / PageUp    — viewport-height steps
 *   Home / End           — jump to top / bottom
 *
 * Modifier-chords (Ctrl/Alt/Meta/Shift) and editable descendants
 * (input / textarea / contenteditable) are left untouched so users can
 * still select text or run native text-edit shortcuts.
 */
function onAiReplyBodyKeyDown(
  e: React.KeyboardEvent<HTMLDivElement>,
): void {
  const target = e.currentTarget as HTMLDivElement | null;
  const scrollEl = target;
  if (!scrollEl) return;

  const focused = e.target as HTMLElement | null;
  if (focused?.isContentEditable || focused?.closest('input, textarea, [contenteditable="true"]')) {
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;

  const lineHeight = 24;
  let delta: number | 'home' | 'end' | null = null;
  switch (e.key) {
    case 'ArrowDown':
      delta = lineHeight;
      break;
    case 'ArrowUp':
      delta = -lineHeight;
      break;
    case 'PageDown':
      delta = scrollEl.clientHeight;
      break;
    case 'PageUp':
      delta = -scrollEl.clientHeight;
      break;
    case 'Home':
      delta = 'home';
      break;
    case 'End':
      delta = 'end';
      break;
    default:
      return;
  }

  if (delta === 'home') {
    scrollEl.scrollTop = 0;
  } else if (delta === 'end') {
    scrollEl.scrollTop = scrollEl.scrollHeight;
  } else if (typeof delta === 'number') {
    scrollEl.scrollTop = Math.max(0, Math.min(scrollEl.scrollHeight, scrollEl.scrollTop + delta));
  }
  e.preventDefault();
  e.stopPropagation();
}

function TtsFollowAlongBody({
  content,
  sentence,
  scrollParentRef,
}: {
  content: string;
  sentence: string;
  scrollParentRef: React.RefObject<HTMLDivElement | null>;
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
    // Instant scroll keeps the playhead aligned with speech; smooth animation lags behind audio.
    if (markRect.top < parentRect.top + pad || markRect.bottom > parentRect.bottom - pad) {
      mark.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }
  }, [sentence, content, scrollParentRef]);

  if (!range) {
    return (
      <div className="whitespace-pre-wrap text-sm text-[#4a4a44] font-serif leading-relaxed min-h-[40px]">
        {content}
      </div>
    );
  }

  return (
    <div className="whitespace-pre-wrap text-sm text-[#4a4a44] font-serif leading-relaxed min-h-[40px]">
      <span className="text-[#8c8a84]">{content.slice(0, range.start)}</span>
      <span
        ref={markRef}
        className="text-[#C2410C] underline decoration-[#C2410C]/45 decoration-2 underline-offset-[3px]"
      >
        {content.slice(range.start, range.end)}
      </span>
      <span className="text-[#b0aea8]">{content.slice(range.end)}</span>
    </div>
  );
}

const FrozenMarkdown = React.memo(function FrozenMarkdown({ content }: { content: string }) {
  return (
    <Markdown
      remarkPlugins={markdownGfmPlugins}
      rehypePlugins={markdownRehypePlugins}
      components={markdownBodyComponents}
    >
      {content}
    </Markdown>
  );
});

function AiReplyMarkdown({
  content,
  sentence,
  scrollParentRef,
}: {
  content: string;
  sentence: string | null;
  scrollParentRef: React.RefObject<HTMLDivElement | null>;
}) {
  const mdRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = mdRef.current;
    const parent = scrollParentRef.current;
    if (!root) return;
    unwrapTtsMarks(root);
    if (!sentence) return;
    const mark = wrapTtsSentenceInElement(root, sentence);
    if (mark && parent) {
      const parentRect = parent.getBoundingClientRect();
      const markRect = mark.getBoundingClientRect();
      const pad = 12;
      if (markRect.top < parentRect.top + pad || markRect.bottom > parentRect.bottom - pad) {
        mark.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      }
    }
    return () => unwrapTtsMarks(root);
  }, [sentence, content, scrollParentRef]);

  return (
    <div
      ref={mdRef}
      className={`markdown-body w-full min-w-0 text-sm font-serif leading-relaxed min-h-[40px] ${
        sentence ? 'tts-follow-along text-[#8c8a84]' : 'text-[#4a4a44]'
      }`}
    >
      <FrozenMarkdown content={content} />
    </div>
  );
}

export function AiNode({
  node,
  isContentStreaming,
  webSearchSourceCount = 0,
  webSearchSourcesCollapsed = false,
  onToggleWebSearchSources,
  ttsHighlightSentence = null,
  isTtsSpeaking = false,
  onStopTts,
  onExtractSelectionToCard,
  onAskAboutSelection,
  streamingThought = '',
  onContinueDiscussion,
  canContinueDiscussion,
  isContinueDiscussionDisabled,
  onRetry,
}: AiNodeProps) {
  const { t } = useTranslation();
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  const thoughtScrollRef = useRef<HTMLDivElement>(null);

  const followAlong = Boolean(ttsHighlightSentence && (node.content || '').trim());
  const userSizedHeight = Boolean(node.height && node.height > 0);
  const replyBody = unwrapSoleMarkdownFence(node.content || '');
  const selectionSource =
    node.userTurn?.replace(/\s+/g, ' ').trim().slice(0, 80) || t('nodes.ai_refinement');

  const {
    askUi,
    toolbarRef,
    quoteRef,
    updateSelectionAsk,
    dismissSelectionToolbar,
    arm,
    disarm,
  } = useTextSelectionToolbar({
    bodyRef: bodyScrollRef,
    sourceLabel: selectionSource,
    disabled: Boolean(isContentStreaming),
    toolbarWidth: 140,
    sourceMarkdown: replyBody,
  });

  const runExtractSelectionToCard = useCallback(() => {
    const quote = quoteRef.current;
    if (!quote || !onExtractSelectionToCard) return;
    onExtractSelectionToCard(quote.markdown ?? quote.text, quote.sourceLabel, node.id);
    dismissSelectionToolbar();
  }, [onExtractSelectionToCard, dismissSelectionToolbar, node.id, quoteRef]);

  const runAskAboutSelection = useCallback(() => {
    const quote = quoteRef.current;
    if (!quote || !onAskAboutSelection) return;
    onAskAboutSelection(quote.text, quote.sourceLabel, node.id);
    dismissSelectionToolbar();
  }, [onAskAboutSelection, dismissSelectionToolbar, node.id, quoteRef]);

  const showSelectionActions =
    askUi && (onExtractSelectionToCard || onAskAboutSelection) && !isContentStreaming;

  useLayoutEffect(() => {
    const el = thoughtScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [streamingThought]);

  if (isContentStreaming && !replyBody.trim()) {
    return (
      <div
        data-testid="ai-thinking-placeholder"
        className="max-w-md px-3 py-2 overflow-hidden"
      >
        {node.userTurn ? (
          <div className="mb-2 w-fit max-w-full text-sm text-[#1a1a1a] font-serif leading-relaxed px-1 py-0.5 bg-white/50 rounded">
            {node.userTurn}
          </div>
        ) : null}
        <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#8c8a84] mb-1">
          {t('nodes.ai_thinking_label')}
        </div>
        <div
          ref={thoughtScrollRef}
          data-testid="ai-thinking-scroll"
          data-no-drag=""
          className="overflow-y-auto overscroll-contain scrollbar-hide min-h-[1.5rem]"
          style={{ maxHeight: AI_THINKING_SCROLL_MAX_HEIGHT_PX }}
          onPointerDown={(e) => e.stopPropagation()}
          onWheel={(e) => {
            if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
          }}
        >
          <div className="whitespace-pre-wrap text-sm text-[#8c8a84] italic font-serif leading-relaxed">
            {streamingThought.trim() || t('nodes.ai_streaming')}
          </div>
        </div>
      </div>
    );
  }

  const showAiError =
    node.aiStatus === 'error' || (node.aiStatus === 'generating' && !isContentStreaming);
  if (showAiError) {
    const errorText = formatAiCardError(
      node.aiStatus === 'generating' ? 'stale' : node.aiError,
      t,
    );
    return (
      <div
        data-testid="ai-generation-error"
        className="max-w-md px-3 py-2 overflow-hidden border-2 border-dashed border-[#C2410C]/45 bg-[#C2410C]/5"
      >
        {node.userTurn ? (
          <div className="mb-2 w-fit max-w-full text-sm text-[#1a1a1a] font-serif leading-relaxed px-1 py-0.5 bg-white/50 rounded">
            {node.userTurn}
          </div>
        ) : null}
        <div className="flex flex-col items-start gap-1.5 py-1">
          <div className="flex items-center gap-1.5 text-[#C2410C]">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="text-[10px] font-sans font-medium">
              {t('nodes.ai_generation_failed')}
            </span>
          </div>
          <p
            className="text-[11px] font-sans text-[#C2410C]/80 leading-snug whitespace-pre-wrap line-clamp-6"
            title={errorText}
          >
            {errorText}
          </p>
          {onRetry ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRetry(node.id);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              title={t('nodes.ai_retry')}
              aria-label={t('nodes.ai_retry')}
              data-testid="ai-retry"
              className="mt-1 inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-sans font-medium text-[#C2410C] hover:bg-[#C2410C]/8 transition-colors"
            >
              <RefreshCw className="h-3 w-3" aria-hidden />
              <span>{t('nodes.ai_retry')}</span>
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const renderAiBody = () => {
    // Incomplete markdown during the stream; follow-along stays on plain text until the card settles.
    if (isContentStreaming) {
      if (followAlong && ttsHighlightSentence) {
        return (
          <TtsFollowAlongBody
            content={replyBody}
            sentence={ttsHighlightSentence}
            scrollParentRef={bodyScrollRef}
          />
        );
      }
      return (
        <div className="whitespace-pre-wrap w-full min-w-0 text-sm text-[#4a4a44] font-serif leading-relaxed min-h-[40px]">
          {replyBody || (
            <span className="text-[#8c8a84] italic">{t('nodes.ai_streaming')}</span>
          )}
        </div>
      );
    }

    return (
      <AiReplyMarkdown
        content={replyBody}
        sentence={followAlong ? ttsHighlightSentence : null}
        scrollParentRef={bodyScrollRef}
      />
    );
  };

  return (
    <div
      data-testid="ai-node-shell"
      className={`w-full min-w-0 min-h-0 bg-[#F4F1ED] p-6 shadow-lg border border-[#E6E4DF] flex flex-col relative overflow-hidden ${
        userSizedHeight ? 'h-full' : ''
      }`}
      style={userSizedHeight ? undefined : { maxHeight: AI_CARD_AUTO_MAX_HEIGHT_PX }}
      {...{ [CANVAS_NODE_CONTEXT_TEXT_ATTR]: '' }}
    >
      <WebSearchSourcesToggle
        count={webSearchSourceCount}
        collapsed={webSearchSourcesCollapsed}
        onToggle={onToggleWebSearchSources}
      />
      <div
        ref={bodyScrollRef}
        data-testid="ai-reply-body"
        data-no-drag=""
        tabIndex={0}
        className={`relative min-h-0 min-w-0 w-full overflow-x-hidden overflow-y-auto overscroll-contain scrollbar-hide select-text cursor-text focus:outline-none ${
          userSizedHeight ? 'flex-1' : ''
        }`}
        style={userSizedHeight ? undefined : { maxHeight: AI_CARD_SCROLL_MAX_HEIGHT_PX }}
        onPointerDown={(e) => e.stopPropagation()}
        onWheel={(e) => {
          if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
        }}
        onKeyDown={onAiReplyBodyKeyDown}
        onMouseUp={updateSelectionAsk}
      >
        {node.userTurn ? (
          <div className="mb-3 shrink-0 w-full min-w-0">
            {typeof node.threadRound === 'number' && node.threadRound > 0 && (
              <div className="mb-1.5">
                <span
                  className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-[#C2410C]/10 text-[#C2410C] text-[10px] font-mono font-bold tracking-wider"
                  title={t('ask.round_badge_title', { round: node.threadRound + 1 })}
                >
                  #{node.threadRound + 1}
                </span>
              </div>
            )}
            <div className="w-fit max-w-full text-sm text-[#1a1a1a] font-serif leading-relaxed px-1 py-0.5 bg-white/50 rounded">
              {node.userTurn}
            </div>
          </div>
        ) : null}
        {renderAiBody()}
      </div>
      {showSelectionActions && askUi && (
        <TextSelectionToolbar
          top={askUi.top}
          left={askUi.left}
          toolbarRef={toolbarRef}
          onArm={arm}
          onDisarm={disarm}
        >
          {onExtractSelectionToCard && (
            <TextSelectionToolbarButton
              variant="primary"
              onArm={arm}
              onAction={runExtractSelectionToCard}
            >
              <StickyNote className="w-3 h-3" />
              {t('nodes.book_to_card')}
            </TextSelectionToolbarButton>
          )}
          {onAskAboutSelection && (
            <TextSelectionToolbarButton
              variant="ghost"
              onArm={arm}
              onAction={runAskAboutSelection}
            >
              <Wand2 className="w-3 h-3" />
              {t('nodes.book_ask_ai')}
            </TextSelectionToolbarButton>
          )}
        </TextSelectionToolbar>
      )}

      {canContinueDiscussion && onContinueDiscussion && !isContentStreaming ? (
        <div className="relative z-10 mt-3 shrink-0 flex items-center justify-end bg-[#F4F1ED]">
          <button
            type="button"
            data-testid="ai-continue-discussion"
            title={t('nodes.agent_continue_discussion')}
            aria-label={t('nodes.agent_continue_discussion')}
            disabled={isContinueDiscussionDisabled}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              if (!isContinueDiscussionDisabled) onContinueDiscussion();
            }}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[#E6E4DF] bg-white text-[#C2410C] text-xs font-medium hover:bg-[#FFF7ED] hover:border-[#C2410C]/60 disabled:opacity-40 disabled:pointer-events-none transition-colors shadow-sm"
          >
            <MessagesSquare className="w-3.5 h-3.5" aria-hidden />
            {t('nodes.agent_continue_discussion')}
          </button>
        </div>
      ) : null}

      {isTtsSpeaking && onStopTts ? (
        <div className="relative z-10 mt-2 shrink-0 flex items-center justify-end gap-1.5 bg-[#F4F1ED]">
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => void onStopTts()}
            aria-label={t('voice.stop_tts')}
            title={t('voice.stop_tts')}
            data-testid="ai-tts-stop"
            className="w-7 h-7 flex items-center justify-center rounded-md text-[#C2410C] transition-colors hover:bg-[#C2410C]/10"
          >
            <Square className="w-3 h-3 fill-current" aria-hidden />
          </button>
        </div>
      ) : null}
    </div>
  );
}
