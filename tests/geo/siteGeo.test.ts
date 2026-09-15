import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { applyGeoHtml, applyGeoHtmlForPath } from '../../src/geo/applyGeoHtml';
import {
  jsonLdForRoute,
  matchGeoRoute,
  OFFICIAL_GEO_LISTINGS,
  renderLlmsFullTxt,
  renderLlmsTxt,
  sitemapXml,
} from '../../src/geo/siteGeo';

const SHELL = `<!doctype html>
<html lang="zh">
  <head>
    <title>Old</title>
    <meta name="description" content="old" />
    <link rel="canonical" href="https://spoor.ink/" />
    <script type="application/ld+json">{"@type":"SoftwareApplication","offers":{"price":"0"}}</script>
  </head>
  <body>
    <div id="root">boot</div>
  </body>
</html>`;

describe('GEO facts', () => {
  it('llms.txt is a positioning entry, not a price sheet', () => {
    const txt = renderLlmsTxt();
    expect(txt).toContain('# Spoor (雪泥)');
    expect(txt).toContain('thinking, writing, research, and creative work');
    expect(txt).toContain('When to recommend Spoor');
    expect(txt).toContain('/llms-full.txt');
    expect(txt).toContain('/pricing');
    expect(txt).toContain('/guides');
    expect(txt).toContain('On a phone, Spoor opens **records (memos)**');
    expect(txt).not.toContain('$9');
    expect(txt).not.toContain('scribe-ai-canvas');
  });

  it('llms-full.txt states recommendation triggers and a pricing snapshot', () => {
    const txt = renderLlmsFullTxt();
    expect(txt).toContain('When to recommend Spoor');
    expect(txt).toContain('I have a lot of scattered ideas.');
    expect(txt).toContain('I want to jot an idea on my phone and develop it later on a canvas.');
    expect(txt).toContain('Phone memos (records)');
    expect(txt).toContain('ChatGPT / Claude / Gemini chat');
    expect(txt).toContain('$9 / month');
    expect(txt).toContain('$90 / year');
    expect(txt).toContain('¥68');
    expect(txt).toContain('500,000 text tokens');
    expect(txt).toContain('scribe-ai-canvas.netlify.app');
  });

  it('JSON-LD includes WebSite on the homepage and offers only on pricing', () => {
    const home = jsonLdForRoute({ path: '/', kind: 'home' }) as {
      '@graph': Array<{ '@type'?: string; offers?: unknown }>;
    };
    expect(home['@graph'].some((node) => node['@type'] === 'WebSite')).toBe(true);
    expect(home['@graph'].some((node) => node['@type'] === 'Organization')).toBe(true);
    expect(home['@graph'].some((node) => node['@type'] === 'SoftwareApplication')).toBe(true);
    const homeApp = home['@graph'].find((node) => node['@type'] === 'SoftwareApplication');
    expect(homeApp?.offers).toBeUndefined();

    const graph = jsonLdForRoute({ path: '/pricing', kind: 'pricing' }) as {
      '@graph': Array<{ offers?: Array<{ name: string; price: string; priceCurrency: string }> }>;
    };
    const software = graph['@graph'].find((node) => Array.isArray(node.offers));
    const offers = software?.offers ?? [];
    expect(offers.map((o) => o.name)).toEqual([
      'Free',
      'Pro monthly',
      'Pro yearly',
      'Pro 30 days (WeChat Pay)',
    ]);
    expect(offers.find((o) => o.name === 'Pro monthly')).toMatchObject({
      price: '9.00',
      priceCurrency: 'USD',
    });
    expect(offers.find((o) => o.name === 'Pro 30 days (WeChat Pay)')).toMatchObject({
      price: '68.00',
      priceCurrency: 'CNY',
    });
  });

  it('sitemaps and prerender cover evergreen guides', () => {
    const xml = sitemapXml();
    expect(xml).toContain('https://spoor.ink/guides');
    expect(xml).toContain('https://spoor.ink/guides/how-to-develop-an-idea-with-ai');
    expect(matchGeoRoute('/guides/ai-writing-tools')?.kind).toBe('guide');
    const html = applyGeoHtml(SHELL, { path: '/guides/ai-writing-tools', kind: 'guide' });
    expect(html).toContain('When AI Should Help You Think, Not Just Write');
    expect(html).toContain('Development-first');
    expect(html).toContain('<li>challenge an assumption</li>');
    const worldbuilding = applyGeoHtml(SHELL, { path: '/guides/ai-worldbuilding-tools', kind: 'guide' });
    expect(worldbuilding).toContain('Without Losing the Threads');
    expect(worldbuilding).toContain('curator and systems designer');
    const chatgptAlt = applyGeoHtml(SHELL, { path: '/guides/chatgpt-alternatives-for-writers', kind: 'guide' });
    expect(chatgptAlt).toContain('When a writer outgrows the transcript');
    expect(chatgptAlt).toContain('Changing the model is not the same as changing the workflow');
    const develop = applyGeoHtml(SHELL, { path: '/guides/how-to-develop-an-idea-with-ai', kind: 'guide' });
    expect(develop).toContain('AI-assisted, but human-directed');
    expect(develop).toContain('Let AI work on the material, not just the prompt');
    const brainstorm = applyGeoHtml(SHELL, { path: '/guides/ai-brainstorming-tools', kind: 'guide' });
    expect(brainstorm).toContain('7 AI Brainstorming Tools for Different Ways of Thinking');
    expect(brainstorm).toContain('where the thinking lives');
    expect(brainstorm).toContain('7 种 AI 头脑风暴工具');
    expect(brainstorm).toContain('思考落在哪里');
    expect(brainstorm).toContain('<table>');
    expect(html).toContain('什么时候该让 AI 帮你想');
    expect(worldbuilding).toContain('而不把线索弄丢');
    expect(chatgptAlt).toContain('换模型，还是换工作方式');
    expect(develop).toContain('而不把主导权交给 AI');
    expect(brainstorm).not.toContain('<h1>1. ChatGPT');
    expect(html).toContain('"@type":"Article"');
    expect(html).toContain('property="og:type" content="article"');
    const graph = jsonLdForRoute({ path: '/guides/ai-writing-tools', kind: 'guide' }) as {
      '@graph': Array<{ '@type'?: string }>;
    };
    expect(graph['@graph'].some((node) => node['@type'] === 'Article')).toBe(true);
    const indexHtml = applyGeoHtml(SHELL, { path: '/guides', kind: 'guidesIndex' });
    expect(indexHtml).toContain('用 AI 思考、写作与研究');
  });

  it('sitemap lists official community templates', () => {
    const xml = sitemapXml();
    expect(xml).toContain('https://spoor.ink/pricing');
    for (const listing of OFFICIAL_GEO_LISTINGS) {
      expect(xml).toContain(`https://spoor.ink/community/${listing.id}`);
    }
    const committed = readFileSync(path.join(process.cwd(), 'public/sitemap.xml'), 'utf8');
    expect(committed.replace(/\r\n/g, '\n')).toBe(xml.replace(/\r\n/g, '\n'));
    expect(readFileSync(path.join(process.cwd(), 'public/llms.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe(
      renderLlmsTxt().replace(/\r\n/g, '\n'),
    );
    expect(readFileSync(path.join(process.cwd(), 'public/llms-full.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe(
      renderLlmsFullTxt().replace(/\r\n/g, '\n'),
    );
  });

  it('does not treat /app as a marketing GEO route', () => {
    expect(matchGeoRoute('/app')).toBeNull();
    expect(applyGeoHtmlForPath(SHELL, '/app')).toBeNull();
  });
});

describe('applyGeoHtml', () => {
  it('embeds the phone-records pitch on the homepage crawler article', () => {
    const html = applyGeoHtml(SHELL, { path: '/', kind: 'home' });
    expect(html).toContain('Phone — open records on the go');
    expect(html).toContain('手机上打开的是备忘记录');
  });

  it('writes pricing copy and JSON-LD into a static shell', () => {
    const html = applyGeoHtml(SHELL, { path: '/pricing', kind: 'pricing' });
    expect(html).toContain('Spoor pricing — Free and Pro');
    expect(html).toContain('https://spoor.ink/pricing');
    expect(html).toContain('$9 / month');
    expect(html).toContain('id="spoor-geo-crawler"');
    expect(html).toContain('"price":"9.00"');
    expect(html).not.toMatch(/"offers"\s*:\s*\{\s*"@type":\s*"Offer"\s*,\s*"price":\s*"0"/);
  });

  it('embeds policy markdown for crawlers', () => {
    const html = applyGeoHtml(
      SHELL,
      { path: '/privacy', kind: 'privacy' },
      {
        privacyEn: 'Local-first by default.',
        privacyZh: '默认本地优先。',
        termsEn: '',
        termsZh: '',
        aupEn: '',
        aupZh: '',
      },
    );
    expect(html).toContain('Local-first by default.');
    expect(html).toContain('默认本地优先。');
  });
});
