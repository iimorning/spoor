import { describe, expect, it, beforeEach } from 'vitest';
import { db } from '../../src/db';
import { mergeThreadMessageSearchHits } from '../../src/utils/personaStreamingAi';

describe('mergeThreadMessageSearchHits', () => {
  beforeEach(async () => {
    await db.canvasPersonaThreads.clear();
    await db.canvasPersonaThreads.put({
      id: 'c1:a1',
      canvasId: 'c1',
      agentNodeId: 'a1',
      updatedAt: 1,
      messages: [
        { id: 'u1', role: 'user', text: 'q', createdAt: 1 },
        { id: 'm1', role: 'assistant', text: 'draft', createdAt: 2 },
      ],
    });
  });

  it('appends unique hits onto the assistant message', async () => {
    await mergeThreadMessageSearchHits('c1:a1', 'm1', [
      { kind: 'webpage', query: 'q', title: 'A', snippet: 's', link: 'https://a.example' },
    ]);
    await mergeThreadMessageSearchHits('c1:a1', 'm1', [
      { kind: 'webpage', query: 'q', title: 'A', snippet: 's', link: 'https://a.example' },
      { kind: 'webpage', query: 'q', title: 'B', snippet: 's', link: 'https://b.example' },
    ]);
    const row = await db.canvasPersonaThreads.get('c1:a1');
    expect(row?.messages.find((m) => m.id === 'm1')?.searchHits).toHaveLength(2);
  });
});
