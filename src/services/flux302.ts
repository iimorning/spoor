import { isTauriRuntime } from '../utils/isTauriRuntime';
import { isServerManaged, getFunctionsBase, resolveAccessToken, edgeFunctionHeaders } from '../lib/serverConfig';
import i18n from '../i18n';
import { OPENROUTER_BASE_URL, OPENROUTER_GPT_IMAGE_MODEL } from '../constants/openrouter';
import { GPT_IMAGE_TIMEOUT_MS, IMAGE_GEN_ERROR, isImageSafetyRejection } from '../utils/imageGenerationWait';
import {
  geminiAspectRatioForOrientation,
  geminiResolutionForOrientation,
  gptImage302FallbackSize,
  orientationFromGptImageSize,
  type ImageOrientation,
} from '../utils/imageOrientation';

const LOG_PREFIX = '[Spoor] image';
/**
 * 302.AI China host — more reliable from CN than api.302.ai.
 * Vite/Netlify proxy `/api/302` rewrites to this origin.
 */
export const FLUX302_UPSTREAM = 'https://api.302ai.cn';
/** Docs: https://doc.302.ai/408538615e0 */
const CREATE_PATH = '/flux/v1/flux-2-klein-4b';
/** Docs: GET /flux/v1/get_result?id=… */
const RESULT_PATH = '/flux/v1/get_result';
/** Docs: https://doc.302.ai/288853804e0 */
const GPT_IMAGE_PATH = '/v1/images/generations';
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 90_000;

export type Flux302GenerateOptions = {
  apiKey: string;
  prompt: string;
  width?: number;
  height?: number;
  signal?: AbortSignal;
};

export type Flux302GenerateResult = {
  url: string;
  taskId: string;
};

type FluxResultBody = {
  id?: string;
  polling_url?: string;
  status?: string;
  result?: {
    sample?: string;
    prompt?: string;
    seed?: number;
  };
  sample?: string;
  detail?: unknown;
  error?: string;
  message?: string;
};

function resolveUrl(pathAndQuery: string): string {
  if (isTauriRuntime()) {
    return `${FLUX302_UPSTREAM}${pathAndQuery}`;
  }
  return `/api/302${pathAndQuery}`;
}

function authHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey.trim()}`,
    Accept: 'application/json',
  };
}

function promptLocaleHint(): string {
  if (typeof navigator === 'undefined') return 'en';
  return navigator.language || 'en';
}

function throwIfHostedImageDenied(
  res: Response,
  body: { error?: string; message?: string },
  label: string,
): void {
  if (res.ok) return;
  const detail = `${body.error ?? ''} ${body.message ?? ''}`;
  if (
    body.error === 'prompt_blocked' ||
    body.error === 'prompt_review' ||
    isImageSafetyRejection(detail)
  ) {
    throw new Error(IMAGE_GEN_ERROR.blocked);
  }
  if (res.status === 402 && body.error === 'quota_exceeded') {
    throw new Error(i18n.t('billing.err_quota_exceeded'));
  }
  throw new Error(`${label} failed (HTTP ${res.status}): ${body.message ?? body.error ?? 'no url'}`);
}

function extractSampleUrl(body: FluxResultBody): string | null {
  const fromResult = (body.result?.sample ?? '').trim();
  if (/^https?:\/\//i.test(fromResult)) return fromResult;
  const top = (body.sample ?? '').trim();
  if (/^https?:\/\//i.test(top)) return top;
  return null;
}

function isReady(body: FluxResultBody): boolean {
  if (extractSampleUrl(body)) return true;
  const s = (body.status ?? '').toLowerCase();
  return s === 'ready' || s === 'success' || s === 'succeeded' || s === 'completed';
}

function isFailed(body: FluxResultBody): boolean {
  const s = (body.status ?? '').toLowerCase();
  return s === 'failed' || s === 'error' || s === 'cancelled' || s === 'canceled';
}

function formatErrorBody(body: FluxResultBody, status: number): string {
  if (typeof body.error === 'string') return body.error;
  if (typeof body.message === 'string') return body.message;
  return JSON.stringify(body.detail ?? body) || `HTTP ${status}`;
}

async function queryFluxResult(
  apiKey: string,
  taskId: string,
  signal?: AbortSignal,
): Promise<FluxResultBody> {
  const q = new URLSearchParams({ id: taskId });
  const res = await fetch(resolveUrl(`${RESULT_PATH}?${q}`), {
    method: 'GET',
    headers: authHeaders(apiKey),
    signal,
  });
  const body = (await res.json().catch(() => ({}))) as FluxResultBody;
  if (!res.ok) {
    throw new Error(`302 Flux query failed (HTTP ${res.status}): ${formatErrorBody(body, res.status)}`);
  }
  return body;
}

/**
 * Generate an image via 302.AI Flux-2-Klein-4b.
 * Prefers `sync: true` (returns Ready + sample URL); falls back to get_result polling.
 *
 * Pricing (docs): first MP ~0.014 PTC, then ~0.001 PTC / MP.
 */
export async function generateFluxDevImage(
  options: Flux302GenerateOptions,
): Promise<Flux302GenerateResult> {
  const apiKey = options.apiKey.trim();
  const prompt = options.prompt.replace(/\s+/g, ' ').trim();
  // Server-managed users don't need a local apiKey — Edge Function reads it
  // from developer_secrets.
  if (!isServerManaged() && !apiKey) throw new Error('302.AI API key is empty');
  if (!prompt) throw new Error('Flux prompt is empty');

  const width = options.width ?? 1024;
  const height = options.height ?? 768;

  // ---- Server-managed Edge Function path (logged-in + useServerKeys) ----
  if (isServerManaged()) {
    const base = getFunctionsBase();
    const token = await resolveAccessToken();
    if (!base || !token) {
      throw new Error('服务器代理未配置 (VITE_SUPABASE_FUNCTIONS_URL 缺失或会话失效)。');
    }
    console.info(`${LOG_PREFIX} create (server-managed)`, { prompt: prompt.slice(0, 80), width, height });
    const res = await fetch(`${base}/ai-image`, {
      method: 'POST',
      headers: edgeFunctionHeaders(token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        provider: 'flux',
        prompt,
        locale: promptLocaleHint(),
        width,
        height,
        output_format: 'jpeg',
        safety_tolerance: 2,
        sync: true,
      }),
      signal: options.signal,
    });
    const body = (await res.json().catch(() => ({}))) as {
      url?: string;
      taskId?: string;
      error?: string;
      message?: string;
    };
    throwIfHostedImageDenied(res, body, '302 Flux (server)');
    if (!body.url) {
      throw new Error(`302 Flux (server) failed (HTTP ${res.status}): ${body.error ?? 'no url'}`);
    }
    return { url: body.url, taskId: body.taskId ?? 'sync' };
  }

  console.info(`${LOG_PREFIX} create`, { prompt: prompt.slice(0, 80), width, height });

  const res = await fetch(resolveUrl(CREATE_PATH), {
    method: 'POST',
    headers: {
      ...authHeaders(apiKey),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      width,
      height,
      output_format: 'jpeg',
      safety_tolerance: 2,
      // Sync returns { id, status: "Ready", result: { sample } } on 302ai.cn.
      sync: true,
    }),
    signal: options.signal,
  });

  const body = (await res.json().catch(() => ({}))) as FluxResultBody;
  if (!res.ok) {
    throw new Error(`302 Flux create failed (HTTP ${res.status}): ${formatErrorBody(body, res.status)}`);
  }

  const syncUrl = extractSampleUrl(body);
  const taskId = (body.id ?? '').trim() || 'sync';
  if (syncUrl && isReady(body)) {
    console.info(`${LOG_PREFIX} ready (sync)`, { taskId });
    return { url: syncUrl, taskId };
  }

  if (!taskId || taskId === 'sync') {
    throw new Error('302 Flux returned neither sample URL nor task id');
  }

  // Async fallback: poll /flux/v1/get_result
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (options.signal?.aborted) throw new Error('302 Flux aborted');
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    if (options.signal?.aborted) throw new Error('302 Flux aborted');

    const status = await queryFluxResult(apiKey, taskId, options.signal);
    const url = extractSampleUrl(status);
    if (url && isReady(status)) {
      console.info(`${LOG_PREFIX} ready (poll)`, { taskId });
      return { url, taskId };
    }
    if (isFailed(status)) {
      throw new Error(`302 Flux task failed (status=${status.status ?? 'unknown'})`);
    }
  }

  throw new Error('302 Flux timed out waiting for the image');
}

export function hasFlux302Credentials(
  apiKey: string | undefined | null,
  openrouterApiKey?: string | undefined | null,
): boolean {
  if (isServerManaged()) return true;
  return !!(apiKey ?? '').trim() || !!(openrouterApiKey ?? '').trim();
}

/** OpenRouter LLM key, only when chat is already on OpenRouter. */
export function openRouterImageApiKey(provider?: string, llmApiKey?: string): string {
  return provider === 'openrouter' ? (llmApiKey ?? '').trim() : '';
}

export function imageKeysFromAiConfig(ai: {
  provider?: string;
  apiKey?: string;
  api302Key?: string;
}): { apiKey: string; openrouterApiKey: string } {
  return {
    apiKey: (ai.api302Key ?? '').trim(),
    openrouterApiKey: openRouterImageApiKey(ai.provider, ai.apiKey),
  };
}

export type GptImage2GenerateOptions = {
  apiKey: string;
  /** When set, illustrations go to OpenRouter; otherwise 302.AI GPT-Image-2. */
  openrouterApiKey?: string;
  prompt: string;
  /** Legacy size token; prefer `orientation` for poster / strip / banner presets. */
  size?: string;
  orientation?: ImageOrientation;
  quality?: 'auto' | 'high' | 'medium' | 'low';
  /** Canvas stills for OpenRouter `input_references` (http or data URLs). Ignored on 302. */
  inputReferences?: string[];
  signal?: AbortSignal;
};

function resolveImageOrientation(options: GptImage2GenerateOptions): ImageOrientation {
  if (options.orientation) return options.orientation;
  return orientationFromGptImageSize(options.size) ?? 'landscape';
}

export type GptImage2GenerateResult = {
  url: string;
};

type GptImageResponseBody = {
  data?: Array<{ url?: string; b64_json?: string }>;
  error?: { message?: string };
  message?: string;
  detail?: unknown;
};

function formatGptImageError(body: GptImageResponseBody, status: number): string {
  if (typeof body.error?.message === 'string') return body.error.message;
  if (typeof body.message === 'string') return body.message;
  return JSON.stringify(body.detail ?? body) || `HTTP ${status}`;
}

function extractGptImageUrl(body: GptImageResponseBody): string | null {
  const first = body.data?.[0];
  if (!first) return null;
  const url = (first.url ?? '').trim();
  if (/^https?:\/\//i.test(url)) return url;
  const b64 = (first.b64_json ?? '').trim();
  if (b64) return `data:image/jpeg;base64,${b64}`;
  return null;
}

function gptImageAspectRatio(
  orientation: ImageOrientation,
): ReturnType<typeof geminiAspectRatioForOrientation> {
  return geminiAspectRatioForOrientation(orientation);
}

const MAX_INPUT_REFERENCES = 4;

function sanitizeInputReferenceUrls(urls: string[] | undefined): string[] {
  const out: string[] = [];
  for (const raw of urls ?? []) {
    const url = raw.trim();
    if (!url) continue;
    if (!/^https?:\/\//i.test(url) && !/^data:image\/[a-zA-Z0-9+.^-]+;base64,/i.test(url)) continue;
    out.push(url);
    if (out.length >= MAX_INPUT_REFERENCES) break;
  }
  return out;
}

function openRouterInputReferences(urls: string[]) {
  return urls.map((url) => ({ type: 'image_url' as const, image_url: { url } }));
}

function promptWithInputReferences(prompt: string, refs: string[]): string {
  if (refs.length === 0) return prompt;
  return `Match character identity, costume, line style, and palette from the reference image(s). ${prompt}`;
}

function resolveOpenRouterImagesUrl(): string {
  if (isTauriRuntime()) return `${OPENROUTER_BASE_URL}/images`;
  return '/api/openrouter/images';
}

function openRouterHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey.trim()}`,
    Accept: 'application/json',
    'HTTP-Referer': 'https://spoor.ink',
    'X-Title': 'Spoor',
  };
}

/** Abort a hung GPT-Image request so the canvas ghost cannot spin forever. */
async function fetchGptImage(
  input: string,
  init: RequestInit,
  outer?: AbortSignal,
): Promise<Response> {
  const timeoutCtrl = new AbortController();
  const timer = window.setTimeout(() => timeoutCtrl.abort(), GPT_IMAGE_TIMEOUT_MS);
  const onOuterAbort = () => timeoutCtrl.abort();
  if (outer) {
    if (outer.aborted) {
      window.clearTimeout(timer);
      throw new DOMException('Aborted', 'AbortError');
    }
    outer.addEventListener('abort', onOuterAbort);
  }
  try {
    return await fetch(input, { ...init, signal: timeoutCtrl.signal });
  } catch (err) {
    if (timeoutCtrl.signal.aborted && !outer?.aborted) {
      throw new Error(IMAGE_GEN_ERROR.timeout);
    }
    throw err;
  } finally {
    window.clearTimeout(timer);
    outer?.removeEventListener('abort', onOuterAbort);
  }
}

async function generateGptImage2Via302(
  options: GptImage2GenerateOptions,
  prompt: string,
  orientation: ImageOrientation,
): Promise<GptImage2GenerateResult> {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error('302.AI API key is empty');
  const size = gptImage302FallbackSize(orientation);
  console.info(`${LOG_PREFIX} gpt-image-2 create (302)`, {
    prompt: prompt.slice(0, 80),
    orientation,
    size,
  });

  const res = await fetchGptImage(
    resolveUrl(GPT_IMAGE_PATH),
    {
      method: 'POST',
      headers: {
        ...authHeaders(apiKey),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        model: 'gpt-image-2',
        size,
        n: 1,
        quality: options.quality ?? 'medium',
        output_format: 'jpeg',
      }),
    },
    options.signal,
  );

  const body = (await res.json().catch(() => ({}))) as GptImageResponseBody;
  if (!res.ok) {
    throw new Error(
      `302 GPT-Image failed (HTTP ${res.status}): ${formatGptImageError(body, res.status)}`,
    );
  }

  const url = extractGptImageUrl(body);
  if (!url) throw new Error('302 GPT-Image returned no image URL or data');
  console.info(`${LOG_PREFIX} gpt-image-2 ready (302)`);
  return { url };
}

async function generateGptImage2ViaOpenRouter(
  openrouterApiKey: string,
  options: GptImage2GenerateOptions,
  prompt: string,
  orientation: ImageOrientation,
): Promise<GptImage2GenerateResult> {
  const refs = sanitizeInputReferenceUrls(options.inputReferences);
  const finalPrompt = promptWithInputReferences(prompt, refs);
  const aspectRatio = gptImageAspectRatio(orientation);
  const resolution = geminiResolutionForOrientation(orientation);
  console.info(`${LOG_PREFIX} gemini-flash-image create (openrouter)`, {
    prompt: finalPrompt.slice(0, 80),
    references: refs.length,
    aspectRatio,
    resolution,
  });
  const res = await fetchGptImage(
    resolveOpenRouterImagesUrl(),
    {
      method: 'POST',
      headers: {
        ...openRouterHeaders(openrouterApiKey),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENROUTER_GPT_IMAGE_MODEL,
        prompt: finalPrompt,
        n: 1,
        resolution,
        aspect_ratio: aspectRatio,
        ...(refs.length > 0 ? { input_references: openRouterInputReferences(refs) } : {}),
      }),
    },
    options.signal,
  );

  const body = (await res.json().catch(() => ({}))) as GptImageResponseBody;
  if (!res.ok) {
    const detail = formatGptImageError(body, res.status);
    if (isImageSafetyRejection(detail)) throw new Error(IMAGE_GEN_ERROR.blocked);
    const tooLarge =
      refs.length > 0 && (res.status === 413 || /too large|payload|request entity/i.test(detail));
    if (tooLarge) {
      console.warn(`${LOG_PREFIX} input_references rejected; retrying without them`, {
        status: res.status,
      });
      return generateGptImage2ViaOpenRouter(
        openrouterApiKey,
        { ...options, inputReferences: [] },
        prompt,
        orientation,
      );
    }
    throw new Error(`OpenRouter GPT-Image failed (HTTP ${res.status}): ${detail}`);
  }

  const url = extractGptImageUrl(body);
  if (!url) throw new Error('OpenRouter GPT-Image returned no image URL or data');
  console.info(`${LOG_PREFIX} gemini-flash-image ready (openrouter)`);
  return { url };
}

/**
 * Generate via OpenRouter `google/gemini-3.1-flash-image` when an OpenRouter key is available;
 * otherwise 302.AI `/v1/images/generations` (`gpt-image-2`).
 */
export async function generateGptImage2(
  options: GptImage2GenerateOptions,
): Promise<GptImage2GenerateResult> {
  const apiKey = options.apiKey.trim();
  const openrouterApiKey = (options.openrouterApiKey ?? '').trim();
  const prompt = options.prompt.replace(/\s+/g, ' ').trim();
  if (!isServerManaged() && !apiKey && !openrouterApiKey) {
    throw new Error('No OpenRouter or 302.AI API key for image generation');
  }
  if (!prompt) throw new Error('Image prompt is empty');
  const orientation = resolveImageOrientation(options);

  if (isServerManaged()) {
    const base = getFunctionsBase();
    const token = await resolveAccessToken();
    if (!base || !token) {
      throw new Error('服务器代理未配置 (VITE_SUPABASE_FUNCTIONS_URL 缺失或会话失效)。');
    }
    console.info(`${LOG_PREFIX} gemini-flash-image create (server-managed → ai-image)`, {
      prompt: prompt.slice(0, 80),
      model: OPENROUTER_GPT_IMAGE_MODEL,
      references: sanitizeInputReferenceUrls(options.inputReferences).length,
      orientation,
      aspectRatio: gptImageAspectRatio(orientation),
      resolution: geminiResolutionForOrientation(orientation),
    });
    const refs = sanitizeInputReferenceUrls(options.inputReferences);
    const res = await fetchGptImage(
      `${base}/ai-image`,
      {
        method: 'POST',
        headers: edgeFunctionHeaders(token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          provider: 'gpt-image-2',
          prompt,
          locale: promptLocaleHint(),
          model: OPENROUTER_GPT_IMAGE_MODEL,
          orientation,
          aspect_ratio: gptImageAspectRatio(orientation),
          resolution: geminiResolutionForOrientation(orientation),
          size: gptImage302FallbackSize(orientation),
          n: 1,
          quality: options.quality ?? 'medium',
          output_format: 'jpeg',
          ...(refs.length > 0 ? { input_references: refs } : {}),
        }),
      },
      options.signal,
    );
    const body = (await res.json().catch(() => ({}))) as {
      url?: string;
      error?: string;
      message?: string;
      upstream?: string;
    };
    throwIfHostedImageDenied(res, body, 'GPT-Image (server)');
    if (!body.url) {
      throw new Error(`GPT-Image (server) failed (HTTP ${res.status}): ${body.error ?? 'no url'}`);
    }
    console.info(`${LOG_PREFIX} gpt-image-2 ready (server-managed)`, {
      upstream: body.upstream ?? 'unknown',
    });
    return { url: body.url };
  }

  if (openrouterApiKey) {
    return generateGptImage2ViaOpenRouter(openrouterApiKey, options, prompt, orientation);
  }
  return generateGptImage2Via302(options, prompt, orientation);
}
