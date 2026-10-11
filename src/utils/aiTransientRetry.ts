/** HTTP statuses that are usually a blip (rate limit, gateway, overload). */
export const RETRYABLE_HTTP_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/** Two pauses → three attempts total. Vitest uses 0 so tests stay fast. */
export function defaultAiRetryDelaysMs(): number[] {
  if (typeof process !== 'undefined' && process.env?.VITEST) return [0, 0];
  return [400, 1200];
}

export class AiHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'AiHttpError';
    this.status = status;
  }
}

export function isAbortLike(err: unknown): boolean {
  if (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') {
    return true;
  }
  return err instanceof Error && (err.name === 'AbortError' || /aborted(?:\s+the\s+request)?/i.test(err.message));
}

/**
 * Retry only transient transport / overload failures.
 * Auth, missing keys, and user abort are not retried.
 */
export function isTransientAiError(err: unknown): boolean {
  if (isAbortLike(err)) return false;
  if (err instanceof AiHttpError) return RETRYABLE_HTTP_STATUS.has(err.status);

  const msg = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
  if (!msg.trim()) return false;

  if (
    /api key|unauthorized|forbidden|invalid.?key|missing for provider|未配置|不支持在请求中附带|provider not supported/.test(
      msg,
    )
  ) {
    return false;
  }

  return (
    /failed to fetch|networkerror|network error|load failed|err_network|err_internet|err_connection|econnreset|etimedout|econnrefused|socket|fetch failed|temporarily unavailable|overloaded|resource exhausted|deadline exceeded|unavailable|too many requests|网络失败|网络错误|status code 429|\b429\b|\b502\b|\b503\b|\b504\b|\b408\b/.test(
      msg,
    )
  );
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function withAiTransientRetry<T>(
  run: () => Promise<T>,
  options?: {
    delaysMs?: number[];
    label?: string;
    /**
     * 每次重试都报一声给调用方。
     *
     * "慢"有好几种：一次往返 28 秒，和三次各 9 秒、重试在救场——从外面看
     * 长得一模一样。调用方要能拿到次数和每次的原因，才不用去翻 Network 面板。
     */
    onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
  },
): Promise<T> {
  const delays = options?.delaysMs ?? defaultAiRetryDelaysMs();
  const maxAttempts = delays.length + 1;
  let last: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await run();
    } catch (e) {
      last = e;
      const canRetry = attempt < maxAttempts && isTransientAiError(e);
      if (!canRetry) throw e;
      const wait = delays[attempt - 1] ?? 0;
      const detail = e instanceof Error ? e.message : String(e);
      console.info(
        `[Scribe AI] retry ${attempt + 1}/${maxAttempts}${options?.label ? ` (${options.label})` : ''} after: ${detail}`,
      );
      options?.onRetry?.(attempt, e, wait);
      await sleep(wait);
    }
  }
  throw last;
}
