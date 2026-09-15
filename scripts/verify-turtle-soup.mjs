// Drive the running dev server to verify the turtle-soup canvas onboarding
// tour fires correctly when the user applies the official turtle-soup listing.
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT_DIR = resolve(process.cwd(), 'screenshots/verify-turtle-soup');
mkdirSync(OUT_DIR, { recursive: true });

const BASE = process.env.SPOOR_URL || 'http://localhost:3000';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 1 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shoot(page, name) {
  const path = resolve(OUT_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  return path;
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=en-US'],
  });
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  page.on('pageerror', (err) => console.log('[pageerror]', err.message));

  console.log('[1/6] goto landing', BASE);
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1500);

  await page.evaluate(() => {
    try {
      localStorage.removeItem('onboarding_completed_v2');
      localStorage.removeItem('onboarding_completed_v3');
      localStorage.removeItem('onboarding_completed_v4');
      localStorage.removeItem('onboarding_completed_v5');
      localStorage.removeItem('onboarding_intuition_pump_v1');
      localStorage.removeItem('onboarding_turtle_soup_v1');
    } catch {}
  });

  console.log('[2/6] apply the official turtle-soup listing');
  await page.evaluate(async () => {
    const mod = await import('/src/utils/applyCommunityListing.ts');
    const listingId = '11111111-1111-4111-8111-111111111111';
    const listing = {
      id: listingId,
      author_id: '00000000-0000-0000-0000-000000000001',
      author_name: 'Spoor',
      kind: 'canvas',
      title: 'Turtle Soup: Lateral Thinking',
      description: 'One persona runs the whole game.',
      cover_url: null,
      payload: {
        version: 1,
        kind: 'canvas',
        template: {
          id: 'official:turtle-soup-template',
          name: 'Turtle Soup: Lateral Thinking',
          description: 'One persona runs the whole game.',
          origin: 'user',
          builtinKey: null,
          listed: true,
          personaIds: ['turtle_soup_host'],
          nodes: [],
          edges: [],
          createdAt: 0,
          updatedAt: 0,
        },
        agents: [],
      },
      published: true,
      is_official: true,
      like_count: 0,
      favorite_count: 0,
      comment_count: 0,
      apply_count: 0,
      created_at: new Date().toISOString(),
    };
    await mod.applyCommunityListing(listing);
  });

  console.log('[3/6] navigate to /app');
  await page.goto(BASE + '/app', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(
    () => document.querySelector('[data-testid="template-node-theme-howto"]') ||
          document.querySelector('[data-testid="onboarding-tooltip"]'),
    { timeout: 15000 },
  );
  await sleep(2500);

  console.log('[4/6] probe step 1');
  const probe1 = await page.evaluate(() => {
    const tooltip = document.querySelector('[data-testid="onboarding-tooltip"]');
    return {
      hasHowto: Boolean(document.querySelector('[data-testid="template-node-theme-howto"]')),
      hasHost: Boolean(document.querySelector('[data-testid="template-node-agent-host"]')),
      hasNoteStart: Boolean(document.querySelector('[data-testid="template-node-note-start"]')),
      hasAsk: Boolean(document.querySelector('[data-testid="template-node-ask"]')),
      hasTooltip: Boolean(tooltip),
      tooltipTitle: tooltip ? tooltip.querySelector('h2')?.textContent : null,
    };
  });
  console.log('[probe step 1]', JSON.stringify(probe1));
  writeFileSync(resolve(OUT_DIR, 'probe-step-1.json'), JSON.stringify(probe1, null, 2));
  await shoot(page, 'step-1-read-rules');

  console.log('[5/6] advance through steps 2-4');
  await page.evaluate(() => document.querySelector('[data-testid="onboarding-next"]')?.click());
  await sleep(1200);
  const probe2 = await page.evaluate(() => {
    const tooltip = document.querySelector('[data-testid="onboarding-tooltip"]');
    return {
      tooltipTitle: tooltip ? tooltip.querySelector('h2')?.textContent : null,
    };
  });
  console.log('[probe step 2]', JSON.stringify(probe2));
  await shoot(page, 'step-2-meet-host');

  await page.evaluate(() => document.querySelector('[data-testid="onboarding-next"]')?.click());
  await sleep(1200);
  const probe3 = await page.evaluate(() => {
    const tooltip = document.querySelector('[data-testid="onboarding-tooltip"]');
    const wand = document.querySelector('[data-testid="note-ask-ai"]');
    return {
      tooltipTitle: tooltip ? tooltip.querySelector('h2')?.textContent : null,
      hasWand: Boolean(wand),
      wandVisible: wand ? window.getComputedStyle(wand).opacity : null,
    };
  });
  console.log('[probe step 3]', JSON.stringify(probe3));
  await shoot(page, 'step-3-type-question');

  await page.evaluate(() => document.querySelector('[data-testid="onboarding-next"]')?.click());
  await sleep(1200);
  const probe4 = await page.evaluate(() => {
    const tooltip = document.querySelector('[data-testid="onboarding-tooltip"]');
    return {
      tooltipTitle: tooltip ? tooltip.querySelector('h2')?.textContent : null,
    };
  });
  console.log('[probe step 4]', JSON.stringify(probe4));
  await shoot(page, 'step-4-voice');

  console.log('[6/6] finish the tour');
  await page.evaluate(() => document.querySelector('[data-testid="onboarding-next"]')?.click());
  await sleep(1000);
  const finalProbe = await page.evaluate(() => ({
    tooltipGone: !document.querySelector('[data-testid="onboarding-tooltip"]'),
    storageFlag: (() => {
      try { return localStorage.getItem('onboarding_turtle_soup_v1'); } catch { return 'no-localStorage'; }
    })(),
  }));
  console.log('[probe final]', JSON.stringify(finalProbe));
  await shoot(page, 'after-tour');

  await browser.close();
  console.log('DONE. screenshots in', OUT_DIR);
}

main().catch((e) => {
  console.error('verify failed', e);
  process.exit(1);
});