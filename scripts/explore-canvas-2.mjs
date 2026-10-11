// Capture essay editor and more surfaces.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT_DIR = resolve(process.cwd(), 'screenshots');
mkdirSync(OUT_DIR, { recursive: true });

const BASE = process.env.SPOOR_URL || 'http://localhost:3001';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 1 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const snap = async (page, name) => {
  await page.screenshot({ path: resolve(OUT_DIR, `${name}.png`), fullPage: false });
  console.log('[x] saved', name);
};

const clickTestId = async (page, id, wait = 1500) => {
  const h = await page.$(`[data-testid="${id}"]`);
  if (!h) return false;
  await h.scrollIntoView();
  await sleep(200);
  const box = await h.boundingBox();
  if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  else await h.click().catch(() => {});
  console.log('[x] clicked', id);
  await sleep(wait);
  return true;
};

const hover = async (page, sel, wait = 1500) => {
  const h = await page.$(sel);
  if (!h) return false;
  await h.scrollIntoView();
  await sleep(200);
  const box = await h.boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(wait);
  return true;
};

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
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(2500);
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button, a')].find((b) =>
        (b.innerText || '').includes('开始探索'),
      );
      btn?.click();
    });
    await sleep(2500);

    // Open + menu and hover over persona section
    await clickTestId(page, 'toolbar-plus', 1000);
    await hover(page, '[data-testid="toolbar-plus"]', 800);
    // Find the persona section
    await page.evaluate(() => {
      const section = [...document.querySelectorAll('*')].find((el) =>
        el.textContent === '角色' && el.children.length === 0,
      );
      section?.parentElement?.parentElement?.scrollIntoView({ block: 'center' });
    });
    await sleep(600);
    await snap(page, '40-plus-menu-full');

    // Hover one of the persona rows
    await page.evaluate(() => {
      const items = [...document.querySelectorAll('button')].filter((b) => b.innerText.includes('造宇宙'));
      items[0]?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      items[0]?.parentElement?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    });
    await sleep(500);
    await snap(page, '41-plus-menu-cosmos-hover');

    // Click publish with cards selected — select a couple cards first
    await page.mouse.click(700, 400); // dismiss
    await sleep(700);

    // Try selecting the standard note by clicking it then shift-clicking theme
    await page.evaluate(() => {
      const note = document.querySelector('[data-testid="note-node-shell"]');
      const theme = document.querySelectorAll('[data-testid="archive-node-default-theme"]');
      note?.parentElement?.parentElement?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, shiftKey: true }));
      theme[0]?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, shiftKey: true }));
    });
    await sleep(500);
    await snap(page, '42-select-attempt');

    // Open persona editor — click 角色 in the side rail
    await page.evaluate(() => {
      document.querySelector('[data-testid="rail-agents"]')?.click();
    });
    await sleep(1500);
    await snap(page, '43-persona-editor');

    // Try each persona — click 占星术
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.innerText.includes('占星术'));
      btn?.click();
    });
    await sleep(1200);
    await snap(page, '44-persona-futurist');

    // Close
    await page.keyboard.press('Escape');
    await sleep(800);

    // Try a right rail or a specific canvas action: click an image card (none yet)
    // Upload an image: click toolbar-upload is a hidden input — can't directly.
    // Instead, drag the fox into the canvas? Skip for now.

    // Snap the canvas with hover on 阿狸
    await hover(page, '[data-testid="ask-card"]', 1000);
    await snap(page, '45-ask-hover');

    console.log('done');
  } catch (e) {
    console.error('!', e.message);
  } finally {
    await browser.close();
  }
})();