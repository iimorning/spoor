import { describe, expect, it } from 'vitest';
import { applyDocumentSeo, resolveDocumentSeo, SITE_OG_IMAGE_URL } from '../../src/utils/siteSeo';

describe('resolveDocumentSeo', () => {
  it('describes the homepage in English by default', () => {
    const spec = resolveDocumentSeo({ pathname: '/' });
    expect(spec.noindex).toBe(false);
    expect(spec.canonicalPath).toBe('/');
    expect(spec.title).toMatch(/Infinite Canvas/i);
    expect(spec.description).toMatch(/Capture records on your phone/i);
  });

  it('uses Chinese copy when language is zh', () => {
    const spec = resolveDocumentSeo({ pathname: '/', language: 'zh' });
    expect(spec.language).toBe('zh');
    expect(spec.title).toContain('雪泥');
    expect(spec.description).toMatch(/手机上也能打开记录/);
  });

  it('marks /app as noindex', () => {
    const spec = resolveDocumentSeo({ pathname: '/app' });
    expect(spec.noindex).toBe(true);
    expect(spec.canonicalPath).toBe('/app');
  });

  it('describes guide articles', () => {
    const spec = resolveDocumentSeo({ pathname: '/guides/ai-brainstorming-tools' });
    expect(spec.canonicalPath).toBe('/guides/ai-brainstorming-tools');
    expect(spec.title).toMatch(/Brainstorming/i);
    expect(spec.noindex).toBe(false);
  });

  it('uses Chinese guide copy when language is zh', () => {
    const spec = resolveDocumentSeo({
      pathname: '/guides/ai-brainstorming-tools',
      language: 'zh',
    });
    expect(spec.title).toContain('头脑风暴');
    expect(spec.description).toMatch(/持久画布/);
  });

  it('uses a listing title on community detail URLs', () => {
    const spec = resolveDocumentSeo({
      pathname: '/community/abc',
      listingTitle: 'Mirror studio',
      listingDescription: 'A critique canvas.',
    });
    expect(spec.canonicalPath).toBe('/community/abc');
    expect(spec.title).toContain('Mirror studio');
    expect(spec.description).toBe('A critique canvas.');
  });
});

describe('applyDocumentSeo', () => {
  it('writes title, robots, and canonical into the document', () => {
    applyDocumentSeo({
      title: 'Test title',
      description: 'Test description',
      canonicalPath: '/pricing',
      noindex: false,
      language: 'en',
    });
    expect(document.title).toBe('Test title');
    expect(document.documentElement.lang).toBe('en');
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
      'Test description',
    );
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      'https://spoor.ink/pricing',
    );
    expect(document.head.querySelector('meta[property="og:image"]')?.getAttribute('content')).toBe(
      SITE_OG_IMAGE_URL,
    );
  });

  it('sets noindex on the app shell', () => {
    applyDocumentSeo({
      title: 'Spoor',
      description: 'canvas',
      canonicalPath: '/app',
      noindex: true,
      language: 'en',
    });
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
      'noindex, nofollow',
    );
  });
});
