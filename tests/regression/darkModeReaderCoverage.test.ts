/**
 * 阅读器相关的组件（书籍卡、全屏阅读、摘抄栏、划词工具条）里，硬编码的亮色
 * 在暗色主题下会失效。补映射的活儿是逐个类名对着 [data-theme="dark"] 块查，
 * 而那张表已经补了一百多条 —— 下次动样式很容易又落下一两个（bg-white/98 就是
 * 这样漏的：翻译浮层在暗色下还是一张白卡片）。
 *
 * 所以这里不钉死类名清单，改成钉住判据：暗色下扛不住对比度的颜色，必须有映射。
 * 浅色系（#b8b4ac、#a8a49c 这类浅灰）在暗底上本来就够读，不需要映射 —— 早期
 * 扫描把它们一并报成「缺失」，那是误报，进了测试就是永久噪音。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** src/index.css 里 [data-theme="dark"] 块的 token 取值。改主题色时这里也要跟着核对。 */
const DARK = {
  surface: '#161514',
  surfaceElevated: '#242220',
  surfaceHover: '#2e2b28',
  border: '#3a3735',
  text: '#f0ede8',
  accent: '#F97316',
  accentHover: '#ea580c',
} as const;

const READER_FILES = [
  'src/components/BookFullscreen.tsx',
  'src/components/BookExcerptRail.tsx',
  'src/components/TextSelectionToolbar.tsx',
  'src/components/nodes/BookNode.tsx',
] as const;

const UTILITY_RE =
  /(?:hover:)?(?:bg|text|border|ring|decoration)-(?:white|\[[^\]]+\])(?:\/\d+)?/g;

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** 把半透明色按 alpha 合成到背景上 —— /10、/15 这类淡底要按合成后的实际观感判断。 */
function flatten(fg: string, alpha: number, bg: string): string {
  const f = parseHex(fg);
  const b = parseHex(bg);
  const mix = f.map((c, i) => Math.round(c * alpha + b[i] * (1 - alpha)));
  return '#' + mix.map((c) => c.toString(16).padStart(2, '0')).join('');
}

/**
 * Tailwind 把任意值类名里的 [ ] # : / 都反斜杠转义后才写进选择器，
 * 少转义任何一个都查不到 —— 头两次扫描「缺失 41 项」/「缺失 11 项」就是这么来的。
 *
 * 而且必须是「真正写在规则里」，不能在文件里现搜一段字符串就算数：把选择器改名成
 * `.x .bg-white\/98` 之后，子串照样匹配得上了，那条测试就成了摆设（试过两次，都会假绿）。
 * 这张表里的写法一律是 `[data-theme="dark"] <该类>` —— 目标类紧跟在主题属性后面，
 * 中间不留别的后代选择器，末尾不许接别的类名的字符。按这个形状匹配才拦得住。
 */
function hasDarkRule(css: string, cls: string): boolean {
  const cssEscaped = cls.replace(/[[\]#:/]/g, (c) => '\\' + c);
  // 上一步得到的是「CSS 里的写法」，其中每个反斜杠是真实字符；直接塞进 RegExp
  // 会被当成转义序列（`\/` 就塌回普通的 `/`），所以还要给正则本身再转一次。
  const rx = cssEscaped.replace(/\\/g, '\\\\');
  return new RegExp(`\\[data-theme="dark"\\]\\s+\\.${rx}(?![\\w\\-])`).test(css);
}

/** 返回该类名在暗色下是否真的撑不住；撑得住就返回 null（不需要映射）。 */
function brokenInDark(cls: string): string | null {
  const isHover = cls.startsWith('hover:');
  const base = isHover ? cls.slice('hover:'.length) : cls;
  const slash = base.lastIndexOf('/');
  const core = slash >= 0 ? base.slice(0, slash) : base;
  const alpha = slash >= 0 ? Number(base.slice(slash + 1)) / 100 : 1;
  const kind = core.split('-')[0];
  const raw = core.slice(core.indexOf('-') + 1);
  if (/^\d+(\.\d+)?px$/.test(raw)) return null; // 字号，跟主题无关

  const hex = raw === 'white' ? '#ffffff' : raw;
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;

  if (kind === 'text') {
    const c = flatten(hex, alpha, DARK.surfaceElevated);
    return contrast(c, DARK.surfaceElevated) < 3
      ? `暗底上只有 ${contrast(c, DARK.surfaceElevated).toFixed(1)}:1`
      : null;
  }
  if (kind === 'border') {
    const c = flatten(hex, alpha, DARK.surface);
    // 细线不是要「看得见」，是要「几乎看不见」。压在暗底上反而扎眼，一样算坏。
    return contrast(c, DARK.surface) > 3
      ? `在暗底上是 ${contrast(c, DARK.surface).toFixed(1)}:1 的硬边`
      : null;
  }
  if (kind === 'bg') {
    const c = flatten(hex, alpha, DARK.surface);
    return contrast(c, DARK.surface) > 3
      ? `底色仍是浅色，${contrast(c, DARK.surface).toFixed(1)}:1`
      : null;
  }
  return null; // ring / decoration 不参与
}

describe('阅读器的暗色覆盖', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf-8');

  it('src/index.css 读得到', () => {
    expect(css).toContain('[data-theme="dark"]');
  });

  it.each(READER_FILES)('%s 里扛不住暗色的颜色都有映射', (file) => {
    const source = readFileSync(resolve(process.cwd(), file), 'utf-8');
    const broken = [...new Set(source.match(UTILITY_RE) ?? [])]
      .filter((c) => !c.startsWith('ring-') && !c.startsWith('decoration-'))
      .map((c) => ({ cls: c, why: brokenInDark(c) }))
      .filter((x) => x.why !== null && !hasDarkRule(css, x.cls))
      .map((x) => `${x.cls}（${x.why}）`);
    expect(broken).toEqual([]);
  });

  it('翻译浮层的底色确实翻成了暗色', () => {
    // 就是用户截图里那张白卡片。回归钉在这一条上，别让它悄悄回去。
    const node = readFileSync(
      resolve(process.cwd(), 'src/components/nodes/BookNode.tsx'),
      'utf-8',
    );
    expect(node).toContain('bg-white/98');
    expect(css).toMatch(
      /\[data-theme="dark"\]\s+\.bg-white\\\/98\s*\{[^}]*--color-surface-elevated/,
    );
  });

  it('上面这条规则不是只补了一半（hover 档同样要翻）', () => {
    // 按钮常态是 accent，悬停档 #a0350a 是更暗的一档；只翻常态的话，指针压上去
    // 的一瞬间按钮就沉进暗底里。两条必须成对出现。
    expect(css).toMatch(
      /\[data-theme="dark"\]\s+\.hover\\:bg-\\\[\\#a0350a\\\]:hover\s*\{[^}]*--color-accent-hover/,
    );
  });
});