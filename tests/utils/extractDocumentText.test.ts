import { describe, it, expect, vi } from 'vitest';
import {
  isPersonaPromptDocument,
  truncateDocumentText,
  extractDocumentText,
} from '../../src/utils/extractDocumentText';

vi.mock('mammoth', () => ({
  default: {
    extractRawText: vi.fn(async () => ({ value: 'Word body\n\nSecond para' })),
  },
}));

vi.mock('../../src/utils/parsePdfBook', () => ({
  parsePdfBook: vi.fn(async () => ({
    format: 'pdf',
    title: 'brief',
    units: [{ title: '1', text: 'Page one.' }, { title: '2', text: 'Page two.' }],
  })),
}));

describe('isPersonaPromptDocument', () => {
  it('accepts pdf and docx by name or type', () => {
    expect(isPersonaPromptDocument(new File(['x'], 'a.pdf', { type: 'application/pdf' }))).toBe(true);
    expect(
      isPersonaPromptDocument(
        new File(['x'], 'a.docx', {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      ),
    ).toBe(true);
    expect(isPersonaPromptDocument(new File(['x'], 'notes.txt', { type: 'text/plain' }))).toBe(false);
  });
});

describe('truncateDocumentText', () => {
  it('keeps short text and marks overflow', () => {
    expect(truncateDocumentText('hello', 20)).toBe('hello');
    expect(truncateDocumentText('abcdefghij', 4)).toBe('abcd\n\n[…]');
  });
});

describe('extractDocumentText', () => {
  it('joins PDF page text', async () => {
    const text = await extractDocumentText(new File(['%PDF'], 'brief.pdf', { type: 'application/pdf' }));
    expect(text).toBe('Page one.\n\nPage two.');
  });

  it('uses mammoth raw text for Word', async () => {
    const text = await extractDocumentText(
      new File(['pk'], 'brief.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    );
    expect(text).toBe('Word body\n\nSecond para');
  });
});
