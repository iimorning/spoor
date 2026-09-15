import { db } from '../db';
import type { CanvasChatMessage, CanvasNode } from '../db';
import { findAdjacentCanvasPosition, type CanvasObstacle } from './canvas';
import { defaultExcerptNoteSize } from './agentWorkZone';
import { stampNewCard } from './stampNewCard';
import {
  formatSearchHitCanvasMarkdown,
  isChatVisibleSearchHit,
  type AskSearchHit,
} from './askSearchHits';
import { resolveMediaPlayback } from './mediaEmbed';
import {
  SOURCE_CARD_HEIGHT,
  SOURCE_CARD_PREVIEW_EXTRA,
  SOURCE_CARD_WIDTH,
} from '../services/spawnWebSearchNoteCards';

export type ExcerptKind = 'selection' | 'full_message' | 'thinking';

export type ExcerptToCanvasInput = {
  canvasId: string;
  agentNodeId: string;
  threadId: string;
  message: CanvasChatMessage;
  text: string;
  kind: ExcerptKind;
  nodes: CanvasNode[];
  obstacles: CanvasObstacle[];
  /** When set (drag-drop), place the card here instead of beside the persona. */
  position?: { x: number; y: number };
};

export const CHAT_EXCERPT_DRAG_PREFIX = 'spoor-chat-excerpt:';

export type ChatExcerptDragPayload = {
  canvasId: string;
  agentNodeId: string;
  threadId: string;
  messageId: string;
  text: string;
  role: 'user' | 'assistant';
};

export function writeChatExcerptDrag(dt: DataTransfer, payload: ChatExcerptDragPayload): void {
  dt.setData('text/plain', `${CHAT_EXCERPT_DRAG_PREFIX}${JSON.stringify(payload)}`);
  dt.effectAllowed = 'copy';
}

export function readChatExcerptDrag(dt: DataTransfer | null | undefined): ChatExcerptDragPayload | null {
  const raw = dt?.getData('text/plain') ?? '';
  if (!raw.startsWith(CHAT_EXCERPT_DRAG_PREFIX)) return null;
  try {
    const parsed = JSON.parse(raw.slice(CHAT_EXCERPT_DRAG_PREFIX.length)) as ChatExcerptDragPayload;
    if (!parsed?.text?.trim() || !parsed.canvasId || !parsed.agentNodeId || !parsed.threadId || !parsed.messageId) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function excerptToCanvas({
  canvasId,
  agentNodeId,
  threadId,
  message,
  text,
  kind,
  nodes,
  obstacles,
  position,
}: ExcerptToCanvasInput): Promise<string> {
  const agent = nodes.find((n) => n.id === agentNodeId);
  const trimmed = text.trim();
  if (!trimmed || !agent) throw new Error('excerpt_empty');

  const size = defaultExcerptNoteSize();
  const pos = position ?? findAdjacentCanvasPosition({
    obstacles,
    anchor: agent,
    size,
  });

  const nodeId = crypto.randomUUID();
  const isFullAi = kind === 'full_message' && message.role === 'assistant';

  await db.nodes.add(
    stampNewCard({
      id: nodeId,
      canvasId,
      type: isFullAi ? 'ai' : 'note',
      content: trimmed,
      ...(isFullAi ? { userTurn: undefined } : {}),
      x: pos.x,
      y: pos.y,
      width: size.width,
      height: size.height,
      contextScopeAgentId: agentNodeId,
      sourceThreadId: threadId,
      sourceMessageId: message.id,
    }),
  );

  const thread = await db.canvasPersonaThreads.get(threadId);
  if (thread && kind !== 'thinking') {
    const messages = thread.messages.map((m) =>
      m.id === message.id ? { ...m, excerptedNodeId: nodeId } : m,
    );
    await db.canvasPersonaThreads.put({ ...thread, messages, updatedAt: Date.now() });
  }

  return nodeId;
}

export type ExcerptSearchHitInput = {
  canvasId: string;
  agentNodeId: string;
  threadId: string;
  message: CanvasChatMessage;
  hit: AskSearchHit;
  nodes: CanvasNode[];
  obstacles: CanvasObstacle[];
  position?: { x: number; y: number };
};

/** Place one side-panel search hit on the canvas (no auto edge). */
export async function excerptSearchHitToCanvas({
  canvasId,
  agentNodeId,
  threadId,
  message,
  hit,
  nodes,
  obstacles,
  position,
}: ExcerptSearchHitInput): Promise<string> {
  const agent = nodes.find((n) => n.id === agentNodeId);
  if (!agent || !isChatVisibleSearchHit(hit)) throw new Error('excerpt_empty');

  const preview = (hit.imageUrl || '').trim();
  const hasPreview = /^https?:\/\//i.test(preview);
  const size = {
    width: SOURCE_CARD_WIDTH,
    height:
      hit.kind === 'webpage' && hasPreview
        ? SOURCE_CARD_HEIGHT + SOURCE_CARD_PREVIEW_EXTRA
        : SOURCE_CARD_HEIGHT,
  };
  const pos =
    position ??
    findAdjacentCanvasPosition({
      obstacles,
      anchor: agent,
      size,
    });
  const nodeId = crypto.randomUUID();
  const provenance = {
    contextScopeAgentId: agentNodeId,
    sourceThreadId: threadId,
    sourceMessageId: message.id,
  };

  if (hit.kind === 'image' && preview) {
    await db.nodes.add(
      stampNewCard({
        id: nodeId,
        canvasId,
        type: 'image',
        content: preview,
        description: hit.title.replace(/\s+/g, ' ').trim() || undefined,
        sourceUrl: (hit.link || preview).trim() || undefined,
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: SOURCE_CARD_HEIGHT,
        ...provenance,
      }),
    );
    return nodeId;
  }

  if (hit.kind === 'video' || hit.kind === 'podcast') {
    const page = (hit.link || '').trim();
    const playback = resolveMediaPlayback({ kind: hit.kind, link: hit.link });
    const title = hit.title.replace(/\s+/g, ' ').trim();
    const snippet = hit.snippet.replace(/\s+/g, ' ').trim();
    await db.nodes.add(
      stampNewCard({
        id: nodeId,
        canvasId,
        type: 'video',
        content: playback.mode === 'none' ? page : playback.src,
        description: [title, snippet].filter(Boolean).join('\n\n') || undefined,
        sourceUrl: page || undefined,
        fileType: playback.mode === 'none' ? undefined : playback.mode,
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: SOURCE_CARD_HEIGHT,
        ...provenance,
      }),
    );
    return nodeId;
  }

  await db.nodes.add(
    stampNewCard({
      id: nodeId,
      canvasId,
      type: 'text',
      content: formatSearchHitCanvasMarkdown(hit),
      x: pos.x,
      y: pos.y,
      width: size.width,
      height: size.height,
      layout: 2,
      sourceUrl: (hit.link || '').trim() || undefined,
      previewImageUrl: hasPreview ? preview : undefined,
      ...provenance,
    }),
  );
  return nodeId;
}

export function formatExcerptSourceLabel(
  agentName: string,
  message: CanvasChatMessage,
  locale?: string,
): string {
  const d = new Date(message.createdAt);
  const dateStr = d.toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${agentName} · ${dateStr}`;
}
