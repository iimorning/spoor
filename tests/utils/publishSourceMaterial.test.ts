import { describe, it, expect } from 'vitest';
import type { CanvasNode } from '../../src/db';
import {
  buildPublishSourceMaterial,
  ensurePublishMediaInBody,
  mediaMarkdownFromNode,
  normalizePublishMediaPlaceholders,
  outlineAttachedVisualLine,
  OUTLINE_VISUAL_PIXELS_SKIPPED,
  remapOutlineAttachedVisuals,
  stripEmbeddedImageDataUrls,
} from '../../src/utils/publishSourceMaterial';

const base = { x: 0, y: 0, canvasId: 'c1' };

describe('mediaMarkdownFromNode', () => {
  it('builds image markdown with optional source link', () => {
    const node = {
      ...base,
      id: 'img1',
      type: 'image',
      content: 'https://cdn.example/a.jpg',
      description: 'Vintage dress',
      sourceUrl: 'https://page.example/a',
    } satisfies CanvasNode;
    const asset = mediaMarkdownFromNode(node);
    expect(asset?.articleMarkdown).toContain('![Vintage dress](https://cdn.example/a.jpg)');
    expect(asset?.articleMarkdown).toContain('https://page.example/a');
  });

  it('keeps local image Base64 out of article Markdown', () => {
    const dataUrl = 'data:image/png;base64,QUJD';
    const node = {
      ...base,
      id: 'local-img',
      type: 'image',
      content: dataUrl,
      description: 'Local picture',
    } satisfies CanvasNode;
    const asset = mediaMarkdownFromNode(node);
    expect(asset?.articleMarkdown).toBe(
      '![Local picture](spoor-article-media:node-local-img)',
    );
    expect(asset?.articleMarkdown).not.toContain('base64');
    expect(asset?.localDataUrl).toBe(dataUrl);
    expect(asset?.articleMediaId).toBe('node-local-img');
  });

  it('builds video link markdown from sourceUrl', () => {
    const node = {
      ...base,
      id: 'v1',
      type: 'video',
      content: 'https://www.youtube.com/embed/abc',
      description: 'Haul · Style',
      sourceUrl: 'https://www.youtube.com/watch?v=abc',
      fileType: 'iframe',
    } satisfies CanvasNode;
    expect(mediaMarkdownFromNode(node)?.articleMarkdown).toBe(
      '[▶ Haul · Style](https://www.youtube.com/watch?v=abc)',
    );
  });

  it('keeps local audio data URLs out of article Markdown', () => {
    const node = {
      ...base,
      id: 'wav1',
      type: 'video',
      content: 'data:audio/wav;base64,UklGRg==',
      description: 'clip.wav',
      fileType: 'audio/wav',
    } satisfies CanvasNode;
    const asset = mediaMarkdownFromNode(node);
    expect(asset?.articleMarkdown).toBe('*[clip.wav]*');
    expect(asset?.articleMarkdown).not.toContain('base64');
  });
});

describe('buildPublishSourceMaterial', () => {
  it('mixes note text with media blocks', () => {
    const nodes: CanvasNode[] = [
      { ...base, id: 'n1', type: 'note', content: 'note body' },
      {
        ...base,
        id: 'img1',
        type: 'image',
        content: 'https://cdn.example/a.jpg',
        description: 'Pic',
      },
    ];
    const material = buildPublishSourceMaterial(['n1', 'img1'], nodes, (id) =>
      id === 'n1' ? 'note body from dom' : '',
    );
    expect(material.promptContent).toContain('Cards (2), in selection order');
    expect(material.promptContent).toMatch(/1\. 【cardId:n1】/);
    expect(material.promptContent).toContain('note body from dom');
    expect(material.promptContent).toContain('Attached visual #1');
    expect(material.promptContent).toContain('![Pic](https://cdn.example/a.jpg)');
    expect(material.mediaAssets).toHaveLength(1);
    expect(material.visionImageHrefs).toEqual(['https://cdn.example/a.jpg']);
    expect(material.cards[1]?.thumbnailSrc).toBe('https://cdn.example/a.jpg');
  });

  it('uses node.content when the DOM text is empty so fidelity has real markdown', () => {
    const nodes: CanvasNode[] = [{ ...base, id: 'n1', type: 'note', content: '画布上的原文' }];
    const material = buildPublishSourceMaterial(['n1'], nodes, () => '');
    expect(material.cards[0]?.markdown).toBe('画布上的原文');
    expect(material.promptContent).toContain('画布上的原文');
  });

  it('does not store image data URLs as card markdown or titles', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    const nodes: CanvasNode[] = [
      {
        ...base,
        id: 'img1',
        type: 'image',
        content: dataUrl,
        description: '封面',
      },
    ];
    const material = buildPublishSourceMaterial(['img1'], nodes, () => dataUrl);
    expect(material.cards[0]?.markdown).not.toContain('base64');
    expect(material.cards[0]?.title).toBe('封面');
    expect(material.cards[0]?.thumbnailSrc).toBe(dataUrl);
    expect(material.visionImageHrefs).toEqual([dataUrl]);
    expect(material.promptContent).toContain('media://image/img1');
    expect(material.promptContent).not.toContain('base64');
  });

  it('strips Base64 embedded in note text so the outline prompt is not millions of tokens', () => {
    const huge = `data:image/png;base64,${'A'.repeat(8000)}`;
    const nodes: CanvasNode[] = [
      { ...base, id: 'n1', type: 'note', content: `说明\n\n![内嵌](${huge})\n\n结尾` },
    ];
    const material = buildPublishSourceMaterial(['n1'], nodes, () => '');
    expect(material.cards[0]?.markdown).toContain(huge);
    expect(material.promptContent).toContain('说明');
    expect(material.promptContent).toContain('结尾');
    expect(material.promptContent).toContain('media://embedded-image');
    expect(material.promptContent).not.toMatch(/base64,A{20,}/);
    expect(material.promptContent.length).toBeLessThan(2000);
  });

  it('does not swallow ASCII after an unwrapped data URL', () => {
    const payload = `data:image/png;base64,${'A'.repeat(80)}`;
    expect(stripEmbeddedImageDataUrls(`${payload} then we discussed`)).toBe(
      'media://embedded-image then we discussed',
    );
    expect(stripEmbeddedImageDataUrls(`intro ${payload} then we discussed`)).toBe(
      'intro media://embedded-image then we discussed',
    );
  });

  it('attaches every selected image as visual input, not just the first four', () => {
    const nodes: CanvasNode[] = Array.from({ length: 5 }, (_, i) => ({
      ...base,
      id: `img${i}`,
      type: 'image' as const,
      content: `https://cdn.example/${i}.jpg`,
      description: `Pic ${i}`,
    }));
    const material = buildPublishSourceMaterial(
      nodes.map((n) => n.id),
      nodes,
      () => '',
    );
    expect(material.visionImageHrefs).toHaveLength(5);
    expect(material.promptContent).toContain('Attached visual #5');
  });
});

describe('ensurePublishMediaInBody', () => {
  it('appends missing media under related heading', () => {
    const body = ensurePublishMediaInBody(
      'Hello world.',
      [
        {
          nodeId: 'img1',
          articleMarkdown: '![Pic](https://cdn.example/a.jpg)',
          promptMarkdown: '![Pic](https://cdn.example/a.jpg)',
        },
      ],
      '相关媒体',
    );
    expect(body).toContain('Hello world.');
    expect(body).toContain('## 相关媒体');
    expect(body).toContain('![Pic](https://cdn.example/a.jpg)');
  });

  it('does not duplicate media already present', () => {
    const md = '![Pic](https://cdn.example/a.jpg)';
    const body = ensurePublishMediaInBody(`Intro\n\n${md}\n`, [
      { nodeId: 'img1', articleMarkdown: md, promptMarkdown: md },
    ], 'Related media');
    expect(body.match(/cdn\.example\/a\.jpg/g)).toHaveLength(1);
  });
});

describe('normalizePublishMediaPlaceholders', () => {
  it('replaces a model-echoed local placeholder with the canonical article image', () => {
    const result = normalizePublishMediaPlaceholders(
      'Before\n\n![Image](media://image/img1)\n\nAfter',
      [
        {
          nodeId: 'img1',
          articleMarkdown: '![Local](spoor-article-media:node-img1)',
          promptMarkdown: '![Local](media://image/img1)',
        },
      ],
    );
    expect(result).toContain('![Local](spoor-article-media:node-img1)');
    expect(result).not.toContain('media://image/img1');
  });
});

describe('remapOutlineAttachedVisuals', () => {
  it('renumbers visual #N to match images that were actually attached', () => {
    const prompt =
      outlineAttachedVisualLine(1) +
      outlineAttachedVisualLine(2) +
      outlineAttachedVisualLine(3);
    const { prompt: next, images } = remapOutlineAttachedVisuals(prompt, [
      null,
      'https://cdn.example/b.jpg',
      'https://cdn.example/c.jpg',
    ]);
    expect(images).toEqual(['https://cdn.example/b.jpg', 'https://cdn.example/c.jpg']);
    expect(next.startsWith(OUTLINE_VISUAL_PIXELS_SKIPPED)).toBe(true);
    expect(next).toContain(outlineAttachedVisualLine(1));
    expect(next).toContain(outlineAttachedVisualLine(2));
    expect(next).not.toContain(outlineAttachedVisualLine(3));
  });
});
