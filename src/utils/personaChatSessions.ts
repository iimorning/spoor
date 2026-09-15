import { db, type CanvasChatMessage, type CanvasChatSession } from '../db';
import {
  buildChatSession,
  findChatSession,
  prependChatArchive,
  removeChatSession,
} from './chatSessionArchive';

export function findPersonaChatSession(
  archive: CanvasChatSession[] | undefined,
  sessionId: string,
): CanvasChatSession | undefined {
  return findChatSession(archive, sessionId);
}

export function buildPersonaChatSession(
  messages: CanvasChatMessage[],
  endedAt = Date.now(),
): CanvasChatSession {
  return buildChatSession(messages, 'pcs', endedAt);
}

export function prependPersonaChatArchive(
  archive: CanvasChatSession[] | undefined,
  session: CanvasChatSession,
): CanvasChatSession[] {
  return prependChatArchive(archive, session);
}

export async function startNewPersonaChatSession(threadId: string): Promise<void> {
  const row = await db.canvasPersonaThreads.get(threadId);
  if (!row) return;
  const current = row.messages ?? [];
  if (current.length === 0) return;
  const session = buildPersonaChatSession(current);
  await db.canvasPersonaThreads.put({
    ...row,
    messages: [],
    sessionArchive: prependPersonaChatArchive(row.sessionArchive, session),
    updatedAt: Date.now(),
  });
}

export async function restorePersonaChatSession(
  threadId: string,
  sessionId: string,
): Promise<boolean> {
  const row = await db.canvasPersonaThreads.get(threadId);
  if (!row) return false;
  const { archive: without, session } = removeChatSession(row.sessionArchive, sessionId);
  if (!session) return false;
  const current = row.messages ?? [];
  const nextArchive =
    current.length > 0
      ? prependPersonaChatArchive(without, buildPersonaChatSession(current))
      : without;
  await db.canvasPersonaThreads.put({
    ...row,
    messages: session.messages,
    sessionArchive: nextArchive,
    updatedAt: Date.now(),
  });
  return true;
}
