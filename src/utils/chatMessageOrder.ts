import type { CanvasChatMessage } from '../db';

/** Stable chronological order for persona thread messages. */
export function compareChatMessages(a: CanvasChatMessage, b: CanvasChatMessage): number {
  const byTime = a.createdAt - b.createdAt;
  if (byTime !== 0) return byTime;
  if (a.role !== b.role) {
    if (a.role === 'user' && b.role === 'assistant') return -1;
    if (a.role === 'assistant' && b.role === 'user') return 1;
  }
  return a.id.localeCompare(b.id);
}

export function sortChatMessages(messages: CanvasChatMessage[]): CanvasChatMessage[] {
  return [...messages].sort(compareChatMessages);
}
