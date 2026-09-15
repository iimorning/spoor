import type { CanvasNode } from '../db';
import { db } from '../db';
import {
  DEFAULT_NODE_SIZE,
  findOpenCanvasPosition,
  type CanvasObstacle,
  type CanvasTransformLike,
} from '../utils/canvas';
import { stampNewCard } from '../utils/stampNewCard';

export async function spawnLinkedTranscriptNote(opts: {
  canvasId: string;
  sourceNode: CanvasNode;
  obstacles: CanvasObstacle[];
  transform: CanvasTransformLike;
  text: string;
}): Promise<string> {
  const { x, y } = findOpenCanvasPosition({
    transform: opts.transform,
    obstacles: opts.obstacles,
    size: DEFAULT_NODE_SIZE,
    preferBeside: opts.sourceNode,
  });
  const noteId = crypto.randomUUID();
  await db.transaction('rw', db.nodes, db.edges, async () => {
    await db.nodes.add(
      stampNewCard({
        id: noteId,
        canvasId: opts.canvasId,
        type: 'text',
        content: opts.text,
        x,
        y,
      }),
    );
    await db.edges.add({
      id: crypto.randomUUID(),
      canvasId: opts.canvasId,
      from: opts.sourceNode.id,
      to: noteId,
    });
  });
  return noteId;
}
