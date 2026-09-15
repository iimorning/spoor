import type { EssayChatAttachmentMeta } from '../db';
import { materializeImageDataUrls } from './canvasContextImages';
import {
  extractDocumentText,
  isPersonaPromptDocument,
  truncateDocumentText,
} from './extractDocumentText';
import { readFileAsDataURL } from './file';

export interface EssayChatAttachmentPayload {
  attachments: EssayChatAttachmentMeta[];
  imageDataUrls: string[];
  attachmentContext: string;
  failures: { name: string; error: string }[];
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

function isTextLikeFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith('.txt') ||
    name.endsWith('.md') ||
    file.type === 'text/plain' ||
    file.type === 'text/markdown'
  );
}

function isEpubFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith('.epub') ||
    file.type === 'application/epub+zip' ||
    file.type === 'application/epub'
  );
}

async function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

async function extractEpubText(file: File): Promise<string> {
  const { parseEpubBook } = await import('./parseEpubBook');
  const book = await parseEpubBook(await file.arrayBuffer(), file.name);
  return book.units
    .map((unit) => unit.text.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

export async function prepareEssayChatAttachments(
  files: File[],
): Promise<EssayChatAttachmentPayload> {
  const attachments: EssayChatAttachmentMeta[] = [];
  const rawImageDataUrls: string[] = [];
  const docBlocks: string[] = [];
  const failures: { name: string; error: string }[] = [];

  for (const file of files) {
    try {
      if (isImageFile(file)) {
        const dataUrl = await readFileAsDataURL(file);
        rawImageDataUrls.push(dataUrl);
        attachments.push({ name: file.name, kind: 'image', previewUrl: dataUrl });
        continue;
      }

      let text = '';
      if (isTextLikeFile(file)) {
        text = truncateDocumentText(await readTextFile(file));
      } else if (isPersonaPromptDocument(file)) {
        text = truncateDocumentText(await extractDocumentText(file));
      } else if (isEpubFile(file)) {
        text = truncateDocumentText(await extractEpubText(file));
      } else {
        throw new Error(`Unsupported file type: ${file.type || file.name}`);
      }

      if (!text.trim()) {
        throw new Error('Empty document');
      }

      docBlocks.push(`### ${file.name}\n\n${text}`);
      attachments.push({ name: file.name, kind: 'document' });
    } catch (err) {
      failures.push({
        name: file.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const imageDataUrls =
    rawImageDataUrls.length > 0 ? await materializeImageDataUrls(rawImageDataUrls) : [];

  return {
    attachments,
    imageDataUrls,
    attachmentContext: docBlocks.join('\n\n'),
    failures,
  };
}
