/** OpenRouter OpenAI-compatible API. Chat: `{OPENROUTER_BASE_URL}/chat/completions` */
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/** Default overseas trial model. Switch by updating `developer_secrets.providers.primaryModel`. */
export const OPENROUTER_DEFAULT_MODEL = 'openai/gpt-5.6-terra';

/** Outline editor and DeepSeek-primary image turns on OpenRouter. */
export const OPENROUTER_OUTLINE_MODEL = 'openai/gpt-5.6-terra';

/**
 * When the hosted text model is DeepSeek (text-only), image turns use GLM.
 * DeepSeek's OpenRouter vision SKU has a single provider and 404s under
 * typical data-policy / guardrail filters.
 */
export const OPENROUTER_DEFAULT_VISION_MODEL = OPENROUTER_OUTLINE_MODEL;

/** Dedicated Image API: `POST {OPENROUTER_BASE_URL}/images` */
export const OPENROUTER_IMAGE_MODEL = 'google/gemini-3.1-flash-image';

/** @deprecated Use OPENROUTER_IMAGE_MODEL */
export const OPENROUTER_GPT_IMAGE_MODEL = OPENROUTER_IMAGE_MODEL;
