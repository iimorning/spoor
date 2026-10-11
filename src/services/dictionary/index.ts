/**
 * 查词的统一入口：先词典，后模型。
 *
 * 划词时最常见的情况是划到一个生词。对这类问题，调一次大模型要好几秒、还要花钱，
 * 而词典是瞬时的、免费的、离线也能用。所以顺序是：
 *
 *   单个词  → 本地英汉词表（无延迟）→ 拿不到再问模型
 *   多个词  → 直接走模型（词典给不了整句的意思）
 *
 * 英英释义是**补充**不是前置：它要在运行时抓外部站点，慢且不稳，所以只有本地
 * 词表已经答上来、读者还想要"这个词英文怎么讲"时才去取，取不到也不影响主答案。
 */

import { lookupEcdict, type EcdictEntry } from './ecdict';
import { lookupEnglish, type EnglishLookup } from './sources';

export type DictionaryHit = {
  /** 'word' = 单词走词典查到了；'model' = 该问模型了 */
  via: 'word' | 'model';
  ecdict?: EcdictEntry;
};

const WORD_RE = /^[A-Za-z]+(?:[-'][A-Za-z]+)*$/;

/** 是不是一个"可以查词典"的词。整句、短语、带数字的一律不算。 */
export function isLookableWord(text: string): boolean {
  return WORD_RE.test(text.trim());
}

/**
 * 划到的是不是单个词。决定这条能不能跳过模型。
 *
 * 用词数判断而不是长度：一个很长的单词照样能查词典，而三个词的短语查了也没用。
 */
export function looksLikeSingleWord(text: string): boolean {
  return isLookableWord(text);
}

/**
 * 单词优先走词表。查不到返回 `via: 'model'`，调用方据此决定要不要发模型请求。
 */
export async function lookupWord(text: string): Promise<DictionaryHit> {
  if (!isLookableWord(text)) return { via: 'model' };
  const entry = await lookupEcdict(text);
  return entry ? { via: 'word', ecdict: entry } : { via: 'model' };
}

/**
 * 英英释义。失败一律返回 null，不抛——它是锦上添花，答不上来不该影响主答案。
 */
export async function lookupEnglishMeanings(
  word: string,
  timeoutMs?: number,
): Promise<EnglishLookup | null> {
  if (!isLookableWord(word)) return null;
  try {
    return await lookupEnglish(word, timeoutMs);
  } catch (e) {
    console.info('[Spoor] 英英释义查询失败：', e);
    return null;
  }
}

export type { EcdictEntry } from './ecdict';
export type { EnglishDefinition, EnglishLookup } from './sources';
export { ENGLISH_SOURCES, sourcesForWord } from './sources';
export { ecdictStats, resetEcdictCache } from './ecdict';
