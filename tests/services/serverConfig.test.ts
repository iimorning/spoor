import { describe, it, expect, beforeEach } from 'vitest';
import {
  setServerConfig,
  isServerManaged,
  getAccessToken,
  getFunctionsBase,
  isFunctionsBaseConfigured,
  getEffectiveProviderConfig,
  edgeFunctionHeaders,
  hasMetasoAccess,
  hasLiveWebSearchAccess,
  hasMinimaxTtsAccess,
} from '../../src/lib/serverConfig';

/**
 * Module-level mutable state must reset between tests so order doesn't leak.
 * `setServerConfig` is the only legal way to mutate it from the outside, so
 * each test starts with the documented default (no session, no server keys).
 */
beforeEach(() => {
  setServerConfig({ session: null, useServerKeys: false, isPro: false });
});

function makeSession(accessToken = 'test-access-token') {
  return { access_token: accessToken };
}

describe('isServerManaged', () => {
  it('defaults to false (no session, no explicit useServerKeys)', () => {
    expect(isServerManaged()).toBe(false);
  });

  it('is true when a session, useServerKeys, and Pro are all set', () => {
    setServerConfig({ session: makeSession(), useServerKeys: true, isPro: true });
    expect(isServerManaged()).toBe(true);
  });

  it('is true when a session and useServerKeys are set, even without Pro', () => {
    setServerConfig({ session: makeSession(), useServerKeys: true, isPro: false });
    expect(isServerManaged()).toBe(true);
  });

  it('is false when session is present but useServerKeys is false', () => {
    // User has logged in but explicitly opted out of server-managed keys.
    setServerConfig({ session: makeSession(), useServerKeys: false });
    expect(isServerManaged()).toBe(false);
  });

  it('is false when useServerKeys is true but session is missing', () => {
    setServerConfig({ session: null, useServerKeys: true });
    expect(isServerManaged()).toBe(false);
  });
});

describe('getAccessToken', () => {
  it('returns null when not server-managed', () => {
    expect(getAccessToken()).toBeNull();
  });

  it('returns the session access token when server-managed', () => {
    setServerConfig({ session: makeSession('jwt-xyz'), useServerKeys: true, isPro: true });
    expect(getAccessToken()).toBe('jwt-xyz');
  });

  it('returns null when server-managed flag is on but session has no access_token', () => {
    setServerConfig({ session: makeSession(''), useServerKeys: true, isPro: true });
    expect(getAccessToken()).toBeNull();
  });
});

describe('getFunctionsBase', () => {
  it('returns the env-configured base when VITE_SUPABASE_FUNCTIONS_URL is set', () => {
    const previous = (import.meta.env as Record<string, string | undefined>).VITE_SUPABASE_FUNCTIONS_URL;
    (import.meta.env as Record<string, string | undefined>).VITE_SUPABASE_FUNCTIONS_URL =
      'https://example.supabase.co/functions/v1';
    try {
      expect(getFunctionsBase()).toBe('https://example.supabase.co/functions/v1');
    } finally {
      (import.meta.env as Record<string, string | undefined>).VITE_SUPABASE_FUNCTIONS_URL = previous;
    }
  });

  it('strips trailing slashes from the configured base', () => {
    const previous = (import.meta.env as Record<string, string | undefined>).VITE_SUPABASE_FUNCTIONS_URL;
    (import.meta.env as Record<string, string | undefined>).VITE_SUPABASE_FUNCTIONS_URL =
      'https://example.supabase.co/functions/v1///';
    try {
      expect(getFunctionsBase()).toBe('https://example.supabase.co/functions/v1');
    } finally {
      (import.meta.env as Record<string, string | undefined>).VITE_SUPABASE_FUNCTIONS_URL = previous;
    }
  });

  it('derives /functions/v1 from VITE_SUPABASE_URL when FUNCTIONS_URL is unset', () => {
    const env = import.meta.env as Record<string, string | undefined>;
    const prevFn = env.VITE_SUPABASE_FUNCTIONS_URL;
    const prevUrl = env.VITE_SUPABASE_URL;
    delete env.VITE_SUPABASE_FUNCTIONS_URL;
    env.VITE_SUPABASE_URL = 'https://abc.supabase.co/';
    try {
      expect(getFunctionsBase()).toBe('https://abc.supabase.co/functions/v1');
    } finally {
      env.VITE_SUPABASE_FUNCTIONS_URL = prevFn;
      env.VITE_SUPABASE_URL = prevUrl;
    }
  });
});

describe('isFunctionsBaseConfigured', () => {
  it('reports true when an env base is set', () => {
    const previous = (import.meta.env as Record<string, string | undefined>).VITE_SUPABASE_FUNCTIONS_URL;
    (import.meta.env as Record<string, string | undefined>).VITE_SUPABASE_FUNCTIONS_URL =
      'https://example.supabase.co/functions/v1';
    try {
      expect(isFunctionsBaseConfigured()).toBe(true);
    } finally {
      (import.meta.env as Record<string, string | undefined>).VITE_SUPABASE_FUNCTIONS_URL = previous;
    }
  });

  it('reports true even with the dev default', () => {
    const previous = (import.meta.env as Record<string, string | undefined>).VITE_SUPABASE_FUNCTIONS_URL;
    delete (import.meta.env as Record<string, string | undefined>).VITE_SUPABASE_FUNCTIONS_URL;
    try {
      expect(isFunctionsBaseConfigured()).toBe(true);
    } finally {
      (import.meta.env as Record<string, string | undefined>).VITE_SUPABASE_FUNCTIONS_URL = previous;
    }
  });
});

describe('getEffectiveProviderConfig', () => {
  const local = { provider: 'openai', model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' };

  it('returns the local config when not server-managed', () => {
    expect(getEffectiveProviderConfig(local)).toEqual(local);
  });

  it('returns null when server-managed (caller should defer to the Edge Function)', () => {
    setServerConfig({ session: makeSession(), useServerKeys: true, isPro: true });
    expect(getEffectiveProviderConfig(local)).toBeNull();
  });
});

describe('hasMetasoAccess', () => {
  it('is true with a local Metaso key', () => {
    expect(hasMetasoAccess('sk-metaso')).toBe(true);
  });

  it('is false without a local key when not server-managed', () => {
    expect(hasMetasoAccess('')).toBe(false);
    expect(hasMetasoAccess(undefined)).toBe(false);
  });

  it('is true when server-managed even without a local key', () => {
    setServerConfig({ session: makeSession(), useServerKeys: true, isPro: true });
    expect(hasMetasoAccess('')).toBe(true);
  });
});

describe('hasLiveWebSearchAccess', () => {
  it('is true with a local Metaso key when live search is Metaso', () => {
    expect(
      hasLiveWebSearchAccess({
        metasoApiKey: 'sk-metaso',
        provider: 'gemini',
        llmApiKey: 'gem',
      }),
    ).toBe(true);
  });

  it('is false without a local Metaso key when not server-managed', () => {
    expect(
      hasLiveWebSearchAccess({
        metasoApiKey: '',
        provider: 'openrouter',
        llmApiKey: 'sk-or',
      }),
    ).toBe(false);
  });

  it('is true when server-managed even without a local OpenRouter key', () => {
    setServerConfig({ session: makeSession(), useServerKeys: true, isPro: true });
    expect(
      hasLiveWebSearchAccess({
        metasoApiKey: '',
        provider: 'gemini',
        llmApiKey: '',
      }),
    ).toBe(true);
  });
});

describe('hasMinimaxTtsAccess', () => {
  it('is true with a local MiniMax TTS key', () => {
    expect(hasMinimaxTtsAccess('sk-mm')).toBe(true);
  });

  it('is false without a local key when not server-managed', () => {
    expect(hasMinimaxTtsAccess('')).toBe(false);
    expect(hasMinimaxTtsAccess(undefined)).toBe(false);
  });

  it('is true when server-managed even without a local key', () => {
    setServerConfig({ session: makeSession(), useServerKeys: true, isPro: true });
    expect(hasMinimaxTtsAccess('')).toBe(true);
  });
});

describe('edgeFunctionHeaders', () => {
  it('includes Authorization and apikey when anon key is configured', () => {
    const previous = (import.meta.env as Record<string, string | undefined>).VITE_SUPABASE_ANON_KEY;
    (import.meta.env as Record<string, string | undefined>).VITE_SUPABASE_ANON_KEY = 'anon-xyz';
    try {
      expect(edgeFunctionHeaders('jwt-1', { 'Content-Type': 'application/json' })).toEqual({
        Authorization: 'Bearer jwt-1',
        apikey: 'anon-xyz',
        'x-client-info': 'spoor-web',
        'Content-Type': 'application/json',
      });
    } finally {
      (import.meta.env as Record<string, string | undefined>).VITE_SUPABASE_ANON_KEY = previous;
    }
  });

  it('throws when anon key is missing', () => {
    const previous = (import.meta.env as Record<string, string | undefined>).VITE_SUPABASE_ANON_KEY;
    (import.meta.env as Record<string, string | undefined>).VITE_SUPABASE_ANON_KEY = '';
    try {
      expect(() => edgeFunctionHeaders('jwt-1')).toThrow(/VITE_SUPABASE_ANON_KEY/);
    } finally {
      (import.meta.env as Record<string, string | undefined>).VITE_SUPABASE_ANON_KEY = previous;
    }
  });
});
