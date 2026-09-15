import { describe, expect, it } from 'vitest';
import { extractErrorMessage } from '../../src/utils/errorMessage';

describe('extractErrorMessage', () => {
  it('extracts message from standard Error', () => {
    expect(extractErrorMessage(new Error('Network error'))).toBe('Network error');
  });

  it('handles plain string errors', () => {
    expect(extractErrorMessage('Failed to connect')).toBe('Failed to connect');
  });

  it('guards against literal [object Object] strings', () => {
    expect(extractErrorMessage('[object Object]', 'Fallback')).toBe('Fallback');
  });

  it('handles null, undefined, and empty string with fallback', () => {
    expect(extractErrorMessage(null, 'default error')).toBe('default error');
    expect(extractErrorMessage(undefined, 'default error')).toBe('default error');
    expect(extractErrorMessage('', 'default error')).toBe('default error');
    expect(extractErrorMessage('   ', 'default error')).toBe('default error');
  });

  it('extracts message property from plain objects (e.g. PostgrestError)', () => {
    const postgrestErr = {
      message: 'new row violates row-level security policy for table "canvases"',
      details: 'Failing row contains (...)',
      hint: null,
      code: '42501',
    };
    expect(extractErrorMessage(postgrestErr)).toBe(
      'new row violates row-level security policy for table "canvases"',
    );
  });

  it('extracts error_description from OAuth style objects', () => {
    expect(extractErrorMessage({ error_description: 'Token expired' })).toBe('Token expired');
  });

  it('extracts details when message is absent', () => {
    expect(extractErrorMessage({ details: 'Database connection failed' })).toBe(
      'Database connection failed',
    );
  });

  it('extracts nested error.message', () => {
    expect(extractErrorMessage({ error: { message: 'Nested error occurred' } })).toBe(
      'Nested error occurred',
    );
  });

  it('falls back if plain object has no recognized fields and serialization produces [object Object]', () => {
    expect(extractErrorMessage({}, 'fallback')).toBe('fallback');
  });
});
