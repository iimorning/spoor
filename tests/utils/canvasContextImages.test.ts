import { describe, it, expect, vi } from 'vitest';
import type { CanvasNode, Edge } from '../../src/db';
import {
  clipImageSourceNote,
  collectDrawReferenceImageContents,
  isAttachableImageContent,
  linkedImageSourceNote,
  materializeImageDataUrls,
  prepareLlmVisionImages,
  resolveImageDataUrlsFromNodeIds,
} from '../../src/utils/canvasContextImages';

const tinyPng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function node(id: string, type: string, content?: string): CanvasNode {
  return { id, type, content, x: 0, y: 0, canvasId: 'c1' };
}

function edge(from: string, to: string): Edge {
  return { id: `${from}-${to}`, from, to, canvasId: 'c1' };
}

describe('canvasContextImages', () => {
  describe('resolveImageDataUrlsFromNodeIds', () => {
    it('按传入顺序解析仍存在且合法的图片节点', () => {
      const nodes: CanvasNode[] = [
        node('i2', 'image', tinyPng),
        node('i1', 'image', tinyPng.replace('iVBOR', 'iVBPR')),
      ];
      const urls = resolveImageDataUrlsFromNodeIds(['i1', 'i2'], nodes);
      expect(urls).toHaveLength(2);
      expect(urls[0]).toContain('iVBPR');
      expect(urls[1]).toBe(tinyPng);
    });

    it('缺失节点时跳过', () => {
      const nodes: CanvasNode[] = [node('i1', 'image', tinyPng)];
      expect(resolveImageDataUrlsFromNodeIds(['gone', 'i1'], nodes)).toEqual([tinyPng]);
    });

    it('保留 http(s) 图片 href，供后续物化成 data URL', () => {
      const nodes: CanvasNode[] = [node('i1', 'image', 'https://file.302ai.cn/a.jpg')];
      expect(resolveImageDataUrlsFromNodeIds(['i1'], nodes)).toEqual(['https://file.302ai.cn/a.jpg']);
    });
  });

  describe('isAttachableImageContent / materializeImageDataUrls', () => {
    it('accepts data URLs, http(s), and bundled same-origin asset paths', () => {
      expect(isAttachableImageContent(tinyPng)).toBe(true);
      expect(isAttachableImageContent('https://cdn.example/a.jpg')).toBe(true);
      expect(isAttachableImageContent('/assets/onboarding/crooked-house.jpg')).toBe(true);
      expect(isAttachableImageContent('not-a-url')).toBe(false);
      expect(isAttachableImageContent('')).toBe(false);
    });

    it('passes through data URLs and fetches http or bundled asset images', async () => {
      const blob = new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, blob: async () => blob }),
      );
      try {
        const out = await materializeImageDataUrls([
          tinyPng,
          'https://cdn.example/a.jpg',
          '/assets/onboarding/crooked-house.jpg',
        ]);
        expect(out[0]).toBe(tinyPng);
        expect(out[1]).toMatch(/^data:image\/png;base64,/);
        expect(out[2]).toMatch(/^data:image\/png;base64,/);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('keeps http(s) hrefs as URLs instead of inlining Base64', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      try {
        const out = await prepareLlmVisionImages([tinyPng, 'https://cdn.example/a.jpg']);
        expect(out).toEqual([tinyPng, 'https://cdn.example/a.jpg']);
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe('clipImageSourceNote / linkedImageSourceNote', () => {
    it('clips long source notes', () => {
      const long = '字'.repeat(1000);
      const out = clipImageSourceNote(long);
      expect(out.endsWith('…')).toBe(true);
      expect(out.length).toBeLessThanOrEqual(901);
    });

    it('reads the linked AI card when the image has no stored rationale', () => {
      const nodes: CanvasNode[] = [
        node('img', 'image', tinyPng),
        { ...node('ai-1', 'ai', '席琳在病床上望向镜头。'), userTurn: '画一张席琳' },
      ];
      const note = linkedImageSourceNote('img', nodes, [edge('ai-1', 'img')]);
      expect(note).toContain('画一张席琳');
      expect(note).toContain('病床上望向镜头');
    });
  });

  describe('collectDrawReferenceImageContents', () => {
    it('uses threadContextImageNodeIds before neighbor images', () => {
      const near = tinyPng.replace('iVBOR', 'iVBPR');
      const nodes: CanvasNode[] = [
        { ...node('ai-1', 'ai', 'ok'), threadContextImageNodeIds: ['img-thread'] },
        node('img-thread', 'image', tinyPng),
        node('img-near', 'image', near),
      ];
      const edges: Edge[] = [edge('ai-1', 'img-near')];
      expect(collectDrawReferenceImageContents(nodes[0]!, nodes, edges)).toEqual([tinyPng, near]);
    });

    it('includes extra work-zone image ids even without edges', () => {
      const nodes: CanvasNode[] = [
        node('ask-1', 'ask', ''),
        node('img-room', 'image', tinyPng),
      ];
      expect(collectDrawReferenceImageContents(nodes[0]!, nodes, [], [], ['img-room'])).toEqual([
        tinyPng,
      ]);
      expect(collectDrawReferenceImageContents(nodes[0]!, nodes, [])).toEqual([]);
    });

    it('skips generating ghosts and excluded ids', () => {
      const nodes: CanvasNode[] = [
        node('ai-1', 'ai', 'ok'),
        node('img-ok', 'image', tinyPng),
        { ...node('img-ghost', 'image', ''), imageStatus: 'generating' },
      ];
      const edges: Edge[] = [edge('ai-1', 'img-ok'), edge('ai-1', 'img-ghost')];
      expect(
        collectDrawReferenceImageContents(nodes[0]!, nodes, edges, ['img-ok']),
      ).toEqual([]);
    });
  });
});
