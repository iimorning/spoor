#!/usr/bin/env node
/**
 * Spoor Reddit Monitor —— 零依赖本地 Web/API 服务。
 *
 * 用法：
 *   node serve.mjs                  # 默认监听 127.0.0.1:3780
 *   node serve.mjs --port=8080      # 自定义端口
 *   node serve.mjs --host=127.0.0.1 # 只允许本机访问
 *
 * 为什么需要：
 *   - viewer.html 用 fetch() 读 data/forum-raw.json 等
 *   - 直接 file:// 打开会被浏览器拦截（CORS）
 *   - 必须起一个静态服务器，并且和 JSON 同源
 *
 * 设计目标：
 *   - 只服务于本目录（防止意外越界）
 *   - 不解析任何目录列表（隐藏文件直接 404）
 *   - content-type 按扩展名猜，UTF-8
 *   - 关闭缓存（dev 友好）
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInsightsFromRaw, readForumRawPayload } from './lib/forum-raw.mjs';
import {
  analyzePain,
  generateForumReply,
  resolveForumAiConfig
} from './lib/forum-ai.mjs';
import {
  applyForumState,
  archiveForumItem,
  readForumState,
  saveForumReply,
  savePainAnalysis
} from './lib/forum-state.mjs';
import {
  collectFreshBatch,
  FRESH_BATCH_TARGET,
  writeSeenPostIds
} from './lib/forum-batch.mjs';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.dirname(__filename);
const DATA_DIR = path.join(ROOT, 'data');
const RAW_PATH = path.join(DATA_DIR, 'forum-raw.json');
const INSIGHTS_PATH = path.join(DATA_DIR, 'forum-insights.json');
const HISTORY_DIR = path.join(DATA_DIR, 'history');
const HISTORY_INDEX_PATH = path.join(HISTORY_DIR, 'index.json');

function writeJson(target, value) {
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readHistoryIndex() {
  if (!fs.existsSync(HISTORY_INDEX_PATH)) return { rounds: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(HISTORY_INDEX_PATH, 'utf8'));
    return { rounds: Array.isArray(parsed?.rounds) ? parsed.rounds : [] };
  } catch {
    return { rounds: [] };
  }
}

function historyId(fetchedAt) {
  const timestamp = Date.parse(String(fetchedAt || ''));
  const iso = Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : new Date().toISOString();
  return iso.replace(/[:.]/g, '-');
}

function persistHistory(raw, insights) {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
  const id = historyId(raw?.fetchedAt);
  const rawFile = `${id}.raw.json`;
  const insightsFile = `${id}.insights.json`;
  const rawPath = path.join(HISTORY_DIR, rawFile);
  const insightsPath = path.join(HISTORY_DIR, insightsFile);

  if (!fs.existsSync(rawPath)) writeJson(rawPath, raw);
  if (!fs.existsSync(insightsPath)) writeJson(insightsPath, insights);

  const index = readHistoryIndex();
  const existing = index.rounds.filter((round) => round?.id !== id);
  const rounds = [
    {
      id,
      fetchedAt: raw?.fetchedAt || new Date().toISOString(),
      itemCount: Array.isArray(raw?.items) ? raw.items.length : 0,
      rawPath: `./data/history/${rawFile}`,
      insightsPath: `./data/history/${insightsFile}`
    },
    ...existing
  ].sort((a, b) => Date.parse(b.fetchedAt) - Date.parse(a.fetchedAt));

  writeJson(HISTORY_INDEX_PATH, {
    updatedAt: new Date().toISOString(),
    retention: 'append-only',
    rounds
  });
}

function rebuildInsights({ skipEmpty = false } = {}) {
  if (!fs.existsSync(RAW_PATH)) return false;

  // Validate before using readForumRawPayload: that helper deliberately turns
  // malformed JSON into an empty payload, which must not overwrite good data.
  const parsed = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8'));
  if (!parsed || !Array.isArray(parsed.items)) {
    throw new Error('forum-raw.json must contain an items array');
  }
  if (skipEmpty && parsed.items.length === 0) return false;

  const raw = readForumRawPayload(ROOT);
  const insights = applyForumState(
    buildInsightsFromRaw(raw),
    readForumState(ROOT)
  );
  insights.meta = {
    ...insights.meta,
    subtitle: 'n8n 自动同步 · Reddit RSS',
    n8nConnected: true
  };
  writeJson(INSIGHTS_PATH, insights);
  persistHistory(parsed, insights);
  return true;
}

// Rebuild existing real data on startup. Keep the bundled demo when the raw
// fixture is empty, then replace it as soon as n8n writes its first payload.
try {
  rebuildInsights({ skipEmpty: true });
} catch (error) {
  process.stderr.write(`[data] initial rebuild skipped: ${error.message}\n`);
}

let rebuildTimer = null;
let processingRaw = false;
let lastProcessedRoundId = null;

async function processIncomingRaw() {
  if (processingRaw) return;
  processingRaw = true;
  try {
    const parsed = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8'));
    if (!parsed || !Array.isArray(parsed.items)) {
      throw new Error('forum-raw.json must contain an items array');
    }

    if (parsed?.batch?.mode === 'incremental-new') {
      const id = historyId(parsed.fetchedAt);
      if (id === lastProcessedRoundId) return;
      if (rebuildInsights({ skipEmpty: true })) {
        lastProcessedRoundId = id;
        process.stdout.write('[data] incremental forum-insights.json rebuilt\n');
      }
      return;
    }

    const result = await collectFreshBatch(ROOT, parsed.items, {
      targetCount: FRESH_BATCH_TARGET
    });
    const fetchedAt = new Date().toISOString();
    const incremental = {
      ...parsed,
      fetchedAt,
      totalCount: result.items.length,
      items: result.items,
      batch: {
        mode: 'incremental-new',
        ...result.stats
      }
    };
    writeJson(RAW_PATH, incremental);

    if (rebuildInsights({ skipEmpty: true })) {
      const updatedSeen = new Set([...result.seenIds, ...result.selectedIds]);
      writeSeenPostIds(ROOT, updatedSeen);
      lastProcessedRoundId = historyId(fetchedAt);
      process.stdout.write(
        `[data] fresh round saved: ${result.items.length}/${FRESH_BATCH_TARGET} new, ` +
        `${result.stats.duplicateCount} duplicates removed\n`
      );
      if (result.stats.shortfall > 0) {
        process.stderr.write(
          `[data] fresh round shortfall=${result.stats.shortfall}` +
          `${result.stats.fetchError ? ` (${result.stats.fetchError})` : ''}\n`
        );
      }
    } else {
      process.stderr.write('[data] no unseen Reddit posts found; keeping current insights\n');
    }
  } finally {
    processingRaw = false;
  }
}

const dataWatcher = fs.watch(DATA_DIR, (_eventType, filename) => {
  if (String(filename || '') !== path.basename(RAW_PATH)) return;
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(async () => {
    try {
      await processIncomingRaw();
    } catch (error) {
      // A write may briefly expose an incomplete file. A later fs.watch event
      // retries; importantly, the last valid insights file remains untouched.
      process.stderr.write(`[data] rebuild skipped: ${error.message}\n`);
    }
  }, 300);
});

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm':  'text/html; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.md':   'text/markdown; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8',
  '.svg':  'image/svg+xml; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon'
};

function parseArgs(argv) {
  const out = { port: 3780, host: '127.0.0.1' };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--port=')) {
      const n = parseInt(a.slice(7), 10);
      // 接受 0（让 OS 分配），接受 1-65535
      if (Number.isFinite(n) && n >= 0 && n <= 65535) out.port = n;
    }
    else if (a.startsWith('--host=')) out.host = a.slice(7);
    else if (a === '--help' || a === '-h') {
      console.log(`Spoor Reddit Monitor — static server

Usage:
  node serve.mjs [--port=N] [--host=HOST]

Defaults:
  --port=3780   (matches content-factory's old forum-raw server)
  --host=127.0.0.1 (local only; protects the AI-backed API)`);
      process.exit(0);
    }
  }
  return out;
}

function safeJoin(root, urlPath) {
  // 解码 URL，去掉 query，规范化路径
  let p;
  try {
    p = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  // 根路径直接返回 null —— 让调用方决定默认文件
  if (p === '/' || p === '') return null;
  const joined = path.normalize(path.join(root, p));
  // 防越界：必须仍在 ROOT 下
  if (!joined.startsWith(root + path.sep)) return null;
  return joined;
}

function send(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(body);
}

function sendJson(res, status, value) {
  send(res, status, `${JSON.stringify(value)}\n`, 'application/json; charset=utf-8');
}

function readJsonBody(req, maxBytes = 1_000_000) {
  if (!String(req.headers['content-type'] || '').toLowerCase().includes('application/json')) {
    const error = new Error('Content-Type 必须是 application/json');
    error.statusCode = 415;
    throw error;
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        const error = new Error('请求体过大');
        error.statusCode = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve(body ? JSON.parse(body) : {});
      } catch {
        const error = new Error('请求体不是有效 JSON');
        error.statusCode = 400;
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function syncCurrentInsights(state) {
  if (!fs.existsSync(INSIGHTS_PATH)) return;
  const current = JSON.parse(fs.readFileSync(INSIGHTS_PATH, 'utf8'));
  writeJson(INSIGHTS_PATH, applyForumState(current, state));
}

async function handleApi(req, res) {
  const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
  if (!pathname.startsWith('/api/forum-insights')) return false;

  if (req.method === 'GET' && pathname === '/api/forum-insights/health') {
    const config = resolveForumAiConfig(ROOT);
    sendJson(res, 200, {
      ok: true,
      ai: {
        configured: config.configured,
        provider: config.provider,
        baseUrl: config.baseUrl,
        model: config.model
      }
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/forum-insights') {
    if (!fs.existsSync(INSIGHTS_PATH)) {
      sendJson(res, 404, { error: 'forum-insights.json 不存在' });
    } else {
      sendJson(res, 200, JSON.parse(fs.readFileSync(INSIGHTS_PATH, 'utf8')));
    }
    return true;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method not allowed' });
    return true;
  }

  const body = await readJsonBody(req);
  if (pathname === '/api/forum-insights/pain-analysis') {
    const id = String(body?.id || '');
    const quote = String(body?.quote || '').trim();
    if (!id || !quote) {
      const error = new Error('痛点分析需要 id 和 quote');
      error.statusCode = 400;
      throw error;
    }
    const analysis = await analyzePain(resolveForumAiConfig(ROOT), { quote });
    const state = savePainAnalysis(ROOT, id, analysis);
    syncCurrentInsights(state);
    sendJson(res, 200, { ok: true, id, analysis });
    return true;
  }

  if (pathname === '/api/forum-insights/reply') {
    const item = body?.item && typeof body.item === 'object' ? body.item : {};
    const id = String(item.id || '');
    if (!id || !String(item.quote || '').trim()) {
      const error = new Error('AI 对话需要包含 id 和 quote 的 item');
      error.statusCode = 400;
      throw error;
    }
    const generated = await generateForumReply(resolveForumAiConfig(ROOT), {
      item,
      chatMessage: String(body?.chatMessage || '').trim(),
      chatHistory: body?.chatHistory
    });
    const state = saveForumReply(ROOT, id, {
      draftReply: body?.chatMessage ? undefined : generated.reply,
      chatHistory: generated.chatHistory
    });
    syncCurrentInsights(state);
    sendJson(res, 200, {
      ok: true,
      id,
      reply: generated.reply,
      aiLab: {
        draftReply: body?.chatMessage ? undefined : generated.reply,
        chatHistory: generated.chatHistory
      }
    });
    return true;
  }

  if (pathname === '/api/forum-insights/archive') {
    const state = archiveForumItem(ROOT, body || {});
    syncCurrentInsights(state);
    sendJson(res, 200, { ok: true, archivedRecords: state.archivedRecords });
    return true;
  }

  sendJson(res, 404, { error: 'API not found' });
  return true;
}

function serveFile(req, res) {
  const urlPath = req.url || '/';

  // 根路径 / 空路径 → 直接走默认文件
  if (urlPath === '/' || urlPath === '') {
    return sendFile(res, path.join(ROOT, 'insights.html'), '/');
  }

  const target = safeJoin(ROOT, urlPath);
  if (target === null) {
    // 越界请求（含 ../ 等）→ 拒绝
    return send(res, 400, `bad request: ${urlPath}`);
  }
  return sendFile(res, target, urlPath);
}

function sendFile(res, target, urlPath) {
  if (!fs.existsSync(target)) return send(res, 404, `not found: ${urlPath}`);
  const stat = fs.statSync(target);
  if (stat.isDirectory()) return send(res, 404, `directory listing disabled`);

  const ext = path.extname(target).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const body = fs.readFileSync(target);
  res.writeHead(200, {
    'content-type': type,
    'content-length': body.length,
    'cache-control': 'no-store'
  });
  res.end(body);
}

const { port, host } = parseArgs(process.argv);
const server = http.createServer(async (req, res) => {
  // SPOOR_QUIET=1 时跳过 access log（测试场景），其它场景都打
  if (process.env.SPOOR_QUIET !== '1') {
    const ts = new Date().toISOString().slice(11, 19);
    process.stdout.write(`[${ts}] ${req.method} ${req.url}\n`);
  }
  try {
    if (await handleApi(req, res)) return;
    serveFile(req, res);
  } catch (e) {
    process.stderr.write(`[error] ${req.url}: ${e.message}\n`);
    if (!res.headersSent) {
      const status = Number.isInteger(e?.statusCode) ? e.statusCode : 500;
      if (String(req.url || '').startsWith('/api/')) {
        sendJson(res, status, { error: e.message || 'server error' });
      } else {
        send(res, status, `server error: ${e.message}`);
      }
    }
  }
});

server.listen(port, host, () => {
  // 当用户传 --port=0，OS 自动分配；address().port 才是真正在监听的端口
  const addr = server.address();
  const actualPort = (addr && typeof addr === 'object' && addr.port) ? addr.port : port;
  const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${actualPort}/`;
  console.log(`Spoor Reddit Monitor — viewer ready`);
  console.log(`  root : ${ROOT}`);
  console.log(`  url  : ${url}`);
  console.log(`  ctrl-c to stop`);
  console.log(`  entry: insights.html  (content-factory style forum insights UI)`);
});

process.on('SIGINT', () => {
  console.log('\nbye');
  clearTimeout(rebuildTimer);
  dataWatcher.close();
  server.close(() => process.exit(0));
});
