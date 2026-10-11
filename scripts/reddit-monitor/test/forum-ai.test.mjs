import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  callForumAi,
  generateForumReply,
  resolveForumAiConfig
} from '../lib/forum-ai.mjs';

test('resolveForumAiConfig reads the monitor-local secret file', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spoor-forum-ai-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, '.env.local'), [
    'REDDIT_MONITOR_AI_API_KEY=test-key',
    'REDDIT_MONITOR_AI_BASE_URL=http://127.0.0.1:9999/v1/',
    'REDDIT_MONITOR_AI_MODEL=test-model'
  ].join('\n'));

  const config = resolveForumAiConfig(root);
  assert.equal(config.configured, true);
  assert.equal(config.baseUrl, 'http://127.0.0.1:9999/v1');
  assert.equal(config.model, 'test-model');
});

test('callForumAi uses the OpenAI-compatible chat contract', async (t) => {
  let received;
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      received = {
        authorization: req.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8'))
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: '测试回复' } }] }));
    });
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => upstream.close());
  const address = upstream.address();

  const text = await callForumAi({
    configured: true,
    apiKey: 'secret',
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    model: 'test-model'
  }, [{ role: 'user', content: '你好' }]);

  assert.equal(text, '测试回复');
  assert.equal(received.authorization, 'Bearer secret');
  assert.equal(received.body.model, 'test-model');
  assert.equal(received.body.stream, false);
});

test('generateForumReply appends the current conversation turn', async (t) => {
  const upstream = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: '更短的回复' } }] }));
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => upstream.close());
  const address = upstream.address();

  const result = await generateForumReply({
    configured: true,
    apiKey: 'secret',
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    model: 'test-model'
  }, {
    item: { id: 'one', title: '标题', source: 'Reddit', quote: '正文' },
    chatMessage: '请更短',
    chatHistory: [{ role: 'assistant', content: '旧回复' }]
  });

  assert.equal(result.reply, '更短的回复');
  assert.deepEqual(result.chatHistory.slice(-2), [
    { role: 'user', content: '请更短' },
    { role: 'assistant', content: '更短的回复' }
  ]);
});
