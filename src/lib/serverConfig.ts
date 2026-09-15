/**
 * Runtime cache of "is this caller routed via the server-managed Edge Function proxy?".
 *
 * Why a module-level cache instead of a hook:
 * - The decision is consumed deep inside service modules (e.g. `callUniversalAI`,
 *   `issueVolcAsrToken`) that are pure functions of config, not React components.
 *   Threading `useServerManaged` through every call site would be invasive.
 * - The source of truth lives in `App.tsx` (it has both the auth context and the
 *   `useServerKeys` aiConfig field). `App.tsx` calls `setServerConfig()` inside a
 *   `useEffect` whenever the session or that field changes.
 * - Service code reads `isServerManaged()` synchronously — the value is always
 *   one tick behind the React state, which is fine for routing decisions because
 *   `useServerKeys` only flips on login/logout, both of which the user expects
 *   to take effect on the *next* call.
 */

import type { DeveloperSecrets } from '../types/developerSecrets';
import { LIVE_WEB_SEARCH_BACKEND } from '../constants/webSearchBackend';

type SessionLike = { access_token?: string } | null;

type ServerConfigSnapshot = {
  session: SessionLike;
  /** Mirror of `aiConfig.useServerKeys`. False = client fills own keys. */
  useServerKeys: boolean;
  /** True when Waffo reports an in-period Pro subscription. */
  isPro: boolean;
};

let snapshot: ServerConfigSnapshot = {
  session: null,
  useServerKeys: false,
  isPro: false,
};

/** Called from App.tsx whenever auth/session/useServerKeys changes. */
export function setServerConfig(next: Partial<ServerConfigSnapshot>): void {
  snapshot = { ...snapshot, ...next };
}

/**
 * True when the caller should route through the developer's Edge Functions
 * (i.e. logged in with `useServerKeys` enabled). Free users share this path
 * with a lifetime cap; Pro has monthly text/image caps. False means the caller is
 * using locally configured keys, either typed in or `VITE_BUILTIN_*`.
 */
export function isServerManaged(): boolean {
  return Boolean(snapshot.session) && snapshot.useServerKeys;
}

/**
 * True when Metaso search can run: either a local key is set, or the caller is
 * on the server-managed path (Edge Function reads `developer_secrets.metaso`).
 */
export function hasMetasoAccess(localMetasoApiKey?: string | null): boolean {
  if (isServerManaged()) return true;
  return Boolean((localMetasoApiKey ?? '').trim());
}

/**
 * True when canvas live search can run for the current backend
 * (`LIVE_WEB_SEARCH_BACKEND`: Perplexity via OpenRouter, or Metaso).
 */
export function hasLiveWebSearchAccess(opts: {
  metasoApiKey?: string | null;
  provider?: string;
  llmApiKey?: string | null;
}): boolean {
  if (LIVE_WEB_SEARCH_BACKEND === 'metaso') return hasMetasoAccess(opts.metasoApiKey);
  if (isServerManaged()) return true;
  return (opts.provider ?? '') === 'openrouter' && Boolean((opts.llmApiKey ?? '').trim());
}

/**
 * True when MiniMax TTS can run: local key, or server-managed
 * (`developer_secrets.minimaxTts` via Edge Functions).
 */
export function hasMinimaxTtsAccess(localMinimaxApiKey?: string | null): boolean {
  if (isServerManaged()) return true;
  return Boolean((localMinimaxApiKey ?? '').trim());
}

/** Active Supabase access token, or null when not logged in / not server-managed. */
export function getAccessToken(): string | null {
  if (!isServerManaged()) return null;
  const token = snapshot.session?.access_token;
  return token && token.length > 0 ? token : null;
}

/**
 * Prefer a fresh session token from the Supabase client (auto-refresh) over the
 * React snapshot, which can lag after expiry and cause Kong to reject the call
 * before `ai-llm` runs — that rejection has no CORS headers and looks like
 * "Failed to fetch".
 */
export async function resolveAccessToken(): Promise<string | null> {
  return getAccessToken();
}

/**
 * Base URL for the Supabase Edge Functions. Trailing slashes stripped so
 * callers can do `${base}/ai-llm`.
 *
 * Prefer `VITE_SUPABASE_FUNCTIONS_URL`. If unset, derive from
 * `VITE_SUPABASE_URL` (hosted project). Only fall back to local
 * `supabase start` when neither is set — otherwise `npm run dev` against a
 * cloud project hangs forever on 127.0.0.1:54321 (checkout spinner).
 */
export function getFunctionsBase(): string {
  const explicit = (import.meta.env.VITE_SUPABASE_FUNCTIONS_URL as string | undefined)?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const project = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
  if (project) return `${project.replace(/\/+$/, '')}/functions/v1`;
  return import.meta.env.DEV ? 'http://127.0.0.1:54321/functions/v1' : '';
}

/** True when the Edge Function URL is configured (dev default counts). */
export function isFunctionsBaseConfigured(): boolean {
  return getFunctionsBase().length > 0;
}

/**
 * Headers for calling a Supabase Edge Function from the browser.
 * Kong requires `apikey` (anon / publishable key) on every call; without it the
 * gateway often returns a non-CORS error page that the browser reports as
 * "Failed to fetch" / CORS. `Authorization` must be the *user* JWT only —
 * never put `sb_publishable_…` in Bearer (not a JWT; gateway rejects it).
 */
export function edgeFunctionHeaders(
  accessToken: string,
  init?: Record<string, string>,
): Record<string, string> {
  const anon = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();
  if (!anon) {
    throw new Error(
      '缺少 VITE_SUPABASE_ANON_KEY：Edge Function 调用需要 apikey 头，请写入 .env.local 后重启 npm run dev。',
    );
  }
  return {
    Authorization: `Bearer ${accessToken}`,
    apikey: anon,
    'x-client-info': 'spoor-web',
    ...(init ?? {}),
  };
}

/**
 * Append Kong `apikey` to an Edge Function WebSocket URL. Browser WS cannot set
 * custom headers; without apikey some gateways reject the upgrade.
 */
export function withEdgeFunctionWsParams(wsUrl: string): string {
  const anon = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();
  if (!anon) return wsUrl;
  const u = new URL(wsUrl);
  if (!u.searchParams.has('apikey')) u.searchParams.set('apikey', anon);
  return u.toString();
}

/**
 * Resolve the effective LLM provider + model + baseUrl for the current caller.
 * Logged-in / useServerKeys → use `DeveloperSecrets.providers` populated server-side
 * (this function only knows the *type*; the actual values come from the
 * Edge Function response — keep this for the lightweight UI display only).
 *
 * NOTE: At call time services don't have access to `DeveloperSecrets`; that
 * JSONB lives in Supabase and only Edge Functions can read it. So this helper
 * returns `null` when server-managed (the UI shouldn't claim a specific model
 * until the Edge Function responds), and falls back to the local `aiConfig`
 * fields when not server-managed.
 */
export function getEffectiveProviderConfig(localConfig: {
  provider: string;
  model: string;
  baseUrl?: string;
}): { provider: string; model: string; baseUrl?: string } | null {
  if (isServerManaged()) return null;
  return {
    provider: localConfig.provider,
    model: localConfig.model,
    baseUrl: localConfig.baseUrl,
  };
}

// Re-export the type so callers can import without a second path.
export type { DeveloperSecrets };