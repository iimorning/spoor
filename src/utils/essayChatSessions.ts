import type { EssayChatMessage, EssayChatSession } from '../db';
import {
  buildChatSession,
  buildRestoreChatSessionPlan,
  chatSessionPreview,
  prependChatArchive,
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
  return buildRestoreChatSessionPlan(current, archive, sessionId, 'ecs');
}

export type { ChatSessionLike };
