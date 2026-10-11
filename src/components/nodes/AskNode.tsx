import React from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import type { CanvasNode } from '../../db';
import type { ProactiveStatus } from '../../hooks/useRoomProactiveChat';
import { WebSearchSourcesToggle } from './WebSearchSourcesToggle';
import { ProactiveStatusPill } from './ProactiveStatusPill';
import askFoxUrl from '../../assets/ask-fox.png';

export interface AskNodeProps {
  node: CanvasNode;
  /** True while an AI call spawned from this card is streaming. */
  isSubmitting: boolean;
  /** Linked AI reply cards in this Ask thread (for stack/expand). */
  askThreadReplyCount?: number;
  askThreadCollapsed?: boolean;
  onToggleAskThread?: () => void;
  /** 这个房间的主动发言进度；没有就不渲染。 */
  proactiveStatus?: ProactiveStatus;
}

export function AskNode({
  isSubmitting,
  askThreadReplyCount = 0,
  askThreadCollapsed = false,
  onToggleAskThread,
  proactiveStatus,
}: AskNodeProps) {
  const { t } = useTranslation();

  return (
    <div
      data-testid="ask-card"
      className="relative w-full h-full min-h-[180px] overflow-hidden rounded-lg border border-[#E6E4DF] bg-[#FBF5EE] shadow-lg"
    >
      <img
        src={askFoxUrl}
        alt=""
        aria-hidden
        draggable={false}
        data-testid="ask-fox"
        className="absolute inset-0 h-full w-full object-cover pointer-events-none select-none"
      />
      <WebSearchSourcesToggle
        count={askThreadReplyCount}
        collapsed={askThreadCollapsed}
        onToggle={onToggleAskThread}
        minCount={1}
        collapseTitle={t('nodes.collapse_ask_thread')}
        expandTitle={t('nodes.expand_ask_thread')}
      />
      <ProactiveStatusPill status={proactiveStatus} />
      {isSubmitting ? (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center bg-[#FBF5EE]/35"
          data-testid="ask-submitting"
        >
          <Loader2 className="h-6 w-6 animate-spin text-[#C2410C]" aria-hidden />
        </div>
      ) : null}
    </div>
  );
}
