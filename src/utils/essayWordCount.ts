/**
 * Visible body length for essay fullscreen.
 * Markdown chrome (images, fences, emphasis marks) is stripped first;
 * remaining non-whitespace characters are the 字数.
 */
export function essayPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_~>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function countEssayChars(markdown: string): number {
  return essayPlainText(markdown).replace(/\s/g, '').length;
}

export function sourceCardInBody(card: { inBody?: boolean }): boolean {
  return card.inBody !== false;
}

/** Whether a source card's segment text (or image src) appears in live editor markdown. */
export function isSourceSegmentInBody(segmentText: string, liveBody: string): boolean {
  const imageSrc = /!\[[^\]]*]\(([^)\s]+)\)/.exec(segmentText ?? '')?.[1];
  if (imageSrc) return liveBody.includes(imageSrc);
  const text = (segmentText ?? '').trim();
  return Boolean(text) && liveBody.includes(text);
}

export function essayBodyMarkdown(article: {
  content?: string;
  sourceCards?: Array<{ segmentText: string; inBody?: boolean }>;
  contentDrivesBody?: boolean;
}): string {
  if (article.contentDrivesBody) {
    return article.content ?? '';
  }
  const cards = article.sourceCards;
  if (cards && cards.length > 0) {
    const joined = cards
      .filter(sourceCardInBody)
      .map((s) => s.segmentText ?? '')
      .join('\n\n')
      .trim();
    if (joined) return joined;
  }
  return article.content ?? '';
}
