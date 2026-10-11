import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const FRESH_BATCH_TARGET = 13;
const RSS_PAGE_LIMIT = 100;
const MAX_RSS_PAGES = 10;
const RSS_URL = 'https://www.reddit.com/r/NoteTaking+PKMS+ObsidianMD+productivity/search.rss';
const RSS_QUERY =
  'frustrated OR stuck OR issue OR broken OR "looking for alternative" OR migration OR ' +
  '"sync issue" OR slow OR lag OR crash OR "switching from" OR limitation OR clunky OR ' +
  'bloated OR "data loss" OR "lock-in"';

const PAIN_WORDS = [
  'frustrated', 'frustrating', 'stuck', 'hate', 'broken', 'annoying',
  'pain', 'painful', 'tired of', 'struggling', 'disappointed', 'mess',
  'clunky', 'bloated', 'slow', 'lag', 'laggy', 'freeze', 'crash',
  'sync issue', 'sync problem', 'sync conflict', 'conflict', 'data loss',
  'lost data', 'looking for', 'alternative', 'alternatives', 'replace',
  'migration', 'migrate', 'switch', 'switching', 'limitation', 'missing',
  'overpriced', 'pricing', 'subscription', 'lock-in', 'locked in'
];

const NOTE_WORDS = [
  'note', 'notes', 'note-taking', 'notetaking', 'pkm', 'knowledge management',
  'obsidian', 'markdown', 'canvas', 'graph view', 'backlink', 'backlinks',
  'offline', 'export', 'import', 'pdf', 'formatting', 'tagging', 'folder',
  'hierarchy', 'database', 'search', 'notion', 'logseq', 'roam'
];

function decodeEntities(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)));
}

function cleanText(value) {
  return decodeEntities(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function conciseFetchError(error) {
  const full = String(error?.message || error || 'unknown fetch error');
  const status = full.match(/\((\d{3})\)|HTTP\s+(\d{3})/i);
  if (status) return `Reddit RSS HTTP ${status[1] || status[2]}`;
  return full.split(/\r?\n/, 1)[0].slice(0, 240);
}

function tagValue(xml, tag) {
  return xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] || '';
}

function alternateLink(entryXml) {
  const links = [...entryXml.matchAll(/<link\b([^>]*?)\/?>/gi)];
  for (const match of links) {
    const attrs = match[1];
    const rel = attrs.match(/\brel=["']([^"']+)["']/i)?.[1] || '';
    const href = attrs.match(/\bhref=["']([^"']+)["']/i)?.[1] || '';
    if (href && (!rel || rel === 'alternate')) return decodeEntities(href);
  }
  return '';
}

export function normalizePostId(post) {
  const raw = String(post?.id || '').trim();
  if (raw) return raw;
  return String(post?.link || '').trim();
}

export function parseRedditAtom(xml) {
  const items = [];
  let lastCursor = null;
  let entryCount = 0;
  for (const match of String(xml || '').matchAll(/<entry>([\s\S]*?)<\/entry>/gi)) {
    entryCount += 1;
    const entry = match[1];
    const atomId = cleanText(tagValue(entry, 'id'));
    const title = cleanText(tagValue(entry, 'title'));
    const content = cleanText(tagValue(entry, 'content') || tagValue(entry, 'summary'));
    const link = alternateLink(entry);
    const authorXml = tagValue(entry, 'author');
    const author = cleanText(tagValue(authorXml, 'name'));
    const subreddit = link.match(/reddit\.com\/r\/([^/]+)/i)?.[1] || '';
    const fullText = `${title}\n${content}\n${subreddit}`.toLowerCase();
    const painKeywords = PAIN_WORDS.filter((word) => fullText.includes(word));
    const hasNoteContext = NOTE_WORDS.some((word) => fullText.includes(word));
    if (atomId) lastCursor = atomId;
    if (!atomId || painKeywords.length === 0 || !hasNoteContext || title.length + content.length < 15) {
      continue;
    }
    items.push({
      id: atomId.startsWith('reddit_') ? atomId : `reddit_${atomId}`,
      title,
      link,
      content,
      author,
      subreddit,
      score: 0,
      numComments: 0,
      isoDate: cleanText(tagValue(entry, 'published') || tagValue(entry, 'updated')) ||
        new Date().toISOString(),
      painKeywords,
      source: 'Reddit NoteTaking Monitor'
    });
  }
  return { items, lastCursor, entryCount };
}

function historySeenIds(projectRoot) {
  const ids = new Set();
  const historyDir = path.join(projectRoot, 'data', 'history');
  if (!fs.existsSync(historyDir)) return ids;
  for (const name of fs.readdirSync(historyDir)) {
    if (!name.endsWith('.raw.json')) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(historyDir, name), 'utf8'));
      for (const item of parsed?.items || []) {
        const id = normalizePostId(item);
        if (id) ids.add(id);
      }
    } catch {
      // Ignore one damaged historical snapshot and continue with the others.
    }
  }
  return ids;
}

export function readSeenPostIds(projectRoot) {
  const ids = historySeenIds(projectRoot);
  const target = path.join(projectRoot, 'data', 'seen-post-ids.json');
  if (fs.existsSync(target)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
      for (const id of parsed?.ids || []) {
        if (String(id).trim()) ids.add(String(id).trim());
      }
    } catch {
      // History remains the source of truth if the cache is malformed.
    }
  }
  return ids;
}

export function writeSeenPostIds(projectRoot, ids) {
  const target = path.join(projectRoot, 'data', 'seen-post-ids.json');
  fs.writeFileSync(target, `${JSON.stringify({
    updatedAt: new Date().toISOString(),
    ids: [...ids].sort()
  }, null, 2)}\n`, 'utf8');
}

export function takeFreshItems(candidates, seenIds, targetCount = FRESH_BATCH_TARGET) {
  const selected = [];
  const selectedIds = new Set();
  let duplicateCount = 0;
  for (const item of Array.isArray(candidates) ? candidates : []) {
    const id = normalizePostId(item);
    if (!id || seenIds.has(id) || selectedIds.has(id)) {
      duplicateCount += 1;
      continue;
    }
    selectedIds.add(id);
    selected.push(item);
    if (selected.length >= targetCount) break;
  }
  return { items: selected, selectedIds, duplicateCount };
}

function rssPageUrl(after) {
  const url = new URL(RSS_URL);
  url.searchParams.set('q', RSS_QUERY);
  url.searchParams.set('restrict_sr', 'on');
  url.searchParams.set('sort', 'new');
  url.searchParams.set('t', 'year');
  url.searchParams.set('limit', String(RSS_PAGE_LIMIT));
  if (after) url.searchParams.set('after', after);
  return url;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchRssViaPowerShell(url) {
  const escapedUrl = url.toString().replace(/'/g, "''");
  const command = [
    "$ProgressPreference='SilentlyContinue'",
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8',
    `$url='${escapedUrl}'`,
    "$headers=@{'User-Agent'='Spoor-NoteTaking-Pain-Monitor/1.0 (local research monitor)';Accept='application/atom+xml';'Accept-Language'='en-US,en;q=0.9'}",
    '(Invoke-WebRequest -UseBasicParsing -Uri $url -Headers $headers).Content'
  ].join(';');
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    command
  ], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
    timeout: 45_000
  });
  return {
    ok: true,
    status: 200,
    text: async () => stdout
  };
}

export async function fetchRedditRssPage(after, { fetchImpl = fetch } = {}) {
  const url = rssPageUrl(after);
  const request =
    fetchImpl === fetch && process.platform === 'win32'
      ? fetchRssViaPowerShell
      : fetchImpl;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await request(url, {
        headers: {
          'User-Agent': 'Spoor-NoteTaking-Pain-Monitor/1.0 (local research monitor)',
          Accept: 'application/atom+xml',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });
      if (response.status === 429 && attempt < 3) {
        await sleep(attempt * 5000);
        continue;
      }
      if (!response.ok) throw new Error(`Reddit RSS HTTP ${response.status}`);
      return parseRedditAtom(await response.text());
    } catch (error) {
      if (attempt >= 3) throw error;
      await sleep(attempt * 5000);
    }
  }
  throw new Error('Reddit RSS retries exhausted');
}

export async function collectFreshBatch(projectRoot, candidates, options = {}) {
  const targetCount = options.targetCount || FRESH_BATCH_TARGET;
  const seenIds = readSeenPostIds(projectRoot);
  const initial = takeFreshItems(candidates, seenIds, targetCount);
  const items = [...initial.items];
  const selectedIds = new Set(initial.selectedIds);
  let duplicateCount = initial.duplicateCount;
  let supplementedCount = 0;
  let pagesFetched = 0;
  let cursor = null;
  let fetchError = null;
  const fetchPage = options.fetchPage || fetchRedditRssPage;

  while (items.length < targetCount && pagesFetched < (options.maxPages || MAX_RSS_PAGES)) {
    if (pagesFetched > 0) await sleep(options.pageDelayMs ?? 2000);
    let page;
    try {
      page = await fetchPage(cursor);
    } catch (error) {
      fetchError = conciseFetchError(error);
      break;
    }
    pagesFetched += 1;
    const pageSeen = new Set([...seenIds, ...selectedIds]);
    const fresh = takeFreshItems(page.items, pageSeen, targetCount - items.length);
    items.push(...fresh.items);
    fresh.selectedIds.forEach((id) => selectedIds.add(id));
    duplicateCount += fresh.duplicateCount;
    supplementedCount += fresh.items.length;
    if (!page.lastCursor || page.lastCursor === cursor || page.entryCount === 0) break;
    cursor = page.lastCursor;
  }

  return {
    items,
    seenIds,
    selectedIds,
    stats: {
      targetCount,
      actualCount: items.length,
      duplicateCount,
      supplementedCount,
      pagesFetched,
      shortfall: Math.max(0, targetCount - items.length),
      fetchError
    }
  };
}
