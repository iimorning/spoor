/** Serialized into CanvasNode.content for type="essay". */

export const ESSAY_CONTENT_PREFIX = 'spoor-essay:v1:';

export interface EssayPayload {
  articleId: string;
}

export const ESSAY_NODE_SIZE = { width: 380, height: 520 };

export function encodeEssayContent(payload: EssayPayload): string {
  return ESSAY_CONTENT_PREFIX + JSON.stringify(payload);
}

export function tryParseEssayContent(content: string | undefined | null): EssayPayload | null {
  if (!content || !content.startsWith(ESSAY_CONTENT_PREFIX)) return null;
  try {
    const raw = JSON.parse(content.slice(ESSAY_CONTENT_PREFIX.length)) as EssayPayload;
    if (!raw || typeof raw.articleId !== 'string' || !raw.articleId.trim()) return null;
    return { articleId: raw.articleId.trim() };
  } catch {
    return null;
  }
}
