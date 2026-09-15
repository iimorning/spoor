import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../../src/db';
import { fulfillDrawToolFromNode, fulfillDrawToolIntoChat } from '../../src/services/fulfillDrawTool';
import { FLUX_IMAGE_CARD_WIDTH } from '../../src/services/spawnFluxImageCards';
import { generateGptImage2 } from '../../src/services/flux302';

vi.mock('../../src/services/flux302', () => ({
  hasFlux302Credentials: () => true,
  generateGptImage2: vi.fn(async () => ({ url: 'https://img.example/a.jpg' })),
}));

const generateMock = vi.mocked(generateGptImage2);

async function addAnchor() {
  await db.nodes.add({
    id: 'ai-1',
    canvasId: 'c1',
    type: 'ai',
    content: 'ok',
    x: 80,
    y: 120,
    width: 320,
    height: 200,
  });
}

describe('fulfillDrawToolFromNode', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.edges.clear();
    generateMock.mockReset();
    generateMock.mockResolvedValue({ url: 'https://img.example/a.jpg' });
    const ids = ['img-1', 'edge-1', 'img-2', 'edge-2'];
    vi.stubGlobal('crypto', {
      ...globalThis.crypto,
      randomUUID: () => ids.shift() ?? 'fallback',
    });
  });

  it('pins the generated image beside the live card, not a far stale offset', async () => {
    await addAnchor();

    await fulfillDrawToolFromNode({
      nodeId: 'ai-1',
      images: [{ title: 'fox', prompt: 'a fox' }],
      apiKey: 'k',
    });

    const img = await db.nodes.get('img-1');
    expect(img?.type).toBe('image');
    expect(img?.x).toBeGreaterThan(80);
    expect(img?.x).toBeLessThan(80 + 320 + FLUX_IMAGE_CARD_WIDTH);
    expect(Math.abs((img?.y ?? 0) - 120)).toBeLessThan(80);
  });

  it('shows a ghost card while generation is still in flight', async () => {
    await addAnchor();
    let release: (v: { url: string }) => void = () => {};
    generateMock.mockReturnValue(
      new Promise<{ url: string }>((resolve) => {
        release = resolve;
      }),
    );

    const done = fulfillDrawToolFromNode({
      nodeId: 'ai-1',
      images: [{ title: 'fox', prompt: 'a fox' }],
      apiKey: 'k',
    });
    // Let the ghost insert run before the generation promise settles.
    await vi.waitFor(async () => {
      expect(await db.nodes.get('img-1')).toBeDefined();
    });

    const ghost = await db.nodes.get('img-1');
    expect(ghost?.imageStatus).toBe('generating');
    expect(ghost?.content).toBe('');
    expect(ghost?.imagePrompt).toBe('a fox');
    // The edge is written with the ghost, so the card is never orphaned.
    expect(await db.edges.get('edge-1')).toBeDefined();

    release({ url: 'https://img.example/a.jpg' });
    await done;

    const ready = await db.nodes.get('img-1');
    expect(ready?.content).toBe('https://img.example/a.jpg');
    expect(ready?.imageStatus).toBeUndefined();
    expect(ready?.imagePrompt).toBe('a fox');
    expect(ready?.imageSourceNote).toBe('ok');
  });

  it('turns the ghost into an error card and keeps the prompt for retry', async () => {
    await addAnchor();
    generateMock.mockRejectedValue(new Error('402 quota'));
    const onError = vi.fn();

    await fulfillDrawToolFromNode({
      nodeId: 'ai-1',
      images: [{ title: 'fox', prompt: 'a fox' }],
      apiKey: 'k',
      onError,
    });

    const failed = await db.nodes.get('img-1');
    expect(failed?.imageStatus).toBe('error');
    expect(failed?.imageError).toContain('402 quota');
    expect(failed?.imagePrompt).toBe('a fox');
    expect(failed?.content).toBe('');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('does not alert when only some of several images fail', async () => {
    await addAnchor();
    generateMock
      .mockRejectedValueOnce(
        new Error('OpenRouter GPT-Image failed (HTTP 400): Your request was rejected by the safety system.'),
      )
      .mockResolvedValueOnce({ url: 'https://img.example/ok.jpg' });
    const onError = vi.fn();

    await fulfillDrawToolFromNode({
      nodeId: 'ai-1',
      images: [
        { title: 'fox', prompt: 'a fox' },
        { title: 'owl', prompt: 'an owl' },
      ],
      apiKey: 'k',
      onError,
    });

    expect(onError).not.toHaveBeenCalled();
    const statuses = [(await db.nodes.get('img-1'))?.imageStatus, (await db.nodes.get('img-2'))?.imageStatus];
    expect(statuses.filter((s) => s === 'error')).toHaveLength(1);
    expect(statuses.filter((s) => s == null)).toHaveLength(1);
  });

  it('places two ghosts without overlapping each other', async () => {
    await addAnchor();

    await fulfillDrawToolFromNode({
      nodeId: 'ai-1',
      images: [
        { title: 'fox', prompt: 'a fox' },
        { title: 'owl', prompt: 'an owl' },
      ],
      apiKey: 'k',
    });

    const a = await db.nodes.get('img-1');
    const b = await db.nodes.get('img-2');
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    const overlaps =
      Math.abs((a!.x ?? 0) - (b!.x ?? 0)) < FLUX_IMAGE_CARD_WIDTH &&
      Math.abs((a!.y ?? 0) - (b!.y ?? 0)) < (a!.height ?? 210);
    expect(overlaps).toBe(false);
  });

  it('spawns a portrait card and requests a portrait GPT size', async () => {
    await addAnchor();

    await fulfillDrawToolFromNode({
      nodeId: 'ai-1',
      images: [
        {
          title: '席琳',
          prompt: '竖构图，医院病床上的女人看着镜头',
          orientation: 'portrait',
        },
      ],
      apiKey: 'k',
    });

    const img = await db.nodes.get('img-1');
    expect(img?.width).toBe(210);
    expect(img?.height).toBe(320);
    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({ orientation: 'portrait' }),
    );
  });

  it('passes linked canvas stills to generateGptImage2 as inputReferences', async () => {
    const tinyPng =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    await addAnchor();
    await db.nodes.add({
      id: 'ref-1',
      canvasId: 'c1',
      type: 'image',
      content: tinyPng,
      x: 0,
      y: 0,
    });
    await db.edges.add({ id: 'e-ref', canvasId: 'c1', from: 'ai-1', to: 'ref-1' });

    await fulfillDrawToolFromNode({
      nodeId: 'ai-1',
      images: [{ title: 'fox', prompt: 'a fox' }],
      apiKey: 'k',
    });

    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'a fox',
        inputReferences: [tinyPng],
      }),
    );
  });
});

describe('fulfillDrawToolIntoChat', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    generateMock.mockReset();
    generateMock.mockResolvedValue({ url: 'https://img.example/chat.jpg' });
    vi.unstubAllGlobals();
  });

  it('keeps generated images in the callback and does not spawn canvas cards', async () => {
    const snapshots: Array<string | undefined>[] = [];
    await fulfillDrawToolIntoChat({
      images: [{ title: 'moon', prompt: 'a moon' }],
      apiKey: 'k',
      onUpdate: (images) => {
        snapshots.push(images.map((img) => img.status));
      },
    });
    expect(await db.nodes.count()).toBe(0);
    expect(snapshots[0]).toEqual(['generating']);
    expect(snapshots.at(-1)).toEqual(['ready']);
    expect(generateMock).toHaveBeenCalledTimes(1);
  });
});
