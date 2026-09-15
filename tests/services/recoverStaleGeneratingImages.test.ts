import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db';
import { recoverStaleGeneratingImages } from '../../src/services/fulfillDrawTool';
import { GPT_IMAGE_TIMEOUT_MS, IMAGE_GEN_ERROR } from '../../src/utils/imageGenerationWait';

describe('recoverStaleGeneratingImages', () => {
  beforeEach(async () => {
    await db.nodes.clear();
  });

  it('marks generating cards older than the client timeout as stale', async () => {
    const now = 1_700_000_000_000;
    await db.nodes.bulkAdd([
      {
        id: 'fresh',
        type: 'image',
        x: 0,
        y: 0,
        imageStatus: 'generating',
        createdAt: now - 10_000,
      },
      {
        id: 'old',
        type: 'image',
        x: 0,
        y: 0,
        imageStatus: 'generating',
        createdAt: now - GPT_IMAGE_TIMEOUT_MS - 1,
      },
      {
        id: 'no-clock',
        type: 'image',
        x: 0,
        y: 0,
        imageStatus: 'generating',
      },
      {
        id: 'ready',
        type: 'image',
        x: 0,
        y: 0,
        content: 'https://cdn.example/a.jpg',
        createdAt: now - GPT_IMAGE_TIMEOUT_MS * 2,
      },
    ]);

    expect(await recoverStaleGeneratingImages(now)).toBe(2);
    expect((await db.nodes.get('fresh'))?.imageStatus).toBe('generating');
    expect((await db.nodes.get('old'))?.imageStatus).toBe('error');
    expect((await db.nodes.get('old'))?.imageError).toBe(IMAGE_GEN_ERROR.stale);
    expect((await db.nodes.get('no-clock'))?.imageStatus).toBe('error');
    expect((await db.nodes.get('ready'))?.imageStatus).toBeUndefined();
  });
});
