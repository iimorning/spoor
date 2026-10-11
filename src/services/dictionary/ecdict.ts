/**
 * 本地英汉词表：查词走它，零延迟、零成本、离线可用。
 *
 * 数据是 ECDICT 的子集，由 `scripts/build-ecdict-subset.mjs` 从使用者自己取的
 * ECDICT.csv 生成，落在 `public/data/dictionary/ecdict-subset.json`（已 gitignore，
 * 仓库里不带词库数据）。没生成过也不影响使用——查不到就回落到模型那条路。
 *
 * 加载是懒的：第一次查词才 `fetch`，之后常驻内存。一份两三百 KB 的 JSON 解析
 * 进来只需要几毫秒，不值得为它拖慢首屏。
 */

export type EcdictEntry = {
  w: string;
  /** 音标 */
  p?: string;
  /** 中文释义，多条之间用 " / " 分隔 */
  t: string;
  pos?: string;
  collins?: string;
  tag?: string;
  /** 语料词频名次，空串表示没有 */
  f?: string;
};

const SUBSET_URL = 'data/dictionary/ecdict-subset.json';

let cache: Map<string, EcdictEntry> | null = null;
let loading: Promise<Map<string, EcdictEntry> | null> | null = null;
/** 加载失败过就别反复试——本地没生成子集是常态，不是临时故障。 */
let unavailable = false;

async function load(): Promise<Map<string, EcdictEntry> | null> {
  if (cache) return cache;
  if (unavailable) return null;
  if (loading) return loading;
  loading = (async () => {
    try {
      const res = await fetch(SUBSET_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = (await res.json()) as Record<string, EcdictEntry>;
      const map = new Map<string, EcdictEntry>();
      for (const [k, v] of Object.entries(raw)) {
        // 键统一小写：查词时也会小写化，靠这一层统一比较。
        // 生成脚本本来就保证小写后唯一，这里再挡一层是为了让"万一有重复"时的
        // 行为是确定的——先到的赢，而不是取决于 JSON 里的顺序。
        const key = k.toLowerCase();
        if (!map.has(key)) map.set(key, v);
      }
      cache = map;
      return map;
    } catch (e) {
      unavailable = true;
      console.info('[Spoor] 本地词表不可用，查词改走模型：', e);
      return null;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** 测试用：让下一次查词重新加载。 */
export function resetEcdictCache(): void {
  cache = null;
  loading = null;
  unavailable = false;
}

/** 供设置页显示"本地词表装上没有"。 */
export async function ecdictStats(): Promise<{ words: number } | null> {
  const map = await load();
  return map ? { words: map.size } : null;
}

/** 双写辅音的词尾：unshipped 切出来是 unshipp，还要再退一个字母才是 unship。 */
const DOUBLED = /(?:p|n|l|s|t|f|r|m|g|b|ll|ss|tt|ff|rr|mm|gg|bb)$/;

/**
 * 最常见的形态变化。词典查不到形态是最常见的挫败：unshipped 查不到、
 * unship 查得到。ECDICT 自带的 `exchange` 字段能做这件事，但子集没保留它
 * （会显著撑大体积），所以这里用规则补。
 *
 * 每条规则都给出"还原后可能的样子"，宁多勿少——多试几个词只是几次 Map 查找，
 * 漏一个形态就是一次查不到词。
 */
function variants(word: string): string[] {
  const out: string[] = [];
  const add = (...c: string[]) => {
    for (const v of c) if (v && v !== word) out.push(v);
  };

  if (word.endsWith('ies') && word.length > 4) add(`${word.slice(0, -3)}y`);

  if (word.endsWith('ing') && word.length > 5) {
    const stem = word.slice(0, -3);
    // running → run（双写）；making → make（补 e）
    add(stem, `${stem}e`);
    if (DOUBLED.test(stem)) add(stem.slice(0, -1));
  }

  if (word.endsWith('ed') && word.length > 4) {
    // studied → study
    if (word.endsWith('ied')) add(`${word.slice(0, -3)}y`);
    const stem = word.slice(0, -2);
    add(stem, `${stem}e`);
    if (DOUBLED.test(stem)) add(stem.slice(0, -1));
  }

  if (word.endsWith('es') && word.length > 3) add(word.slice(0, -2), word.slice(0, -1));
  if (word.endsWith('s') && word.length > 2) add(word.slice(0, -1));
  if (word.endsWith('ly') && word.length > 4) add(word.slice(0, -2));
  if (word.endsWith('er') && word.length > 4) add(word.slice(0, -2), word.slice(0, -1));
  if (word.endsWith('est') && word.length > 5) add(word.slice(0, -3), word.slice(0, -2));

  return out;
}

/**
 * 查一个词。返回 null 表示本地词表里没有——调用方据此回落到模型。
 */
export async function lookupEcdict(word: string): Promise<EcdictEntry | null> {
  const key = word.trim().toLowerCase();
  if (!key) return null;
  const map = await load();
  if (!map) return null;

  const direct = map.get(key);
  if (direct) return direct;

  // 词典查不到形态变化是最常见的挫败：unshipped 查不到、unship 查得到。
  // ECDICT 自带 `exchange` 字段（形态互指），子集里没保留，这里用规则补。
  for (const v of variants(key)) {
    const hit = map.get(v);
    if (hit) return hit;
  }
  return null;
}
