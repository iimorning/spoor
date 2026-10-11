// Re-capture persona editor, archive, settings (separately from the prior script).
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
    // Dismiss onboarding
    for (let i = 0; i < 12; i += 1) {
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

    // Persona editor (rail-agents)
    await page.click('[data-testid="rail-agents"]');
    await sleep(1500);
    await page.screenshot({ path: resolve(OUT_DIR, 'E1-persona-default.png') });

    // Click 占星术 to highlight it
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === '占星术');
      btn?.click();
    });
    await sleep(1000);
    await page.screenshot({ path: resolve(OUT_DIR, 'E2-persona-futurist.png') });

    // Dump DOM
    writeFileSync(resolve(OUT_DIR, 'E-persona-dom.html'), await page.evaluate(() => document.body.innerHTML));

    // Close
    await page.keyboard.press('Escape');
    await sleep(700);

    // Archive
    await page.click('[data-testid="rail-archive"]');
    await sleep(1500);
    await page.screenshot({ path: resolve(OUT_DIR, 'F-archive.png') });

    // Close
    await page.keyboard.press('Escape');
    await sleep(700);

    // Settings
    await page.click('[data-testid="rail-settings"]');
    await sleep(1500);
    await page.screenshot({ path: resolve(OUT_DIR, 'G-settings.png') });
    writeFileSync(resolve(OUT_DIR, 'G-settings-dom.html'), await page.evaluate(() => document.body.innerHTML));

    console.log('done');
  } catch (e) {
    console.error('!', e.message);
  } finally {
    await browser.close();
  }
})();