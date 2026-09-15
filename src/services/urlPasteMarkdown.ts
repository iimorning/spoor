/** Trimmed clipboard text that is exactly one http(s) URL. */
export function parseLoneHttpUrl(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  if (!/^https?:\/\/.+/i.test(trimmed)) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return trimmed;
  } catch {
    return null;
  }
}

export function isLoneHttpUrl(text: string): boolean {
  return parseLoneHttpUrl(text) !== null;
}

export function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '') || url;
  } catch {
    return url;
  }
}

export function buildUrlNoteMarkdown(input: {
  title: string;
  snippet?: string;
  url: string;
}): string {
  const title = (input.title || hostnameFromUrl(input.url) || input.url).replace(/\n/g, ' ').trim();
  const snippet = (input.snippet || '').trim();
  const link = input.url.trim();
  const parts = [`### ${title}`];
  if (snippet) parts.push('', snippet);
  if (link) parts.push('', `[${link}](${link})`);
  return parts.join('\n');
}
