import type { Article, ArticleMedia } from '../db';
import {
  extensionForMime,
  fetchUrlToBlob,
  uploadCanvasMedia,
} from '../services/canvasMediaStorage';

export const ARTICLE_MEDIA_SCHEME = 'spoor-article-media:';

const DATA_IMAGE_RE =
  /data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z\d+/=\r\n]+/gi;

export function articleMediaUrl(id: string): string {
  return `${ARTICLE_MEDIA_SCHEME}${encodeURIComponent(id)}`;
}

export function articleMediaIdFromUrl(url: string | undefined): string | null {
  if (!url?.startsWith(ARTICLE_MEDIA_SCHEME)) return null;
  try {
    return decodeURIComponent(url.slice(ARTICLE_MEDIA_SCHEME.length));
  } catch {
    return null;
  }
}

export function articleHasEmbeddedDataImages(article: Article): boolean {
  if (DATA_IMAGE_RE.test(article.content)) {
    DATA_IMAGE_RE.lastIndex = 0;
    return true;
  }
  DATA_IMAGE_RE.lastIndex = 0;
  const found = (article.sourceCards ?? []).some((card) => DATA_IMAGE_RE.test(card.segmentText));
  DATA_IMAGE_RE.lastIndex = 0;
  return found;
}

export function articleHasLegacyMedia(article: Article): boolean {
  if (articleHasEmbeddedDataImages(article)) return true;
  if (article.content.includes('media://image/')) return true;
  return (article.sourceCards ?? []).some((card) =>
    card.segmentText.includes('media://image/'),
  );
}

function normalizeStoredMediaPlaceholders(article: Article): Article {
  const normalize = (text: string) => {
    let next = text;
    for (const media of article.media ?? []) {
      if (!media.sourceNodeId) continue;
      const placeholder = `media://image/${media.sourceNodeId}`;
      if (!next.includes(placeholder)) continue;
      const canonical = articleMediaUrl(media.id);
      const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const imageMarkdown = new RegExp(`!\\[[^\\]\\n]*\\]\\(${escaped}\\)`, 'g');
      // The old fallback may already have appended the canonical image. In
      // that case remove the broken duplicate instead of creating two valid
      // copies.
      next = next.includes(canonical)
        ? next.replace(imageMarkdown, '')
        : next.replaceAll(placeholder, canonical);
      next = next.replaceAll(placeholder, canonical);
    }
    // Some articles were generated before media metadata existed. Their
    // prompt-only placeholders can never resolve, so remove the broken image
    // markup instead of leaving the article in a perpetual migration loop.
    next = next
      .replace(/!\[[^\]\n]*\]\(media:\/\/image\/[^)\s]+\)/g, '')
      .replace(/media:\/\/image\/[^)\s]+/g, '');
    return next.replace(/\n{3,}/g, '\n\n').trim();
  };
  return {
    ...article,
    content: normalize(article.content),
    sourceCards: article.sourceCards?.map((card) => ({
      ...card,
      segmentText: normalize(card.segmentText),
    })),
  };
}

export async function dataImageUrlToBlob(dataUrl: string): Promise<Blob> {
  // Browsers decode data URLs off the React render path. Keep a manual fallback
  // for test environments without data-URL fetch support.
  try {
    const response = await fetch(dataUrl);
    if (response.ok) return await response.blob();
  } catch {
    // fall through
  }
  const match = /^data:(image\/[a-z\d+.-]+);base64,([\s\S]+)$/i.exec(dataUrl);
  if (!match) throw new Error('invalid_data_image');
  const binary = atob(match[2].replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: match[1] });
}

export async function blobToDataImageUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunks: string[] = [];
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
  }
  return `data:${blob.type || 'image/png'};base64,${btoa(chunks.join(''))}`;
}

/**
 * One-time migration for legacy articles that embedded multi-megabyte Base64
 * strings in both content and sourceCards.
 */
export async function extractEmbeddedArticleMedia(article: Article): Promise<Article> {
  const normalizedArticle = normalizeStoredMediaPlaceholders(article);
  const urls: string[] = [];
  const seen = new Set<string>();
  const collect = (text: string) => {
    DATA_IMAGE_RE.lastIndex = 0;
    for (const match of text.matchAll(DATA_IMAGE_RE)) {
      const url = match[0];
      if (!seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
    }
    DATA_IMAGE_RE.lastIndex = 0;
  };
  collect(normalizedArticle.content);
  for (const card of normalizedArticle.sourceCards ?? []) collect(card.segmentText);
  if (urls.length === 0) return normalizedArticle;

  const existing = normalizedArticle.media ?? [];
  const replacements = new Map<string, string>();
  const added = await Promise.all(
    urls.map(async (dataUrl, index): Promise<ArticleMedia> => {
      const id = `legacy-${existing.length + index}`;
      replacements.set(dataUrl, articleMediaUrl(id));
      const blob = await dataImageUrlToBlob(dataUrl);
      return { id, mimeType: blob.type || 'image/png', blob };
    }),
  );
  const replace = (text: string) => {
    DATA_IMAGE_RE.lastIndex = 0;
    const next = text.replace(DATA_IMAGE_RE, (url) => replacements.get(url) ?? url);
    DATA_IMAGE_RE.lastIndex = 0;
    return next;
  };

  return {
    ...normalizedArticle,
    content: replace(normalizedArticle.content),
    sourceCards: normalizedArticle.sourceCards?.map((card) => ({
      ...card,
      segmentText: replace(card.segmentText),
    })),
    media: [...existing, ...added],
  };
}

export async function createArticleMedia(
  id: string,
  dataUrl: string,
  sourceNodeId?: string,
): Promise<ArticleMedia> {
  const blob = await dataImageUrlToBlob(dataUrl);
  return {
    id,
    sourceNodeId,
    mimeType: blob.type || 'image/png',
    blob,
  };
}

type JsonArticleMedia = Omit<ArticleMedia, 'blob'> & { url?: string; /** legacy cloud rows */ dataUrl?: string };
type JsonArticle = Omit<Article, 'media'> & { media?: JsonArticleMedia[] };

export type ArticleCloudPrep = {
  cloud: JsonArticle;
  /** Persist cloudStorageUrl on local ArticleMedia after a successful upload. */
  localMediaPatches?: Array<{ mediaId: string; cloudStorageUrl: string }>;
};

/** Convert Blobs to Supabase Storage URLs at the cloud JSON boundary. */
export async function articleForCloud(article: Article, userId: string): Promise<ArticleCloudPrep> {
  if (!article.media?.length) {
    const { media: _media, ...plain } = article;
    return { cloud: plain };
  }

  const localMediaPatches: Array<{ mediaId: string; cloudStorageUrl: string }> = [];
  const media = await Promise.all(
    article.media.map(async ({ blob, cloudStorageUrl, ...item }) => {
      if (cloudStorageUrl?.trim()) {
        return { ...item, cloudStorageUrl, url: cloudStorageUrl.trim() };
      }
      const url = await uploadCanvasMedia(
        userId,
        `${userId}/articles/${article.id}/${item.id}.${extensionForMime(blob.type)}`,
        blob,
      );
      localMediaPatches.push({ mediaId: item.id, cloudStorageUrl: url });
      return { ...item, url };
    }),
  );

  return {
    cloud: { ...article, media },
    localMediaPatches: localMediaPatches.length > 0 ? localMediaPatches : undefined,
  };
}

/** Restore cloud JSON media to efficient local Blobs. Supports legacy dataUrl rows. */
export async function articleFromCloud(raw: unknown): Promise<Article> {
  const article = raw as JsonArticle;
  if (!article.media?.length) {
    const { media: _media, ...plain } = article;
    return plain;
  }
  return {
    ...article,
    media: await Promise.all(
      article.media.map(async ({ dataUrl, url, ...media }) => {
        if (url?.trim()) {
          return { ...media, blob: await fetchUrlToBlob(url.trim()) };
        }
        if (dataUrl?.trim()) {
          return { ...media, blob: await dataImageUrlToBlob(dataUrl.trim()) };
        }
        throw new Error('article_media_missing_payload');
      }),
    ),
  };
}
