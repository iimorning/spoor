/**
 * vite-plugins/ortWasmPlugin.ts 的守卫。
 *
 * 这个插件本身没什么逻辑好测，但它配错了**不会**让任何单测变红——单测全都不经过
 * vite.config.ts，也不真的去浏览器里下载 wasm。所以把两条最容易踩、且后果是
 * "OCR 静默失效"的不变量钉在这里：
 * 1. 托管的文件名必须包含 ORT 实际会请求的 `.jsep` 那一对。
 * 2. 缺文件时构建要出声，而不是悄悄产出一个 /ort/ 404 的包。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const pluginSource = readFileSync(
  join(repoRoot, 'vite-plugins', 'ortWasmPlugin.ts'),
  'utf8',
);
const viteConfigSource = readFileSync(join(repoRoot, 'vite.config.ts'), 'utf8');

describe('ortWasmPlugin 托管的文件', () => {
  // onnxruntime-web 的 bundle 把加载器文件名写死成 .jsep.mjs，跟 backend 设成什么无关；
  // 少托管这一对，浏览器里就是一句 "no available backend found"，功能全废而构建是绿的。
  it('includes the .jsep pair that onnxruntime actually asks for', () => {
    expect(pluginSource).toContain('ort-wasm-simd-threaded.jsep.mjs');
    expect(pluginSource).toContain('ort-wasm-simd-threaded.jsep.wasm');
  });

  it('keeps the non-jsep pair as a fallback', () => {
    expect(pluginSource).toContain('ort-wasm-simd-threaded.mjs');
    expect(pluginSource).toContain('ort-wasm-simd-threaded.wasm');
  });

  it('fails the build loudly instead of shipping a 404 /ort/', () => {
    expect(pluginSource).toMatch(/closeBundle[\s\S]{0,900}this\.error\(/);
  });

  it('does not tell the user it falls back to a CDN, because it cannot', () => {
    // wasmPaths 写死成 /ort/，中间件不在就是 404，SDK 不会退回 CDN。
    expect(pluginSource).not.toMatch(/退回 CDN 兜底/);
  });
});

describe('vite.config.ts 的 optimizeDeps', () => {
  // 预打包会把 import.meta.url 指向 .vite/deps/，SDK 用它 new URL 出来的
  // worker 路径就不存在了，dev 下报 "OCR worker failed"，而 build 却是好的——
  // 也就是说"本地跑不通、发出去能用"这种最难查的形态。
  it('excludes the OCR SDK from the dependency pre-bundle', () => {
    expect(viteConfigSource).toMatch(/optimizeDeps[\s\S]{0,600}exclude:\s*\['@paddleocr\/paddleocr-js'\]/);
  });

  // 被排除的包，它的 CJS 依赖也就不再走 esbuild 的 interop：
  // clipper-lib / opencv-js / js-yaml 只有一个 default 导出。
  it('pre-bundles the SDK CJS dependencies so their default export is interop-ed', () => {
    expect(viteConfigSource).toContain('clipper-lib');
    expect(viteConfigSource).toContain('@techstark/opencv-js');
    expect(viteConfigSource).toContain('js-yaml');
  });
});
