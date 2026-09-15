/**
 * Ordinary notes are plain text. Legacy content may still contain HTML
 * islands (`<p>`, `<br>`) from when preview used rehype-raw. Flatten those
 * so view and edit show the same visible words.
 *
 * Pure text / markdown source without tags is left untouched.
 */

/** Opening/closing tags like `<p>` / `<br/>` — not comparisons such as `1 < 2`. */
const HTML_TAG_RE = /<\/?[a-z][a-z0-9]*\b[^>]*>/i;

export function noteLooksLikeHtml(raw: string): boolean {
  return HTML_TAG_RE.test(raw);
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function htmlFragmentToPlainText(html: string): string {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const withBreaks = withoutNoise
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre|section)[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeXmlEntities(withBreaks)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^\n+|\n+$/g, '');
}

export function noteContentForEditor(raw: string | undefined | null): string {
  if (!raw) return '';
  if (!HTML_TAG_RE.test(raw)) return raw;
  return htmlFragmentToPlainText(raw);
}
