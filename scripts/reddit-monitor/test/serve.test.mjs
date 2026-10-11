import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVE_SCRIPT = path.join(__dirname, '..', 'serve.mjs');

/**
 * 启动一个子进程跑 serve.mjs，绑定到 127.0.0.1 上一个临时端口，
 * 返回 Promise<{ baseUrl, close }>。
 */
function startServer(extraArgs = []) {
  return new Promise((resolve, reject) => {
    const { spawn } = require('node:child_process');
    const proc = spawn(process.execPath, [SERVE_SCRIPT, '--host=127.0.0.1', '--port=0', ...extraArgs], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        SPOOR_QUIET: '1',
        REDDIT_MONITOR_AI_API_KEY: '',
        VITE_BUILTIN_DOUBAO_API_KEY: ''
      }
    });
    let baseUrl = null;
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('server boot timeout'));
    }, 5000);

    proc.stdout.on('data', (chunk) => {
      const s = chunk.toString();
      const m = s.match(/url\s*:\s*(http:\/\/[^\s]+)/);
      if (m && !baseUrl) {
        // 截到最后一个 "/" 之前的 host:port
        const full = m[1];
        const cutAt = full.lastIndexOf('/');
        baseUrl = cutAt > 'http://'.length ? full.slice(0, cutAt + 1) : full + '/';
        clearTimeout(timer);
        resolve({
          baseUrl,
          close: () => { proc.kill(); }
        });
      }
    });
    proc.stderr.on('data', (chunk) => process.stderr.write(`[serve] ${chunk}`));
    proc.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', reject);
  });
}

// 我们没在 package.json 里写 node:child_process 的 require，但 serve 启动器
// 来自 Node built-in，加 require('node:child_process') 在 ESM 下需要
// createRequire。这段改用 createRequire 走兼容路径。
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

test('serve.mjs serves insights.html with text/html', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const res = await get(`${srv.baseUrl}insights.html`);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'] || '', /text\/html/);
  assert.match(res.body, /Spoor/);
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('serve.mjs serves data/forum-insights.json as JSON', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const res = await get(`${srv.baseUrl}data/forum-insights.json`);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'] || '', /application\/json/);
  const parsed = JSON.parse(res.body);
  assert.ok(Array.isArray(parsed.frictionTags));
});

test('serve.mjs blocks path traversal', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const res = await get(`${srv.baseUrl}..%2F..%2Fpackage.json`);
  assert.equal(res.status, 400);
});

test('serve.mjs returns 404 for missing files', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const res = await get(`${srv.baseUrl}data/nope.json`);
  assert.equal(res.status, 404);
});

test('serve.mjs reports AI configuration without exposing a key', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const res = await get(`${srv.baseUrl}api/forum-insights/health`);
  assert.equal(res.status, 200);
  const payload = JSON.parse(res.body);
  assert.equal(payload.ai.configured, false);
  assert.equal(Object.hasOwn(payload.ai, 'apiKey'), false);
});

test('serve.mjs returns a useful error when AI is not configured', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const res = await fetch(`${srv.baseUrl}api/forum-insights/pain-analysis`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'test-post', quote: '同步一直失败' })
  });
  const payload = await res.json();
  assert.equal(res.status, 503);
  assert.match(payload.error, /AI 尚未配置/);
});

test('serve.mjs redirects / to viewer.html', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const res = await get(`${srv.baseUrl}`);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'] || '', /text\/html/);
  assert.match(res.body, /Spoor/);
});
