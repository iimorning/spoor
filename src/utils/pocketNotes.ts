import { db, type CanvasNode } from '../db';
import {
  DEFAULT_NODE_SIZE,
  findOpenCanvasPosition,
  type CanvasObstacle,
  type CanvasTransformLike,
} from './canvas';
import { noteContentForEditor } from './noteContentForEditor';
import { stampNewCard } from './stampNewCard';
import { stampWorkZoneScopeOnNewNodes } from './syncWorkZoneScopes';

/** Reserved canvas id for unplaced capture notes. Not listed in history. */
export const POCKET_CANVAS_ID = '__pocket__';

const POCKET_TITLE_MAX = 48;

export function isPocketCanvasId(id?: string | null): boolean {
  return id === POCKET_CANVAS_ID;
}

export function isPocketNode(node: Pick<CanvasNode, 'canvasId'>): boolean {
  return node.canvasId === POCKET_CANVAS_ID;
}

export function pocketNoteTitle(content: string | undefined | null): string {
  const line = noteContentForEditor(content)
    .split('\n')
    .map((part) => part.trim())
    .find(Boolean);
  if (!line) return '';
  if (line.length <= POCKET_TITLE_MAX) return line;
  return `${line.slice(0, POCKET_TITLE_MAX)}…`;
}

export function pocketNotePreview(content: string | undefined | null): string {
  return noteContentForEditor(content).trim();
}

export function sortPocketNotes(nodes: CanvasNode[]): CanvasNode[] {
  return [...nodes].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || a.id.localeCompare(b.id));
}

/** Today → time only; older notes → locale date, with year when needed, plus time. */
export function formatPocketTime(ms: number | undefined, locale: string, now = new Date()): string {
  if (!ms) return '';
  const date = new Date(ms);
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const time = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return time;
  const sameYear = date.getFullYear() === now.getFullYear();
  const dateStr = date.toLocaleDateString(
    locale,
    sameYear
      ? { month: 'short', day: 'numeric' }
      : { year: 'numeric', month: 'short', day: 'numeric' },
  );
  return `${dateStr} ${time}`;
}

function isPocketNoteType(type: string | undefined): boolean {
  return type === 'note' || type === 'text';
}

export async function listPocketNotes(): Promise<CanvasNode[]> {
  const rows = await db.nodes.where('canvasId').equals(POCKET_CANVAS_ID).toArray();
  return sortPocketNotes(rows.filter((node) => isPocketNoteType(node.type)));
}

export async function createPocketNote(content = ''): Promise<string> {
  const id = crypto.randomUUID();
  await db.nodes.add(
    stampNewCard({
      id,
      canvasId: POCKET_CANVAS_ID,
      type: 'note',
      content,
      x: 0,
      y: 0,
    }),
  );
  return id;
}

export async function updatePocketNoteContent(id: string, content: string): Promise<void> {
  const node = await db.nodes.get(id);
  if (!node || !isPocketNode(node) || !isPocketNoteType(node.type)) return;
  await db.nodes.update(id, { content });
}

export async function deletePocketNote(id: string): Promise<void> {
  const node = await db.nodes.get(id);
  if (!node || !isPocketNode(node)) return;
  await db.nodes.delete(id);
}

export async function discardEmptyPocketNotes(exceptId?: string): Promise<void> {
  const rows = await listPocketNotes();
  const doomed = rows.filter(
    (node) => node.id !== exceptId && !pocketNotePreview(node.content),
  );
  if (doomed.length === 0) return;
  await db.nodes.bulkDelete(doomed.map((node) => node.id));
}

export async function placePocketNoteOnCanvas(opts: {
  id: string;
  canvasId: string;
  transform: CanvasTransformLike;
  obstacles: CanvasObstacle[];
}): Promise<boolean> {
  if (isPocketCanvasId(opts.canvasId)) return false;
  const node = await db.nodes.get(opts.id);
  if (!node || !isPocketNode(node) || !isPocketNoteType(node.type)) return false;
  if (!pocketNotePreview(node.content)) return false;
  const { x, y } = findOpenCanvasPosition({
    transform: opts.transform,
    obstacles: opts.obstacles,
    size: DEFAULT_NODE_SIZE,
  });
  const [placed] = await stampWorkZoneScopeOnNewNodes(
    [{ ...node, canvasId: opts.canvasId, x, y }],
    opts.canvasId,
  );
  await db.nodes.update(opts.id, {
    canvasId: opts.canvasId,
    x,
    y,
    contextScopeAgentId: placed.contextScopeAgentId,
  });
  return true;
}
