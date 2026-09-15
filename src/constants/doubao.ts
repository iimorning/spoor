/**
 * Volcengine Ark (火山方舟) OpenAI-compatible API for Doubao models.
 * Chat endpoint: {DOUBAO_ARK_BASE_URL}/chat/completions
 */
export const DOUBAO_ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

/** Previous chat id — restore `DOUBAO_DEFAULT_MODEL` to this to switch back. */
export const DOUBAO_PREVIOUS_MODEL = 'doubao-seed-2-1-turbo-260628';

/**
 * Ark `model` field for chat/completions. Seed-2.0-lite is the default so
 * Ask / Agent turns start tokens quickly. Turbo / pro / mini / old `ep-`
 * ids still stored in settings remap here.
 */
export const DOUBAO_DEFAULT_MODEL = 'doubao-seed-2-0-lite-260428';

const DOUBAO_LEGACY_MODELS = new Set<string>([
  DOUBAO_PREVIOUS_MODEL,
  'ep-20260218175314-xrnrn',
  'doubao-seed-2-0-mini-260428',
  'doubao-seed-2-1-pro-260628',
]);

/** Map retired Doubao ids (turbo / mini / pro / previous `ep-`) onto lite. */
export function resolveDoubaoChatModel(model?: string): string {
  const raw = (model ?? '').trim();
  if (!raw || DOUBAO_LEGACY_MODELS.has(raw)) return DOUBAO_DEFAULT_MODEL;
  return raw;
}

/**
 * Optional hosted Doubao key baked in at build time (Vite: VITE_BUILTIN_DOUBAO_API_KEY).
 * WARNING: visible in the shipped JS bundle — only for low-friction demos; rotate if leaked.
 */
export function getBuiltinDoubaoApiKey(): string {
  const raw = import.meta.env.VITE_BUILTIN_DOUBAO_API_KEY;
  return typeof raw === 'string' ? raw.trim() : '';
}

export function hasBuiltinDoubaoApiKey(): boolean {
  return getBuiltinDoubaoApiKey().length > 0;
}

/** User key wins; otherwise built-in key when configured. */
export function resolveDoubaoApiKey(userKey?: string): string {
  const user = (userKey ?? '').trim();
  if (user) return user;
  return getBuiltinDoubaoApiKey();
}

/** End-user vs maintainer messaging when hosted Doubao is unavailable. */
export function formatDoubaoKeyMissingError(): string {
  if (import.meta.env.PROD) {
    return (
      '托管豆包服务暂不可用（本站构建时未注入内置 API Key）。' +
      '普通用户无需自行配置；请稍后再试，或联系站点维护者在 Netlify 设置 VITE_BUILTIN_DOUBAO_API_KEY 后重新部署。'
    );
  }
  return (
    '豆包 API Key 未配置。开发环境请执行 npm run setup:doubao-key -- ark-你的密钥，然后重启 npm run dev。' +
    '线上部署见 docs/BUILTIN_DOUBAO.md。'
  );
}
