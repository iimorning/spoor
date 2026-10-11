import { DEEPSEEK_VISION_MODEL } from '../constants/deepseek';
import { OPENROUTER_DEFAULT_VISION_MODEL } from '../constants/openrouter';

export function isVisionModelId(model: string): boolean {
  return /vision/i.test((model || '').trim());
}

export function isDeepSeekModelId(model: string): boolean {
  const m = (model || '').trim().toLowerCase();
  return m === 'deepseek' || m.startsWith('deepseek/') || m.startsWith('deepseek-');
}

/**
 * DeepSeek-family ids that are natively multimodal, so image turns can stay on
 * them. Everything else in the family is text-only and must be rerouted.
 */
const DEEPSEEK_MULTIMODAL_MODEL_IDS = ['deepseek/deepseek-v4.1-flash', 'deepseek-v4.1-flash'];

export function isDeepSeekMultimodalModelId(model: string): boolean {
  return DEEPSEEK_MULTIMODAL_MODEL_IDS.includes((model || '').trim().toLowerCase());
}

/** Text DeepSeek SKUs cannot see pixels; route those image turns to the OpenRouter vision model. */
export function shouldRouteDeepSeekImagesToVisionModel(provider: string, model: string): boolean {
  if (isDeepSeekMultimodalModelId(model)) return false;
  return provider === 'deepseek' || isDeepSeekModelId(model);
}

/**
 * Text DeepSeek SKUs cannot see pixels.
 * Own-key DeepSeek stays on the native vision SKU (DeepSeek API).
 * OpenRouter DeepSeek slugs switch to the OpenRouter vision model
 * (`OPENROUTER_DEFAULT_VISION_MODEL`); natively multimodal ids stay put.
 */
export function resolveChatModelForImages(provider: string, model: string): string {
  const m = (model || '').trim();
  if (isDeepSeekMultimodalModelId(m)) return m;
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
