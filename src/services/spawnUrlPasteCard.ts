import { db, type CanvasNode } from '../db';
import { stampNewCard } from '../utils/stampNewCard';
import { stampWorkZoneScopeOnNewNodes } from '../utils/syncWorkZoneScopes';
import { resolveMediaPlayback } from '../utils/mediaEmbed';
import { SOURCE_CARD_HEIGHT, SOURCE_CARD_WIDTH } from './spawnWebSearchNoteCards';
import { fetchPageMeta } from './fetchPageMeta';
import { buildUrlNoteMarkdown, hostnameFromUrl } from './urlPasteMarkdown';

export {
  buildUrlNoteMarkdown,
  hostnameFromUrl,
  parseLoneHttpUrl,
  isLoneHttpUrl,
} from './urlPasteMarkdown';

export type SpawnUrlPasteResult = {
  nodeId: string;
  kind: 'video' | 'note';
};

/** Route paste: embeddable YT/Bili → video; everything else → note. */
export function decidePastedUrlCardKind(url: string): 'video' | 'note' {
  const playback = resolveMediaPlayback({ kind: 'video', link: url });
  return playback.mode === 'iframe' ? 'video' : 'note';
}

/**
 * Create a canvas card from a pasted http(s) URL at the given position.
 * Video embeds (YouTube / Bilibili) become `video` nodes; other URLs become compact text notes.
 */
export async function spawnCardFromPastedUrl(options: {
  url: string;
  canvasId: string;
  position: { x: number; y: number };
}): Promise<SpawnUrlPasteResult> {
  const url = options.url.trim();
  const id = crypto.randomUUID();
  const hostLabel = hostnameFromUrl(url);
  const playback = resolveMediaPlayback({ kind: 'video', link: url });

  if (playback.mode === 'iframe') {
    const [card] = await stampWorkZoneScopeOnNewNodes(
      [
        stampNewCard({
          id,
          canvasId: options.canvasId,
          type: 'video',
          content: playback.src,
          description: hostLabel || 'Video',
          sourceUrl: url,
          fileType: 'iframe',
          x: options.position.x,
          y: options.position.y,
          width: SOURCE_CARD_WIDTH,
          height: SOURCE_CARD_HEIGHT,
        }) as CanvasNode,
      ],
      options.canvasId,
    );
    await db.nodes.add(card);
    return { nodeId: id, kind: 'video' };
  }

  const title = hostLabel || url;
  const [card] = await stampWorkZoneScopeOnNewNodes(
    [
      stampNewCard({
        id,
        canvasId: options.canvasId,
        type: 'text',
        content: buildUrlNoteMarkdown({ title, snippet: '', url }),
        description: title,
        sourceUrl: url,
        x: options.position.x,
        y: options.position.y,
        width: SOURCE_CARD_WIDTH,
        height: SOURCE_CARD_HEIGHT,
        layout: 2,
      }) as CanvasNode,
    ],
    options.canvasId,
  );
  await db.nodes.add(card);
  return { nodeId: id, kind: 'note' };
}

/**
 * Fetch page HTML and refresh the note's title / snippet.
 * Failures are swallowed so the placeholder card remains.
 */
export async function enrichUrlNoteFromPage(nodeId: string, url: string): Promise<void> {
  try {
    const meta = await fetchPageMeta(url);
    const title = meta.title.trim() || hostnameFromUrl(url) || url;
    const snippet = meta.snippet.trim();
    await db.nodes.update(nodeId, {
      content: buildUrlNoteMarkdown({ title, snippet, url }),
      description: title,
    });
  } catch (err) {
    console.warn('[Spoor] enrichUrlNoteFromPage failed', err);
  }
}
