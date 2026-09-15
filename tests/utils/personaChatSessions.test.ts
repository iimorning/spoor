import { describe, expect, it } from 'vitest';
import { db } from '../../src/db';
import {
  restorePersonaChatSession,
  startNewPersonaChatSession,
} from '../../src/utils/personaChatSessions';

describe('personaChatSessions', () => {
  it('archives the active thread and restores a selected session', async () => {
    await db.canvasPersonaThreads.put({
      id: 'thread-1',
      canvasId: 'c1',
      agentNodeId: 'ask-1',
      updatedAt: 1,
      messages: [
        { id: 'u2', role: 'user', text: 'current', createdAt: 3 },
        { id: 'a2', role: 'assistant', text: 'current reply', createdAt: 4 },
      ],
      sessionArchive: [
        {
          id: 's1',
          createdAt: 1,
          endedAt: 2,
          preview: 'old question',
          messages: [
            { id: 'u1', role: 'user', text: 'old question', createdAt: 1 },
            { id: 'a1', role: 'assistant', text: 'old reply', createdAt: 2 },
          ],
        },
      ],
    });

    await startNewPersonaChatSession('thread-1');
    let row = await db.canvasPersonaThreads.get('thread-1');
    expect(row?.messages).toEqual([]);
    expect(row?.sessionArchive?.[0]?.preview).toBe('current');

    await restorePersonaChatSession('thread-1', 's1');
    row = await db.canvasPersonaThreads.get('thread-1');
    expect(row?.messages.map((m) => m.text)).toEqual(['old question', 'old reply']);
    expect(row?.sessionArchive?.some((s) => s.id === 's1')).toBe(false);
    expect(row?.sessionArchive?.[0]?.preview).toBe('current');
  });
});
