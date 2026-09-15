import { describe, expect, it } from 'vitest';
import {
  buildEssayChatSession,
  essayChatSessionPreview,
  prependEssayChatArchive,
  ESSAY_CHAT_ARCHIVE_CAP,
} from '../../src/utils/essayChatSessions';

describe('essayChatSessions', () => {
  it('builds a preview from the first user turn', () => {
    expect(
      essayChatSessionPreview([
        { id: 'a', role: 'assistant', text: 'Hi', createdAt: 1 },
        { id: 'u', role: 'user', text: '帮我查一下 App Store 上架流程', createdAt: 2 },
      ]),
    ).toBe('帮我查一下 App Store 上架流程');
  });

  it('archives the current thread and caps history length', () => {
    const session = buildEssayChatSession([
      { id: 'u', role: 'user', text: 'hello', createdAt: 1 },
    ]);
    const existing = Array.from({ length: ESSAY_CHAT_ARCHIVE_CAP }, (_, i) =>
      buildEssayChatSession([{ id: `u-${i}`, role: 'user', text: `old-${i}`, createdAt: i }]),
    );
    const next = prependEssayChatArchive(existing, session);
    expect(next).toHaveLength(ESSAY_CHAT_ARCHIVE_CAP);
    expect(next[0]?.preview).toBe('hello');
  });
});
