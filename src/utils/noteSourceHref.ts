/** First http(s) URL on a trimmed line, or empty. */
export function asHttpUrl(raw: string | undefined): string {
  const s = (raw ?? '').trim();
  return /^https?:\/\//i.test(s) ? s : '';
}

function urlFromLine(line: string): string {
  const t = line.trim();
  const md = t.match(/^\[(https?:\/\/[^\]]+)\]\(\1\)$/i);
  if (md) return asHttpUrl(md[1]);
  return asHttpUrl(t);
}

/** Last non-empty line if it is a URL (plain or `[url](url)`). */
export function trailingHttpUrl(text: string): string {
  const lines = (text ?? '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? '';
    if (!line.trim()) continue;
    return urlFromLine(line);
  }
  return '';
}

export function resolveNoteSourceHref(node: { sourceUrl?: string; content?: string }): string {
  return asHttpUrl(node.sourceUrl) || trailingHttpUrl(node.content ?? '');
}

export function noteContentWithoutTrailingSourceUrl(content: string, href: string): string {
  const link = asHttpUrl(href);
  if (!link) return content;
  const trimmed = (content ?? '').replace(/[ \t]+$/g, '').replace(/\n+$/, '');
  const suffixes = [link, `[${link}](${link})`];
  for (const suf of suffixes) {
    if (trimmed === suf) return '';
    if (trimmed.endsWith(`\n${suf}`)) {
      return trimmed.slice(0, trimmed.length - suf.length - 1).replace(/\n+$/, '');
    }
  }
  return content;
}

export function sourceHostLabel(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return href;
  }
}
