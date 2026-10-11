/**
 * 对账暗色模式：哪些硬编码文字色在暗色表面上已经看不清。
 *
 * 暗色模式下 `[data-theme="dark"]` 会把 bg-white / bg-[#FAF9F6] 这些底换成暗色，
 * 但文字色只在重映射表里换。表里漏掉的类会留成「暗底上的暗字」——
 * 这个脚本按 WCAG 对比度把漏网的挑出来，而不是靠肉眼扫。
 *
 * node 组件自带一套纸面色板（见 index.css 的注释），不进这张表。
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * 节点里「自带纸色」的那一部分，扫的时候跳过。
 *
 * 不是所有节点都该跳过：bg-white 且不带 --node-bg 的节点（Ambience / Agent / Ask /
 * Essay 等）整体会跟着暗色翻，内部浅色件不翻就会在深色节点上留一条白边——
 * AmbienceNode 顶部那条就是这么漏到用户眼前的。把整个 components/nodes 排除掉，
 * 等于让这类问题永远看不见，所以这里只排除真正自带纸色的。
 */
const PAPER_NODES = /components\/nodes\/(note\/|EssayNode\.tsx)/;

const DARK_SURFACES = { elevated: '#242220', surface: '#161514' };
const LIGHT_SURFACE = '#ffffff';

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const css = readFileSync('src/index.css', 'utf8');
const mapped = new Set(
  [...css.matchAll(/\[data-theme="dark"\]\s+([^{]+)\{/g)]
    .flatMap((m) => m[1].split(','))
    // 去掉选择器上的 `:hover` / `:focus` 之类后缀——类名本身是同一条。
    .map((s) => s.trim().replace(/^\./, '').replace(/:(?:hover|focus|focus-visible|focus-within|active|disabled)$/, '')),
);
const esc = (cls) => cls.replace(/[.[\]#/%:()!]/g, (c) => '\\' + c);

const usage = new Map();
for (const file of walk('src')) {
  const rel = relative('src', file).replace(/\\/g, '/');
  if (PAPER_NODES.test(rel)) continue; // 自带纸色的节点
  for (const m of readFileSync(file, 'utf8').matchAll(/(?:[a-z0-9:_-]+:)?text-\[#([0-9a-fA-F]{6})\]/g)) {
    const cls = m[0]; // 整个类名，比对重映射表时要连同 `#hex]` 一起转义
    const key = `${cls}|${m[1]}`;
    if (!usage.has(key)) usage.set(key, { cls, hex: `#${m[1]}`, files: new Set() });
    usage.get(key).files.add(rel);
  }
}

const rows = [];
for (const { cls, hex, files } of usage.values()) {
  if (mapped.has(esc(cls))) continue;
  const light = ratio(hex, LIGHT_SURFACE);
  const dark = Math.min(ratio(hex, DARK_SURFACES.elevated), ratio(hex, DARK_SURFACES.surface));
  // 只报「暗色下真的读不出来」的：亮色在暗底上本来就该保持原样。
  if (dark >= 3) continue;
  rows.push({ cls, hex, light: light.toFixed(2), dark: dark.toFixed(2), files: [...files] });
}
rows.sort((a, b) => Number(a.dark) - Number(b.dark));
for (const r of rows) {
  console.log(
    `${r.cls.padEnd(26)} ${r.hex}  暗底 ${String(r.dark).padStart(5)} : 1 (亮底 ${r.light})  ${r.files.slice(0, 3).join(', ')}`,
  );
}
console.log(`\n${rows.length} 个文字色在暗色表面上低于 3:1`);