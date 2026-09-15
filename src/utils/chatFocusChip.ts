import type { CanvasNode } from '../db';
import { isAttachableImageContent, isImageDataUrl } from './canvasContextImages';

export type ChatFocusChip = {
  id: string;
  title: string;
  thumbnailSrc?: string;
};

const TITLE_MAX = 16;

function stripMd(text: string): string {
  return text
    .replace(/[#>*`\[\]()!|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function visibleText(node: CanvasNode): string {
  if (node.type === 'image' || node.type === 'video') {
    return (node.description ?? '').trim();
  }
  const content = (node.content ?? '').trim();
  if (!content || content.startsWith('data:')) return '';
  return content;
}

function chipThumbnail(node: CanvasNode): string | undefined {
  if (node.type !== 'image') return undefined;
  const href = (node.content ?? '').trim();
  if (!isAttachableImageContent(href)) return undefined;
  if (isImageDataUrl(href) && href.length > 400_000) return undefined;
  return href;
}

export function chatFocusChipFromNode(node: CanvasNode, fallbackTitle: string): ChatFocusChip {
  const raw =
    (node.description ?? '').trim() ||
    (node.themeTag ?? '').trim() ||
    stripMd(visibleText(node)) ||
    fallbackTitle;
  const title = raw.length > TITLE_MAX ? `${raw.slice(0, TITLE_MAX - 1)}…` : raw;
  return { id: node.id, title, thumbnailSrc: chipThumbnail(node) };
}
