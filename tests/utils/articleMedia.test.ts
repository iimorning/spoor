import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Article } from '../../src/db';
import {
  articleForCloud,
  articleFromCloud,
  articleHasEmbeddedDataImages,
  articleHasLegacyMedia,
  articleMediaIdFromUrl,
  articleMediaUrl,
  extractEmbeddedArticleMedia,
} from '../../src/utils/articleMedia';

const uploadCanvasMediaMock = vi.hoisted(() =>
  vi.fn(async (_userId: string, path: string, blob: Blob) =>
    `https://cdn.test/storage/v1/object/public/canvas-media/${path}`,
  ),
);
const fetchUrlToBlobMock = vi.hoisted(() =>
  vi.fn(async () => new Blob(['ABC'], { type: 'image/png' })),
);

vi.mock('../../src/services/canvasMediaStorage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/canvasMediaStorage')>();
  return {
    ...actual,
    uploadCanvasMedia: uploadCanvasMediaMock,
    fetchUrlToBlob: fetchUrlToBlobMock,
  };
});

const DATA_URL = 'data:image/png;base64,QUJD';

function legacyArticle(): Article {
  return {
    id: 'a1',
    title: 'Legacy',
    type: 'GEN-1',
    date: '2026',
    content: `before ![img](${DATA_URL}) after`,
    sourceCards: [
      {
        nodeId: 'img1',
        canvasId: 'c1',
        kind: 'image',
        title: 'Image',
        segmentText: `![img](${DATA_URL})`,
      },
    ],
  };
}

describe('article media storage', () => {
  beforeEach(() => {
    uploadCanvasMediaMock.mockClear();
    fetchUrlToBlobMock.mockClear();
  });

  it('round-trips media reference ids', () => {
    expect(articleMediaIdFromUrl(articleMediaUrl('node/a'))).toBe('node/a');
  });

  it('extracts duplicate embedded Base64 once as a Blob', async () => {
    const legacy = legacyArticle();
    expect(articleHasEmbeddedDataImages(legacy)).toBe(true);

    const migrated = await extractEmbeddedArticleMedia(legacy);

    expect(migrated.media).toHaveLength(1);
    expect(migrated.media?.[0].blob.type).toBe('image/png');
    expect(migrated.media?.[0].blob.size).toBe(3);
    expect(migrated.content).not.toContain('base64');
    expect(migrated.sourceCards?.[0].segmentText).not.toContain('base64');
    expect(articleHasEmbeddedDataImages(migrated)).toBe(false);
  });

  it('converts Blob media only at the cloud JSON boundary', async () => {
    const migrated = await extractEmbeddedArticleMedia(legacyArticle());
    const cloud = await articleForCloud(migrated, 'user-1');
    expect(cloud.cloud.media?.[0].url).toContain('canvas-media/user-1/articles/a1/');
    expect(cloud.cloud.media?.[0].dataUrl).toBeUndefined();
    expect(uploadCanvasMediaMock).toHaveBeenCalledTimes(1);

    const restored = await articleFromCloud(cloud.cloud);
    expect(restored.media?.[0].blob.type).toBe('image/png');
    expect(restored.media?.[0].blob.size).toBe(3);
    expect(restored.content).not.toContain('base64');
    expect(fetchUrlToBlobMock).toHaveBeenCalledTimes(1);
  });

  it('restores legacy cloud rows that still use dataUrl', async () => {
    const cloud = {
      id: 'legacy-cloud',
      title: 'Legacy cloud',
      type: 'GEN-1',
      date: '2026',
      content: 'text',
      media: [{ id: 'm1', mimeType: 'image/png', dataUrl: DATA_URL }],
    };
    const restored = await articleFromCloud(cloud);
    expect(restored.media?.[0].blob.size).toBe(3);
    expect(fetchUrlToBlobMock).not.toHaveBeenCalled();
  });

  it('removes an echoed broken placeholder when the canonical image already exists', async () => {
    const canonical = articleMediaUrl('node-img1');
    const article: Article = {
      id: 'a2',
      title: 'Duplicate',
      type: 'GEN-2',
      date: '2026',
      content: `![Image](media://image/img1)\n\n![Image](${canonical})`,
      media: [
        {
          id: 'node-img1',
          sourceNodeId: 'img1',
          mimeType: 'image/png',
          blob: new Blob(['ABC'], { type: 'image/png' }),
        },
      ],
    };
    expect(articleHasLegacyMedia(article)).toBe(true);

    const migrated = await extractEmbeddedArticleMedia(article);

    expect(migrated.content).not.toContain('media://image/img1');
    expect(migrated.content.match(/spoor-article-media:node-img1/g)).toHaveLength(1);
    expect(articleHasLegacyMedia(migrated)).toBe(false);
  });

  it('removes an unresolvable placeholder from articles created before media metadata', async () => {
    const article: Article = {
      id: 'a3',
      title: 'Old placeholder',
      type: 'GEN-3',
      date: '2026',
      content: '正文\n\n![Image](media://image/deleted-node)',
    };
    expect(articleHasLegacyMedia(article)).toBe(true);

    const migrated = await extractEmbeddedArticleMedia(article);

    expect(migrated.content).toBe('正文');
    expect(articleHasLegacyMedia(migrated)).toBe(false);
  });
});
