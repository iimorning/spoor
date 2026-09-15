import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/db';
import { savePersonaComposerDraft } from '../../src/utils/personaStreamingAi';

describe('savePersonaComposerDraft', () => {
  beforeEach(async () => {
    await db.canvasPersonaThreads.clear();
  });

  it('creates a thread when saving a draft with no prior chat', async () => {
    await savePersonaComposerDraft({
      canvasId: 'c1',
      agentNodeId: 'agent-a',
      draft: 'half-written question',
    });
    const row = await db.canvasPersonaThreads.get('c1:agent-a');
    expect(row?.composerDraft).toBe('half-written question');
    expect(row?.messages).toEqual([]);
  });

  it('does not create an empty thread for a blank draft', async () => {
    await savePersonaComposerDraft({
      canvasId: 'c1',
      agentNodeId: 'agent-a',
      draft: '',
    });
    expect(await db.canvasPersonaThreads.get('c1:agent-a')).toBeUndefined();
  });

  it('updates and clears draft on an existing thread without dropping messages', async () => {
    await db.canvasPersonaThreads.put({
      id: 'c1:agent-a',
      canvasId: 'c1',
      agentNodeId: 'agent-a',
      messages: [{ id: 'm1', role: 'user', text: 'hi', createdAt: 1 }],
      composerDraft: 'old',
      updatedAt: 1,
    });
    await savePersonaComposerDraft({
      canvasId: 'c1',
      agentNodeId: 'agent-a',
      draft: 'new draft',
    });
    expect((await db.canvasPersonaThreads.get('c1:agent-a'))?.composerDraft).toBe('new draft');
    expect((await db.canvasPersonaThreads.get('c1:agent-a'))?.messages).toHaveLength(1);

    await savePersonaComposerDraft({
      canvasId: 'c1',
      agentNodeId: 'agent-a',
      draft: '',
    });
    const cleared = await db.canvasPersonaThreads.get('c1:agent-a');
    expect(cleared?.composerDraft).toBeUndefined();
    expect(cleared?.messages).toHaveLength(1);
  });
});
