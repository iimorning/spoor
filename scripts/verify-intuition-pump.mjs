// Drive the running dev server to verify the intuition-pump template no
// longer renders a "Start one" note and the canvas onboarding tour overlay
// points at the correct cards.
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT_DIR = resolve(process.cwd(), 'screenshots/verify-intuition-pump');
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
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[console.error]', msg.text());
  });

  console.log('[1/8] goto landing', BASE);
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1500);

  // Clear localStorage so the tours fire fresh.
  await page.evaluate(() => {
    try {
      localStorage.removeItem('onboarding_completed_v2');
      localStorage.removeItem('onboarding_completed_v3');
      localStorage.removeItem('onboarding_completed_v4');
      localStorage.removeItem('onboarding_completed_v5');
      localStorage.removeItem('onboarding_intuition_pump_v1');
    } catch {}
  });

  // Pre-seed the Supabase-mirrored intuition-pump listing row into IndexedDB
  // so the app treats the community page as reachable without auth.
  console.log('[2/8] pre-seed intuition-pump listing');
  await page.evaluate(async () => {
    const open = indexedDB.open('SpoorDatabase');
    await new Promise((res, rej) => {
      open.onsuccess = () => res();
      open.onerror = () => rej(open.error);
      open.onupgradeneeded = () => res();
    });
    const db = open.result;
    const stores = Array.from(db.objectStoreNames);
    const hasListings = stores.includes('community_listings');
    db.close();
    if (!hasListings) return;
    const open2 = indexedDB.open('SpoorDatabase');
    await new Promise((res, rej) => {
      open2.onsuccess = () => res();
      open2.onerror = () => rej(open2.error);
    });
    const db2 = open2.result;
    const tx = db2.transaction('community_listings', 'readwrite');
    const store = tx.objectStore('community_listings');
    const listingId = '22222222-2222-4222-8222-222222222222';
    const row = {
      id: listingId,
      kind: 'canvas',
      title: 'Intuition Pump: Thought Experiments',
      description: 'Turn an abstract concept into a small scene.',
      cover_url: null,
      payload: {
        version: 1,
        kind: 'canvas',
        template: {
          id: 'official:intuition-pump-template',
          name: 'Intuition Pump: Thought Experiments',
          description: 'Turn an abstract concept into a small scene.',
          origin: 'user',
          builtinKey: null,
          listed: true,
          personaIds: ['intuition_pump_expert'],
          nodes: [],
          edges: [],
          createdAt: 0,
          updatedAt: 0,
        },
        agents: [],
      },
      published: true,
      is_official: true,
      author_id: '00000000-0000-0000-0000-000000000001',
      author_name: 'Spoor',
      like_count: 0,
      favorite_count: 0,
      comment_count: 0,
      apply_count: 0,
      created_at: new Date().toISOString(),
    };
    await new Promise((res, rej) => {
      const req = store.put(row);
      req.onsuccess = () => res();
      req.onerror = () => rej(req.error);
    });
    db2.close();
  });

  // Use the in-page module API to call applyCommunityListing directly.
  console.log('[3/8] trigger apply via app module');
  await page.evaluate(async () => {
    const mod = await import('/src/utils/applyCommunityListing.ts');
    const listingId = '22222222-2222-4222-8222-222222222222';
    const listing = {
      id: listingId,
      author_id: '00000000-0000-0000-0000-000000000001',
      author_name: 'Spoor',
      kind: 'canvas',
      title: 'Intuition Pump: Thought Experiments',
      description: 'Turn an abstract concept into a small scene.',
      cover_url: null,
      payload: {
        version: 1,
        kind: 'canvas',
        template: {
          id: 'official:intuition-pump-template',
          name: 'Intuition Pump: Thought Experiments',
          description: 'Turn an abstract concept into a small scene.',
          origin: 'user',
          builtinKey: null,
          listed: true,
          personaIds: ['intuition_pump_expert'],
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

  console.log('[4/8] navigate to /app via direct goto');
  await page.goto(BASE + '/app', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(
    () => document.querySelector('[data-testid="template-node-theme-howto"]') ||
          document.querySelector('[data-testid="onboarding-tooltip"]') ||
          document.querySelector('main'),
    { timeout: 15000 },
  );
  await sleep(2500);

  // Probe the DOM for the intuition-pump canvas template-key nodes.
  console.log('[5/8] probe DOM for template nodes');
  const probe = await page.evaluate(() => {
    function $$(sel) { return Array.from(document.querySelectorAll(sel)); }
    const howto = document.querySelector('[data-testid="template-node-theme-howto"]');
    const host = document.querySelector('[data-testid="template-node-agent-host"]');
    const start = document.querySelector('[data-testid="template-node-note-start"]');
    const ask = document.querySelector('[data-testid="template-node-ask"]');
    const cutout = document.querySelector('[data-testid="onboarding-cutout"]');
    const tooltip = document.querySelector('[data-testid="onboarding-tooltip"]');
    const tooltipTitle = tooltip ? tooltip.querySelector('h2') : null;
    return {
      hasHowto: Boolean(howto),
      hasHost: Boolean(host),
      hasNoteStart: Boolean(start),
      hasAsk: Boolean(ask),
      hasCutout: Boolean(cutout),
      hasTooltip: Boolean(tooltip),
      tooltipTitle: tooltipTitle ? tooltipTitle.textContent : null,
      allTestIds: $$('[data-testid]').map((el) => el.getAttribute('data-testid')),
    };
  });
  console.log('[probe]', JSON.stringify(probe, null, 2));

  await shoot(page, 'canvas-with-onboarding');
  writeFileSync(resolve(OUT_DIR, 'probe.json'), JSON.stringify(probe, null, 2));

  console.log('[6/8] advance the tour once');
  await page.evaluate(() => {
    const next = document.querySelector('[data-testid="onboarding-next"]');
    if (next) next.click();
  });
  await sleep(1500);
  const probe2 = await page.evaluate(() => {
    const tooltip = document.querySelector('[data-testid="onboarding-tooltip"]');
    const tooltipTitle = tooltip ? tooltip.querySelector('h2') : null;
    const target = tooltip ? tooltip.getAttribute('aria-labelledby') : null;
    return {
      hasTooltip: Boolean(tooltip),
      tooltipTitle: tooltipTitle ? tooltipTitle.textContent : null,
    };
  });
  console.log('[probe step 2]', JSON.stringify(probe2, null, 2));
  await shoot(page, 'canvas-onboarding-step-2');

  console.log('[7/8] advance to step 3 (text-first)');
  await page.evaluate(() => {
    const next = document.querySelector('[data-testid="onboarding-next"]');
    if (next) next.click();
  });
  await sleep(1500);
  const probe3 = await page.evaluate(() => {
    const tooltip = document.querySelector('[data-testid="onboarding-tooltip"]');
    const tooltipTitle = tooltip ? tooltip.querySelector('h2') : null;
    const wand = document.querySelector('[data-testid="note-ask-ai"]');
    return {
      hasTooltip: Boolean(tooltip),
      tooltipTitle: tooltipTitle ? tooltipTitle.textContent : null,
      hasWand: Boolean(wand),
      wandVisible: wand ? window.getComputedStyle(wand).opacity : null,
    };
  });
  console.log('[probe step 3]', JSON.stringify(probe3, null, 2));
  await shoot(page, 'canvas-onboarding-step-3-text');

  console.log('[7b/8] advance to step 4 (voice)');
  await page.evaluate(() => {
    const next = document.querySelector('[data-testid="onboarding-next"]');
    if (next) next.click();
  });
  await sleep(1500);
  const probe4 = await page.evaluate(() => {
    const tooltip = document.querySelector('[data-testid="onboarding-tooltip"]');
    const tooltipTitle = tooltip ? tooltip.querySelector('h2') : null;
    return {
      hasTooltip: Boolean(tooltip),
      tooltipTitle: tooltipTitle ? tooltipTitle.textContent : null,
    };
  });
  console.log('[probe step 4]', JSON.stringify(probe4, null, 2));
  await shoot(page, 'canvas-onboarding-step-4-voice');

  console.log('[8/8] verify Done button finishes the tour');
  await page.evaluate(() => {
    const next = document.querySelector('[data-testid="onboarding-next"]');
    if (next) next.click();
  });
  await sleep(1000);
  const finalProbe = await page.evaluate(() => {
    return {
      tooltipGone: !document.querySelector('[data-testid="onboarding-tooltip"]'),
      storageFlag: (() => {
        try { return localStorage.getItem('onboarding_intuition_pump_v1'); } catch { return 'no-localStorage'; }
      })(),
    };
  });
  console.log('[probe final]', JSON.stringify(finalProbe, null, 2));
  await shoot(page, 'canvas-after-tour');

  await browser.close();
  console.log('DONE. screenshots in', OUT_DIR);
}

main().catch((e) => {
  console.error('verify failed', e);
  process.exit(1);
});