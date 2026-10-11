import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

// i18n 初始化会读 localStorage，先给个内存实现（与 tests/i18n.test.ts 同样的做法）。
const store: Record<string, string> = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      Object.keys(store).forEach((k) => delete store[k]);
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
  },
  configurable: true,
});

import i18n from '../src/i18n';

/**
 * 防"用了 t() 但没加翻译"这一类错。
 *
 * 真实踩过：编辑器里写了 `t('pocket.ocr_view')`，而 i18n 里从头到尾没有这个键，
 * 界面上直接显示原始的 "pocket.ocr_view"，而所有单测都是绿的——因为测试自己 mock 了 t()。
 * 这类错只有把"源码里用到的 key"和"实际定义出来的 key"对一遍才抓得到。
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(repoRoot, 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** 把语言包里的所有叶子键拍平成 `a.b.c`。 */
function flatten(obj: unknown, prefix: string, out: Set<string>): void {
  if (!obj || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? prefix + '.' + k : k;
    if (v && typeof v === 'object') flatten(v, key, out);
    else out.add(key);
  }
}

function definedKeys(): Set<string> {
  const out = new Set<string>();
  for (const lang of ['en', 'zh']) {
    flatten(i18n.getResourceBundle(lang, 'translation'), '', out);
  }
  return out;
}

/**
 * 抓源码里 t('字面量key') 的用法。动态拼出来的 key 抓不到，不在这份清单里。
 * 带了 defaultValue 的算有意为之（i18next 找不到键时会用它），不报。
 */
function usedKeys(files: string[]): Map<string, string> {
  const used = new Map<string, string>();
  const callPattern = /\bt\(\s*'([a-zA-Z][\w]*(?:\.[\w]+)+)'([^)]{0,200}?)\)/g;
  for (const file of files) {
    if (file.endsWith(join('src', 'i18n.ts'))) continue;
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(callPattern)) {
      const key = m[1]!;
      if (used.has(key)) continue;
      if (/defaultValue\s*:/.test(m[2] ?? '')) continue;
      used.set(key, relative(repoRoot, file));
    }
  }
  return used;
}

/**
 * 已知欠账：这些 key 源码在用、bundle 里没有，也没有 defaultValue，界面上会显示原始 key。
 * 都是本轮 OCR 改动之前就存在的，和口袋/OCR 无关，先记在这里；
 * 新增的漏 key 仍然会让上面的用例变红。
 */
const KNOWN_MISSING = new Set(['nodes.agent_fallback_name']);

describe('i18n 键都存在', () => {
  const defined = definedKeys();
  const files = walk(SRC_DIR);

  it('finds a non-trivial language bundle', () => {
    expect(defined.size).toBeGreaterThan(300);
  });

  it('defines every key the source actually uses', () => {
    const missing = [...usedKeys(files)]
      .filter(([key]) => !defined.has(key) && !KNOWN_MISSING.has(key))
      .map(([key, file]) => `${key}  (${file})`);
    expect(missing).toEqual([]);
  });

  it('translates the pocket keys the phone shell relies on', () => {
    const view = readFileSync(join(SRC_DIR, 'components', 'PocketView.tsx'), 'utf8');
    const pocketKeys = [...view.matchAll(/\bt\(\s*'(pocket\.[\w]+)'/g)].map((m) => m[1]!);
    expect(pocketKeys.length).toBeGreaterThan(10);
    expect(pocketKeys.filter((k) => !defined.has(k))).toEqual([]);
  });
});
