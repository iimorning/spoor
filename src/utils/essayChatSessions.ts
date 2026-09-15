import type { EssayChatMessage, EssayChatSession } from '../db';
import {
  buildChatSession,
  chatSessionPreview,
  findChatSession,
  prependChatArchive,
  removeChatSession,
  type ChatSessionLike,
} from './chatSessionArchive';

export const ESSAY_CHAT_ARCHIVE_CAP = 20;

export { chatSessionPreview as essayChatSessionPreview };

export function buildEssayChatSession(
  messages: EssayChatMessage[],
  endedAt = Date.now(),
): EssayChatSession {
  return buildChatSession(messages, 'ecs', endedAt);
}

export function prependEssayChatArchive(
  archive: EssayChatSession[] | undefined,
  session: EssayChatSession,
): EssayChatSession[] {
  return prependChatArchive(archive, session);
}

export function restoreEssayChatSessionPlan(
  current: EssayChatMessage[],
  archive: EssayChatSession[] | undefined,
  sessionId: string,
): {
  nextMessages: EssayChatMessage[];
  nextArchive: EssayChatSession[];
} | null {
  const { archive: without, session } = removeChatSession(archive, sessionId);
  if (!session) return null;
  const nextArchive =
    current.length > 0
      ? prependChatArchive(without, buildEssayChatSession(current))
      : without;
  return { nextMessages: session.messages, nextArchive };
}

export function findEssayChatSession(
  archive: EssayChatSession[] | undefined,
  sessionId: string,
): EssayChatSession | undefined {
  return findChatSession(archive, sessionId);
}

export type { ChatSessionLike };
