import type { AIConfig } from '../components/AISettingsModal';
import { db, type CanvasNode } from '../db';
import { findOpenCanvasPosition } from './canvas';
import { placeEssayNode } from './essayNodes';
import { ESSAY_NODE_SIZE } from './essayPayload';
import { getCanvasNodeContextText } from './canvasNodeContextText';
import { draftArticleFromOutline } from './generateArticleFromOutline';
import { outlineFromCardIds } from './parsePublishOutlineResponse';
import { buildPublishSourceMaterial } from './publishSourceMaterial';
import { finalizePublishOrder } from './publishStrokeSequence';

export type SynthesizePublishEssayArgs = {
  orderedIds: readonly string[];
  candidateIds: readonly string[];
  dynamicNodes: CanvasNode[];
  nodesRef: Record<string, HTMLElement | null | undefined>;
  activeCanvasId: string;
  fallbackTitle: string;
  relatedHeading: string;
  kindLabel: (kind: string) => string;
  aiConfig?: AIConfig;
  t?: (key: string, opts?: Record<string, unknown>) => string;
};

export type SynthesizePublishEssayResult = {
  articleId: string;
  nodeId: string;
  /** True when the draft was saved with `generating` and still needs first-pass assembly. */
  willAssemble: boolean;
};

/**
 * Build essay from stroke (or selection) order — no LLM arrange.
 * Unbrushed candidates are appended in selection order.
 *
 * Returns as soon as the stitched draft + essay card exist. First-pass assembly
 * (bridge sentences / deletion marks) is left to the caller so the editor can open
 * first instead of spinning on the canvas.
 */
export async function synthesizePublishEssay({
  orderedIds,
  candidateIds,
  dynamicNodes,
  nodesRef,
  activeCanvasId,
  fallbackTitle,
  relatedHeading,
  kindLabel,
  aiConfig,
  t,
}: SynthesizePublishEssayArgs): Promise<SynthesizePublishEssayResult> {
  const finalIds = finalizePublishOrder(orderedIds, candidateIds);
  if (finalIds.length === 0) {
    throw new Error('No cards to publish');
  }

  const material = buildPublishSourceMaterial(
    finalIds,
    dynamicNodes,
    (nodeId) => {
      const el = nodesRef[nodeId];
      return el ? getCanvasNodeContextText(el) : '';
    },
    kindLabel,
    activeCanvasId,
  );

  const title =
    (material.cards.find((c) => (c.title || '').trim())?.title || '').trim() || fallbackTitle;
  const outline = outlineFromCardIds(title, finalIds);
  const articleId = `gen-${Date.now()}`;

  const willAssemble = Boolean(aiConfig && t);
  const draft = await draftArticleFromOutline({
    outline,
    cards: material.cards,
    mediaAssets: material.mediaAssets,
    activeCanvasId,
    articleId,
    relatedHeading,
    generating: willAssemble,
  });
  await db.articles.add(draft);

  const obstacles = await db.nodes
    .filter((n) => (n.canvasId ?? 'default') === activeCanvasId)
    .toArray();
  const { x, y } = findOpenCanvasPosition({
    transform: { x: 0, y: 0, scale: 1 },
    obstacles,
    size: ESSAY_NODE_SIZE,
    gap: 36,
    maxRings: 24,
  });
  const nodeId = await placeEssayNode({
    articleId,
    canvasId: activeCanvasId,
    x,
    y,
    title: draft.title,
    sourceNodeIds: (draft.sourceCards ?? []).map((card) => card.nodeId),
    collapseSources: true,
  });

  return { articleId, nodeId, willAssemble };
}
