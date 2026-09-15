/**
 * Forward a flash file-ASR JSON body to openspeech. Shared by the Vite proxy.
 */
import { randomUUID } from 'node:crypto';
import { parseVolcFlashTranscript, volcFlashStatusMessage } from '../src/utils/volcAsrFlashResult';

export const VOLC_FLASH_UPSTREAM =
  'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash';
export const VOLC_FLASH_RESOURCE_ID = 'volc.bigasr.auc_turbo';

export type VolcFlashCreds = { apiKey?: string; appId?: string; accessToken?: string };

export function volcFlashUpstreamHeaders(creds: VolcFlashCreds, requestId: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Api-Resource-Id': VOLC_FLASH_RESOURCE_ID,
    'X-Api-Request-Id': requestId,
    'X-Api-Sequence': '-1',
  };
  const apiKey = (creds.apiKey ?? '').trim();
  const appId = (creds.appId ?? '').trim();
  const accessToken = (creds.accessToken ?? '').trim();
  if (apiKey) headers['X-Api-Key'] = apiKey;
  else {
    headers['X-Api-App-Key'] = appId;
    headers['X-Api-Access-Key'] = accessToken;
  }
  return headers;
}

export function buildVolcFlashUpstreamBody(format: string, data: string): string {
  return JSON.stringify({
    user: { uid: 'spoor' },
    audio: { format, data },
    request: { model_name: 'bigmodel', enable_itn: true, enable_punc: true },
  });
}

export async function forwardVolcFlashRecognize(
  creds: VolcFlashCreds,
  format: string,
  data: string,
): Promise<{ ok: true; text: string } | { ok: false; status: number; error: string }> {
  const requestId = randomUUID();
  let res: Response;
  try {
    res = await fetch(VOLC_FLASH_UPSTREAM, {
      method: 'POST',
      headers: volcFlashUpstreamHeaders(creds, requestId),
      body: buildVolcFlashUpstreamBody(format, data),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (e) {
    return { ok: false, status: 502, error: `upstream_unreachable: ${e instanceof Error ? e.message : String(e)}` };
  }

  const json: unknown = await res.json().catch(() => null);
  const statusCode = res.headers.get('X-Api-Status-Code') ?? res.headers.get('x-api-status-code');
  const message = res.headers.get('X-Api-Message') ?? res.headers.get('x-api-message');
  const flashErr = volcFlashStatusMessage(statusCode, message, json);
  if (!res.ok || flashErr) {
    return {
      ok: false,
      status: res.ok ? 502 : res.status,
      error: flashErr ?? `Volc ASR flash HTTP ${res.status}`,
    };
  }
  const text = parseVolcFlashTranscript(json);
  return { ok: true, text };
}
