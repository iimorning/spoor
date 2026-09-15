// Drive the running dev server to verify the new drop-to-canvas section
// on the landing page: sits between hero and community, three cards render
// with the right copy, no layout regressions.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT_DIR = resolve(process.cwd(), 'screenshots/verify-drop-section');
mkdirSync(OUT_DIR, { recursive: true });

const BASE = process.env.SPOOR_URL || 'http://localhost:3000';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 1 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=en-US'],
  });
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  page.on('pageerror', (err) => console.log('[pageerror]', err.message));

  console.log('[1/5] goto landing', BASE);
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(2000);

  console.log('[2/5] scroll to the drop-to-canvas section');
  await page.evaluate(() => {
    document.getElementById('drop-to-canvas')?.scrollIntoView({ behavior: 'instant', block: 'start' });
  });
  await sleep(800);

  const probe = await page.evaluate(() => {
    const section = document.getElementById('drop-to-canvas');
    const heading = document.getElementById('drop-to-canvas-heading');
    const cards = Array.from(document.querySelectorAll('[data-testid^="lp-drop-card-"]'));
    const community = document.getElementById('community');
    const sectionTop = section ? section.getBoundingClientRect().top + window.scrollY : null;
    const communityTop = community ? community.getBoundingClientRect().top + window.scrollY : null;
    const sectionBottom = section ? section.getBoundingClientRect().bottom + window.scrollY : null;
    const gapPx = sectionBottom != null && communityTop != null ? communityTop - sectionBottom : null;
    const aiSection = document.getElementById('ai-capabilities');
    const aiCards = Array.from(document.querySelectorAll('[data-testid^="lp-ai-card-"]'));
    const aiBottom = aiSection ? aiSection.getBoundingClientRect().bottom + window.scrollY : null;
    const aiAboveDrop = aiSection && section
      ? aiSection.getBoundingClientRect().top + window.scrollY < section.getBoundingClientRect().bottom + window.scrollY
      : null;
    const aiAboveCommunity = aiSection && community
      ? aiSection.getBoundingClientRect().top + window.scrollY < community.getBoundingClientRect().top + window.scrollY
      : null;
    return {
      hasSection: Boolean(section),
      hasHeading: Boolean(heading),
      headingText: heading?.textContent?.trim().replace(/\s+/g, ' '),
      cardCount: cards.length,
      cardKeys: cards.map((c) => c.getAttribute('data-testid')),
      chipTexts: cards.map((c) => c.querySelector('.lp-drop-cover__chip')?.textContent?.trim()),
      sectionOrder: sectionTop != null && communityTop != null ? sectionTop < communityTop : null,
      communityGapPx: gapPx,
      hasAiSection: Boolean(aiSection),
      aiCardKeys: aiCards.map((c) => c.getAttribute('data-testid')),
      aiCaptions: aiCards.map((c) => c.querySelector('.lp-ai-card__caption')?.textContent?.trim()),
      aiAskText: aiCards.find((c) => c.getAttribute('data-testid') === 'lp-ai-card-search')
        ?.querySelector('.lp-ai-card__ask-text')?.textContent?.trim(),
      aiResultTitles: Array.from(
        document.querySelectorAll('[data-testid="lp-ai-card-search"] .lp-ai-card__result-title'),
      ).map((e) => e.textContent?.trim()),
      aiImageBadge: document.querySelector('[data-testid="lp-ai-card-image"] .lp-ai-card__gen-badge')?.textContent?.trim(),
      aiAfterDrop: aiAboveDrop,
      aiBeforeCommunity: aiAboveCommunity,
    };
  });
  console.log('[probe]', JSON.stringify(probe, null, 2));

  console.log('[3/5] screenshot drop-to-canvas section');
  await page.screenshot({
    path: resolve(OUT_DIR, 'drop-to-canvas.png'),
    fullPage: false,
  });

  console.log('[3b/5] scroll to AI capabilities + screenshot');
  await page.evaluate(() => {
    document.getElementById('ai-capabilities')?.scrollIntoView({ behavior: 'instant', block: 'start' });
  });
  await sleep(800);
  await page.screenshot({
    path: resolve(OUT_DIR, 'ai-capabilities.png'),
    fullPage: false,
  });

  console.log('[4/5] full-page screenshot');
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(500);
  await page.screenshot({
    path: resolve(OUT_DIR, 'landing-full.png'),
    fullPage: true,
  });

  console.log('[5/5] verify zh locale');
  await page.evaluate(() => {
    // The toggle shows "中文" when current locale is en, "EN" when it's zh.
    const btns = Array.from(document.querySelectorAll('button'));
    const toggle = btns.find((b) => {
      const t = b.textContent?.trim();
      return t === '中文' || t === 'EN';
    });
    if (toggle) toggle.click();
  });
  await sleep(1500);
  await page.evaluate(() => {
    document.getElementById('drop-to-canvas')?.scrollIntoView({ behavior: 'instant', block: 'start' });
  });
  await sleep(800);
  const zhProbe = await page.evaluate(() => {
    const heading = document.getElementById('drop-to-canvas-heading');
    const cards = Array.from(document.querySelectorAll('[data-testid^="lp-drop-card-"]'));
    return {
      headingText: heading?.textContent?.trim().replace(/\s+/g, ' '),
      chipTexts: cards.map((c) => c.querySelector('.lp-drop-cover__chip')?.textContent?.trim()),
    };
  });
  console.log('[zh probe]', JSON.stringify(zhProbe, null, 2));
  await page.screenshot({
    path: resolve(OUT_DIR, 'drop-to-canvas-zh.png'),
    fullPage: false,
  });
  await page.evaluate(() => {
    document.getElementById('ai-capabilities')?.scrollIntoView({ behavior: 'instant', block: 'start' });
  });
  await sleep(600);
  await page.screenshot({
    path: resolve(OUT_DIR, 'ai-capabilities-zh.png'),
    fullPage: false,
  });

  await browser.close();
  console.log('DONE. screenshots in', OUT_DIR);
}

main().catch((e) => {
  console.error('verify failed', e);
  process.exit(1);
});