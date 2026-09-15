import { ARTICLE_MEDIA_SCHEME } from './articleMedia';

/** Allow raster data URLs and article media scheme; reject executable schemes. */
export function essayUrlTransform(url: string): string {
  const value = url.trim();
  if (/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i.test(value)) return value;
  if (value.startsWith(ARTICLE_MEDIA_SCHEME)) return value;
  if (/^(?:https?:|mailto:|tel:)/i.test(value)) return value;
  // Keep ordinary relative/hash URLs, but reject every other explicit scheme.
  if (!/^[a-z][a-z\d+.-]*:/i.test(value)) return value;
  return '';
}
