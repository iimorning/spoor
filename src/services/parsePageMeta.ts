export type PageMeta = {
  title: string;
  snippet: string;
};

const TITLE_MAX = 120;
const SNIPPET_MAX = 280;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Decode a small set of HTML entities common in titles / meta tags. */
export function decodeBasicHtmlEntities(raw: string): string {
  return raw
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    });
}

export function truncateMetaText(text: string, maxLen: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen).trim();
}

function metaContent(html: string, propertyOrName: string): string {
  const key = escapeRegExp(propertyOrName);
  const rePropFirst = new RegExp(
    `<meta\\b[^>]*\\b(?:property|name)=["']${key}["'][^>]*\\bcontent=["']([^"']*)["'][^>]*>`,
    'i',
  );
  const reContentFirst = new RegExp(
    `<meta\\b[^>]*\\bcontent=["']([^"']*)["'][^>]*\\b(?:property|name)=["']${key}["'][^>]*>`,
    'i',
  );
  const a = rePropFirst.exec(html)?.[1];
  if (a != null && a.trim()) return a;
  const b = reContentFirst.exec(html)?.[1];
  return b?.trim() ? b : '';
}

/**
 * Extract title + description from HTML using OG tags, then document title / meta description.
 */
export function parsePageMeta(html: string): PageMeta {
  const ogTitle = metaContent(html, 'og:title');
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '';
  const title = truncateMetaText(decodeBasicHtmlEntities(ogTitle || titleTag), TITLE_MAX);

  const ogDesc = metaContent(html, 'og:description');
  const metaDesc = metaContent(html, 'description');
  const snippet = truncateMetaText(decodeBasicHtmlEntities(ogDesc || metaDesc), SNIPPET_MAX);

  return { title, snippet };
}

const OG_IMAGE_KEYS = ['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'] as const;

/**
 * First Open Graph / Twitter preview image URL from HTML (may be relative).
 */
export function parsePageOgImage(html: string): string {
  for (const key of OG_IMAGE_KEYS) {
    const raw = decodeBasicHtmlEntities(metaContent(html, key)).trim();
    if (raw) return raw;
  }
  return '';
}

/** Resolve a meta image against the page URL; skip data URIs and obvious site chrome. */
export function resolvePagePreviewImageUrl(pageUrl: string, raw: string): string {
  const t = raw.trim();
  if (!t || /^data:/i.test(t)) return '';
  let abs = '';
  try {
    abs = new URL(t, pageUrl).href;
  } catch {
    return '';
  }
  if (!/^https?:\/\//i.test(abs)) return '';
  if (/favicon|\.ico(\b|$)|apple-touch-icon|\/icons?\/|sprite/i.test(abs)) return '';
  return abs;
}
