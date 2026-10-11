#!/usr/bin/env node
/**
 * Spoor Reddit 监测 fetcher（standalone / zero-dep）。
 *
 * 与 content-factory 的 n8n workflow 同款语义，但去掉了 n8n 依赖，
 * 只用 Node built-ins（https / fs / path）。用 cron / Task Scheduler / GitHub
 * Actions 都能跑。
 *
 * 用法：
 *   node fetch.mjs                          # 抓取 subreddits.mjs 全部条目
 *   node fetch.mjs --category=notes_pkm     # 只抓某个分类
 *   node fetch.mjs --category=philosophy    # 同上
 *   node fetch.mjs --dry-run                # 不写盘，只打印会抓多少
 *   node fetch.mjs --stats                  # 读现有 data/forum-raw.json 输出统计
 *   node fetch.mjs --limit=25               # 每个 subreddit 拉 25 条（默认 30）
 *   node fetch.mjs --quiet                  # 不打印每条 item
 *
 * 产物：
 *   data/forum-raw.json       — 去重 + 倒序后的全集（最多 1500 条）
 *   data/forum-insights.json  — 投影给 UI 用的 insights（前 24 条 + 痛点热度）
 *
 * 数据流（与 content-factory 对齐）：
 *   Reddit JSON API  ─►  Map Raw Fields  ─►  mergeForumRaw  ─►  forum-raw.json
 *                                                                   │
 *                                                                   ▼
 *                                              buildInsightsFromRaw ─► forum-insights.json
 */

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

import subredditData, { getByCategory, findBySubreddit } from './subreddits.mjs';
import {
  readForumRawPayload,
  mergeForumRaw,
  buildInsightsFromRaw
} from './lib/forum-raw.mjs';
import { loadForumInsights, getDefaultForumInsights } from './lib/forum-insights.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = __dirname;

const DEFAULT_LIMIT = 30;
const MAX_CONCURRENCY = 4;        // 同时最多 4 个 Reddit 请求
const REQUEST_TIMEOUT_MS = 15000; // 单个请求 15 秒超时
const USER_AGENT = 'Spoor-Reddit-Monitor/1.0 (+https://github.com/iimorning/spoor)';

// ---------- CLI parsing ----------

function parseArgs(argv) {
  const out = { category: null, dryRun: false, stats: false, limit: DEFAULT_LIMIT, quiet: false };
  for (const a of argv.slice(2)) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--stats') out.stats = true;
    else if (a === '--quiet' || a === '-q') out.quiet = true;
    else if (a.startsWith('--category=')) out.category = a.slice('--category='.length);
    else if (a.startsWith('--limit=')) {
      const n = parseInt(a.slice('--limit='.length), 10);
      if (Number.isFinite(n) && n > 0 && n <= 100) out.limit = n;
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return out;
}

function printHelp() {
  console.log(`Spoor Reddit Monitor

Usage:
  node fetch.mjs [options]

Options:
  --category=<name>   only fetch one category (notes_pkm, sea_turtle_soup,
                       narrative_reflection, philosophy, selfhosted_ai,
                       show_and_tell)
  --limit=<N>         posts per subreddit (default 30, max 100)
  --dry-run           don't write files, just print the plan
  --stats             read existing data/forum-raw.json and print stats
  --quiet, -q         suppress per-item log
  --help, -h          show this help
`);
}

// ---------- Reddit fetch ----------

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      },
      (res) => {
        if (res.statusCode === 429) {
          res.resume();
          reject(new Error(`rate limited (HTTP 429) for ${url}`));
          return;
        }
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        let chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`JSON parse failed for ${url}: ${e.message}`));
          }
        });
      }
    );
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`timeout after ${REQUEST_TIMEOUT_MS}ms`));
    });
    req.on('error', reject);
  });
}

function buildSearchUrl(subredditName, query, limit) {
  // Reddit search.json — &restrict_sr=1 把搜索限定在单 sub 里
  const q = encodeURIComponent(query || '');
  return `https://www.reddit.com/${subredditName}/search.json?q=${q}&restrict_sr=1&sort=new&limit=${limit}`;
}

function mapRedditPost(child) {
  const d = child?.data;
  if (!d) return null;
  const id = d.id ? `reddit_${d.id}` : null;
  if (!id) return null;
  return {
    id,
    title: d.title || '',
    link: d.permalink ? `https://www.reddit.com${d.permalink}` : '',
    content: d.selftext || '',
    isoDate: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : new Date().toISOString(),
    source: 'Reddit',
    author: d.author || ''
  };
}

async function fetchSubreddit(entry, limit, logger) {
  const url = buildSearchUrl(entry.subreddit, entry.searchQuery, limit);
  try {
    const json = await fetchJson(url);
    const children = Array.isArray(json?.data?.children) ? json.data.children : [];
    const items = children.map(mapRedditPost).filter(Boolean);
    logger(`  ✓ ${entry.subreddit}  fetched=${items.length}`);
    return { subreddit: entry.subreddit, items };
  } catch (e) {
    logger(`  ✗ ${entry.subreddit}  ${e.message}`);
    return { subreddit: entry.subreddit, items: [], error: e.message };
  }
}

async function runWithConcurrency(tasks, concurrency, logger) {
  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < tasks.length) {
      const i = cursor++;
      results[i] = await tasks[i]();
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ---------- stats mode ----------

function printStats() {
  const raw = readForumRawPayload(projectRoot);
  const insights = loadForumInsights(projectRoot);
  const isDefault =
    JSON.stringify(insights) === JSON.stringify(getDefaultForumInsights());

  console.log(`\nforum-raw.json`);
  console.log(`  fetchedAt : ${raw.fetchedAt || '(never)'}`);
  console.log(`  source    : ${raw.source}`);
  console.log(`  itemCount : ${raw.items.length}`);

  if (raw.items.length > 0) {
    const bySource = new Map();
    const byAuthor = new Map();
    for (const it of raw.items) {
      bySource.set(it.source, (bySource.get(it.source) || 0) + 1);
      if (it.author) byAuthor.set(it.author, (byAuthor.get(it.author) || 0) + 1);
    }
    console.log(`  by source : ${[...bySource.entries()].map(([k, v]) => `${k}=${v}`).join(', ')}`);
    console.log(`  top author: ${[...byAuthor.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `u/${k}=${v}`).join(', ')}`);
  }

  console.log(`\nforum-insights.json`);
  console.log(`  using default fallback: ${isDefault}`);
  console.log(`  frictionTags : ${insights.frictionTags.join(', ') || '(none)'}`);
  console.log(`  items        : ${insights.items.length}`);
}

// ---------- main ----------

async function main() {
  const opts = parseArgs(process.argv);

  if (opts.stats) {
    printStats();
    return;
  }

  const targets = opts.category ? getByCategory(opts.category) : subredditData;
  if (targets.length === 0) {
    console.error(`No subreddits matched category=${opts.category}.`);
    console.error(`Available: notes_pkm, sea_turtle_soup, narrative_reflection, philosophy, selfhosted_ai, show_and_tell`);
    process.exit(2);
  }

  const logger = opts.quiet ? () => {} : (m) => console.log(m);

  console.log(`\nSpoor Reddit Monitor`);
  console.log(`  category  : ${opts.category || '(all)'}`);
  console.log(`  target    : ${targets.length} subreddits × limit=${opts.limit}`);
  console.log(`  dry-run   : ${opts.dryRun}`);
  console.log(`  data dir  : ${path.relative(process.cwd(), path.join(projectRoot, 'data'))}`);

  const tasks = targets.map((entry) => () => fetchSubreddit(entry, opts.limit, logger));
  const fetchResults = await runWithConcurrency(tasks, MAX_CONCURRENCY, logger);

  const newItems = [];
  let fetchErrors = 0;
  for (const r of fetchResults) {
    if (r.error) fetchErrors += 1;
    newItems.push(...r.items);
  }

  console.log(`\n  fetched total : ${newItems.length} (errors=${fetchErrors})`);

  if (opts.dryRun) {
    console.log(`\n[--dry-run] Not writing data/forum-raw.json or data/forum-insights.json.`);
    return;
  }

  const oldPayload = readForumRawPayload(projectRoot);
  const merged = mergeForumRaw(oldPayload, newItems);
  const insights = buildInsightsFromRaw(merged);

  const rawPath = path.join(projectRoot, 'data', 'forum-raw.json');
  const insightsPath = path.join(projectRoot, 'data', 'forum-insights.json');
  fs.mkdirSync(path.dirname(rawPath), { recursive: true });
  fs.writeFileSync(rawPath, JSON.stringify(merged, null, 2), 'utf8');
  fs.writeFileSync(insightsPath, JSON.stringify(insights, null, 2), 'utf8');

  console.log(`\n  wrote ${path.relative(process.cwd(), rawPath)}  (${merged.items.length} items)`);
  console.log(`  wrote ${path.relative(process.cwd(), insightsPath)}  (${insights.items.length} projected)`);
  console.log(`  frictionTags: ${insights.frictionTags.join(', ') || '(none)'}`);

  // 友好提示：标记仍未填写的字段
  if (fetchErrors > 0) {
    console.log(`\n  ⚠ ${fetchErrors} subreddits failed — re-run later or check rate limits.`);
  }
}

main().catch((err) => {
  console.error('\n[fatal]', err);
  process.exit(1);
});
