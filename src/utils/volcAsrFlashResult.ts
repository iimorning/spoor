/** Pull the transcript out of a Volc flash `/recognize/flash` JSON body. */
export function parseVolcFlashTranscript(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const result = (body as { result?: unknown }).result;
  if (!result || typeof result !== 'object') return '';
  const rec = result as { text?: unknown; utterances?: unknown };
  if (typeof rec.text === 'string' && rec.text.trim()) return rec.text.trim();
  if (!Array.isArray(rec.utterances)) return '';
  const parts: string[] = [];
  for (const u of rec.utterances) {
    if (!u || typeof u !== 'object') continue;
    const t = (u as { text?: unknown }).text;
    if (typeof t === 'string' && t.trim()) parts.push(t.trim());
  }
  return parts.join('');
}

export function volcFlashStatusMessage(
  statusCode: string | null,
  message: string | null,
  body: unknown,
): string | null {
  const code = (statusCode ?? '').trim();
  if (code && code !== '20000000' && code !== '0' && code !== '200') {
    const fromBody = flashErrorFromBody(body);
    return `Volc ASR flash error ${code}${message ? `: ${message}` : fromBody ? `: ${fromBody}` : ''}`;
  }
  const fromBody = flashErrorFromBody(body);
  if (fromBody) return fromBody;
  return null;
}

function flashErrorFromBody(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const rec = body as { message?: unknown; error?: unknown; msg?: unknown };
  if (typeof rec.message === 'string' && rec.message.trim()) return rec.message.trim();
  if (typeof rec.msg === 'string' && rec.msg.trim()) return rec.msg.trim();
  if (typeof rec.error === 'string' && rec.error.trim()) return rec.error.trim();
  return null;
}
