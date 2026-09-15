/** OpenRouter sticky routing + prompt-cache helpers. */

export const OPENROUTER_SESSION_ID_MAX = 256;

export function isOpenRouterChatTarget(provider: string, urlOrBase?: string): boolean {
  if (provider === 'openrouter') return true;
  return /openrouter/i.test(urlOrBase ?? '');
}

/** Stable sticky key for one Ask thread / agent / canvas voice session. */
export function spoorLlmSessionId(...parts: Array<string | undefined | null>): string {
  const tokens = ['spoor', ...parts.map((p) => (p ?? '').trim()).filter(Boolean)].map((p) =>
    p.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 80),
  );
  const id = tokens.filter(Boolean).join('-');
  return (id || 'spoor').slice(0, OPENROUTER_SESSION_ID_MAX);
}

export function attachOpenRouterCacheFields(
  body: Record<string, unknown>,
  sessionId: string | undefined,
  opts?: { stream?: boolean },
): Record<string, unknown> {
  if (!sessionId) return body;
  const next: Record<string, unknown> = {
    ...body,
    session_id: sessionId,
    prompt_cache_key: sessionId,
  };
  if (opts?.stream) {
    next.stream_options = { include_usage: true };
  }
  return next;
}

export function openRouterSessionHeaders(sessionId?: string): Record<string, string> {
  if (!sessionId) return {};
  return { 'x-session-id': sessionId };
}

export type PromptCacheUsage = {
  prompt_tokens?: number;
  cached_tokens: number;
  cache_write_tokens?: number;
};

export function readPromptCacheUsage(data: unknown): PromptCacheUsage | null {
  if (!data || typeof data !== 'object') return null;
  const usage = (data as { usage?: unknown }).usage;
  if (!usage || typeof usage !== 'object') return null;
  const rec = usage as Record<string, unknown>;
  const details =
    rec.prompt_tokens_details && typeof rec.prompt_tokens_details === 'object'
      ? (rec.prompt_tokens_details as Record<string, unknown>)
      : {};
  const cached = Number(details.cached_tokens ?? rec.cached_tokens ?? 0);
  const write = Number(
    details.cache_write_tokens ?? rec.cache_write_tokens ?? rec.cache_creation_input_tokens ?? 0,
  );
  const prompt = Number(rec.prompt_tokens ?? 0);
  if (!Number.isFinite(cached) && !Number.isFinite(write)) return null;
  return {
    prompt_tokens: Number.isFinite(prompt) ? prompt : undefined,
    cached_tokens: Number.isFinite(cached) ? cached : 0,
    cache_write_tokens: Number.isFinite(write) ? write : undefined,
  };
}

export function logPromptCacheUsage(
  data: unknown,
  meta: { sessionId?: string; provider?: string; model?: string },
): void {
  const usage = readPromptCacheUsage(data);
  if (!usage) return;
  console.info('[Spoor] llm prompt-cache', { ...meta, ...usage });
}
