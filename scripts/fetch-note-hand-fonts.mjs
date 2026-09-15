/**
 * Trial handwriting faces for note CJK (gitignored).
 * Downloads TTF if missing, then writes sibling .woff2 for the web app.
 *   npm run setup:note-hand-fonts
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { compress } = require('wawoff2');

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'fonts');

function mirrors(url) {
  return [`https://ghfast.top/${url}`, `https://gh-proxy.com/${url}`, url];
}

const files = [
  {
    dest: 'LXGWWenKaiLite-Regular.ttf',
    urls: mirrors(
      'https://github.com/lxgw/LxgwWenKai-Lite/releases/download/v1.522/LXGWWenKaiLite-Regular.ttf',
    ),
  },
  {
    dest: 'Yozai-Regular.ttf',
    urls: mirrors('https://github.com/lxgw/yozai-font/releases/download/v0.868/Yozai-Regular.ttf'),
  },
  {
    dest: 'Xiaolai-Regular.ttf',
    urls: mirrors('https://github.com/lxgw/kose-font/releases/download/v3.126/Xiaolai-Regular.ttf'),
  },
  {
    dest: 'NaniFont-Regular.ttf',
    urls: mirrors('https://raw.githubusercontent.com/max32002/nanifont/master/ttf/NaniFont-Regular.ttf'),
  },
  {
    dest: 'LXGWMarkerGothic-Regular.ttf',
    urls: mirrors(
      'https://raw.githubusercontent.com/lxgw/LxgwMarkerGothic/v1.003/fonts/ttf/LXGWMarkerGothic-Regular.ttf',
    ),
  },
  {
    dest: 'LiyuShoushu.ttf',
    urls: mirrors(
      'https://github.com/InkPantherType/LiyuShoushu/releases/download/v0.107/LiyuShoushu.ttf',
    ),
  },
  {
    dest: 'JasonHandwriting1.ttf',
    urls: mirrors(
      'https://raw.githubusercontent.com/jasonhandwriting/JasonHandwriting/master/JasonHandwriting1.ttf',
    ),
  },
];

const compressAlso = ['ZhuqueFangsong-Regular.ttf'];

async function existsBig(file) {
  try {
    const s = await stat(file);
    return s.size >= 20_000;
  } catch {
    return false;
  }
}

async function fetchOne(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 20_000) throw new Error(`too small (${buf.length} bytes)`);
  return buf;
}

await mkdir(dir, { recursive: true });
for (const file of files) {
  const target = path.join(dir, file.dest);
  if (await existsBig(target)) {
    console.log(`have ${file.dest}`);
    continue;
  }
  let lastError = null;
  for (const url of file.urls) {
    try {
      console.log(`fetch ${file.dest}\n  ${url}`);
      const buf = await fetchOne(url);
      await writeFile(target, buf);
      console.log(`wrote ${target} (${buf.length} bytes)`);
      lastError = null;
      break;
    } catch (e) {
      lastError = e;
      console.warn(`  failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (lastError) {
    throw new Error(
      `could not download ${file.dest}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }
}

for (const dest of [...files.map((f) => f.dest), ...compressAlso]) {
  const ttfPath = path.join(dir, dest);
  const woff2Path = ttfPath.replace(/\.ttf$/i, '.woff2');
  if (!(await existsBig(ttfPath))) continue;
  if (await existsBig(woff2Path)) {
    const t = await stat(ttfPath);
    const w = await stat(woff2Path);
    if (w.mtimeMs >= t.mtimeMs) {
      console.log(`have ${path.basename(woff2Path)}`);
      continue;
    }
  }
  console.log(`woff2 ${dest}`);
  const out = Buffer.from(await compress(await readFile(ttfPath)));
  await writeFile(woff2Path, out);
  console.log(`wrote ${woff2Path} (${out.length} bytes)`);
}
