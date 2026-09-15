import { db, type CanvasNode } from '../db';
import { DEFAULT_NODE_SIZE } from './canvas';
import { stampNewCard } from './stampNewCard';
import { stampWorkZoneScopeOnNewNodes } from './syncWorkZoneScopes';

/** Clipboard text that should become a canvas note (not empty, not only whitespace). */
export function normalizePastedCanvasText(raw: string): string | null {
  const text = raw.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').trim();
  return text.length > 0 ? text : null;
}

/**
 * Place a text note at `position` with the pasted body.
 * Work-zone scope follows the same center-in-room rule as toolbar / URL paste.
 */
export async function spawnNoteFromPastedText(options: {
  text: string;
  canvasId: string;
  position: { x: number; y: number };
}): Promise<string | null> {
  const content = normalizePastedCanvasText(options.text);
  if (!content) return null;

  const id = crypto.randomUUID();
  const [card] = await stampWorkZoneScopeOnNewNodes(
    [
      stampNewCard({
        id,
        canvasId: options.canvasId,
        type: 'text',
        content,
        x: options.position.x,
        y: options.position.y,
        width: DEFAULT_NODE_SIZE.width,
        height: DEFAULT_NODE_SIZE.height,
      }) as CanvasNode,
    ],
    options.canvasId,
  );
  await db.nodes.add(card);
  return id;
}
