import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

// Polyfill crypto.randomUUID for test environment
if (!globalThis.crypto) {
  (globalThis as any).crypto = {
    randomUUID: () => Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15),
  };
}

// Polyfill DOMMatrix for pdfjs-dist in jsdom (used transitively via parsePdfBook → file → useNodeActions)
if (typeof (globalThis as any).DOMMatrix === 'undefined') {
  (globalThis as any).DOMMatrix = class DOMMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    m11 = 1; m12 = 0; m13 = 0; m14 = 0;
    m21 = 0; m22 = 1; m23 = 0; m24 = 0;
    m31 = 0; m32 = 0; m33 = 1; m34 = 0;
    m41 = 0; m42 = 0; m43 = 0; m44 = 1;
    is2D = true;
    isIdentity = true;
    constructor(_init?: unknown) {}
    translate() { return this; }
    scale() { return this; }
    rotate() { return this; }
    multiply() { return this; }
    inverse() { return this; }
    setMatrixValue() { return this; }
    transformPoint() { return { x: 0, y: 0, z: 0, w: 1 }; }
    toFloat32Array() { return new Float32Array(16); }
    toString() { return 'matrix(1, 0, 0, 1, 0, 0)'; }
  };
}

// Suppress Dexie console warnings during tests
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  const msg = String(args[0] ?? '');
  if (msg.includes('[Dexie]') || msg.includes('IndexedDB')) return;
  originalWarn(...args);
};

// Suppress window.matchMedia not available in jsdom
//
// 以前这是一块死板：`matches` 永远是 false，于是 `useAdaptiveLayout` 的 `compact`
// 在**所有**用例里都是 false——窄屏那条分支从来没被测到过，而它恰好是抽屉、弹层、
// 被折起来的侧栏这些最脆的东西。
//
// 默认仍然全 false（既有行为一个字没变），但留了 `setMatchMediaQueries` 让单个用例
// 按需覆写某几条查询。测窄屏就在自己的 beforeEach 里写：
//   setMatchMediaQueries(['max-width: 1279px'])
let matchMediaOverrides: string[] = [];

function matchMediaMatches(query: string): boolean {
  return matchMediaOverrides.some((candidate) => query.includes(candidate));
}

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: matchMediaMatches(query),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

/** 让接下来的用例里指定的媒体查询命中（比如窄屏）。`[]` 恢复成"全部不命中"。 */
export function setMatchMediaQueries(queries: string[]): void {
  matchMediaOverrides = queries;
}

// Mock window.confirm and window.alert to prevent test interruptions
window.confirm = () => true;
window.alert = () => {};

if (!window.getSelection) {
  Object.defineProperty(window, 'getSelection', {
    writable: true,
    value: () => ({
      rangeCount: 0,
      addRange() {},
      removeAllRanges() {},
      getRangeAt() {
        return document.createRange();
      },
      toString() {
        return '';
      },
    }),
  });
}

// Mock requestFullscreen / exitFullscreen (not available in jsdom)
Element.prototype.requestFullscreen = Element.prototype.requestFullscreen || (async () => {});
document.exitFullscreen = document.exitFullscreen || (async () => {});
