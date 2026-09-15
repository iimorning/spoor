import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearAllAskComposerDrafts,
  clearAskComposerDraft,
  getAskComposerDraft,
  setAskComposerDraft,
} from '../../src/utils/askComposerDraft';

describe('askComposerDraft', () => {
  beforeEach(() => {
    clearAllAskComposerDrafts();
  });

  it('stores and restores text per card', () => {
    setAskComposerDraft('a', 'hello');
    setAskComposerDraft('b', 'world');
    expect(getAskComposerDraft('a')).toBe('hello');
    expect(getAskComposerDraft('b')).toBe('world');
  });

  it('clears empty text and explicit deletes', () => {
    setAskComposerDraft('a', 'keep');
    setAskComposerDraft('a', '');
    expect(getAskComposerDraft('a')).toBe('');
    setAskComposerDraft('a', 'again');
    clearAskComposerDraft('a');
    expect(getAskComposerDraft('a')).toBe('');
  });
});
