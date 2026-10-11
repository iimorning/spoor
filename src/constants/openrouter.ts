/** OpenRouter OpenAI-compatible API. Chat: `{OPENROUTER_BASE_URL}/chat/completions` */
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * Default overseas trial model. Nothing reads this at runtime: the hosted path
 * resolves `developer_secrets.providers.primaryModel` server-side. Switch a
 * deployment with `scripts/sql/set-hosted-openrouter-*.sql` and keep this line in
 * sync as the record of what is deployed.
 */
export const OPENROUTER_DEFAULT_MODEL = 'deepseek/deepseek-v4.1-flash';

/**
 * Outline editor, and the fallback for image turns on a text-only DeepSeek
 * primary. Must be multimodal: the outline editor sends canvas images and locks
 * the model (`lockModel`).
 */
export const OPENROUTER_OUTLINE_MODEL = 'openai/gpt-5.6-terra';

/**
 * 书籍卡的文字模型：伴读对话 + 伴读标注都用它。
 *
 * 4.1 Flash 是照着代码任务调的，让它陪读，写出来的东西像技术文档而不像人在说话。
 * 读书这一路既不写代码也不带图，正好交给上一代——OpenRouter 上并没有 "4.0" 这个名字，
 * 4.1 之前那条 Flash 线有三个：
 *
 *   `deepseek/deepseek-v4-flash`        → V4 Flash 0423（不带后缀，默认解析到的那一版）
 *   `deepseek/deepseek-v4-flash-0731`   → V4 Flash 0731
 *   `~deepseek/deepseek-v4-flash-latest` → 跟着上游滚动
 *
 * 这里钉 **0731 快照**，不跟 latest：不钉的话，同一段正文今天和下周会标出不同的重点，
 * 而用户没做任何操作，没法解释为什么。快照不会自己变，代价是将来上游改了也不会跟着升级。
 *
 * 用它必须配 `lockModel` 才钉得住：服务端 `resolveHostedChatModel` 的取值顺序是
 * `primary || requested || default`，`primary` 排在前面，光把 model 传过去会被顶掉。
 */
export const OPENROUTER_BOOK_MODEL = 'deepseek/deepseek-v4-flash-0731';

/**
 * When the hosted text model is a DeepSeek text SKU (text-only), image turns
 * switch to this slug. DeepSeek's own OpenRouter vision SKU has a single
 * provider and 404s under typical data-policy / guardrail filters.
 */
export const OPENROUTER_DEFAULT_VISION_MODEL = OPENROUTER_OUTLINE_MODEL;

/** Dedicated Image API: `POST {OPENROUTER_BASE_URL}/images` */
export const OPENROUTER_IMAGE_MODEL = 'google/gemini-3.1-flash-image';

/** @deprecated Use OPENROUTER_IMAGE_MODEL */
export const OPENROUTER_GPT_IMAGE_MODEL = OPENROUTER_IMAGE_MODEL;

/**
 * 深度思考（OpenRouter 的统一 `reasoning` 参数）。
 *
 * - `default`：**什么都不传**，跟随模型自身的默认行为（这是我们以前的唯一行为）。
 * - `off`：`reasoning: { enabled: false }`，不思考。
 * - `low` / `medium` / `high`：`reasoning: { effort }`，OpenRouter 会翻译成目标模型的
 *   说法（OpenAI 系的 effort、Anthropic 的 thinking 预算等）。不支持的模型会被静默忽略。
 */
export type ReasoningMode = 'default' | 'off' | 'low' | 'medium' | 'high';

export const REASONING_MODES: readonly ReasoningMode[] = ['default', 'off', 'low', 'medium', 'high'];

export type ReasoningRequestField =
  | { enabled: boolean }
  | { effort: 'low' | 'medium' | 'high' };

export function resolveReasoningMode(value: unknown): ReasoningMode {
  return typeof value === 'string' && (REASONING_MODES as readonly string[]).includes(value)
    ? (value as ReasoningMode)
    : 'default';
}

/** 只有真的要改行为时才返回字段：`default` 返回 undefined（一个字节都不发给上游）。 */
export function reasoningRequestField(mode: ReasoningMode): ReasoningRequestField | undefined {
  if (mode === 'off') return { enabled: false };
  if (mode === 'low' || mode === 'medium' || mode === 'high') return { effort: mode };
  return undefined;
}

/** 这条请求是不是走 OpenRouter（自带 Key 直连，或托管代理到 OpenRouter）。 */
export function isOpenRouterEndpoint(
  provider: string,
  baseUrl?: string | null,
): boolean {
  if (provider === 'openrouter') return true;
  return (baseUrl ?? '').toLowerCase().includes('openrouter.ai');
}
