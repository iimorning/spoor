// Screenshot the live Spoor app so we can ground the promo video in reality.
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT_DIR = resolve(process.cwd(), 'screenshots');
mkdirSync(OUT_DIR, { recursive: true });

const BASE = process.env.SPOOR_URL || 'http://localhost:3001';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 1 };

const log = (...a) => console.log('[snap]', ...a);

async function ensureLoaded(page) {
  // Wait until either the canvas HUD, the Ask AI input, or some known shell is up.
  await page.waitForSelector('body', { timeout: 30000 });
  // Small settle delay for canvases/fonts/animations
  await new Promise((r) => setTimeout(r, 1500));
}

async function snap(page, name) {
  const file = resolve(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  log('saved', file);
}

async function dumpDom(page, name) {
  const html = await page.evaluate(() => document.body.innerHTML);
  const file = resolve(OUT_DIR, `${name}.html`);
  writeFileSync(file, html);
  log('dom ->', file);
}

async function clickText(page, text, opts = {}) {
  const handle = await page.evaluateHandle((needle) => {
    const all = Array.from(document.querySelectorAll('button, a, [role="button"]'));
    return all.find((el) => (el.innerText || el.textContent || '').trim().includes(needle));
  }, text);
  const el = handle.asElement();
  if (!el) {
    log(`! no button matching "${text}"`);
    return false;
  }
  await el.scrollIntoViewIfNeeded?.();
  await new Promise((r) => setTimeout(r, 200));
  const box = await el.boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  } else {
    await el.click().catch(() => {});
  }
  log(`clicked "${text}"`);
  await new Promise((r) => setTimeout(r, opts.wait ?? 1500));
  return true;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--hide-scrollbars',
    ],
    defaultViewport: VIEWPORT,
  });

  const page = await browser.newPage();
  page.on('console', (msg) => {
    if (['warning', 'error'].includes(msg.type())) {
      console.log(`[browser:${msg.type()}]`, msg.text().slice(0, 240));
    }
  });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 240)));

  try {
    log('open', BASE);
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
    await ensureLoaded(page);
    await snap(page, '01-landing');

    // Click the orange "开始探索" button if present
    await clickText(page, '开始探索', { wait: 3000 });
    await snap(page, '02-after-explore');

    // Dump current DOM so we know what selectors to use next
    await dumpDom(page, '02-after-explore');

    // Try to dismiss any onboarding overlays
    await clickText(page, '跳过', { wait: 1200 }).catch(() => {});
    await clickText(page, '稍后', { wait: 1200 }).catch(() => {});
    await clickText(page, '知道了', { wait: 1200 }).catch(() => {});

    await snap(page, '03-canvas');

    // Look for an "Ask" or voice button near the bottom
    const asked = await clickText(page, 'Ask', { wait: 1500 });
    if (asked) await snap(page, '04-ask');

    const askedZh = await clickText(page, '问问', { wait: 1500 });
    if (askedZh) await snap(page, '04b-ask-zh');

    const mic = await clickText(page, '麦克风', { wait: 1500 });
    if (mic) await snap(page, '05-mic');

    // Try "角色" / "Personas"
    const personas = await clickText(page, '角色', { wait: 1500 });
    if (personas) await snap(page, '06-personas');

    // Click somewhere neutral to deselect
    await page.mouse.click(720, 450);
    await new Promise((r) => setTimeout(r, 1000));
    await snap(page, '07-canvas-clean');

    await dumpDom(page, '07-canvas-clean');
  } catch (e) {
    console.error('! error:', e.message);
    try {
      await snap(page, 'error-state');
      await dumpDom(page, 'error-state');
    } catch {}
  } finally {
    await browser.close();
  }
})();