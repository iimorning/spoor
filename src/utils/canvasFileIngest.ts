import { db, type CanvasNode } from '../db';
import { DEFAULT_NODE_SIZE } from './canvas';
import { scopeIngestedNodesToPersona } from './chatPanelFileUpload';
import { processFileToNode } from './file';
import { stampNewCard } from './stampNewCard';
import { stampWorkZoneScopeOnNewNodes } from './syncWorkZoneScopes';

export const BATCH_FILE_GAP = 28;
/** Columns for a multi-file drop / upload grid. */
export const BATCH_FILE_COLS = 3;

/** Spread batch uploads into a readable grid instead of stacking 20px apart. */
export function batchFileDropPosition(
  origin: { x: number; y: number },
  index: number,
  cols = BATCH_FILE_COLS,
): { x: number; y: number } {
  const n = Math.max(1, cols);
  const col = index % n;
  const row = Math.floor(index / n);
  return {
    x: origin.x + col * (DEFAULT_NODE_SIZE.width + BATCH_FILE_GAP),
    y: origin.y + row * (DEFAULT_NODE_SIZE.height + BATCH_FILE_GAP),
  };
}

export type IngestFileFailure = { name: string; message: string };

/**
 * Process one or many files into canvas nodes at a grid originating at `origin`.
 * Nodes are written in one transaction so live queries only refresh once.
 */
export async function ingestFilesToCanvas(options: {
  canvasId: string;
  files: ArrayLike<File>;
  origin: { x: number; y: number };
  /** When set (chat panel uploads), stamp every new card into this persona's room. */
  contextScopeAgentId?: string;
}): Promise<{
  addedIds: string[];
  /** Ids of nodes that came out of `processFileToNode` as type === 'book'. Used
   *  by the caller to auto-link uploaded books to the canvas's Ask card. */
  addedBookIds: string[];
  failures: IngestFileFailure[];
}> {
  const files = Array.from(options.files);
  const rows: CanvasNode[] = [];
  const failures: IngestFileFailure[] = [];

  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    try {
      const data = await processFileToNode(file);
      const pos = batchFileDropPosition(options.origin, index);
      rows.push(stampNewCard({
        id: crypto.randomUUID(),
        canvasId: options.canvasId,
        ...data,
        ...pos,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to process file:', file.name, err);
      failures.push({ name: file.name, message });
    }
  }

  if (rows.length > 0) {
    let scoped = await stampWorkZoneScopeOnNewNodes(rows, options.canvasId);
    if (options.contextScopeAgentId) {
      scoped = scopeIngestedNodesToPersona(scoped, options.contextScopeAgentId);
    }
    await db.transaction('rw', db.nodes, async () => {
      await db.nodes.bulkAdd(scoped);
    });
  }

  const addedIds = rows.map((r) => r.id);
  const addedBookIds = rows.filter((r) => r.type === 'book').map((r) => r.id);
  return { addedIds, addedBookIds, failures };
}
