import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../../src/db';
import { retryChatDrawImage, retryImageGeneration } from '../../src/services/fulfillDrawTool';
import { generateGptImage2 } from '../../src/services/flux302';

vi.mock('../../src/services/flux302', () => ({
  hasFlux302Credentials: () => true,
  generateGptImage2: vi.fn(async () => ({ url: 'https://img.example/retry.jpg' })),
}));

const generateMock = vi.mocked(generateGptImage2);

/** A card left behind by a failed generation. */
async function addFailedCard(overrides: Record<string, unknown> = {}) {
  await db.nodes.add({
    id: 'img-1',
    canvasId: 'c1',
    type: 'image',
    content: '',
    description: 'fox',
    aiGenerated: true,
    x: 400,
    y: 120,
    width: 320,
    height: 210,
    imageStatus: 'error',
    imageError: '402 quota',
    imagePrompt: 'a fox',
    ...overrides,
  });
}

describe('retryImageGeneration', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.edges.clear();
    generateMock.mockReset();
    generateMock.mockResolvedValue({ url: 'https://img.example/retry.jpg' });
  });

  it('regenerates into the same card instead of spawning a second one', async () => {
    await addFailedCard();

    await retryImageGeneration({ nodeId: 'img-1', apiKey: 'k' });

    const card = await db.nodes.get('img-1');
    expect(card?.content).toBe('https://img.example/retry.jpg');
    expect(card?.imageStatus).toBeUndefined();
    expect(card?.imageError).toBeUndefined();
    expect(card?.imagePrompt).toBe('a fox');
    // Same position, and no extra card was created.
    expect(card?.x).toBe(400);
    expect(await db.nodes.count()).toBe(1);
  });

  it('reuses the stored prompt', async () => {
    await addFailedCard();

    await retryImageGeneration({ nodeId: 'img-1', apiKey: 'k' });

    expect(generateMock).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'a fox' }));
  });

  it('retries a tall card with the portrait GPT size', async () => {
    await addFailedCard({ width: 210, height: 320, imagePrompt: '竖构图 立绘' });

    await retryImageGeneration({ nodeId: 'img-1', apiKey: 'k' });

    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({ orientation: 'portrait', prompt: '竖构图 立绘' }),
    );
  });

  it('shows the ghost again while the retry is in flight', async () => {
    await addFailedCard();
    let release: (v: { url: string }) => void = () => {};
    generateMock.mockReturnValue(
      new Promise<{ url: string }>((resolve) => {
        release = resolve;
      }),
    );

    const done = retryImageGeneration({ nodeId: 'img-1', apiKey: 'k' });
    await vi.waitFor(async () => {
      expect((await db.nodes.get('img-1'))?.imageStatus).toBe('generating');
    });
    expect((await db.nodes.get('img-1'))?.imageError).toBeUndefined();

    release({ url: 'https://img.example/retry.jpg' });
    await done;
    expect((await db.nodes.get('img-1'))?.imageStatus).toBeUndefined();
  });

  it('falls back to the error state when the retry also fails', async () => {
    await addFailedCard();
    generateMock.mockRejectedValue(new Error('still broken'));

    await retryImageGeneration({ nodeId: 'img-1', apiKey: 'k' });

    const card = await db.nodes.get('img-1');
    expect(card?.imageStatus).toBe('error');
    expect(card?.imageError).toContain('still broken');
    // Prompt survives so the button can be pressed again.
    expect(card?.imagePrompt).toBe('a fox');
  });

  it('does nothing when the card has no stored prompt', async () => {
    await addFailedCard({ imagePrompt: undefined });

    await retryImageGeneration({ nodeId: 'img-1', apiKey: 'k' });

    expect(generateMock).not.toHaveBeenCalled();
    expect((await db.nodes.get('img-1'))?.imageStatus).toBe('error');
  });
});

describe('retryChatDrawImage', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.canvasPersonaThreads.clear();
    generateMock.mockReset();
    generateMock.mockResolvedValue({ url: 'https://img.example/retry-chat.jpg' });
  });

  it('regenerates the failed chat slot in place and does not spawn a canvas card', async () => {
    await db.canvasPersonaThreads.add({
      id: 'c1:agent-1',
      canvasId: 'c1',
      agentNodeId: 'agent-1',
      updatedAt: 1,
      messages: [
        {
          id: 'msg-1',
          role: 'assistant',
          text: 'here',
          createdAt: 1,
          images: [
            {
              id: 'img-slot',
              title: 'fox',
              prompt: 'a fox',
              status: 'error',
              error: '402 quota',
              orientation: 'square',
            },
          ],
        },
      ],
    });

    await retryChatDrawImage({
      threadId: 'c1:agent-1',
      messageId: 'msg-1',
      imageId: 'img-slot',
      apiKey: 'k',
    });

    const thread = await db.canvasPersonaThreads.get('c1:agent-1');
    const slot = thread?.messages[0]?.images?.[0];
    expect(slot?.status).toBe('ready');
    expect(slot?.url).toBe('https://img.example/retry-chat.jpg');
    expect(slot?.error).toBeUndefined();
    expect(slot?.prompt).toBe('a fox');
    expect(await db.nodes.count()).toBe(0);
    expect(generateMock).toHaveBeenCalledTimes(1);
  });
});
