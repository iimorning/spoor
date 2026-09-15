import { DEEPSEEK_VISION_MODEL } from '../constants/deepseek';
import { OPENROUTER_DEFAULT_VISION_MODEL } from '../constants/openrouter';

export function isVisionModelId(model: string): boolean {
  return /vision/i.test((model || '').trim());
}

export function isDeepSeekModelId(model: string): boolean {
  const m = (model || '').trim().toLowerCase();
  return m === 'deepseek' || m.startsWith('deepseek/') || m.startsWith('deepseek-');
}

/** Hosted DeepSeek text SKUs cannot see pixels; route those image turns to GLM. */
export function shouldRouteDeepSeekImagesToGlm(provider: string, model: string): boolean {
  return provider === 'deepseek' || isDeepSeekModelId(model);
}

/**
 * Text DeepSeek SKUs cannot see pixels.
 * Own-key DeepSeek stays on the native vision SKU (DeepSeek API).
 * OpenRouter DeepSeek slugs switch to GLM, which has many vision endpoints.
 */
export function resolveChatModelForImages(provider: string, model: string): string {
  const m = (model || '').trim();
  if (provider === 'deepseek') return DEEPSEEK_VISION_MODEL;
  if (provider === 'openrouter' && isDeepSeekModelId(m)) {
    return OPENROUTER_DEFAULT_VISION_MODEL;
  }
  if (isVisionModelId(m) && isDeepSeekModelId(m)) {
    return OPENROUTER_DEFAULT_VISION_MODEL;
  }
  if (isVisionModelId(m)) return m;
  return m;
}
