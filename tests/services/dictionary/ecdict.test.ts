import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  lookupEcdict,
  resetEcdictCache,
  ecdictStats,
} from '../../../src/services/dictionary/ecdict';

const DICT: Record<string, unknown> = {
  enthusiasm: { w: 'enthusiasm', p: "in'θju:ziæzәm", t: 'n. 巨大的热情, 热心', tag: 'cet4', f: '3716' },
  resilience: { w: 'resilience', p: "ri'ziliәns", t: 'n. 恢复力', tag: 'ielts', f: '10578' },
  theorize: { w: 'theorize', p: "'θiәraiz", t: 'vi. 建立理论, 推理', tag: 'gre', f: '9999' },
  study: { w: 'study', p: "'stʌdi", t: 'n. 研究; 书房', tag: 'cet4', f: '800' },
  unship: { w: 'unship', p: "'ʌn'ʃɪp", t: 'v. 卸下; 下船', tag: 'toefl', f: '20000' },
  Enthusiasm: { w: 'enthusiasm', p: 'x', t: 'dup key' },
};

const originalFetch = globalThis.fetch;

beforeEach(() => {
  resetEcdictCache();
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => DICT,
  })) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('lookupEcdict', () => {
  it('finds a word and returns its phonetic and translation', async () => {
    const hit = await lookupEcdict('enthusiasm');
    expect(hit?.t).toContain('巨大的热情');
    expect(hit?.p).toContain('θju');
  });

  it('is case-insensitive, and a later duplicate key does not win', async () => {
    // 键统一小写；重复键以 Map 保留先到的那个。
    const hit = await lookupEcdict('ENTHUSIASM');
    expect(hit?.t).toContain('巨大的热情');
  });

  it('resolves inflections back to the base word', async () => {
    // 词典查不到形态变化是最常见的挫败：unshipped 查不到、unship 查得到。
    expect((await lookupEcdict('unshipped'))?.t).toContain('卸下');
    expect((await lookupEcdict('theorized'))?.t).toContain('理论');
    // 补 e：making → make，不是 mak
    expect((await lookupEcdict('theorizing'))?.w).toBe('theorize');
    // y 还原：studies → study
    expect((await lookupEcdict('studied'))?.w).toBe('study');
  });

  it('returns null for a word that is simply not there', async () => {
    expect(await lookupEcdict('unhelpful')).toBeNull();
  });

  it('returns null for an empty query', async () => {
    expect(await lookupEcdict('   ')).toBeNull();
  });

  it('only fetches once, however many words are looked up', async () => {
    await lookupEcdict('enthusiasm');
    await lookupEcdict('resilience');
    await lookupEcdict('theorize');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('reports unavailable and stops retrying when the subset is missing', async () => {
    // 本地没跑过生成脚本是常态，不是故障：不该每次查词都打一次失败的请求。
    globalThis.fetch = vi.fn(async () => {
      throw new Error('404');
    }) as unknown as typeof fetch;
    resetEcdictCache();

    expect(await lookupEcdict('enthusiasm')).toBeNull();
    expect(await lookupEcdict('resilience')).toBeNull();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(await ecdictStats()).toBeNull();
  });
});
