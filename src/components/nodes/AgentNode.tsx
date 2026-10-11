import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, MessagesSquare, Play } from 'lucide-react';
import type { AgentNodeProps } from './types';
import { resolveAgentLocalizedName } from '../../utils/aiI18n';
import { AgentIcon } from '../AgentIcon';
import { ProactiveStatusPill } from './ProactiveStatusPill';

const EDGE_BTN =
  'w-6 h-6 bg-white border border-[#E6E4DF] rounded-full flex items-center justify-center text-[#8c8a84] hover:text-[#C2410C] hover:border-[#C2410C] transition-all shadow-sm disabled:opacity-40 disabled:pointer-events-none';

export function AgentRunAnalysisButton({
  onRunAnalysis,
  disabled,
  label,
}: {
  onRunAnalysis: () => void;
  disabled?: boolean;
  label?: string;
}) {
  const { t } = useTranslation();
  const runDisabled = Boolean(disabled);
  const text = label ?? t('nodes.agent_run_analysis_hint');
  return (
    <button
      type="button"
      data-testid="agent-run-analysis"
      title={t('nodes.agent_run_analysis')}
      aria-label={t('nodes.agent_run_analysis')}
      disabled={runDisabled}
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (!runDisabled) onRunAnalysis();
      }}
      className="flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-[#C2410C]/20 bg-white/40 px-2.5 backdrop-blur-md text-[#8c8a84] transition-colors hover:text-[#C2410C] hover:border-[#C2410C]/40 disabled:opacity-40 disabled:pointer-events-none"
    >
      <Play className="w-3 h-3 shrink-0" aria-hidden fill="currentColor" />
      <span className="text-[13px] font-sans leading-none text-[#8c8a84]/70 whitespace-nowrap">
        {text}
      </span>
    </button>
  );
}

export function AgentCardEdgeActions({
  onStartDiscussion,
  canStartDiscussion,
  disabled,
}: {
  onStartDiscussion?: () => void;
  canStartDiscussion?: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const showDiscussion = Boolean(canStartDiscussion && onStartDiscussion);
  if (!showDiscussion) return null;

  const discussionDisabled = Boolean(disabled) || !onStartDiscussion || !canStartDiscussion;

  return (
    <button
      type="button"
      data-testid="agent-start-discussion"
      title={t('nodes.agent_start_discussion')}
      aria-label={t('nodes.agent_start_discussion')}
      disabled={discussionDisabled}
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (!discussionDisabled) onStartDiscussion?.();
      }}
      className={EDGE_BTN}
    >
      <MessagesSquare className="w-3 h-3" aria-hidden />
    </button>
  );
}

export function AgentNode({
  node,
  agentConfigs,
  isAnalyzing,
  isGeneratingCover,
  proactiveStatus,
}: AgentNodeProps) {
  const [coverFailed, setCoverFailed] = useState(false);

  const conf = agentConfigs.find((a) => a.id === node.agentConfigId);
  const coverUrl = (conf?.coverImageUrl ?? '').trim();
  const showCover = Boolean(coverUrl) && !coverFailed;

  useEffect(() => {
    setCoverFailed(false);
  }, [coverUrl]);

  return (
    <div data-testid="agent-card" className="relative w-full h-full">
      <div
        className={
          showCover
            ? 'relative w-full h-full min-h-[180px] overflow-hidden rounded-lg border border-[#E6E4DF] bg-[#FBF5EE] shadow-lg'
            : 'relative w-full h-full bg-white text-[#1a1a1a] p-4 shadow-lg border border-[#E6E4DF] rounded-lg overflow-hidden flex flex-col'
        }
      >
        {showCover ? (
          <img
            src={coverUrl}
            alt=""
            aria-hidden
            draggable={false}
            data-testid="agent-cover"
            onError={() => setCoverFailed(true)}
            className="absolute inset-0 h-full w-full object-cover pointer-events-none select-none"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[#C2410C]/8 to-transparent pointer-events-none" aria-hidden />
        )}
        {showCover ? null : (
          <div className="flex items-start gap-3 relative z-10">
            <div className="w-9 h-9 rounded-lg bg-[#F4F1ED] border border-[#E6E4DF] flex items-center justify-center text-[#C2410C] shrink-0 overflow-hidden">
              <AgentIcon
                agentId={conf?.id}
                className="w-full h-full"
                imageClassName="scale-[1.32]"
                fallbackClassName="text-[#C2410C]"
              />
            </div>
            <div className="min-w-0 flex-1 self-center">
              <div className="font-serif text-xl font-bold leading-snug text-[#1a1a1a]">
                {conf ? resolveAgentLocalizedName(conf) : 'Agent'}
              </div>
            </div>
          </div>
        )}
        {isAnalyzing || isGeneratingCover ? (
          <div
            className="absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-white/75 backdrop-blur-[1px] pointer-events-none"
            data-testid="agent-analyzing-overlay"
          >
            <Loader2 className="w-8 h-8 text-[#C2410C] animate-spin" aria-hidden />
          </div>
        ) : null}
        <ProactiveStatusPill status={proactiveStatus} />
      </div>
    </div>
  );
}
