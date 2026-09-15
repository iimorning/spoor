import { describe, expect, it, vi, beforeEach } from 'vitest';
import { agentForCloud, nodeForCloud } from '../../src/utils/cloudSyncMedia';

const uploadDataUrlMock = vi.hoisted(() =>
  vi.fn(async (_userId: string, path: string) =>
    `https://cdn.test/storage/v1/object/public/canvas-media/${path}`,
  ),
);

vi.mock('../../src/services/canvasMediaStorage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/canvasMediaStorage')>();
  return {
    ...actual,
    inlineDataUrlForCloud: vi.fn(async (userId: string, storagePath: string, value?: string) => {
      if (!value?.startsWith('data:')) return value;
      return uploadDataUrlMock(userId, `${storagePath}.png`);
    }),
  };
});

describe('cloudSyncMedia', () => {
  beforeEach(() => {
    uploadDataUrlMock.mockClear();
  });

  it('uploads image node content before cloud sync', async () => {
    const node = {
      id: 'img1',
      canvasId: 'c1',
      type: 'image',
      content: 'data:image/png;base64,QUJD',
      x: 0,
      y: 0,
    };
    const cloud = await nodeForCloud(node, 'user-1');
    expect(cloud.cloud.content).toContain('/storage/v1/object/public/canvas-media/');
    expect(cloud.localPatch?.content).toContain('/storage/v1/object/public/canvas-media/');
    expect(uploadDataUrlMock).toHaveBeenCalledTimes(1);
  });

  it('uploads agent coverImageUrl before cloud sync', async () => {
    const agent = {
      id: 'agent-1',
      name: 'Host',
      role: 'Guide',
      prompt: 'Hello',
      coverImageUrl: 'data:image/png;base64,QUJD',
    };
    const cloud = await agentForCloud(agent, 'user-1');
    expect(cloud.cloud.coverImageUrl).toContain('/storage/v1/object/public/canvas-media/');
    expect(cloud.localPatch?.coverImageUrl).toContain('/storage/v1/object/public/canvas-media/');
    expect(uploadDataUrlMock).toHaveBeenCalledTimes(1);
  });

  it('leaves http URLs untouched', async () => {
    const node = {
      id: 'img2',
      canvasId: 'c1',
      type: 'image',
      content: 'https://example.com/photo.jpg',
      x: 0,
      y: 0,
    };
    const cloud = await nodeForCloud(node, 'user-1');
    expect(cloud.cloud.content).toBe('https://example.com/photo.jpg');
    expect(cloud.localPatch).toBeUndefined();
    expect(uploadDataUrlMock).not.toHaveBeenCalled();
  });
});
