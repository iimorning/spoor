import { describe, it, expect } from 'vitest';
import {
  encodeEssayContent,
  tryParseEssayContent,
  ESSAY_CONTENT_PREFIX,
} from '../../src/utils/essayPayload';

describe('essayPayload', () => {
  it('encodes and parses articleId', () => {
    const encoded = encodeEssayContent({ articleId: 'art-1' });
    expect(encoded.startsWith(ESSAY_CONTENT_PREFIX)).toBe(true);
    expect(tryParseEssayContent(encoded)).toEqual({ articleId: 'art-1' });
  });

  it('returns null for invalid payloads', () => {
    expect(tryParseEssayContent(null)).toBeNull();
    expect(tryParseEssayContent('')).toBeNull();
    expect(tryParseEssayContent('spoor-book:v1:{}')).toBeNull();
    expect(tryParseEssayContent(`${ESSAY_CONTENT_PREFIX}{`)).toBeNull();
    expect(tryParseEssayContent(`${ESSAY_CONTENT_PREFIX}{"articleId":""}`)).toBeNull();
  });
});
