/**
 * 英英释义：运行时查。
 *
 * 用的是 **Free Dictionary API**（`api.dictionaryapi.dev`）——免费、开放、**带 CORS 头**，
 * 所以网页版和桌面版都能用，不需要任何后端转发。它同时给音标和真人录音，
 * 查词这件事能一次给全。
 *
 * 它在部分网络下不通（实测会超时）。取不到就安静地回落：本地词表（见 `ecdict.ts`）
 * 没有的话再交给模型那条路——查词不能因为一个源不通就断掉。
 */

export type EnglishDefinition = {
  /** 词性标签，如 "verb" / "noun" */
  pos?: string;
  /** 一条释义 */
  text: string;
  /** 真人录音地址。有它就别用合成语音了。 */
  audio?: string;
};

export type EnglishSource = {
  id: string;
  /** 界面上显示的出处 */
  label: string;
  /** 这个源认不认这个词（有些源只收短语） */
  supports?: (word: string) => boolean;
  urlFor: (word: string) => string;
  parse: (body: string, word: string) => EnglishDefinition[];
};

/** 只收单个词或连字符词组——整句没有英英释义，去查只是白跑一趟。 */
const isLookable = (word: string) => /^[a-z]+(?:[-'][a-z]+)*$/i.test(word.trim());

/**
 * 抓一个 JSON 接口。Tauri 优先——那是一条已经存在的、绕过浏览器 CORS 的出口
 * （和 `metaso_search` 同一个理由）。
 */
async function fetchJson(url: string): Promise<string | null> {
  const tauri = (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  if (tauri) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<string>('fetch_dict_page', { url });
    } catch (e) {
      console.info('[Spoor] 词典接口抓取失败（桌面端）：', e);
      return null;
    }
  }
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return JSON.stringify(await res.json());
  } catch {
    // 网络不通是预期结果，不该刷控制台。
    return null;
  }
}

/**
 * Free Dictionary API。查得到音标、释义、同反义词，还有真人录音。
 */
const freeDictionary: EnglishSource = {
  id: 'free-dictionary',
  label: 'Free Dictionary API',
  supports: isLookable,
  urlFor: (word) =>
    `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.trim())}`,
  parse: (raw) => {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return [];
    }
    if (!Array.isArray(data)) return [];
    const out: EnglishDefinition[] = [];
    for (const entry of data) {
      const e = entry as {
        meanings?: Array<{
          partOfSpeech?: string;
          definitions?: Array<{ definition?: string; synonyms?: string[] }>;
        }>;
        phonetics?: Array<{ audio?: string }>;
      };
      // 录音挂在条目上，不在释义上；取第一条有音频的，用在每一条释义上。
      const audio = (e.phonetics ?? []).find((p) => p.audio)?.audio;
      for (const m of e.meanings ?? []) {
        const def = m.definitions?.[0];
        if (!def?.definition) continue;
        out.push({ pos: m.partOfSpeech, text: def.definition, audio });
        if (out.length >= 5) break;
      }
      if (out.length >= 5) break;
    }
    return out;
  },
};

/** 顺序就是界面上的展示顺序：先给最权威的。 */
export const ENGLISH_SOURCES: EnglishSource[] = [freeDictionary];

export function sourcesForWord(word: string): EnglishSource[] {
  return ENGLISH_SOURCES.filter((s) => !s.supports || s.supports(word));
}

export type EnglishLookup = {
  sourceId: string;
  sourceLabel: string;
  definitions: EnglishDefinition[];
};

/**
 * 依次问各源，第一个答上来的算结果。取不到就返回 null，由调用方回落。
 */
export async function lookupEnglish(word: string, timeoutMs = 4000): Promise<EnglishLookup | null> {
  const key = word.trim();
  if (!key) return null;
  for (const source of sourcesForWord(key)) {
    const body = await withTimeout(fetchJson(source.urlFor(key)), timeoutMs);
    if (!body) continue;
    const definitions = source.parse(body, key);
    if (definitions.length > 0) {
      return { sourceId: source.id, sourceLabel: source.label, definitions };
    }
  }
  return null;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p,
    new Promise<null>((resolve) => window.setTimeout(() => resolve(null), ms)),
  ]);
}