import mammoth from 'mammoth';
import { parsePdfBook } from './parsePdfBook';

export const PERSONA_PROMPT_DOC_MAX_BYTES = 15 * 1024 * 1024;
export const PERSONA_PROMPT_DOC_MAX_CHARS = 24_000;

export function isPersonaPromptDocument(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith('.pdf') ||
    name.endsWith('.docx') ||
    file.type === 'application/pdf' ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
}

export function truncateDocumentText(text: string, max = PERSONA_PROMPT_DOC_MAX_CHARS): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max).trimEnd()}\n\n[…]`;
}

export async function extractDocumentText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  const buffer = await file.arrayBuffer();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    const book = await parsePdfBook(buffer, file.name);
    return book.units
      .map((unit) => unit.text.trim())
      .filter(Boolean)
      .join('\n\n')
      .trim();
  }
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return (result.value ?? '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
