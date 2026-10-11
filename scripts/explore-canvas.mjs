// Explore the real Spoor canvas and capture screenshots of key surfaces.
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT_DIR = resolve(process.cwd(), 'screenshots');
mkdirSync(OUT_DIR, { recursive: true });

const BASE = process.env.SPOOR_URL || 'http://localhost:3001';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 1 };

const log = (...a) => console.log('[x]', ...a);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function snap(page, name) {
  const file = resolve(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  log('saved', file);
}

async function clickTestId(page, testid, wait = 1500) {
  const handle = await page.$(`[data-testid="${testid}"]`);
  if (!handle) {
    log(`! no element with data-testid="${testid}"`);
    return false;
  }
  await handle.scrollIntoView();
  await sleep(200);
  const box = await handle.boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  } else {
    await handle.click().catch(() => {});
  }
  log(`clicked [${testid}]`);
  await sleep(wait);
  return true;
}

async function hoverTestId(page, testid, wait = 1500) {
  const handle = await page.$(`[data-testid="${testid}"]`);
  if (!handle) return false;
  await handle.scrollIntoView();
  await sleep(200);
  const box = await handle.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  }
  log(`hover [${testid}]`);
  await sleep(wait);
  return true;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
    defaultViewport: VIEWPORT,
  });

  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 240)));
  page.on('console', (m) => {
    if (['warning', 'error'].includes(m.type())) {
      console.log(`[browser:${m.type()}]`, m.text().slice(0, 200));
    }
  });

  try {
    log('open', BASE);
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(2500);

    // Click 开始探索
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button, a')].find((b) =>
        (b.innerText || '').includes('开始探索'),
      );
      btn?.click();
    });
    await sleep(2500);
    await snap(page, '20-canvas-default');

    // Hover 主题卡 → reveals hover toolbar with wand "问 AI" + delete
    await hoverTestId(page, 'archive-node-default-theme', 1500);
    await snap(page, '21-theme-hover');

    // Hover the ask card (阿狸) → wand 按钮
    await hoverTestId(page, 'ask-card', 1500);
    await snap(page, '22-ask-card-hover');

    // Click the + toolbar button → dropdown menu
    await clickTestId(page, 'toolbar-plus', 1200);
    await snap(page, '23-plus-menu');

    // Hover the persona menu item area to reveal them all
    await page.mouse.move(700, 100);
    await sleep(500);
    await snap(page, '24-plus-menu-personas');

    // Click toolbar voice → voice canvas overlay
    await page.mouse.click(700, 450); // dismiss menu
    await sleep(800);
    await clickTestId(page, 'toolbar-voice', 2000);
    await snap(page, '25-voice-overlay');

    // Settings panel
    await clickTestId(page, 'rail-settings', 1500);
    await snap(page, '26-settings');

    // Close settings, then open archive (left rail)
    await page.keyboard.press('Escape');
    await sleep(800);
    await clickTestId(page, 'rail-archive', 1500);
    await snap(page, '27-archive');

    // Close, then open agents rail
    await page.keyboard.press('Escape');
    await sleep(800);
    await clickTestId(page, 'rail-agents', 1500);
    await snap(page, '28-agents-panel');

    // Close, open mic bottom toolbar
    await page.keyboard.press('Escape');
    await sleep(800);
    await hoverTestId(page, 'toolbar-voice', 1500);
    await snap(page, '29-mic-tooltip');

    // Click publish button → essay
    await clickTestId(page, 'toolbar-publish', 1500);
    await snap(page, '30-publish-attempt');

    // Zoom in via toolbar
    await page.keyboard.press('Escape');
    await sleep(600);
    for (let i = 0; i < 3; i += 1) {
      await clickTestId(page, 'canvas-zoom-in', 400);
    }
    await snap(page, '31-zoomed-in');

    // Fit view
    await clickTestId(page, 'canvas-fit-view', 1500);
    await snap(page, '32-fit-view');

    // Dump the body HTML of the canvas so I can read button labels / class names
    const html = await page.evaluate(() => document.body.innerHTML);
    writeFileSync(resolve(OUT_DIR, 'final-dom.html'), html);

    log('done');
  } catch (e) {
    console.error('! error', e.message);
  } finally {
    await browser.close();
  }
})();