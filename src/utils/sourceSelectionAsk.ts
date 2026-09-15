import type { CanvasNode, CanvasWorkZone } from '../db';
import { isPersonaAnchorNode, listPersonaAnchorNodes } from './agentWorkZone';
import type { ComposerSegment } from './chatComposer';
import { findPersonaForNodeInZones } from './workZoneGeometry';

/** Compact a selection so it fits the side-panel composer. */
export function formatSourceAskDraft(quote: string, sourceLabel?: string): string {
  const text = quote.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const label = sourceLabel?.replace(/\s+/g, ' ').trim();
  return label ? `${label}\n\n${text}` : text;
}

/**
 * Which persona should receive “ask about this selection” in V2.
 * Prefers the card’s own thread, then work-zone scope, then geometry.
 */
export function resolvePersonaIdForSourceAsk(
  source: CanvasNode,
  nodes: CanvasNode[],
  zones: CanvasWorkZone[],
): string | undefined {
  if (isPersonaAnchorNode(source)) return source.id;
  const live = new Set(listPersonaAnchorNodes(nodes).map((n) => n.id));
  if (source.contextScopeAgentId && live.has(source.contextScopeAgentId)) {
    return source.contextScopeAgentId;
  }
  const fromZone = findPersonaForNodeInZones(source, zones);
  if (fromZone && live.has(fromZone)) return fromZone;
  return undefined;
}

export function planSourceSelectionAsk(options: {
  quote: string;
  sourceLabel?: string;
  source: CanvasNode;
  nodes: CanvasNode[];
  zones: CanvasWorkZone[];
}): { personaNodeId: string; draft: string; focusNodeId: string; composerSegments: ComposerSegment[] } | null {
  const draft = formatSourceAskDraft(options.quote, options.sourceLabel);
  if (!draft) return null;
  const personaNodeId = resolvePersonaIdForSourceAsk(
    options.source,
    options.nodes,
    options.zones,
  );
  if (!personaNodeId) return null;
  return {
    personaNodeId,
    draft,
    focusNodeId: options.source.id,
    composerSegments: [
      { type: 'card', nodeId: options.source.id },
      { type: 'text', content: draft },
    ],
  };
}
