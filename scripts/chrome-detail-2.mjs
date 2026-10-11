// Recapture chrome with onboarding dismissed.
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT_DIR = resolve(process.cwd(), 'screenshots/chrome');
mkdirSync(OUT_DIR, { recursive: true });

const BASE = process.env.SPOOR_URL || 'http://localhost:3003';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 2 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
    defaultViewport: VIEWPORT,
  });

  const page = await browser.newPage();

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

    // Dismiss onboarding — click 跳过引导 link or 下一步 button until done
    for (let i = 0; i < 10; i += 1) {
      const dismissed = await page.evaluate(() => {
        const skip = [...document.querySelectorAll('button, a')].find((b) =>
          (b.innerText || '').includes('跳过引导'),
        );
        const next = [...document.querySelectorAll('button, a')].find((b) =>
          (b.innerText || '').includes('下一步'),
        );
        if (skip) { skip.click(); return 'skip'; }
        if (next) { next.click(); return 'next'; }
        return null;
      });
      if (!dismissed) break;
      await sleep(500);
    }
    await sleep(800);

    // Tag the chrome for precise clips
    await page.evaluate(() => {
      document.querySelector('[data-testid="side-rail"]')?.setAttribute('data-clip-rail', 'true');
      document.querySelector('main > div.absolute.top-6')?.setAttribute('data-clip-topright', 'true');
      const overlays = [...document.querySelectorAll('[data-canvas-overlay]')];
      for (const el of overlays) {
        const cls = el.className;
        if (/bottom-3/.test(cls) && /left-1\/2/.test(cls)) el.setAttribute('data-clip-toolbar', 'true');
        if (/bottom-3/.test(cls) && /right-6/.test(cls)) el.setAttribute('data-clip-zoom', 'true');
      }
    });

    // Clip each chrome region (with padding for context)
    async function clip(name, sel) {
      const h = await page.$(sel);
      if (!h) return console.log('! no', sel);
      const box = await h.boundingBox();
      if (!box) return;
      await page.screenshot({
        path: resolve(OUT_DIR, `${name}.png`),
        clip: { x: box.x - 24, y: box.y - 24, width: box.width + 48, height: box.height + 48 },
      });
      console.log('clip', name);
    }

    await clip('A1-side-rail', '[data-clip-rail="true"]');
    await clip('A2-top-right', '[data-clip-topright="true"]');
    await clip('A3-toolbar-center', '[data-clip-toolbar="true"]');
    await clip('A4-zoom', '[data-clip-zoom="true"]');

    // Full canvas without onboarding
    await page.screenshot({ path: resolve(OUT_DIR, 'A0-canvas-clean.png') });

    // Hover each side-rail button
    for (const tid of ['rail-archive', 'rail-agents', 'rail-settings']) {
      const h = await page.$(`[data-testid="${tid}"]`);
      if (h) {
        const box = await h.boundingBox();
        if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      }
      await sleep(600);
      await clip(`B-${tid}`, '[data-clip-rail="true"]');
    }

    // Hover the ask-card to reveal hover toolbar
    const askH = await page.$('[data-testid="ask-card"]');
    if (askH) {
      const box = await askH.boundingBox();
      if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    }
    await sleep(700);
    await page.screenshot({ path: resolve(OUT_DIR, 'C-ask-hover.png') });

    // Open + menu
    await page.click('[data-testid="toolbar-plus"]');
    await sleep(800);
    await clip('C-plus-dropdown', '[data-clip-toolbar="true"]');
    await page.screenshot({ path: resolve(OUT_DIR, 'C-plus-full.png') });

    // Dismiss menu
    await page.mouse.click(700, 600);
    await sleep(600);

    // Click toolbar-voice
    await page.click('[data-testid="toolbar-voice"]');
    await sleep(1500);
    await page.screenshot({ path: resolve(OUT_DIR, 'D-voice-mode.png') });
    // Capture only the right side of screen where voice bubble appears
    await page.screenshot({
      path: resolve(OUT_DIR, 'D-voice-mode-right.png'),
      clip: { x: 700, y: 80, width: 700, height: 800 },
    });

    // Close voice, open persona editor
    await page.keyboard.press('Escape');
    await sleep(500);
    await page.click('[data-testid="rail-agents"]');
    await sleep(1500);
    await page.screenshot({ path: resolve(OUT_DIR, 'E-persona-default.png') });

    // Switch to 占星术
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.innerText.includes('占星术'));
      btn?.click();
    });
    await sleep(1000);
    await page.screenshot({ path: resolve(OUT_DIR, 'E-persona-futurist.png') });

    // Switch to 真知镜
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.innerText.includes('真知镜'));
      btn?.click();
    });
    await sleep(1000);
    await page.screenshot({ path: resolve(OUT_DIR, 'E-persona-mirror.png') });

    // Dump persona editor DOM
    const personaHtml = await page.evaluate(() => document.body.innerHTML);
    writeFileSync(resolve(OUT_DIR, 'E-persona-dom.html'), personaHtml);

    // Close, open archive
    await page.keyboard.press('Escape');
    await sleep(500);
    await page.click('[data-testid="rail-archive"]');
    await sleep(1500);
    await page.screenshot({ path: resolve(OUT_DIR, 'F-archive.png') });

    // Close, open settings
    await page.keyboard.press('Escape');
    await sleep(500);
    await page.click('[data-testid="rail-settings"]');
    await sleep(1500);
    await page.screenshot({ path: resolve(OUT_DIR, 'G-settings.png') });

    // Dump settings DOM
    const settingsHtml = await page.evaluate(() => document.body.innerHTML);
    writeFileSync(resolve(OUT_DIR, 'G-settings-dom.html'), settingsHtml);

    console.log('done');
  } catch (e) {
    console.error('!', e.message);
  } finally {
    await browser.close();
  }
})();