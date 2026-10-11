// Precisely capture each chrome element of the real Spoor canvas so we can
// match them in the Remotion promo. Auto-mode: just dump everything we need.
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT_DIR = resolve(process.cwd(), 'screenshots/chrome');
mkdirSync(OUT_DIR, { recursive: true });

const BASE = process.env.SPOOR_URL || 'http://localhost:3003';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 2 }; // HiDPI

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[chrome]', ...a);

async function clip(page, name, selector) {
  const handle = await page.$(selector);
  if (!handle) {
    log('! no element', selector);
    return;
  }
  const box = await handle.boundingBox();
  if (!box) return;
  await page.screenshot({
    path: resolve(OUT_DIR, `${name}.png`),
    clip: { x: box.x - 12, y: box.y - 12, width: box.width + 24, height: box.height + 24 },
  });
  log('clip', name);
}

async function snap(page, name) {
  await page.screenshot({ path: resolve(OUT_DIR, `${name}.png`), fullPage: false });
  log('snap', name);
}

async function hover(page, selector, wait = 1000) {
  const h = await page.$(selector);
  if (!h) return;
  await h.scrollIntoView();
  await sleep(200);
  const box = await h.boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(wait);
}

async function dumpDom(page, name, selector) {
  const html = await page.evaluate((sel) => {
    const el = sel ? document.querySelector(sel) : document.body;
    return el ? el.outerHTML : '';
  }, selector);
  writeFileSync(resolve(OUT_DIR, `${name}.html`), html);
  log('dom', name, html.length);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
    defaultViewport: VIEWPORT,
  });

  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 200)));

  try {
    log('open', BASE);
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(2500);
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button, a')].find((b) =>
        (b.innerText || '').includes('开始探索'),
      );
      btn?.click();
    });
    await sleep(2500);

    // Default canvas state
    await snap(page, '00-canvas-default');

    // Side rail close-up
    await clip(page, '10-side-rail', '[data-testid="side-rail"]');

    // Hover rail-agents to show hover state
    await hover(page, '[data-testid="rail-agents"]');
    await clip(page, '11-side-rail-agents-hover', '[data-testid="side-rail"]');

    // Top-right toolbar — three icons
    await clip(page, '20-top-right', 'main > div.absolute.top-6');

    // Bottom-left palette — find it (it's not testid'd but has the bottom-3 left positioning)
    // We can locate it as: the absolute element with bottom-3 and left NOT centered
    const paletteHandle = await page.evaluate(() => {
      const overlays = [...document.querySelectorAll('[data-canvas-overlay]')];
      // Find the one with bottom-3 + left positioning (palette), not the centered one
      for (const el of overlays) {
        const cls = el.className;
        if (/left-/.test(cls) && !/left-1\/2/.test(cls)) {
          el.setAttribute('data-detail-palette', 'true');
          return true;
        }
      }
      return false;
    });
    log('palette marked:', paletteHandle);
    await sleep(500);
    await clip(page, '30-bottom-palette', '[data-detail-palette="true"]');

    // Hover each palette icon (and capture the orange volume slider too)
    const paletteIcons = await page.$$('[data-detail-palette="true"] button, [data-detail-palette="true"] [role="button"]');
    log('palette buttons found:', paletteIcons.length);

    // Hover the FIRST palette button (currently orange/active per screenshot)
    if (paletteIcons[0]) {
      await hover(page, '[data-detail-palette="true"] button:nth-of-type(1), [data-detail-palette="true"] [role="button"]:nth-of-type(1)', 800);
      await clip(page, '31-palette-hover-1', '[data-detail-palette="true"]');
    }

    // Bottom-center toolbar
    const centerHandle = await page.evaluate(() => {
      const overlays = [...document.querySelectorAll('[data-canvas-overlay]')];
      for (const el of overlays) {
        const cls = el.className;
        if (/bottom-3/.test(cls) && /left-1\/2/.test(cls)) {
          el.setAttribute('data-detail-toolbar', 'true');
          return true;
        }
      }
      return false;
    });
    log('center toolbar marked:', centerHandle);
    await sleep(500);
    await clip(page, '40-toolbar-center', '[data-detail-toolbar="true"]');

    // Open the + menu so we see the dropdown
    await page.click('[data-testid="toolbar-plus"]');
    await sleep(800);
    await snap(page, '41-plus-menu-open');
    await clip(page, '42-plus-dropdown', '[data-detail-toolbar="true"]');

    // Click somewhere neutral
    await page.mouse.click(700, 600);
    await sleep(700);

    // Hover 阿狸 to reveal hover toolbar (× + ✦)
    await hover(page, '[data-testid="ask-card"]', 800);
    await snap(page, '50-ask-card-hover');

    // Click on the 阿狸 wand button (问 AI)
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="ask-card"]')
        ?.closest('.absolute.group')
        ?.querySelector('[data-testid="note-ask-ai"]');
      btn?.click();
    });
    await sleep(800);
    await snap(page, '51-ask-card-wand-open');

    // Close (Escape) and open 角色 rail
    await page.keyboard.press('Escape');
    await sleep(500);
    await page.click('[data-testid="rail-agents"]');
    await sleep(1500);
    await snap(page, '60-persona-editor');
    await dumpDom(page, '60-persona-editor-full', null);

    // Try each persona — start with 占星术
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.innerText.includes('占星术'));
      btn?.click();
    });
    await sleep(1000);
    await snap(page, '61-persona-futurist');

    // 真知镜
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.innerText.includes('真知镜'));
      btn?.click();
    });
    await sleep(1000);
    await snap(page, '62-persona-mirror');

    // Close persona editor, open archive
    await page.keyboard.press('Escape');
    await sleep(500);
    await page.click('[data-testid="rail-archive"]');
    await sleep(1500);
    await snap(page, '70-archive');

    // Open settings
    await page.keyboard.press('Escape');
    await sleep(500);
    await page.click('[data-testid="rail-settings"]');
    await sleep(1500);
    await snap(page, '80-settings');
    await dumpDom(page, '80-settings-full', null);

    // Final: dump the chrome elements with their outerHTML for precise replication
    await page.keyboard.press('Escape');
    await sleep(500);
    await dumpDom(page, 'final-full', null);

    log('done');
  } catch (e) {
    console.error('!', e.message);
  } finally {
    await browser.close();
  }
})();