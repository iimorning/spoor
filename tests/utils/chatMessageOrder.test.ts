import { describe, expect, it } from 'vitest';
import type { CanvasChatMessage } from '../../src/db';
import { compareChatMessages, sortChatMessages } from '../../src/utils/chatMessageOrder';

function msg(partial: Partial<CanvasChatMessage> & Pick<CanvasChatMessage, 'id' | 'role'>): CanvasChatMessage {
  return {
    text: partial.text ?? '',
    createdAt: partial.createdAt ?? 0,
    ...partial,
  };
}

describe('chatMessageOrder', () => {
  it('keeps user before assistant when createdAt ties', () => {
    const user = msg({ id: 'zzz-user', role: 'user', createdAt: 100 });
    const assistant = msg({ id: 'aaa-assistant', role: 'assistant', createdAt: 100 });
    expect(compareChatMessages(user, assistant)).toBeLessThan(0);
    expect(sortChatMessages([assistant, user]).map((m) => m.id)).toEqual(['zzz-user', 'aaa-assistant']);
  });

  it('sorts by createdAt first', () => {
    const older = msg({ id: 'u1', role: 'user', createdAt: 1 });
    const newer = msg({ id: 'a1', role: 'assistant', createdAt: 2 });
    expect(sortChatMessages([newer, older]).map((m) => m.id)).toEqual(['u1', 'a1']);
  });
});
