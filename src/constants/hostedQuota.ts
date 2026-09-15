/**
 * Hosted allowance. Keep in sync with `supabase/functions/_shared/hostedQuota.ts`.
 *
 * Free: lifetime bucket (does not reset). Voice: 30 minutes ASR; TTS 20,000 chars.
 * Pro: calendar-month text and image caps; voice stays uncapped.
 */
export const FREE_HOSTED_TEXT_TOKENS = 500_000;
export const FREE_HOSTED_IMAGES = 10;
export const FREE_HOSTED_ASR_SECONDS = 30 * 60;
export const FREE_HOSTED_TTS_CHARS = 20_000;

export const PRO_HOSTED_TEXT_TOKENS = 20_000_000;
export const PRO_HOSTED_IMAGES = 150;

export type UsageSnapshot = {
  text_tokens: number;
  image_count: number;
  asr_seconds: number;
  tts_chars: number;
};

export const EMPTY_USAGE: UsageSnapshot = {
  text_tokens: 0,
  image_count: 0,
  asr_seconds: 0,
  tts_chars: 0,
};

/** Free lifetime bucket in `hosted_usage.period_start`. */
export const HOSTED_USAGE_PERIOD_START = '1970-01-01';

/** UTC calendar month start as YYYY-MM-01. Keep in sync with the Edge helper. */
export function utcMonthStart(now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

export function hostedPeriodStart(isPro: boolean, now = new Date()): string {
  return isPro ? utcMonthStart(now) : HOSTED_USAGE_PERIOD_START;
}

export function hostedTextLimit(isPro: boolean): number {
  return isPro ? PRO_HOSTED_TEXT_TOKENS : FREE_HOSTED_TEXT_TOKENS;
}

export function hostedImageLimit(isPro: boolean): number {
  return isPro ? PRO_HOSTED_IMAGES : FREE_HOSTED_IMAGES;
}
