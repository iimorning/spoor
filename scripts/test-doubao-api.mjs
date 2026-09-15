#!/usr/bin/env node
/**
 * Smoke test: Volcengine Ark chat/completions.
 * Usage: node scripts/test-doubao-api.mjs
 * Reads VITE_BUILTIN_DOUBAO_API_KEY from .env.local or env.
 */
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env.local');
let apiKey = process.env.VITE_BUILTIN_DOUBAO_API_KEY?.trim() ?? '';
if (!apiKey && existsSync(envPath)) {
  const m = readFileSync(envPath, 'utf8').match(/VITE_BUILTIN_DOUBAO_API_KEY=(.+)/);
  if (m) apiKey = m[1].trim();
}
if (!apiKey) {
  console.error('Missing VITE_BUILTIN_DOUBAO_API_KEY in .env.local or env');
  process.exit(1);
}

const model = 'doubao-seed-2-1-turbo-260628';
const url = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
const body = {
  model,
  messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
  max_tokens: 32,
};

const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  },
  body: JSON.stringify(body),
});
const raw = await res.text();
if (!res.ok) {
  console.error(`HTTP ${res.status}`, raw.slice(0, 2000));
  process.exit(1);
}
let data;
try {
  data = JSON.parse(raw);
} catch {
  console.error('Non-JSON response', raw.slice(0, 500));
  process.exit(1);
}
const text = data?.choices?.[0]?.message?.content;
if (!text || typeof text !== 'string') {
  console.error('No choices[0].message.content', JSON.stringify(data).slice(0, 2000));
  process.exit(1);
}
console.log('Doubao API smoke test passed.');
console.log('model:', data.model ?? model);
console.log('content preview:', text.slice(0, 120));
