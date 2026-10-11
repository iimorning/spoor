import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseBookFocusPass, runBookFocusPass } from '../../src/services/bookFocusPass';
import { callUniversalAI } from '../../src/services/ai';
import i18n from '../../src/i18n';
import type { AIConfig } from '../../src/components/AISettingsModal';

vi.mock('../../src/services/ai', () => ({
  callUniversalAI: vi.fn(),
  formatAiError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

const callAi = vi.mocked(callUniversalAI);
const config = { provider: 'openrouter', apiKey: 'k' } as AIConfig;
const t = ((key: string, opts?: Record<string, unknown>) =>
  (i18n.t as unknown as (k: string, o?: Record<string, unknown>) => string)(key, opts)) as never;

const CHAPTER = '第一段讲的是旧衣服。\n\n第二段说，真正穿旧衣服的人不讲究旧。';
/** 一条够长的说明：低于门槛会被当成"复述正文"丢掉。 */
const NOTE = '这一处的分量在于它把"旧"从时间的远近改成了立场的远近，后面整章都建立在这上面。';

describe('parseBookFocusPass', () => {
  it('keeps verbatim quotes with their notes, and the hook', () => {
    const raw = JSON.stringify({
      marks: [{ quote: '真正穿旧衣服的人不讲究旧', note: NOTE }],
      message: '你有没有想过，所谓不讲究旧，本身就是一种讲究？',
    });
    expect(parseBookFocusPass(raw, CHAPTER)).toEqual({
      marks: [{ quote: '真正穿旧衣服的人不讲究旧', note: NOTE }],
      message: '你有没有想过，所谓不讲究旧，本身就是一种讲究？',
    });
  });

  it('drops a mark whose note only restates the passage', () => {
    // 引文没问题、说明只是把它复述一遍——那这条标注没有价值，整个丢掉。
    const raw = JSON.stringify({
      marks: [{ quote: '真正穿旧衣服的人不讲究旧', note: '这一段讲的是穿旧衣服。' }],
      message: '',
    });
    expect(parseBookFocusPass(raw, CHAPTER).marks).toEqual([]);
  });

  it('silently marks nothing when the model has nothing to say', () => {
    // 沉默是正确答案，而且是常见答案：这里必须原样放过。
    expect(parseBookFocusPass('{"marks":[],"message":""}', CHAPTER)).toEqual({
      marks: [],
      message: '',
    });
  });

  it('drops a quote the model paraphrased instead of copying', () => {
    // 转述、翻译、顺手改标点——全都定位不回去，宁可这一章不标。
    expect(
      parseBookFocusPass(JSON.stringify({ marks: [{ quote: '不在意旧衣服的人', note: NOTE }] }), CHAPTER)
        .marks,
    ).toEqual([]);
  });

  it('survives a reply that is not the envelope at all', () => {
    // 模型偶尔先客套一句再给 JSON，或者干脆跑题。伴读是自动触发的，
    // 这时候的表现必须是"这一章没标"，而不是把整趟炸掉。
    for (const raw of ['', '   ', 'sure! here you go', '[]', '{"marks":"nope"}', 'null', 42]) {
      expect(parseBookFocusPass(raw, CHAPTER)).toEqual({ marks: [], message: '' });
    }
  });

  it('accepts the field aliases models drift into', () => {
    const raw = JSON.stringify({
      highlights: [{ text: '真正穿旧衣服的人不讲究旧', reason: NOTE }],
      remark: '这一章值得停一下。',
    });
    expect(parseBookFocusPass(raw, CHAPTER)).toEqual({
      marks: [{ quote: '真正穿旧衣服的人不讲究旧', note: NOTE }],
      message: '这一章值得停一下。',
    });
  });
});

describe('runBookFocusPass', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    callAi.mockReset();
  });

  it('asks for the chapter and validates against the whole of it', async () => {
    callAi.mockImplementation(async (opts: { onStreamChunk?: (acc: string) => void }) => {
      const text = JSON.stringify({ marks: [{ quote: '真正穿旧衣服的人不讲究旧', note: NOTE }], message: '' });
      opts.onStreamChunk?.(text);
      return text;
    });

    const result = await runBookFocusPass({
      config,
      bookTitle: '孤独消费论',
      unitLabel: 'Ch2',
      chapterText: CHAPTER,
      t,
    });

    expect(result.marks).toEqual([{ quote: '真正穿旧衣服的人不讲究旧', note: NOTE }]);
    const prompt = String((callAi.mock.calls[0]?.[0] as { messages?: Array<{ content?: string }> })
      ?.messages?.[0]?.content ?? '');
    expect(prompt).toContain('第一段讲的是旧衣服');
    expect(prompt).toContain('孤独消费论');
  });

  it('does not call the model for an empty chapter', async () => {
    await expect(
      runBookFocusPass({ config, bookTitle: 'x', unitLabel: 'Ch1', chapterText: '   ', t }),
    ).resolves.toEqual({ marks: [], message: '' });
    expect(callAi).not.toHaveBeenCalled();
  });
});
