import React from 'react';
import { Bot } from 'lucide-react';

import mirrorIconUrl from '../assets/agent-icons/mirror.png';
import weavingIconUrl from '../assets/agent-icons/weaving.png';
import ironSmoothingIconUrl from '../assets/agent-icons/iron.png';
import compassIconUrl from '../assets/agent-icons/compass.png';
import turtleSoupHostIconUrl from '../assets/agent-icons/turtle-soup-host.png';
import intuitionPumpExpertIconUrl from '../assets/agent-icons/intuition-pump-expert.png';

const AGENT_ICON_URLS: Record<string, string> = {
  interviewer: mirrorIconUrl,
  synthesizer: weavingIconUrl,
  stylist: ironSmoothingIconUrl,
  futurist: compassIconUrl,
  turtle_soup_host: turtleSoupHostIconUrl,
  intuition_pump_expert: intuitionPumpExpertIconUrl,
  cosmos_weaver: weavingIconUrl,
  character_atelier: compassIconUrl,
};

export function getAgentIconUrl(agentId?: string | null) {
  return agentId ? AGENT_ICON_URLS[agentId] : undefined;
}

export function AgentIcon({
  agentId,
  coverUrl,
  className = 'w-5 h-5',
  imageClassName,
  fallbackClassName,
}: {
  agentId?: string | null;
  /** Literary card cover — shown instead of the default robot / built-in glyph. */
  coverUrl?: string | null;
  className?: string;
  imageClassName?: string;
  fallbackClassName?: string;
}) {
  const cover = (coverUrl ?? '').trim();
  if (cover) {
    return (
      <img
        src={cover}
        alt=""
        aria-hidden
        draggable={false}
        data-testid="agent-cover-thumb"
        className={`${className} object-cover`}
      />
    );
  }

  const iconUrl = getAgentIconUrl(agentId);

  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt=""
        aria-hidden
        draggable={false}
        className={`${className} object-contain ${imageClassName ?? ''}`}
      />
    );
  }

  return <Bot className={`${className} ${fallbackClassName ?? ''}`} aria-hidden />;
}
