import { VOLC_ASR_FLASH_MAX_BYTES, VOLC_ASR_FLASH_PROXY_PATH } from '../constants/voiceWriting';
import { isServerManaged, getFunctionsBase, resolveAccessToken, edgeFunctionHeaders } from '../lib/serverConfig';
import { isTauriRuntime } from '../utils/isTauriRuntime';
import { inferVolcAudioFormat, uint8ToBase64 } from '../utils/volcAudioFileFormat';
import { parseVolcFlashTranscript } from '../utils/volcAsrFlashResult';
import { hasVolcAsrCredentials, type VolcAsrCredentials } from './volcAsr';

/**
 * File ASR via Volc **flash** HTTP (`/auc/bigmodel/recognize/flash`).
 * Live Ask / voice writing still uses streaming WebSocket — do not reuse that
 * path for pre-recorded cards (it expects realtime packets and times out).
 */
export async function transcribeAudioUrlWithVolcFlash(
  creds: VolcAsrCredentials,
  src: string,
  opts?: { signal?: AbortSignal; fetchImpl?: typeof fetch; mime?: string },
): Promise<string> {
  const url = src.trim();
  if (!url) throw new Error('Empty audio source');

  const f = opts?.fetchImpl ?? fetch;
  const res = await f(url, { signal: opts?.signal });
  if (!res.ok) throw new Error(`Failed to load audio (${res.status})`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length === 0) return '';
  if (buf.length > VOLC_ASR_FLASH_MAX_BYTES) {
    throw new Error(
      `音频文件过大（${Math.round(buf.length / (1024 * 1024))}MB）。录音文件识别建议不超过 ${Math.round(VOLC_ASR_FLASH_MAX_BYTES / (1024 * 1024))}MB。`,
    );
  }

  const mime = opts?.mime ?? res.headers.get('content-type') ?? undefined;
  const format = inferVolcAudioFormat(mime, buf, url);
  const data = uint8ToBase64(buf);

  const apiKey = (creds.apiKey ?? '').trim();
  const appId = (creds.appId ?? '').trim();
  const accessToken = (creds.accessToken ?? '').trim();
  const hasLocalVolc = !!apiKey || (!!appId && !!accessToken);

  let endpoint: string;
  let headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const body: Record<string, string> = { format, data };

  if (isServerManaged() && !hasLocalVolc) {
    const base = getFunctionsBase();
    const token = await resolveAccessToken();
    if (!base || !token) {
      throw new Error('服务器代理未配置 (VITE_SUPABASE_FUNCTIONS_URL 缺失或会话失效)。');
    }
    endpoint = `${base}/ai-volc-asr-flash`;
    headers = edgeFunctionHeaders(token, { 'Content-Type': 'application/json' });
  } else if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const port = await invoke<number | null>('voice_proxy_port');
    if (port == null) {
      throw new Error('Tauri 语音代理未启动 (Rust setup hook 还未绑定端口)。');
    }
    endpoint = `http://127.0.0.1:${port}/volc-asr/recognize-flash`;
    if (apiKey) body.apiKey = apiKey;
    if (appId) body.appId = appId;
    if (accessToken) body.accessToken = accessToken;
  } else {
    if (!hasVolcAsrCredentials(creds)) {
      throw new Error('missing_volc_asr_credentials');
    }
    endpoint = VOLC_ASR_FLASH_PROXY_PATH;
    if (apiKey) body.apiKey = apiKey;
    if (appId) body.appId = appId;
    if (accessToken) body.accessToken = accessToken;
  }

  let flashRes: Response;
  try {
    flashRes = await f(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: opts?.signal,
    });
  } catch (e) {
    throw new Error(`Volc ASR flash failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  const json: unknown = await flashRes.json().catch(() => null);
  if (!flashRes.ok) {
    const rec = json && typeof json === 'object' ? (json as { error?: unknown; message?: unknown }) : null;
    const err =
      (typeof rec?.message === 'string' && rec.message.trim()) ||
      (typeof rec?.error === 'string' && rec.error.trim()) ||
      `HTTP ${flashRes.status}`;
    throw new Error(err);
  }
  if (json && typeof json === 'object' && typeof (json as { text?: unknown }).text === 'string') {
    return ((json as { text: string }).text ?? '').trim();
  }
  return parseVolcFlashTranscript(json);
}
