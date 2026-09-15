/**
 * Shape of the `secrets` JSONB column in `public.developer_secrets`.
 *
 * The developer (us) populates this server-side via Supabase SQL / dashboard.
 * Edge Functions read it with the service_role key. Clients never see this
 * type at runtime — it's purely a contract between the developer and the
 * Edge Functions.
 *
 * Optional fields let the developer ship only the providers they actually pay
 * for; missing entries surface as "provider not configured" errors from the
 * Edge Functions, which the frontend maps to a friendly message.
 */

export type SupportedProvider =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'mimo'
  | 'doubao'
  | 'deepseek'
  | 'minimax'
  | 'openrouter';

export type ProviderSecret = {
  apiKey: string;
  baseUrl?: string;
};

export type VolcAsrSecret = {
  /** New console X-Api-Key. */
  apiKey?: string;
  /** Legacy X-Api-App-Key. */
  appId?: string;
  /** Legacy X-Api-Access-Key. */
  accessToken?: string;
  /** Defaults to `volc.seedasr.sauc.duration` if omitted. */
  resourceId?: string;
};

export type MinimaxTtsSecret = {
  apiKey: string;
  voiceId?: string;
  model?: string;
};

export type DeveloperSecrets = {
  /**
   * Default LLM provider used when a logged-in user hasn't picked one.
   * `primaryBaseUrl` is only honored for non-Anthropic/non-Gemini providers
   * — Anthropic and Gemini have hard-coded upstream endpoints.
   */
  providers: {
    primary: SupportedProvider;
    primaryModel: string;
    /** OpenRouter (or other) slug used only when the request includes images. */
    primaryVisionModel?: string;
    primaryBaseUrl?: string;
  };
  openai?: ProviderSecret;
  anthropic?: ProviderSecret;
  gemini?: ProviderSecret;
  mimo?: ProviderSecret;
  doubao?: ProviderSecret;
  deepseek?: ProviderSecret;
  minimax?: ProviderSecret;
  openrouter?: ProviderSecret;
  volcAsr?: VolcAsrSecret;
  minimaxTts?: MinimaxTtsSecret;
  metaso?: ProviderSecret;
  api302?: ProviderSecret;
};

/** Return the API-key field name for a provider, or null when not configured. */
export function providerApiKey(secrets: DeveloperSecrets, provider: SupportedProvider): string | undefined {
  const entry = (secrets as unknown as Record<string, ProviderSecret | undefined>)[provider];
  return entry?.apiKey?.trim() || undefined;
}

/** Return the optional baseUrl for a provider, or undefined. */
export function providerBaseUrl(secrets: DeveloperSecrets, provider: SupportedProvider): string | undefined {
  const entry = (secrets as unknown as Record<string, ProviderSecret | undefined>)[provider];
  return entry?.baseUrl?.trim() || undefined;
}