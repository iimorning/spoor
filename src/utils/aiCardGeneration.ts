import type { TFunction } from 'i18next';
import { db } from '../db';

/** Page reload / hung stream: show Retry instead of spinning forever. */
export const AI_CARD_STALE_MS = 180_000;

export const AI_CARD_ERROR = {
  empty: 'empty',
  stale: 'stale',
} as const;

export type AiCardErrorCode = (typeof AI_CARD_ERROR)[keyof typeof AI_CARD_ERROR];

export function isAiCardErrorCode(value: string | undefined): value is AiCardErrorCode {
  return value === AI_CARD_ERROR.empty || value === AI_CARD_ERROR.stale;
}

export function formatAiCardError(error: string | undefined, t: TFunction): string {
  if (error === AI_CARD_ERROR.empty) return t('nodes.ai_generation_empty');
  if (error === AI_CARD_ERROR.stale) return t('nodes.ai_generation_stale');
  return error?.trim() || t('nodes.ai_generation_failed_unknown');
}

export function aiGeneratingPatch(at = Date.now()): {
  aiStatus: 'generating';
  aiError: undefined;
  aiStartedAt: number;
} {
  return { aiStatus: 'generating', aiError: undefined, aiStartedAt: at };
}

export async function markAiCardFailed(nodeId: string, message: string): Promise<void> {
  await db.nodes.update(nodeId, {
    aiStatus: 'error',
    aiError: message,
    content: '',
  });
}

/**
 * End-of-stream safety net: success paths should clear `aiStatus`, and failures
 * should call `markAiCardFailed` — but if a card is still `generating` when
 * the UI unmounts the stream, settle it so the placeholder does not vanish.
 */
export async function settleAiCardGeneration(
  nodeId: string,
  errorMessage?: string,
): Promise<void> {
  const node = await db.nodes.get(nodeId);
  if (!node || node.type !== 'ai') return;
  if (node.aiStatus !== 'generating') return;
  if ((node.content ?? '').trim()) {
    await db.nodes.update(nodeId, { aiStatus: undefined, aiError: undefined });
    return;
  }
  await markAiCardFailed(nodeId, errorMessage ?? AI_CARD_ERROR.stale);
}

export function aiGenerationStartedAt(node: {
  aiStartedAt?: number;
  createdAt?: number;
}): number | undefined {
  return node.aiStartedAt ?? node.createdAt;
}

/** Convert abandoned `generating` AI placeholders into error cards with Retry. */
export async function recoverStaleGeneratingAiCards(now = Date.now()): Promise<number> {
  const stuck = await db.nodes
    .filter((n) => n.type === 'ai' && n.aiStatus === 'generating')
    .toArray();
  let marked = 0;
  for (const node of stuck) {
    const started = aiGenerationStartedAt(node);
    if (started != null && now - started < AI_CARD_STALE_MS) continue;
    await db.nodes.update(node.id, {
      aiStatus: 'error',
      aiError: AI_CARD_ERROR.stale,
    });
    marked += 1;
  }
  return marked;
}
