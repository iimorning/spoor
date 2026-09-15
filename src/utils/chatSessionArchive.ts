export const CHAT_SESSION_ARCHIVE_CAP = 20;

export type ChatSessionLike<TMessage> = {
  id: string;
  createdAt: number;
  endedAt: number;
  preview: string;
  messages: TMessage[];
};

export function chatSessionPreview(
  messages: Array<{ role: string; text: string }>,
): string {
  const firstUser = messages.find((m) => m.role === 'user');
  const text = (firstUser?.text ?? messages[0]?.text ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > 48 ? `${text.slice(0, 48)}…` : text;
}

export function buildChatSessionId(prefix: string, endedAt = Date.now()): string {
  return `${prefix}-${endedAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildChatSession<TMessage extends { role: string; text: string; createdAt?: number }>(
  messages: TMessage[],
  idPrefix: string,
  endedAt = Date.now(),
): ChatSessionLike<TMessage> {
  return {
    id: buildChatSessionId(idPrefix, endedAt),
    createdAt: messages[0]?.createdAt ?? endedAt,
    endedAt,
    preview: chatSessionPreview(messages),
    messages,
  };
}

export function prependChatArchive<TMessage>(
  archive: ChatSessionLike<TMessage>[] | undefined,
  session: ChatSessionLike<TMessage>,
): ChatSessionLike<TMessage>[] {
  return [session, ...(archive ?? [])].slice(0, CHAT_SESSION_ARCHIVE_CAP);
}

export function findChatSession<TMessage>(
  archive: ChatSessionLike<TMessage>[] | undefined,
  sessionId: string,
): ChatSessionLike<TMessage> | undefined {
  return (archive ?? []).find((session) => session.id === sessionId);
}

export function removeChatSession<TMessage>(
  archive: ChatSessionLike<TMessage>[] | undefined,
  sessionId: string,
): {
  archive: ChatSessionLike<TMessage>[];
  session?: ChatSessionLike<TMessage>;
} {
  const list = archive ?? [];
  const session = list.find((row) => row.id === sessionId);
  return {
    archive: list.filter((row) => row.id !== sessionId),
    session,
  };
}
