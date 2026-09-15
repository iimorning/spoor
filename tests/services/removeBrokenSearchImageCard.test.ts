import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/db';
import {
  isAutoRemovableSearchImage,
  removeBrokenSearchImageCard,
} from '../../src/services/removeBrokenSearchImageCard';

describe('isAutoRemovableSearchImage', () => {
  it('keeps AI generations and plain uploads', () => {
    expect(
      isAutoRemovableSearchImage({
        type: 'image',
        content: 'https://x/a.jpg',
        aiGenerated: true,
        webSearchParentId: 'ai-1',
      }),
    ).toBe(false);
    expect(isAutoRemovableSearchImage({ type: 'image', content: 'https://x/a.jpg' })).toBe(false);
  });

  it('targets search-sourced image cards', () => {
    expect(
      isAutoRemovableSearchImage({
        type: 'image',
        content: 'https://x/a.jpg',
        webSearchParentId: 'ai-1',
      }),
    ).toBe(true);
    expect(
      isAutoRemovableSearchImage({
        type: 'image',
        content: 'https://x/a.jpg',
        webSearchIndex: 2,
      }),
    ).toBe(true);
  });
});

describe('removeBrokenSearchImageCard', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.edges.clear();
  });

  it('deletes the image node and its edges', async () => {
    await db.nodes.add({
      id: 'img-1',
      canvasId: 'c1',
      type: 'image',
      content: 'https://cdn.example/broken.jpg',
      x: 0,
      y: 0,
      webSearchParentId: 'ai-1',
      webSearchIndex: 0,
    });
    await db.edges.add({ id: 'e1', canvasId: 'c1', from: 'ai-1', to: 'img-1' });
    await db.edges.add({ id: 'e2', canvasId: 'c1', from: 'img-1', to: 'note-2' });

    expect(await removeBrokenSearchImageCard('img-1')).toBe(true);
    expect(await db.nodes.get('img-1')).toBeUndefined();
    expect(await db.edges.toArray()).toEqual([]);
  });

  it('does nothing for non-search images', async () => {
    await db.nodes.add({
      id: 'img-2',
      canvasId: 'c1',
      type: 'image',
      content: 'https://cdn.example/ok.jpg',
      x: 0,
      y: 0,
    });
    expect(await removeBrokenSearchImageCard('img-2')).toBe(false);
    expect(await db.nodes.get('img-2')).toBeTruthy();
  });
});
