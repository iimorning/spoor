import type { TFunction } from 'i18next';

/** GPT-Image-2 can take a minute; after this we abort and ask the user to retry. */
export const GPT_IMAGE_TIMEOUT_MS = 120_000;
/** Show a slow-network hint and Retry while the spinner is still up. */
export const IMAGE_GEN_SLOW_MS = 30_000;

/** Stable codes stored on `imageError` so the card can i18n them. */
export const IMAGE_GEN_ERROR = {
  timeout: 'timeout',
  stale: 'stale',
  blocked: 'blocked',
} as const;

export type ImageGenErrorCode = (typeof IMAGE_GEN_ERROR)[keyof typeof IMAGE_GEN_ERROR];

/** OpenAI / Gemini / OpenRouter image-safety refusals (not Spoor's own scan). */
export function isImageSafetyRejection(message: string): boolean {
  return /rejected by the safety system|safety system|content.?policy|content filter|blocked this request|gemini blocked/i.test(
    message,
  );
}

export function isImageGenErrorCode(value: string | undefined): value is ImageGenErrorCode {
  return (
    value === IMAGE_GEN_ERROR.timeout ||
    value === IMAGE_GEN_ERROR.stale ||
    value === IMAGE_GEN_ERROR.blocked
  );
}

export function isImageGenerationTimeoutError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'TimeoutError') return true;
  if (!(err instanceof Error)) return false;
  return err.name === 'TimeoutError' || err.message === IMAGE_GEN_ERROR.timeout;
}

export function formatImageGenerationError(
  error: string | undefined,
  t: TFunction,
): string {
  if (error === IMAGE_GEN_ERROR.timeout) return t('nodes.image_generation_timeout');
  if (error === IMAGE_GEN_ERROR.stale) return t('nodes.image_generation_stale');
  if (error === IMAGE_GEN_ERROR.blocked) return t('nodes.image_generation_blocked');
  return error?.trim() || t('nodes.image_generation_failed_unknown');
}

export function formatImageWaited(ms: number, t: TFunction): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return t('nodes.image_generating_waited', { seconds });
}

export function imageGenerationStartedAt(node: {
  imageStartedAt?: number;
  createdAt?: number;
}): number | undefined {
  return node.imageStartedAt ?? node.createdAt;
}
