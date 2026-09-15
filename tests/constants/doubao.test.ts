import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DOUBAO_DEFAULT_MODEL,
  formatDoubaoKeyMissingError,
  getBuiltinDoubaoApiKey,
  hasBuiltinDoubaoApiKey,
  resolveDoubaoApiKey,
  resolveDoubaoChatModel,
} from '../../src/constants/doubao';

describe('resolveDoubaoChatModel', () => {
  it('maps turbo / pro / mini / old ep onto lite', () => {
    expect(resolveDoubaoChatModel('')).toBe(DOUBAO_DEFAULT_MODEL);
    expect(resolveDoubaoChatModel('doubao-seed-2-1-turbo-260628')).toBe(
      'doubao-seed-2-0-lite-260428',
    );
    expect(resolveDoubaoChatModel('doubao-seed-2-1-pro-260628')).toBe(DOUBAO_DEFAULT_MODEL);
    expect(resolveDoubaoChatModel('doubao-seed-2-0-mini-260428')).toBe(DOUBAO_DEFAULT_MODEL);
    expect(resolveDoubaoChatModel('ep-20260218175314-xrnrn')).toBe(DOUBAO_DEFAULT_MODEL);
  });

  it('leaves an explicit non-legacy model id unchanged', () => {
    expect(resolveDoubaoChatModel('doubao-seed-2-0-lite-260428')).toBe(
      'doubao-seed-2-0-lite-260428',
    );
  });
});

describe('doubao builtin API key', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('resolveDoubaoApiKey prefers user key over builtin', () => {
    vi.stubEnv('VITE_BUILTIN_DOUBAO_API_KEY', 'ark-builtin');
    expect(resolveDoubaoApiKey('ark-user')).toBe('ark-user');
  });

  it('resolveDoubaoApiKey falls back to builtin when user empty', () => {
    vi.stubEnv('VITE_BUILTIN_DOUBAO_API_KEY', 'ark-builtin');
    expect(resolveDoubaoApiKey('')).toBe('ark-builtin');
    expect(resolveDoubaoApiKey('   ')).toBe('ark-builtin');
  });

  it('hasBuiltinDoubaoApiKey is false when env unset', () => {
    vi.stubEnv('VITE_BUILTIN_DOUBAO_API_KEY', '');
    expect(getBuiltinDoubaoApiKey()).toBe('');
    expect(hasBuiltinDoubaoApiKey()).toBe(false);
    expect(resolveDoubaoApiKey('')).toBe('');
  });

  it('formatDoubaoKeyMissingError mentions Netlify in production', () => {
    vi.stubEnv('PROD', true);
    expect(formatDoubaoKeyMissingError()).toMatch(/Netlify/);
    expect(formatDoubaoKeyMissingError()).toMatch(/无需自行配置/);
  });

  it('formatDoubaoKeyMissingError mentions setup script in dev', () => {
    vi.stubEnv('PROD', false);
    expect(formatDoubaoKeyMissingError()).toMatch(/setup:doubao-key/);
  });
});
