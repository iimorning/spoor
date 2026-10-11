/**
 * 暗色模式对账的第二半：暗底里还留着的亮色面板和亮色描边。
 *
 * 文字色漏映射是「暗底暗字」（见 check-dark-contrast.mjs），底色漏映射是
 * 「暗底亮块」，描边漏映射是「暗底白线」——后两者不瞎，但在一屏深色里会像
 * 贴上去的白纸和划上去的白痕。这里把它们挑出来，好决定要不要一起补。
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

/**
 * 明知故白、不该报的地方。
 * key 是「角色 + 色值」，value 是理由——补规则时顺手更新这里，别让它变成
 * 一张谁也看不懂的黑名单。
 */
const INTENTIONAL = new Map([
  ['bg|#F7F4F0', '图谱视图的浅色档是用户自己选的（存在自己的 localStorage 里），index.css 里有嵌套 [data-theme="light"] 的出口把它圈出来'],
]);

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

const css = readFileSync('src/index.css', 'utf8');
const mapped = new Set(
  [...css.matchAll(/\[data-theme="dark"\][^{]*?([^{}]*)\{[^{}]*\}/g)]
    .flatMap((m) => m[1].split(','))
    .map((s) =>
      s
        .trim()
        .replace(/^\./, '')
        .replace(
          /:(?:hover|focus|focus-visible|focus-within|active|disabled|before|after)$/,
          '',
        ),
    ),
);
const esc = (cls) => cls.replace(/[.[\]#/%:()!]/g, (c) => '\\' + c);

const usage = new Map();
for (const file of walk('src')) {
  const rel = relative('src', file).replace(/\\/g, '/');
  if (PAPER_NODES.test(rel)) continue; // 自带纸色的节点
  // 注意透明度有两种写法：`bg-[#FFF]/70` 的斜杠在括号外。两种都要匹配到，
  // 否则会把已经映射过的类报成漏网。
  for (const m of readFileSync(file, 'utf8').matchAll(
    /(?:[a-z0-9-]+:)?(bg|border)-\[#([0-9a-fA-F]{6})\](?:\/[0-9]+)?/g,
  )) {
    const role = m[1];
    const cls = m[0];
    const hex = `#${m[2]}`;
    const key = `${cls}|${hex}`;
    if (!usage.has(key)) usage.set(key, { role, cls, hex, files: new Set() });
    usage.get(key).files.add(rel);
  }
}

const rows = [];
const skipped = [];
for (const { cls, hex, role, files } of usage.values()) {
  // 重映射表里那条可能带了额外的伪类（:disabled:not(...)），按前缀找。
  const covered = [...mapped].some(
    (entry) => entry === esc(cls) || entry.startsWith(`${esc(cls)}:`),
  );
  if (covered) continue;
  if (INTENTIONAL.has(`${role}|${hex}`)) {
    skipped.push(`${cls} ${hex} — ${INTENTIONAL.get(`${role}|${hex}`)}`);
    continue;
  }
  if (lum(hex) < 0.4) continue; // 深色底在暗色模式里本来就该留着
  rows.push({ cls, hex, role, lum: lum(hex).toFixed(2), files: [...files] });
}
rows.sort((a, b) => b.files.length - a.files.length);
for (const r of rows) {
  console.log(
    `${r.cls.padEnd(30)} ${r.hex}  亮度 ${r.lum}  ${String(r.files.length).padStart(2)}  ${r.files.slice(0, 3).join(', ')}`,
  );
}
for (const s of skipped) console.log(`\n（有意保留）${s}`);
console.log(`\n${rows.length} 个亮色的底/描边没有暗色重映射`);