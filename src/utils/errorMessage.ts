/**
 * Safely extracts a human-readable error message from unknown error values.
 * Prevents plain objects (like Supabase PostgrestError or raw fetch errors)
 * from being converted into the infamous "[object Object]" string.
 */
export function extractErrorMessage(err: unknown, fallback = ''): string {
  if (err === null || err === undefined) {
    return fallback;
  }

  if (err instanceof Error) {
    const msg = err.message?.trim();
    return msg || fallback;
  }

  if (typeof err === 'string') {
    const trimmed = err.trim();
    if (!trimmed || trimmed === '[object Object]') {
      return fallback;
    }
    return trimmed;
  }

  if (typeof err === 'object') {
    const record = err as Record<string, unknown>;

    // Common error object message properties (PostgrestError, AuthError, OAuth, fetch responses)
    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message.trim();
    }
    if (typeof record.error_description === 'string' && record.error_description.trim()) {
      return record.error_description.trim();
    }
    if (typeof record.details === 'string' && record.details.trim()) {
      return record.details.trim();
    }
    if (typeof record.error === 'string' && record.error.trim()) {
      return record.error.trim();
    }
    if (
      record.error &&
      typeof record.error === 'object' &&
      typeof (record.error as Record<string, unknown>).message === 'string'
    ) {
      const nestedMsg = ((record.error as Record<string, unknown>).message as string).trim();
      if (nestedMsg) return nestedMsg;
    }

    try {
      const json = JSON.stringify(err);
      if (json && json !== '{}') {
        return json;
      }
    } catch {
      /* ignore circular reference / serialization errors */
    }
  }

  const str = String(err).trim();
  if (!str || str === '[object Object]') {
    return fallback;
  }
  return str;
}
