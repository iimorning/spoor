#!/usr/bin/env node
/**
 * 从本地 ECDICT 生成一份能进包的英汉词表子集。
 *
 * **这个脚本不附带任何词典数据。** 原始 ECDICT 由使用者自己去
 * <https://github.com/skywind3000/ECDICT> 取，然后跑一次这个脚本；产物
 * `public/data/dictionary/ecdict-subset.json` 已在 .gitignore 里，不进版本库。
 * 理由是 ECDICT 的词条是多处语料和释义来源聚合来的，MIT 覆盖的是这份代码，
 * 不等于明确授权再分发整份词库——所以只发布生成方法，不发布数据。
 *
 * 用法：
 *   node scripts/build-ecdict-subset.mjs <ecdict.csv 路径> [--out <输出路径>]
 *
 * 保留的字段：word / phonetic / translation / pos / collins / tag / frq。
 * 刻意**不保留** `definition`（英文释义）——覆盖率只有 20%，带进来体积翻倍，
 * 而英英释义由运行时的在线源负责。
 */

import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';

/** 收这些考试/能力标签：读者在书里真会卡住的词就在这里。 */
const KEEP_TAGS = new Set([
  'zk', 'gk', 'cet4', 'cet6', 'ky', 'ielts', 'toefl', 'gre',
]);

/**
 * 语料词频（ECDICT 的 `frq` 列）排到第几名。
 *
 * 只按考试标签收是不够的：标签只覆盖全库 1%，像 unhelpful、theorize 这种
 * 读书会撞上、却不在考纲里的词全都收不到。语料词频这一列本身只填了四万多条
 * （ECDICT 的老数据），正好是当代英语里最常用的一批。两个标准取并集才是
 * 读得动的覆盖面。
 */
const FREQ_RANK_MAX = 20000;

const OUT_DEFAULT = 'public/data/dictionary/ecdict-subset.json';

/** ECDICT 是带引号、引号内可含逗号和换行的 CSV——自己拆，不能 split(',')。 */
function splitCsvLine(line) {
  const cells = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

async function main() {
  const args = process.argv.slice(2);
  const srcArg = args.find((a) => !a.startsWith('--'));
  if (!srcArg) {
    console.error(
      '用法：node scripts/build-ecdict-subset.mjs <ecdict.csv> [--out <输出路径>]',
    );
    process.exit(1);
  }
  const outIdx = args.indexOf('--out');
  const outPath = resolve(outIdx >= 0 ? args[outIdx + 1] : OUT_DEFAULT);
  const srcPath = resolve(srcArg);

  try {
    await stat(srcPath);
  } catch {
    console.error(`找不到 ${srcPath}`);
    console.error('先从 https://github.com/skywind3000/ECDICT 取 ECDICT.csv 再跑。');
    process.exit(1);
  }

  const rl = createInterface({
    input: createReadStream(srcPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  const header = await rl[Symbol.asyncIterator]().next();
  if (header.done) {
    console.error('输入是空文件');
    process.exit(1);
  }
  const cols = splitCsvLine(header.value);
  const at = (name) => cols.indexOf(name);

  const iWord = at('word');
  const iPhonetic = at('phonetic');
  const iTranslation = at('translation');
  const iPos = at('pos');
  const iCollins = at('collins');
  const iTag = at('tag');
  const iFrq = at('frq');
  if (iWord < 0 || iTranslation < 0) {
    console.error(`表头里没有 word / translation 列：${cols.join(',')}`);
    process.exit(1);
  }

  const out = new Map();
  let scanned = 0;
  for await (const line of rl) {
    if (!line) continue;
    scanned += 1;
    const cells = splitCsvLine(line);
    const tag = iTag >= 0 ? cells[iTag] ?? '' : '';
    const rawFrq = iFrq >= 0 ? (cells[iFrq] ?? '').trim() : '';
    // frq 列绝大多数是 0，意思是"这条没有词频数据"——不是"排第一"。
    // 当成 0 处理会把全库七十七条全收进来。
    const frqNum = /^\d+$/.test(rawFrq) ? Number(rawFrq) : 0;
    const frqRank = frqNum > 0 ? frqNum : Number.POSITIVE_INFINITY;
    const wanted =
      frqRank <= FREQ_RANK_MAX ||
      tag.split(/\s+/).some((t) => t && KEEP_TAGS.has(t));
    if (!wanted) continue;
    const word = (cells[iWord] ?? '').trim().toLowerCase();
    const translation = (cells[iTranslation] ?? '').trim();
    if (!word || !translation) continue;
    // ECDICT 一个词只有一行，不存在"多行里挑一条"的情况——但真出现了就得
    // 保住已有的，别让行顺序决定结果。（原来那两道守卫判的是列索引而不是单元格，
    // 恒为假，等于没写。）
    if (out.has(word)) continue;
    out.set(word, {
      w: word,
      p: iPhonetic >= 0 ? (cells[iPhonetic] ?? '').trim() : '',
      // 义项之间保留**换行**，不要拍成一行：读者要能一眼分清"系统"和"制度"是两个
      // 义项，而不是一个长串。截断放到 400——长词条本来就该给全。
      t: translation.replace(/\\n/g, '\n').slice(0, 400).trim(),
      pos: iPos >= 0 ? (cells[iPos] ?? '').trim() : '',
      collins: iCollins >= 0 ? (cells[iCollins] ?? '').trim() : '',
      tag,
      f: iFrq >= 0 ? (cells[iFrq] ?? '').trim() : '',
    });
  }

  const dict = {};
  for (const key of [...out.keys()].sort()) dict[key] = out.get(key);

  const json = JSON.stringify(dict);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, json, 'utf8');

  console.log(`扫过 ${scanned.toLocaleString()} 行，收进 ${Object.keys(dict).length.toLocaleString()} 词条`);
  console.log(`写出 ${outPath}`);
  console.log(`  ${(json.length / 1048576).toFixed(1)} MB（gzip 后约 ${(json.length / 4096).toFixed(0)} KB）`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
