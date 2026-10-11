import { GoogleGenAI } from '@google/genai';
import { MIMO_TOKEN_PLAN_BASE_URL, resolveMimoApiKey } from '../constants/mimo';
import {
  DOUBAO_ARK_BASE_URL,
  formatDoubaoKeyMissingError,
  resolveDoubaoApiKey,
  resolveDoubaoChatModel,
} from '../constants/doubao';
import { DEEPSEEK_BASE_URL, DEEPSEEK_DEFAULT_MODEL } from '../constants/deepseek';
import { MINIMAX_BASE_URL, MINIMAX_DEFAULT_MODEL } from '../constants/minimax';
import {
  OPENROUTER_DEFAULT_VISION_MODEL,
  isOpenRouterEndpoint,
  reasoningRequestField,
  resolveReasoningMode,
} from '../constants/openrouter';
import { resolveChatModelForImages, shouldRouteDeepSeekImagesToVisionModel } from '../utils/aiVisionConfig';
import { isServerManaged, getFunctionsBase, resolveAccessToken, edgeFunctionHeaders } from '../lib/serverConfig';
import i18n from '../i18n';
import { AiHttpError, withAiTransientRetry } from '../utils/aiTransientRetry';
import {
  applyHostedSsePayload,
  applyLlmStreamDelta,
  createLlmStreamAcc,
  wrapMessageReasoning,
} from '../utils/llmReasoningStream';
import {
  attachOpenRouterCacheFields,
  isOpenRouterChatTarget,
  logPromptCacheUsage,
  openRouterSessionHeaders,
} from '../utils/openRouterPromptCache';


const LOG_PREFIX = '[Scribe AI]';

/** For logs only — never log full API keys. */
export function maskApiKeyForLog(key: string | undefined): string {
  if (!key?.trim()) return '(empty)';
  const k = key.trim();
  if (k.length <= 12) return `${k.slice(0, 3)}…`;
  return `${k.slice(0, 6)}…${k.slice(-4)}`;
}

export function formatAiError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' &&
    Object.prototype.hasOwnProperty.call(window, '__TAURI_INTERNALS__');
}

function parseOpenAiStyleErrorBody(raw: string, status: number): string {
  if (!raw.trim()) return `HTTP ${status} (empty body)`;
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const errObj = j.error as Record<string, unknown> | string | undefined;
    if (typeof errObj === 'string') return errObj;
    if (errObj && typeof errObj === 'object') {
      const m = errObj.message;
      if (typeof m === 'string') return m;
    }
    const direct =
      (typeof j.message === 'string' && j.message) ||
      (typeof j.msg === 'string' && j.msg) ||
      (typeof j.detail === 'string' && j.detail);
    if (direct) return direct;
  } catch {
    /* not JSON */
  }
  return raw.length > 800 ? `${raw.slice(0, 800)}…` : raw;
}

function extractChatCompletionContent(data: unknown): string {
  const d = data as {
    choices?: Array<{
      message?: {
        content?: unknown;
        reasoning_content?: unknown;
        reasoning?: unknown;
        reasoning_text?: unknown;
      };
    }>;
  };
  const message = d?.choices?.[0]?.message;
  const content = message?.content;
  const reasoning =
    (typeof message?.reasoning_content === 'string' && message.reasoning_content) ||
    (typeof message?.reasoning === 'string' && message.reasoning) ||
    (typeof message?.reasoning_text === 'string' && message.reasoning_text) ||
    '';
  let text = '';
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    const texts = content
      .map((c) => {
        if (typeof c === 'object' && c !== null && 'text' in c) {
          const t = (c as { text?: unknown }).text;
          return typeof t === 'string' ? t : '';
        }
        return '';
      })
      .filter(Boolean);
    text = texts.join('');
  } else if (content != null && content !== '') {
    text = String(content);
  }
  const wrapped = wrapMessageReasoning(text, reasoning);
  if (!wrapped) {
    console.error(`${LOG_PREFIX} unexpected response (no choices[0].message.content)`, data);
    throw new Error('API returned no text content. Open DevTools → Console for the full response.');
  }
  return wrapped;
}

/** Parse `data:image/...;base64,...` for multimodal APIs. */
export function parseImageDataUrl(dataUrl: string): { mediaType: string; base64: string } | null {
  const trimmed = dataUrl.trim();
  const m = /^data:(image\/[a-zA-Z0-9+.^-]+);base64,(.+)$/s.exec(trimmed);
  if (!m) return null;
  return { mediaType: m[1], base64: m[2] };
}

function buildOpenAiUserContent(
  prompt: string,
  images: string[] | undefined,
): string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> {
  if (!images?.length) return prompt;
  const content: Array<
    { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
  > = [{ type: 'text', text: prompt }];
  for (const url of images) {
    const href = url.trim();
    if (parseImageDataUrl(href) || /^https?:\/\//i.test(href)) {
      content.push({ type: 'image_url', image_url: { url: href } });
    }
  }
  return content;
}

type AnthropicUserBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

function buildAnthropicUserContent(
  prompt: string,
  images: string[] | undefined,
): string | AnthropicUserBlock[] {
  if (!images?.length) return prompt;
  const blocks: AnthropicUserBlock[] = [{ type: 'text', text: prompt }];
  for (const url of images) {
    const p = parseImageDataUrl(url);
    if (p) {
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: p.mediaType, data: p.base64 },
      });
    }
  }
  return blocks;
}

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

function buildGeminiUserPayload(
  prompt: string,
  images: string[] | undefined,
): string | GeminiPart[] {
  if (!images?.length) return prompt;
  const parts: GeminiPart[] = [{ text: prompt }];
  for (const url of images) {
    const p = parseImageDataUrl(url);
    if (p) parts.push({ inlineData: { mimeType: p.mediaType, data: p.base64 } });
  }
  return parts;
}

function withOpenRouterCacheBody(
  url: string,
  provider: string,
  body: Record<string, unknown>,
  sessionId: string | undefined,
  stream: boolean,
): Record<string, unknown> {
  if (!isOpenRouterChatTarget(provider, url)) return body;
  return attachOpenRouterCacheFields(body, sessionId, { stream });
}

function openAiCompatibleHeaders(
  apiKey: string,
  url: string,
  provider: string,
  sessionId?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
  if (isOpenRouterChatTarget(provider, url)) {
    headers['HTTP-Referer'] = 'https://spoor.ink';
    headers['X-Title'] = 'Spoor';
    Object.assign(headers, openRouterSessionHeaders(sessionId));
  }
  return headers;
}

async function postOpenAiCompatibleChat(
  apiKey: string,
  url: string,
  body: Record<string, unknown>,
  meta: { provider: string; model: string; sessionId?: string }
): Promise<string> {
  const key = apiKey.trim();
  if (!key) {
    throw new Error('API Key 为空（或只有空格）。请在设置中粘贴 MiMo 的密钥（通常以 tp- 开头）。');
  }
  console.info(`${LOG_PREFIX} chat/completions request`, {
    provider: meta.provider,
    model: meta.model,
    url,
    runtime: isTauriRuntime() ? 'tauri' : 'web',
    apiKey: maskApiKeyForLog(key),
  });

  return withAiTransientRetry(async () => {
    if (isTauriRuntime()) {
      const { invoke } = await import('@tauri-apps/api/core');
      try {
        const payload = withOpenRouterCacheBody(url, meta.provider, body, meta.sessionId, false);
        const text = await invoke<string>('openai_compatible_chat', { apiKey: key, url, body: payload });
        return text;
      } catch (e) {
        const msg = formatAiError(e);
        console.error(`${LOG_PREFIX} Tauri invoke openai_compatible_chat failed`, msg);
        throw new Error(msg);
      }
    }

    let response: Response;
    try {
      const payload = withOpenRouterCacheBody(url, meta.provider, body, meta.sessionId, false);
      response = await fetch(url, {
        method: 'POST',
        headers: openAiCompatibleHeaders(key, url, meta.provider, meta.sessionId),
        body: JSON.stringify(payload)
      });
    } catch (e) {
      console.error(`${LOG_PREFIX} network/fetch failed`, { url, error: formatAiError(e) });
      throw new Error(`Network error: ${formatAiError(e)}. If this is MiMo / Doubao / MiniMax in the browser, ensure Vite dev server is running (proxy /api/mimo, /api/doubao, /api/minimax) or use the desktop app.`);
    }

    const rawText = await response.text();
    if (!response.ok) {
      const msg = parseOpenAiStyleErrorBody(rawText, response.status);
      console.error(`${LOG_PREFIX} chat/completions HTTP error`, {
        status: response.status,
        url,
        bodyPreview: rawText.slice(0, 2000),
      });
      throw new AiHttpError(response.status, msg);
    }

    let data: unknown;
    try {
      data = JSON.parse(rawText);
    } catch {
      console.error(`${LOG_PREFIX} invalid JSON response`, rawText.slice(0, 2000));
      throw new Error('API returned non-JSON response. See console for preview.');
    }
    logPromptCacheUsage(data, meta);
    return extractChatCompletionContent(data);
  }, { label: `${meta.provider} chat` });
}

/** Accumulate OpenAI-style SSE (`data: {...}\\n`) deltas from a fetch Response body. */
async function consumeOpenAiSseFromResponse(
  response: Response,
  onAccumulated: (full: string) => void,
  cacheMeta?: { provider: string; model: string; sessionId?: string },
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    const rawText = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error('API returned non-JSON response.');
    }
    const content = extractChatCompletionContent(data);
    onAccumulated(content);
    return content;
  }

  const decoder = new TextDecoder();
  let carry = '';
  // 有些 OpenAI 兼容端点无视 stream:true，回一整包 JSON。这种响应里一行
  // `data:` 都没有，上面的循环等于白读，最后只能报"空响应"——划词改流式之前
  // 翻译不走这条路径，是能拿到结果的。所以整包留一份，只在兜底里用一次。
  let rawAll = '';
  const acc = createLlmStreamAcc();
  let transcript = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const decoded = decoder.decode(value, { stream: true });
    rawAll += decoded;
    carry += decoded;
    const lines = carry.split(/\r?\n/);
    carry = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.replace(/\r$/, '').trim();
      if (!trimmed.startsWith('data:')) continue;
      const dataLine = trimmed.slice(5).trimStart();
      if (dataLine === '[DONE]') continue;
      try {
        const json = JSON.parse(dataLine) as {
          choices?: Array<{ delta?: unknown }>;
          usage?: unknown;
        };
        if (json.usage) {
          logPromptCacheUsage({ usage: json.usage }, cacheMeta ?? {});
        }
        const next = applyLlmStreamDelta(acc, json?.choices?.[0]?.delta);
        if (next !== transcript) {
          transcript = next;
          onAccumulated(transcript);
        }
      } catch {
        /* ignore malformed chunk */
      }
    }
  }
  // 一帧都没解析出来：多半是端点回了整包 JSON 而不是 SSE。用它兜一次底，
  // 免得"改流式"把本来好用的直连端点变成一次都翻译不出来。
  if (!transcript && rawAll.trim()) {
    try {
      const content = extractChatCompletionContent(JSON.parse(rawAll));
      if (content) {
        transcript = content;
        onAccumulated(content);
      }
    } catch {
      /* 确实不是 JSON：交给调用方的"空响应"错误，别在这里编内容 */
    }
  }
  return transcript;
}

async function postOpenAiCompatibleChatWithOptionalStream(
  apiKey: string,
  url: string,
  body: Record<string, unknown>,
  meta: { provider: string; model: string; sessionId?: string },
  onStreamChunk?: (accumulated: string) => void,
): Promise<string> {
  if (!onStreamChunk) {
    return postOpenAiCompatibleChat(apiKey, url, body, meta);
  }

  const streamBody = withOpenRouterCacheBody(
    url,
    meta.provider,
    { ...body, stream: true },
    meta.sessionId,
    true,
  );

  const key = apiKey.trim();
  if (!key) {
    throw new Error('API Key 为空（或只有空格）。请在设置中粘贴 MiMo 的密钥（通常以 tp- 开头）。');
  }

  return withAiTransientRetry(async () => {
    if (isTauriRuntime()) {
      const { invoke } = await import('@tauri-apps/api/core');
      const { listen } = await import('@tauri-apps/api/event');
      const streamId = crypto.randomUUID();
      const unlisten = await listen<{ id: string; text: string }>('lab-ai-stream', (event) => {
        if (event.payload.id !== streamId) return;
        onStreamChunk(event.payload.text);
      });
      try {
        return await invoke<string>('openai_compatible_chat_stream', {
          apiKey: key,
          url,
          body: streamBody,
          streamId,
        });
      } finally {
        unlisten();
      }
    }

    console.info(`${LOG_PREFIX} chat/completions stream`, {
      provider: meta.provider,
      model: meta.model,
      url,
      runtime: 'web',
      apiKey: maskApiKeyForLog(key),
    });

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: openAiCompatibleHeaders(key, url, meta.provider, meta.sessionId),
        body: JSON.stringify(streamBody),
      });
    } catch (e) {
      console.error(`${LOG_PREFIX} stream network/fetch failed`, { url, error: formatAiError(e) });
      throw new Error(`Network error: ${formatAiError(e)}. If this is MiMo / Doubao / MiniMax in the browser, ensure Vite dev server is running (proxy /api/mimo, /api/doubao, /api/minimax) or use the desktop app.`);
    }

    if (!response.ok) {
      const errBody = await response.text();
      throw new AiHttpError(response.status, parseOpenAiStyleErrorBody(errBody, response.status));
    }

    const full = await consumeOpenAiSseFromResponse(response, onStreamChunk, meta);
    if (!full.trim()) {
      throw new Error('API returned an empty streamed response.');
    }
    return full;
  }, { label: `${meta.provider} stream` });
}

export type CallAIFn = (params: {
  config: AiProviderConfig;
  prompt: string;
  systemInstruction?: string;
  temperature?: number;
  topP?: number;
  /** `data:image/*;base64,...` URLs from canvas image nodes */
  images?: string[];
  onStreamChunk?: (accumulatedText: string) => void;
  /** Skip hosted primary/vision remapping; send `config.model` as-is. */
  lockModel?: boolean;
  /** Sticky routing key for OpenRouter prompt cache (same Ask/agent/canvas thread). */
  sessionId?: string;
  /**
   * 上游瞬时失败、正在重试时叫一声。
   *
   * 拿来分开两种"慢"：一次往返很久，和三次重试在救场。从外面看是同一件事，
   * 只有次数和每次的原因能分辨——不然就只能去翻 Network 面板。
   */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}) => Promise<string>;

export type AiProviderConfig = {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  localGgufPath?: string;
  localEnableThinking?: boolean;
  /** 深度思考（仅 OpenRouter 生效）：见 constants/openrouter.ts 的 ReasoningMode。 */
  reasoningMode?: string;
};

export type ChatMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | { role: 'system' | 'user' | 'assistant'; content: unknown[] };

/**
 * If `messages` is provided, attach `images` (data URLs) to the last user
 * message by converting its `content` from a string into a multimodal
 * content-parts array. Returns the messages unchanged when no images or no
 * suitable user message exists.
 */
function attachImagesToLastUser(
  messages: ChatMessage[],
  images: string[] | undefined,
): ChatMessage[] {
  if (!images || images.length === 0) return messages;
  const lastUserIdx = messages.map((m) => m.role).lastIndexOf('user');
  if (lastUserIdx < 0) return messages;
  const last = messages[lastUserIdx]!;
  // If the caller already built a multimodal user message, don't double-attach.
  if (Array.isArray(last.content)) return messages;
  // buildOpenAiUserContent returns string | Array<{...specific OpenAI parts...}>.
  // Widen to ChatMessage['content'] (string | unknown[]) so the resulting
  // object satisfies the second branch of the ChatMessage union.
  const nextContent = buildOpenAiUserContent(last.content, images) as string | unknown[];
  // The spread preserves ChatMessage's discriminated role, but TS still sees
  // the result as {role: 'user'|'system'|'assistant', content: string|unknown[]}
  // because of the widened content. Cast at the array boundary to ChatMessage[].
  return [
    ...messages.slice(0, lastUserIdx),
    { ...last, content: nextContent },
    ...messages.slice(lastUserIdx + 1),
  ] as ChatMessage[];
}

export async function callUniversalAI({
  config,
  prompt,
  messages,
  systemInstruction,
  temperature = 0.7,
  topP = 0.4,
  images,
  onStreamChunk,
  lockModel = false,
  sessionId,
  onRetry,
}: {
  config: AiProviderConfig;
  /** Legacy single-turn user message. Ignored if `messages` is provided. */
  prompt?: string;
  /**
   * Full chat history for multi-turn calls. Use `{ role, content }` per
   * OpenAI / Anthropic / Gemini shape. When provided, the caller is
   * responsible for including any system prompt at index 0; `systemInstruction`
   * here is prepended only if the array doesn't already start with one.
   */
  messages?: ChatMessage[];
  /** System message. Prepended to `messages` if no system role is already first. */
  systemInstruction?: string;
  temperature?: number;
  topP?: number;
  /** Images for the most recent user turn. Attached to the last user message. */
  images?: string[];
  onStreamChunk?: (accumulatedText: string) => void;
  lockModel?: boolean;
  sessionId?: string;
  /** 上游瞬时失败、正在重试时叫一声：一次往返很久 vs 三次重试在救场，从外面看是同一件事。 */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}): Promise<string> {
  const apiKeyTrimmed = (config.apiKey ?? '').trim();
  const useUserConfig = Boolean(apiKeyTrimmed);
  const mimoApiKey =
    config.provider === 'mimo' ? resolveMimoApiKey(apiKeyTrimmed) : '';
  const doubaoApiKey =
    config.provider === 'doubao' ? resolveDoubaoApiKey(apiKeyTrimmed) : '';

  if (config.provider === 'local_llama') {
    if (images?.length) {
      throw new Error(
        '本地 GGUF（llama.cpp）当前不支持在请求中附带图片。请改用在线多模态模型，或暂时移除与便签/Agent 相连的图片来源后再试。',
      );
    }
    if (!isTauriRuntime()) {
      throw new Error('本地 GGUF（内置 llama.cpp）仅在使用 Tauri 桌面版时可用，网页版请改用在线模型。');
    }
    const modelPath = (config.localGgufPath ?? '').trim();
    if (!modelPath) {
      throw new Error('请在设置中填写本地 GGUF 模型文件的完整路径。');
    }
    const { invoke } = await import('@tauri-apps/api/core');

    let logPath: string | null = null;
    try {
      logPath = await invoke<string>('get_local_llama_log_path');
    } catch {
      // 忽略：旧版本没有这个命令
    }

    const startedAt = Date.now();
    // llama.cpp is single-turn inference; flatten the messages array to the
    // last user turn (older turns are summarised by `systemInstruction` in
    // practice — not exposed via this provider for now).
    const lastUserContent = (() => {
      if (messages && messages.length > 0) {
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = messages[i]!;
          if (m.role === 'user') {
            return typeof m.content === 'string' ? m.content : '';
          }
        }
      }
      return prompt ?? '';
    })();
    console.info(`${LOG_PREFIX} local_llama → invoke`, {
      modelPath: modelPath.slice(0, 80) + (modelPath.length > 80 ? '…' : ''),
      promptChars: lastUserContent.length,
      systemChars: (systemInstruction ?? '').length,
      temperature,
      topP,
      maxTokens: 256,
      nCtx: 1024,
      logPath,
    });

    try {
      const out = await invoke<string>('local_llama_chat', {
        payload: {
          modelPath,
          systemInstruction: systemInstruction ?? null,
          userMessage: lastUserContent,
          temperature,
          topP,
          maxTokens: 256,
          nCtx: 1024,
          enableThinking: config.localEnableThinking ?? false,
        },
      });
      console.info(`${LOG_PREFIX} local_llama ← done`, {
        elapsedMs: Date.now() - startedAt,
        outChars: (out ?? '').length,
      });
      const text = out ?? '';
      onStreamChunk?.(text);
      return text;
    } catch (e) {
      const elapsedMs = Date.now() - startedAt;
      const msg = formatAiError(e);
      console.error(`${LOG_PREFIX} local_llama ← FAILED (${elapsedMs}ms)`, msg, { logPath });
      const suffix = logPath ? `\n\n详细日志：${logPath}` : '';
      throw new Error(`${msg}${suffix}`);
    }
  }

  // ─── Server-managed path ──────────────────────────────────────────────────
  // Logged-in users with useServerKeys go through the developer's Supabase Edge
  // Function (`ai-llm`), which reads `developer_secrets` server-side and
  // forwards to upstream. The browser never sees the key. local_llama stays
  // out of this path because it's a Tauri-only local model.
  if (
    isServerManaged() &&
    config.provider !== 'local_llama'
  ) {
    const base = getFunctionsBase();
    const token = await resolveAccessToken();
    if (!base || !token) {
      throw new Error(
        '服务器代理未配置 (VITE_SUPABASE_FUNCTIONS_URL 缺失或未登录)。',
      );
    }
    const wantStream = Boolean(onStreamChunk);
    const url = `${base}/ai-llm`;
    const hasImages = Boolean(images?.length);
    const requestedModel =
      config.provider === 'doubao'
        ? resolveDoubaoChatModel(config.model)
        : config.model || undefined;
    const useVisionModelForImages =
      hasImages &&
      !lockModel &&
      shouldRouteDeepSeekImagesToVisionModel(config.provider, requestedModel ?? '');
    const hostedModel = useVisionModelForImages
      ? OPENROUTER_DEFAULT_VISION_MODEL
      : requestedModel
        ? (hasImages && !lockModel
          ? resolveChatModelForImages(config.provider, requestedModel)
          : requestedModel)
        : undefined;
    const hostedLockModel = lockModel || useVisionModelForImages;
    const hostedReasoning = reasoningRequestField(
      resolveReasoningMode(config.reasoningMode),
    );
    return withAiTransientRetry(async () => {
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: edgeFunctionHeaders(token, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            provider: config.provider,
            model: hostedModel,
            baseUrl: config.baseUrl || undefined,
            // 托管时由 Edge Function 转发；用户选"默认"时不带这个键（函数保持它原来的行为）。
            ...(hostedReasoning ? { reasoning: hostedReasoning } : {}),
            systemInstruction: systemInstruction || undefined,
            // When the caller built a multi-turn history, forward it as-is. The
            // Edge Function (`ai-llm`) already accepts `messages?: ChatMessage[]`
            // and merges with `systemInstruction` server-side, same precedence
            // rules as the OpenAI-compatible branch.
            ...(messages && messages.length > 0 ? { messages } : { prompt: prompt ?? '' }),
            ...(images && images.length > 0 ? { images } : {}),
            temperature,
            topP,
            stream: wantStream,
            ...(hostedLockModel ? { lockModel: true } : {}),
            ...(sessionId ? { sessionId } : {}),
          }),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`${LOG_PREFIX} ai-llm network error`, msg);
        throw new Error(
          `服务器代理网络失败 (${msg})。请确认已配置 VITE_SUPABASE_ANON_KEY，且 ai-llm Edge Function 已部署；本地开发时 F12 若见 CORS，通常是网关拒绝了缺少 apikey 的请求。`,
        );
      }
      if (!res.ok) {
        const errText = await res.text();
        console.error(`${LOG_PREFIX} ai-llm HTTP error`, res.status, errText.slice(0, 1000));
        let parsedMessage: string | null = null;
        try {
          const parsed = JSON.parse(errText) as {
            error?: string;
            kind?: string;
            message?: string;
            body?: string;
          };
          if (parsed && typeof parsed.error === 'string') parsedMessage = parsed.error;
          if (typeof parsed.body === 'string' && parsed.body.trim()) {
            const nested = parseOpenAiStyleErrorBody(parsed.body, res.status);
            if (nested && nested !== parsed.body) parsedMessage = nested;
          }
          if (parsed?.error === 'images_not_supported') {
            throw new AiHttpError(
              400,
              typeof parsed.message === 'string' && parsed.message
                ? parsed.message
                : '当前托管服务商不支持在对话中附带图片。',
            );
          }
          if (parsed?.error === 'quota_exceeded') {
            throw new AiHttpError(402, i18n.t('billing.err_quota_exceeded'));
          }
        } catch (e) {
          if (e instanceof AiHttpError) throw e;
          /* not JSON */
        }
        const privacyHint =
          parsedMessage &&
          /data policy|openrouter\.ai\/settings\/privacy/i.test(parsedMessage)
            ? ' OpenRouter 当前账号的隐私/数据策略过滤掉了该模型的全部端点，到 https://openrouter.ai/settings/privacy 放宽限制，或换一个托管模型。'
            : '';
        throw new AiHttpError(
          res.status,
          `服务器代理调用失败 (${res.status}${parsedMessage ? `: ${parsedMessage}` : ''})${privacyHint}`,
        );
      }
      if (!wantStream) {
        const data = (await res.json()) as { text?: string };
        const text = data.text ?? '';
        onStreamChunk?.(text);
        return text;
      }
      // Streaming: consume `data: {"delta": "..."}` events and emit accumulated text.
      if (!res.body) {
        throw new Error('服务器代理未返回流式响应体');
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const acc = createLlmStreamAcc();
      let transcript = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const chunkRaw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          for (const line of chunkRaw.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const payload = trimmed.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              const parsed = JSON.parse(payload) as { delta?: string; reasoning?: string };
              const next = applyHostedSsePayload(acc, parsed);
              if (next !== transcript) {
                transcript = next;
                onStreamChunk?.(transcript);
              }
            } catch {
              /* skip malformed line */
            }
          }
        }
      }
      return transcript;
    }, { label: 'ai-llm', onRetry });
  }

  if (config.provider === 'gemini') {
    const apiKey = useUserConfig ? apiKeyTrimmed : (process.env.GEMINI_API_KEY as string | undefined)?.trim();
    if (!apiKey) throw new Error("Gemini: API Key missing (set in Settings or GEMINI_API_KEY).");

    console.info(`${LOG_PREFIX} Gemini generateContent`, {
      model: useUserConfig ? config.model : 'gemini-3-flash-preview',
      apiKey: maskApiKeyForLog(apiKey),
    });

    const ai = new GoogleGenAI({ apiKey });
    const modelId = useUserConfig ? config.model : "gemini-3-flash-preview";

    // Build Gemini contents. If `messages` is provided, map to Gemini's
    // { role: 'user' | 'model', parts: [...] } shape; pull out any system
    // message for the top-level `systemInstruction` field.
    let geminiSystem = systemInstruction;
    let geminiContents: Array<{ role: 'user' | 'model'; parts: Array<{ text?: string }> }>;
    if (messages && messages.length > 0) {
      // Pull out the first system message if any (so we don't lose it).
      const withoutSystem = messages[0]?.role === 'system' ? messages.slice(1) : messages;
      if (withoutSystem.length === 0) {
        // No non-system messages; fall back to legacy single-turn behavior.
        // buildGeminiUserPayload returns string | GeminiPart[]; widen via
        // unknown to the strict Gemini contents shape expected by the SDK.
        geminiContents = buildGeminiUserPayload(prompt ?? '', images) as unknown as typeof geminiContents;
      } else {
        geminiContents = withoutSystem
          .filter((m) => m.role !== 'system')
          .map((m) => {
            const role: 'user' | 'model' = m.role === 'assistant' ? 'model' : 'user';
            const text =
              typeof m.content === 'string'
                ? m.content
                : Array.isArray(m.content)
                  ? (m.content as unknown[]).map((p) => (p as { text?: string }).text ?? '').join('')
                  : '';
            return { role, parts: [{ text }] };
          });
      }
    } else {
      // Same widening as above: GeminiPart[] doesn't structurally overlap the
      // SDK's `{ role, parts: [{ text? }] }[]` shape, so route through unknown.
      geminiContents = buildGeminiUserPayload(prompt ?? '', images) as unknown as typeof geminiContents;
    }

    try {
      const response = await withAiTransientRetry(
        () =>
          ai.models.generateContent({
            model: modelId,
            contents: geminiContents,
            config: {
              systemInstruction: geminiSystem,
              temperature,
              topP
            }
          }),
        { label: 'gemini' },
      );
      const text = response.text || '';
      onStreamChunk?.(text);
      return text;
    } catch (e) {
      console.error(`${LOG_PREFIX} Gemini failed`, formatAiError(e));
      throw e instanceof Error ? e : new Error(formatAiError(e));
    }
  }

  if (config.provider === 'mimo' && !mimoApiKey) {
    throw new Error(
      'MiMo API Key 未配置。请在设置中粘贴 tp- 密钥，或在构建时设置 VITE_BUILTIN_MIMO_API_KEY。',
    );
  }

  if (config.provider === 'doubao' && !doubaoApiKey) {
    throw new Error(formatDoubaoKeyMissingError());
  }

  if (!useUserConfig && config.provider !== 'mimo' && config.provider !== 'doubao') {
    throw new Error(`API Key missing for provider "${config.provider}". Open Settings and paste your key.`);
  }

  if (
    config.provider === 'openai' ||
    config.provider === 'custom' ||
    config.provider === 'mimo' ||
    config.provider === 'deepseek' ||
    config.provider === 'doubao' ||
    config.provider === 'minimax'
  ) {
    const baseNormalized = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    const mimoBase = (config.baseUrl || MIMO_TOKEN_PLAN_BASE_URL).replace(/\/$/, '');
    const deepseekBase = (config.baseUrl || DEEPSEEK_BASE_URL).replace(/\/$/, '');
    const doubaoBase = (config.baseUrl || DOUBAO_ARK_BASE_URL).replace(/\/$/, '');
    const minimaxBase = (config.baseUrl || MINIMAX_BASE_URL).replace(/\/$/, '');
    const chatUrl =
      config.provider === 'mimo'
        ? (isTauriRuntime() ? `${mimoBase}/chat/completions` : '/api/mimo/chat/completions')
        : config.provider === 'deepseek'
          ? (isTauriRuntime() ? `${deepseekBase}/chat/completions` : '/api/deepseek/chat/completions')
          : config.provider === 'doubao'
            ? (isTauriRuntime() ? `${doubaoBase}/chat/completions` : '/api/doubao/chat/completions')
            : config.provider === 'minimax'
              ? (isTauriRuntime() ? `${minimaxBase}/chat/completions` : '/api/minimax/v1/chat/completions')
              : `${baseNormalized}/chat/completions`;

    const requestedModel =
      config.provider === 'doubao'
        ? resolveDoubaoChatModel(config.model)
        : config.model ||
          (config.provider === 'mimo'
            ? 'mimo-v2.5-pro'
            : config.provider === 'deepseek'
              ? DEEPSEEK_DEFAULT_MODEL
              : config.provider === 'minimax'
                ? MINIMAX_DEFAULT_MODEL
                : 'gpt-4o');
    const model = images?.length && !lockModel
      ? resolveChatModelForImages(config.provider, requestedModel)
      : requestedModel;
    // Resolve the messages array: prefer caller-provided `messages`; if absent,
    // build the legacy [system?, user] pair from `systemInstruction` + `prompt`.
    const fallbackMessages: ChatMessage[] = [];
    if (systemInstruction) {
      fallbackMessages.push({ role: 'system', content: systemInstruction });
    }
    if (prompt !== undefined) {
      // Same widening as in attachImagesToLastUser above — the function
      // returns a more specific array than ChatMessage['content'] allows.
      const userContent = (
        images && images.length > 0
          ? buildOpenAiUserContent(prompt, images)
          : prompt
      ) as string | unknown[];
      // Cast to ChatMessage: the spread-then-widen dance leaves the literal
      // type as `{role: 'user', content: string|unknown[]}` which TS can't
      // structurally match to ChatMessage's two-branch union.
      fallbackMessages.push({ role: 'user', content: userContent } as ChatMessage);
    }
    const baseMessages = messages && messages.length > 0 ? messages : fallbackMessages;
    // Prepend systemInstruction only if caller-provided array doesn't already
    // start with a system message.
    const hasSystem = baseMessages.some((m) => m.role === 'system');
    const finalMessages: ChatMessage[] = hasSystem
      ? baseMessages
      : systemInstruction
        ? [{ role: 'system', content: systemInstruction }, ...baseMessages]
        : baseMessages;
    const withImages = attachImagesToLastUser(finalMessages, images);

    // 深度思考：只有 OpenRouter 认这个字段，而且用户选"默认"时一个字都不加。
    const reasoning = isOpenRouterEndpoint(config.provider, config.baseUrl)
      ? reasoningRequestField(resolveReasoningMode(config.reasoningMode))
      : undefined;
    const body = {
      model,
      messages: withImages,
      temperature,
      top_p: topP,
      ...(reasoning ? { reasoning } : {}),
    };

    const openAiKey =
      config.provider === 'mimo'
        ? mimoApiKey
        : config.provider === 'doubao'
          ? doubaoApiKey
          : apiKeyTrimmed;
    return postOpenAiCompatibleChatWithOptionalStream(openAiKey, chatUrl, body, {
      provider: config.provider,
      model,
      sessionId,
    }, onStreamChunk);
  }

  if (config.provider === 'anthropic') {
    console.info(`${LOG_PREFIX} Anthropic messages`, {
      model: config.model || 'claude-3-5-sonnet-20240620',
      apiKey: maskApiKeyForLog(apiKeyTrimmed),
    });
    // Anthropic takes a top-level `system` field and a `messages` array
    // (no system role in messages). Strip the leading system message out of
    // `messages` and pass it as `system`; prepend any standalone systemInstruction.
    let anthropicSystem = systemInstruction ?? '';
    let anthropicMessages: Array<{ role: 'user' | 'assistant'; content: string | unknown[] }>;
    if (messages && messages.length > 0) {
      const filtered = messages.filter((m) => m.role !== 'system');
      if (filtered.length > 0 && filtered[0]!.role === 'system') {
        anthropicSystem = String((filtered[0] as ChatMessage & { role: 'system' }).content);
      }
      const derived = ((filtered.length === 0 ? messages : filtered)
        // Cast at the filter result: ChatMessage.role includes 'system', which
        // can't be narrowed via a structural type predicate without falling
        // into `never` territory (TS2677). The runtime filter removes system
        // messages; the cast re-types the array to match anthropicMessages.
        .filter((m) => m.role === 'user' || m.role === 'assistant') as Array<{
        role: 'user' | 'assistant';
        content: string | unknown[];
      }>)
        .map((m) => {
          if (m.role === 'user' && typeof m.content === 'string' && images && images.length > 0) {
            return { role: 'user' as const, content: buildAnthropicUserContent(m.content, images) };
          }
          return { role: m.role, content: m.content };
        });
      anthropicMessages =
        derived.length > 0
          ? derived
          : [
              {
                role: 'user',
                content: prompt !== undefined ? buildAnthropicUserContent(prompt, images) : '',
              },
            ];
    } else {
      anthropicMessages = [
        {
          role: 'user',
          content:
            prompt !== undefined ? buildAnthropicUserContent(prompt, images) : '',
        },
      ];
    }
    const data = await withAiTransientRetry(async () => {
      let response: Response;
      try {
        response = await fetch(`https://api.anthropic.com/v1/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKeyTrimmed,
            'anthropic-version': '2023-06-01',
            'dangerouslyAllowBrowser': 'true'
          },
          body: JSON.stringify({
            model: config.model || 'claude-3-5-sonnet-20240620',
            system: anthropicSystem || undefined,
            max_tokens: 1024,
            messages: anthropicMessages,
            temperature
          })
        });
      } catch (e) {
        throw new Error(`Network error: ${formatAiError(e)}`);
      }

      if (!response.ok) {
        const raw = await response.text();
        const msg = parseOpenAiStyleErrorBody(raw, response.status);
        console.error(`${LOG_PREFIX} Anthropic HTTP error`, response.status, raw.slice(0, 2000));
        throw new AiHttpError(response.status, msg);
      }
      return response.json();
    }, { label: 'anthropic' });
    const blocks = data.content as Array<{ type?: string; text?: string }>;
    if (!Array.isArray(blocks) || blocks.length === 0) {
      console.error(`${LOG_PREFIX} unexpected Anthropic response`, data);
      throw new Error('API returned no content blocks.');
    }
    const text = blocks
      .map((b) => {
        if (typeof b.text !== 'string') return '';
        if (b.type === 'image') return '';
        return b.text;
      })
      .join('');
    if (!text) {
      console.error(`${LOG_PREFIX} Anthropic returned no text blocks`, data);
      throw new Error('API returned no text content.');
    }
    onStreamChunk?.(text);
    return text;
  }

  throw new Error(`Provider not supported: ${config.provider}`);
}
