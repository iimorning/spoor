import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db';
import {
  buildUrlNoteMarkdown,
  decidePastedUrlCardKind,
  hostnameFromUrl,
  isLoneHttpUrl,
  parseLoneHttpUrl,
  spawnCardFromPastedUrl,
} from '../../src/services/spawnUrlPasteCard';
import {
  decodeBasicHtmlEntities,
  parsePageMeta,
  parsePageOgImage,
  resolvePagePreviewImageUrl,
  truncateMetaText,
} from '../../src/services/parsePageMeta';

describe('parseLoneHttpUrl / isLoneHttpUrl', () => {
  it('accepts a lone http(s) URL with surrounding whitespace', () => {
    expect(parseLoneHttpUrl('  https://example.com/path?q=1  \n')).toBe(
      'https://example.com/path?q=1',
    );
    expect(isLoneHttpUrl('http://example.com')).toBe(true);
  });

  it('rejects empty, multi-token, or non-http text', () => {
    expect(parseLoneHttpUrl('')).toBeNull();
    expect(parseLoneHttpUrl('see https://example.com')).toBeNull();
    expect(parseLoneHttpUrl('ftp://example.com')).toBeNull();
    expect(parseLoneHttpUrl('not a url')).toBeNull();
    expect(isLoneHttpUrl('https://a.com\nhttps://b.com')).toBe(false);
  });
});

describe('buildUrlNoteMarkdown / hostnameFromUrl', () => {
  it('builds title + optional snippet + link', () => {
    expect(
      buildUrlNoteMarkdown({
        title: 'Example Domain',
        snippet: 'This domain is for use in documentation.',
        url: 'https://example.com',
      }),
    ).toBe(
      [
        '### Example Domain',
        '',
        'This domain is for use in documentation.',
        '',
        '[https://example.com](https://example.com)',
      ].join('\n'),
    );
  });

  it('omits snippet block when empty', () => {
    expect(buildUrlNoteMarkdown({ title: 'example.com', snippet: '', url: 'https://example.com' })).toBe(
      ['### example.com', '', '[https://example.com](https://example.com)'].join('\n'),
    );
  });

  it('strips www from hostname', () => {
    // URL hostname is lowercased by the URL parser
    expect(hostnameFromUrl('https://www.Example.com/x')).toBe('example.com');
  });
});

describe('decidePastedUrlCardKind', () => {
  it('routes YouTube and Bilibili to video', () => {
    expect(decidePastedUrlCardKind('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('video');
    expect(decidePastedUrlCardKind('https://youtu.be/dQw4w9WgXcQ')).toBe('video');
    expect(decidePastedUrlCardKind('https://www.bilibili.com/video/BV1xx411c7mD')).toBe('video');
  });

  it('routes ordinary pages to note', () => {
    expect(decidePastedUrlCardKind('https://example.com')).toBe('note');
    expect(decidePastedUrlCardKind('https://news.ycombinator.com/item?id=1')).toBe('note');
  });
});

describe('parsePageMeta', () => {
  it('prefers og:title and og:description', () => {
    const html = `
      <html><head>
        <title>Doc Title</title>
        <meta property="og:title" content="OG Title &amp; More" />
        <meta property="og:description" content="OG desc &#39;quote&#39;" />
        <meta name="description" content="Meta desc" />
      </head></html>`;
    expect(parsePageMeta(html)).toEqual({
      title: 'OG Title & More',
      snippet: "OG desc 'quote'",
    });
  });

  it('falls back to title tag and meta description', () => {
    const html = `
      <html><head>
        <title>  Plain &lt;Title&gt;  </title>
        <meta name="description" content="Fallback desc" />
      </head></html>`;
    expect(parsePageMeta(html)).toEqual({
      title: 'Plain <Title>',
      snippet: 'Fallback desc',
    });
  });

  it('handles content-before-property meta order', () => {
    const html = `<meta content="From content first" property="og:title" />`;
    expect(parsePageMeta(html).title).toBe('From content first');
  });

  it('truncates long title and snippet', () => {
    expect(truncateMetaText('a'.repeat(200), 120)).toHaveLength(120);
    expect(decodeBasicHtmlEntities('&quot;x&quot;')).toBe('"x"');
  });

  it('reads og:image and twitter:image, including content-first order', () => {
    expect(
      parsePageOgImage(
        `<meta property="og:image" content="https://img.example/cover.jpg" />`,
      ),
    ).toBe('https://img.example/cover.jpg');
    expect(
      parsePageOgImage(
        `<meta content="//cdn.example/a.png" name="twitter:image" />`,
      ),
    ).toBe('//cdn.example/a.png');
  });
});

describe('resolvePagePreviewImageUrl', () => {
  it('resolves relative and protocol-relative URLs', () => {
    expect(resolvePagePreviewImageUrl('https://book.douban.com/subject/1/', '/img/cover.jpg')).toBe(
      'https://book.douban.com/img/cover.jpg',
    );
    expect(resolvePagePreviewImageUrl('https://book.douban.com/subject/1/', '//img.example/c.jpg')).toBe(
      'https://img.example/c.jpg',
    );
  });

  it('skips data URIs and favicons', () => {
    expect(resolvePagePreviewImageUrl('https://a.example/', 'data:image/png;base64,xx')).toBe('');
    expect(resolvePagePreviewImageUrl('https://a.example/', 'https://a.example/favicon.ico')).toBe('');
  });
});

describe('spawnCardFromPastedUrl', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.edges.clear();
    await db.canvasWorkZones.clear();
    localStorage.clear();
  });

  it('creates a text note with sourceUrl for ordinary URLs', async () => {
    const { nodeId, kind } = await spawnCardFromPastedUrl({
      url: 'https://example.com/page',
      canvasId: 'c1',
      position: { x: 10, y: 20 },
    });
    expect(kind).toBe('note');
    const node = await db.nodes.get(nodeId);
    expect(node?.type).toBe('text');
    expect(node?.sourceUrl).toBe('https://example.com/page');
    expect(node?.layout).toBe(2);
    expect(node?.content).toContain('[https://example.com/page](https://example.com/page)');
    expect(node?.content).toContain('### example.com');
    expect(node?.x).toBe(10);
    expect(node?.y).toBe(20);
  });

  it('creates an iframe video card for YouTube', async () => {
    const { nodeId, kind } = await spawnCardFromPastedUrl({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      canvasId: 'c1',
      position: { x: 0, y: 0 },
    });
    expect(kind).toBe('video');
    const node = await db.nodes.get(nodeId);
    expect(node?.type).toBe('video');
    expect(node?.fileType).toBe('iframe');
    expect(node?.content).toContain('youtube.com/embed/dQw4w9WgXcQ');
    expect(node?.sourceUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('stamps work-zone scope when the paste lands in a bound room', async () => {
    await db.canvasWorkZones.add({
      id: 'zone-a',
      canvasId: 'c1',
      personaNodeId: 'agent-a',
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      createdAt: 0,
    });
    const { nodeId } = await spawnCardFromPastedUrl({
      url: 'https://example.com/page',
      canvasId: 'c1',
      position: { x: 20, y: 20 },
    });
    expect((await db.nodes.get(nodeId))?.contextScopeAgentId).toBe('agent-a');
  });
});
