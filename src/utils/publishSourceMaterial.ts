import type { CanvasNode } from '../db';
import { articleMediaUrl } from './articleMedia';
import {
  isAttachableImageContent,
  isImageDataUrl,
  MAX_DATA_URL_CHARS,
} from './canvasContextImages';

/** Keep huge data-URLs out of the LLM prompt; still inject them into the final article. */
const MAX_PROMPT_MEDIA_URL_CHARS = 2_000;

/** 1-based index in the multimodal `images` array actually sent with the request. */
export function outlineAttachedVisualLine(n: number): string {
  return (
    `Attached visual #${n} in this request is this card. ` +
    'Look at the image pixels to place it next to the matching text note.\n'
  );
}

export const OUTLINE_VISUAL_PIXELS_SKIPPED =
  'Media card (pixels not attached; use the caption only).\n';

/**
 * If some local images could not be attached, drop/renumber `Attached visual #N`
 * so it still matches the `images` array the model receives.
 */
export function remapOutlineAttachedVisuals(
  prompt: string,
  slots: Array<string | null>,
): { prompt: string; images: string[] } {
  const images: string[] = [];
  const newNs: Array<number | null> = slots.map((slot) => {
    if (!slot) return null;
    images.push(slot);
    return images.length;
  });
  let next = prompt;
  const tokens = slots.map((_, i) => `\0OUTLINE_VISUAL_SLOT_${i}\0`);
  for (let i = slots.length - 1; i >= 0; i--) {
    next = next.split(outlineAttachedVisualLine(i + 1)).join(tokens[i]!);
  }
  for (let i = 0; i < slots.length; i++) {
    const newN = newNs[i];
    const replacement = newN ? outlineAttachedVisualLine(newN) : OUTLINE_VISUAL_PIXELS_SKIPPED;
    next = next.split(tokens[i]!).join(replacement);
  }
  return { prompt: next, images };
}

export interface PublishMediaAsset {
  nodeId: string;
  /** Markdown that must appear in the finished article */
  articleMarkdown: string;
  /** Shorter / placeholder form for the model prompt when the real URL is huge */
  promptMarkdown: string;
  /** Local upload kept out of Markdown; converted to one Blob on article save. */
  localDataUrl?: string;
  articleMediaId?: string;
}

export interface PublishSourceCardMeta {
  nodeId: string;
  canvasId: string;
  /** 卡片类型，用于侧栏图标 */
  kind: string;
  /** 侧栏显示标题 */
  title: string;
  /**
   * The source card's verbatim text content. Used by the AI fidelity gate in
   * `generateArticleFromOutline` to enforce "do not rewrite card text".
   */
  markdown: string;
  /** Image/video preview in the outline list (data URL or http). */
  thumbnailSrc?: string;
}

function asHttpUrl(raw: string | undefined): string {
  const s = (raw || '').trim();
  return /^https?:\/\//i.test(s) ? s : '';
}

function escapeMdAlt(s: string): string {
  return s.replace(/[\[\]]/g, '').replace(/\s+/g, ' ').trim();
}

function isDataUrl(s: string): boolean {
  return /^data:/i.test(s.trim());
}

const EMBEDDED_DATA_IMAGE_RE =
  /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+(?=[^A-Za-z0-9+/=]|$)/gi;

/** Keep pixels out of the text prompt; they belong in multimodal image parts. */
export function stripEmbeddedImageDataUrls(text: string): string {
  if (!text) return text;
  return text.replace(EMBEDDED_DATA_IMAGE_RE, 'media://embedded-image');
}

/** 取卡片内容前若干字符作为侧栏标题；为空时回退到 description / 类型名 */
function deriveCardTitle(node: CanvasNode, fallback: string): string {
  const fromContent = (node.content || '').replace(/\s+/g, ' ').trim();
  if (fromContent && !isDataUrl(fromContent)) return fromContent.slice(0, 40);
  const fromDesc = (node.description || '').replace(/\s+/g, ' ').trim();
  if (fromDesc) return fromDesc.slice(0, 40);
  return fallback;
}

/** Build markdown for a selected image/video node to embed in a long-form article. */
export function mediaMarkdownFromNode(node: CanvasNode): PublishMediaAsset | null {
  if (node.type === 'image') {
    const src = (node.content || '').trim();
    if (!src) return null;
    if (!/^https?:\/\//i.test(src) && !src.startsWith('data:image/')) return null;
    const alt = escapeMdAlt(node.description || 'Image') || 'Image';
    const local = src.startsWith('data:image/');
    const articleMediaId = local ? `node-${node.id}` : undefined;
    const articleSrc = articleMediaId ? articleMediaUrl(articleMediaId) : src;
    const articleMarkdown = `![${alt}](${articleSrc})`;
    const source = asHttpUrl(node.sourceUrl);
    const withSource = source && source !== src
      ? `${articleMarkdown}\n\n[${source}](${source})`
      : articleMarkdown;
    const promptMarkdown =
      local || src.length > MAX_PROMPT_MEDIA_URL_CHARS
        ? `![${alt}](media://image/${node.id})`
        : withSource;
    return {
      nodeId: node.id,
      articleMarkdown: withSource,
      promptMarkdown,
      ...(local ? { localDataUrl: src, articleMediaId } : {}),
    };
  }

  if (node.type === 'video') {
    const content = (node.content || '').trim();
    const isLocalFile = content.startsWith('data:video/') || content.startsWith('data:audio/');
    const href = asHttpUrl(node.sourceUrl) || asHttpUrl(node.content);
    if (!href && !isLocalFile) return null;
    const title = escapeMdAlt(node.description || 'Video') || 'Video';
    if (!href && isLocalFile) {
      // Local uploaded video/audio: keep as a named placeholder; skip data: URLs in md
      const articleMarkdown = `*[${title}]*`;
      return {
        nodeId: node.id,
        articleMarkdown,
        promptMarkdown: `[Video: ${title}] (local upload — mention in prose; no public URL)`,
      };
    }
    if (!href) return null;
    const articleMarkdown = `[▶ ${title}](${href})`;
    return { nodeId: node.id, articleMarkdown, promptMarkdown: articleMarkdown };
  }

  return null;
}

export interface PublishSourceMaterial {
  /** Text + media descriptors sent to the model */
  promptContent: string;
  /** Canonical media markdown to guarantee in the final article */
  mediaAssets: PublishMediaAsset[];
  /** 选中卡片元数据，按选中顺序（用于回填 sourceCards） */
  cards: PublishSourceCardMeta[];
  /**
   * Image hrefs (data URL or http) in the same order as attached visual #N
   * in `promptContent`. Capped for the multimodal request.
   */
  visionImageHrefs: string[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The model sometimes echoes prompt-only `media://image/...` placeholders.
 * Replace them with the canonical article reference before missing-media
 * detection, otherwise the fallback appends a second image and leaves the
 * echoed placeholder as a broken image.
 */
export function normalizePublishMediaPlaceholders(
  text: string,
  mediaAssets: PublishMediaAsset[],
): string {
  let normalized = text;
  for (const asset of mediaAssets) {
    const placeholders = [
      ...asset.promptMarkdown.matchAll(/media:\/\/image\/[^)\s]+/g),
    ].map((match) => match[0]);
    if (placeholders.length === 0) continue;
    const canonicalUrl = asset.articleMarkdown.match(/!\[[^\]]*\]\(([^)\s]+)\)/)?.[1];
    if (!canonicalUrl) continue;
    for (const placeholder of new Set(placeholders)) {
      const imageMarkdown = new RegExp(
        `!\\[[^\\]\\n]*\\]\\(${escapeRegExp(placeholder)}\\)`,
        'g',
      );
      normalized = normalized.replace(imageMarkdown, asset.articleMarkdown);
      normalized = normalized.split(placeholder).join(canonicalUrl);
    }
  }
  return normalized;
}

/**
 * Assemble publish source material from selected canvas nodes.
 * Text/note/theme/ai → DOM or node text; image/video → markdown media blocks.
 * 每段素材以 `【cardId:xxx】` 标注，便于模型回填 segments。
 */
export function buildPublishSourceMaterial(
  selectedIds: string[],
  nodes: CanvasNode[],
  getText: (nodeId: string) => string,
  /** 用于把卡片类型翻译成侧栏标题回退值 */
  typeLabel?: (kind: string) => string,
  /** 来源画布 id（所有选中卡通常同属一画布） */
  canvasId?: string,
): PublishSourceMaterial {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const textParts: string[] = [];
  const mediaAssets: PublishMediaAsset[] = [];
  const cards: PublishSourceCardMeta[] = [];
  const visionImageHrefs: string[] = [];

  for (const id of selectedIds) {
    const node = byId.get(id);
    const kind = node?.type ?? 'card';
    const fallbackTitle = typeLabel ? typeLabel(kind) : kind;
    const cardCanvasId = node?.canvasId ?? canvasId ?? '';
    const fromDom = getText(id).trim();
    const fromNode = (node?.content || '').trim();
    const usableDom = fromDom && !isDataUrl(fromDom) ? fromDom : '';
    const usableNode = fromNode && !isDataUrl(fromNode) ? fromNode : '';

    if (!node) {
      const markdown = usableDom;
      cards.push({
        nodeId: id,
        canvasId: cardCanvasId,
        kind,
        title: markdown.slice(0, 40) || fallbackTitle,
        markdown,
      });
      if (markdown) textParts.push(`【cardId:${id}】\n${stripEmbeddedImageDataUrls(markdown)}`);
      continue;
    }

    const media = mediaMarkdownFromNode(node);
    if (media) {
      mediaAssets.push(media);
      const href = (node.content || '').trim();
      const thumbnailSrc =
        node.type === 'image' && isAttachableImageContent(href) ? href : undefined;
      let visualLine = '';
      if (
        node.type === 'image' &&
        thumbnailSrc &&
        !(isImageDataUrl(href) && href.length > MAX_DATA_URL_CHARS)
      ) {
        visionImageHrefs.push(href);
        visualLine = outlineAttachedVisualLine(visionImageHrefs.length);
      } else if (node.type === 'image' || node.type === 'video') {
        visualLine = OUTLINE_VISUAL_PIXELS_SKIPPED;
      }
      cards.push({
        nodeId: id,
        canvasId: cardCanvasId,
        kind,
        title: deriveCardTitle(node, fallbackTitle),
        markdown: media.promptMarkdown,
        ...(thumbnailSrc ? { thumbnailSrc } : {}),
      });
      textParts.push(
        `【cardId:${id}】\n${visualLine}Caption / markdown:\n${media.promptMarkdown}`,
      );
      continue;
    }

    const markdown = usableDom || usableNode;
    cards.push({
      nodeId: id,
      canvasId: cardCanvasId,
      kind,
      title: deriveCardTitle({ ...node, content: markdown || node.content }, fallbackTitle),
      markdown,
    });
    if (markdown) textParts.push(`【cardId:${id}】\n${stripEmbeddedImageDataUrls(markdown)}`);
  }

  const index = cards
    .map((c, i) => `${i + 1}. 【cardId:${c.nodeId}】 ${c.kind}${c.title ? ` ${c.title}` : ''}`)
    .join('\n');
  const body = textParts.join('\n\n');
  const promptContent = index
    ? `Cards (${cards.length}), in selection order:\n${index}${body ? `\n\n---\n\n${body}` : ''}`
    : body;

  return {
    promptContent,
    mediaAssets,
    cards,
    visionImageHrefs,
  };
}

/** If the model omitted any selected media URLs, append them under a section heading. */
export function ensurePublishMediaInBody(
  body: string,
  mediaAssets: PublishMediaAsset[],
  relatedHeading: string,
): string {
  if (mediaAssets.length === 0) return body;
  const missing = mediaAssets.filter((asset) => {
    const urls = [...asset.articleMarkdown.matchAll(/\(([^)\s]+)\)/g)].map((m) => m[1]!);
    if (urls.length === 0) {
      // Local / prose-only assets: treat as present if title fragment appears
      const title = asset.articleMarkdown.replace(/[*\[\]]/g, '').trim();
      return title.length > 0 && !body.includes(title);
    }
    return urls.some((u) => u && !body.includes(u));
  });
  if (missing.length === 0) return body;
  const block = missing.map((m) => m.articleMarkdown).join('\n\n');
  const heading = relatedHeading.replace(/\s+/g, ' ').trim() || 'Related media';
  return `${body.trim()}\n\n## ${heading}\n\n${block}\n`;
}
