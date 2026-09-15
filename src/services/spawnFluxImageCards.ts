import { db } from '../db';
import { stampNewCard } from '../utils/stampNewCard';
import { findAdjacentCanvasPosition, type CanvasObstacle } from '../utils/canvas';
import type { ImageOrientation } from '../utils/imageOrientation';
import {
  BOOK_EXPAND_CHILD_OFFSET_X,
  BOOK_EXPAND_CHILD_WIDTH,
  BOOK_EXPAND_HUB_HEIGHT,
} from './spawnBookExpandCards';

export const FLUX_IMAGE_CARD_WIDTH = 320;
export const FLUX_IMAGE_CARD_HEIGHT = 210;
export const FLUX_IMAGE_GAP_Y = 24;
/** Place Flux cards to the right of the book-expand branch lane. */
export const FLUX_IMAGE_OFFSET_FROM_HUB_X =
  BOOK_EXPAND_CHILD_OFFSET_X + BOOK_EXPAND_CHILD_WIDTH + 48;

export function fluxImageCardPos(
  hub: { x: number; y: number },
  index: number,
  count: number,
): { x: number; y: number } {
  const n = Math.max(1, count);
  const stackH = (n - 1) * (FLUX_IMAGE_CARD_HEIGHT + FLUX_IMAGE_GAP_Y) + FLUX_IMAGE_CARD_HEIGHT;
  const centerY = hub.y + BOOK_EXPAND_HUB_HEIGHT / 2;
  const firstY = centerY - stackH / 2;
  return {
    x: hub.x + FLUX_IMAGE_OFFSET_FROM_HUB_X,
    y: firstY + index * (FLUX_IMAGE_CARD_HEIGHT + FLUX_IMAGE_GAP_Y),
  };
}

/** Image card beside an AI / note anchor (voice writing dialogue mode). */
export function fluxImageBesideAnchorPos(
  anchor: { x: number; y: number; width?: number; height?: number },
  index: number,
  size: { width: number; height: number } = fluxImageCardSize('landscape'),
): { x: number; y: number } {
  const aw = anchor.width && anchor.width > 0 ? anchor.width : 320;
  return {
    x: anchor.x + aw + 48,
    y: anchor.y + index * (size.height + FLUX_IMAGE_GAP_Y),
  };
}

/** Canvas card frame matching the generated aspect preset. */
export function fluxImageCardSize(orientation: ImageOrientation): { width: number; height: number } {
  if (orientation === 'strip') {
    return { width: 96, height: 768 };
  }
  if (orientation === 'poster') {
    return { width: 180, height: 320 };
  }
  if (orientation === 'banner-mid') {
    return { width: 400, height: 100 };
  }
  if (orientation === 'banner') {
    return { width: 480, height: 60 };
  }
  if (orientation === 'portrait') {
    return { width: FLUX_IMAGE_CARD_HEIGHT, height: FLUX_IMAGE_CARD_WIDTH };
  }
  if (orientation === 'square') {
    return { width: 260, height: 260 };
  }
  return { width: FLUX_IMAGE_CARD_WIDTH, height: FLUX_IMAGE_CARD_HEIGHT };
}

/**
 * Pin a generated image next to the live anchor (right, then below) instead of
 * a hardcoded offset that can land far from 阿狸 when nearby slots are full.
 */
export function placeFluxImageBesideLiveAnchor(
  anchor: CanvasObstacle,
  obstacles: CanvasObstacle[],
  size: { width: number; height: number } = fluxImageCardSize('landscape'),
): { x: number; y: number } {
  return findAdjacentCanvasPosition({
    obstacles,
    anchor,
    size,
  });
}

export async function spawnFluxImageCard(options: {
  canvasId: string;
  imageUrl: string;
  description?: string;
  x: number;
  y: number;
  /** Optional edge from a hub / AI / branch card. */
  linkFromId?: string;
  /** Omit for a ready card; `generating` spawns the ghost placeholder. */
  imageStatus?: 'generating' | 'error';
  /** Original prompt, kept after success so later questions can see why it was drawn. */
  imagePrompt?: string;
  /** Visible prose from the source AI card at generation time (not hidden CoT). */
  imageSourceNote?: string;
  imageError?: string;
  width?: number;
  height?: number;
  contextScopeAgentId?: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  const width = options.width && options.width > 0 ? options.width : FLUX_IMAGE_CARD_WIDTH;
  const height = options.height && options.height > 0 ? options.height : FLUX_IMAGE_CARD_HEIGHT;
  // Node + edge together, so the live query never paints a card without its link.
  await db.transaction('rw', db.nodes, db.edges, async () => {
    await db.nodes.add(stampNewCard({
      id,
      canvasId: options.canvasId,
      type: 'image',
      content: options.imageUrl,
      description: options.description?.trim() || undefined,
      aiGenerated: true,
      x: options.x,
      y: options.y,
      width,
      height,
      ...(options.imageStatus ? { imageStatus: options.imageStatus } : {}),
      ...(options.imageStatus === 'generating' ? { imageStartedAt: Date.now() } : {}),
      ...(options.imagePrompt ? { imagePrompt: options.imagePrompt } : {}),
      ...(options.imageSourceNote ? { imageSourceNote: options.imageSourceNote } : {}),
      ...(options.imageError ? { imageError: options.imageError } : {}),
      ...(options.contextScopeAgentId ? { contextScopeAgentId: options.contextScopeAgentId } : {}),
    }));
    if (options.linkFromId) {
      await db.edges.add({
        id: crypto.randomUUID(),
        canvasId: options.canvasId,
        from: options.linkFromId,
        to: id,
      });
    }
  });
  return id;
}
