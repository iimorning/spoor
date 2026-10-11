import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildTranslateContext,
  parseBookTranslate,
  runBookTranslate,
} from '../../src/services/bookTranslate';
vi.mock('../../src/services/ai', () => ({
  callUniversalAI: vi.fn(async () => '{"translation":"x","note":""}'),
  formatAiError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import { callUniversalAI } from '../../src/services/ai';
import type { AIConfig } from '../../src/components/AISettingsModal';

const callAi = vi.mocked(callUniversalAI);
const config = { provider: 'openrouter', apiKey: 'k' } as AIConfig;

const BODY =
  'He walked into the shop without hesitation, asked for a row of tickets, ' +
  'and paid without counting. Outside, the rain had stopped. The clerk watched ' +
  'him go and said nothing at all, which was the most honest thing she had done ' +
  'all week.';

/** callUniversalAI 的回调形状，流式用例要自己按 SSE 的节奏调它。 */
type StreamOpts = {
  onStreamChunk?: (accumulated: string) => void;
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
};

describe('buildTranslateContext', () => {
  it('marks the selection and keeps the words around it', () => {
    const { context, located } = buildTranslateContext(BODY, 'a row of tickets');
    expect(located).toBe(true);
    // 标记包住的正是选中的那几个字
    expect(context).toContain('‹‹a row of tickets››');
    // 上下文在：选段前后的文字都还在，不然多义词无从判断
    expect(context).toContain('walked into the shop');
    expect(context).toContain('paid without counting');
  });

  it('never cuts a window through the middle of the selection', () => {
    // 选段贴在一篇长文的最开头——开窗很容易从它中间切进去，
    // 那样标记被拆成两半，模型就不知道该翻哪边了。
    const long = 'First sentence here. ' + BODY.repeat(20);
    const { context } = buildTranslateContext(long, 'a row of tickets');
    expect(context).toContain('‹‹a row of tickets››');
  });

  it('marks a whole sentence, not just its first 80 characters', () => {
    // 划句常常超过 80 字。只拿前缀去定位的话，右标记会落在选段中间，
    // 模型收到的"要翻的那段"就是残的——那等于让它翻一句不完整的话。
    const long = BODY.slice(0, 95);
    expect(long.length).toBeGreaterThan(80);
    const { context, located } = buildTranslateContext(BODY, long);
    expect(located).toBe(true);
    expect(context).toContain(`‹‹${long}››`);
  });

  it('falls back to the bare selection when the words cannot be located', () => {
    const { context, located } = buildTranslateContext(BODY, '完全不在正文里的一句话');
    expect(located).toBe(false);
    // 宁可上下文差一点，也不能让模型去翻错东西
    expect(context).toBe('‹‹完全不在正文里的一句话››');
  });

  it('returns nothing for an empty selection', () => {
    expect(buildTranslateContext(BODY, '   ').context).toBe('');
    expect(buildTranslateContext('', 'anything').context).toBe('');
  });
});

describe('parseBookTranslate', () => {
  it('takes the translation and the note', () => {
    const r = parseBookTranslate('{"translation":"一排票","note":"行取 háng。"}');
    expect(r.translation).toBe('一排票');
    expect(r.note).toBe('行取 háng。');
  });

  it('reads the alternate field names a model might reach for', () => {
    expect(parseBookTranslate('{"text":"hello"}').translation).toBe('hello');
  });

  it('drops the whole thing when there is no translation', () => {
    // 只剩一句说明、没译文：浮层里显示一个孤零零的解释比什么都不显示更糟。
    const r = parseBookTranslate('{"note":"取 háng。"}');
    expect(r.translation).toBe('');
    expect(r.note).toBe('');
  });

  it('survives a model that does not answer in the envelope', () => {
    for (const raw of ['', '好的，我来翻一下。', 'not json at all', null, 42]) {
      expect(parseBookTranslate(raw)).toEqual({ translation: '', note: '' });
    }
  });

  it('tolerates a JSON envelope wrapped in a code fence', () => {
    const r = parseBookTranslate('```json\n{"translation":"hi"}\n```');
    expect(r.translation).toBe('hi');
  });
});

describe('runBookTranslate', () => {
  beforeEach(() => {
    callAi.mockReset();
    callAi.mockResolvedValue('{"translation":"一排票","note":""}');
  });

  it('asks for the marked window and comes back with a translation', async () => {
    const result = await runBookTranslate({
      config,
      title: 'Demo',
      selection: 'a row of tickets',
      body: BODY,
      targetLang: 'zh',
      sourceLang: 'en',
    });
    expect(result.translation).toBe('一排票');
    const sent = callAi.mock.calls[0]?.[0] as {
      systemInstruction: string;
      messages: Array<{ content: string }>;
      temperature: number;
    };
    // 模型看到的必须带着标记和上下文
    expect(sent.messages[0].content).toContain('‹‹a row of tickets››');
    expect(sent.messages[0].content).toContain('walked into the shop');
    // 提示词里的语言名得插好，不能把 {{targetLang}} 原样发出去
    expect(sent.systemInstruction).not.toContain('{{targetLang}}');
    expect(sent.systemInstruction).not.toContain('{{sourceLang}}');
    // 翻译没有发挥空间
    expect(sent.temperature).toBeLessThanOrEqual(0.2);
  });

  it('turns reasoning off for translation and survives a think block anyway', async () => {
    // 上游不认 enabled:false 时照样会先吐一段思考链，而思考里带花括号就足以让
    // "抽第一个平衡括号"抽错位置——所以关掉之外还得能扛住。
    callAi.mockResolvedValue(
      '<think>先看看这句 {"a":1}</think>{"translation":"一排票","note":""}',
    );
    const result = await runBookTranslate({
      config: { ...config, reasoningMode: 'high' } as AIConfig,
      title: 'Demo',
      selection: 'a row of tickets',
      body: BODY,
      targetLang: 'zh',
      sourceLang: 'en',
    });
    // 用户在设置里为伴读开的深度思考，不该由翻译这一环替他付账。
    const sent = callAi.mock.calls[0]?.[0] as { config: { reasoningMode?: string } };
    expect(sent.config.reasoningMode).toBe('off');
    expect(result.translation).toBe('一排票');
  });

  it('hands the retry callback down, so a slow call can be told apart from a retried one', async () => {
    // 28 秒光看总耗时分不出是"一次往返"还是"三次重试在救场"——这两种修法正好相反。
    // 所以 onRetry 必须真的传到 callUniversalAI，否则日志里的"重试：无"永远是假的。
    await runBookTranslate({
      config,
      title: 'Demo',
      selection: 'a row of tickets',
      body: BODY,
      targetLang: 'zh',
      sourceLang: 'en',
    });
    const opts = callAi.mock.calls[0]?.[0] as { onRetry?: unknown };
    expect(typeof opts.onRetry).toBe('function');

    // 回调被调用时要能吞下一次重试，不把异常抛回调用方
    const { AiHttpError } = await import('../../src/utils/aiTransientRetry');
    const cb = opts.onRetry as (a: number, e: unknown, d: number) => void;
    expect(() => cb(1, new AiHttpError(502, 'bad gateway'), 400)).not.toThrow();
  });

  it('does not call the model for an empty selection', async () => {
    const r = await runBookTranslate({
      config,
      title: 'Demo',
      selection: '   ',
      body: BODY,
      targetLang: 'zh',
      sourceLang: 'en',
    });
    expect(r.translation).toBe('');
    expect(callAi).not.toHaveBeenCalled();
  });

  it('asks for no stream when the caller did not subscribe', async () => {
    // 没有 onPartial 就不该下发 stream：白付一份流式的代价，
    // 换来一次逐帧重渲染，收益是零。
    await runBookTranslate({
      config,
      title: 'Demo',
      selection: 'a row of tickets',
      body: BODY,
      targetLang: 'zh',
      sourceLang: 'en',
    });
    const opts = callAi.mock.calls[0]?.[0] as { onStreamChunk?: unknown };
    expect(opts.onStreamChunk).toBeUndefined();
  });

  it('streams the translation progressively, with the envelope peeled off', async () => {
    const whole = '{"translation":"一排票","note":"行取 háng。"}';
    callAi.mockImplementationOnce(async (opts: StreamOpts) => {
      // 逐字喂，模拟真实的 SSE 到达节奏
      for (let i = 1; i <= whole.length; i += 1) opts.onStreamChunk?.(whole.slice(0, i));
      return whole;
    });
    const seen: string[] = [];
    const result = await runBookTranslate({
      config,
      title: 'Demo',
      selection: 'a row of tickets',
      body: BODY,
      targetLang: 'zh',
      sourceLang: 'en',
      onPartial: (t) => seen.push(t),
    });

    expect(seen.length).toBeGreaterThan(1);
    // 收尾那一刻浮层上已经是完整译文
    expect(seen[seen.length - 1]).toBe('一排票');
    // 信封一个字都不能漏给用户：前一帧还停在信封头上，读者不该看见 {" 或 "note
    expect(seen.every((s) => !s.includes('{') && !s.includes('"'))).toBe(true);
    // 只增不减：上一帧还在的字不能在下一帧消失
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i].length).toBeGreaterThanOrEqual(seen[i - 1].length);
    }
    expect(result.translation).toBe('一排票');
    expect(result.note).toBe('行取 háng。');
  });

  it('strips a think block before streaming, not just at the end', async () => {
    callAi.mockImplementationOnce(async (opts: StreamOpts) => {
      opts.onStreamChunk?.('<think>模型在犹豫 {"x":1}</think>{"translati');
      opts.onStreamChunk?.('<think>模型在犹豫 {"x":1}</think>{"translation":"票"');
      return '<think>模型在犹豫 {"x":1}</think>{"translation":"票","note":""}';
    });
    const seen: string[] = [];
    await runBookTranslate({
      config,
      title: 'Demo',
      selection: 'a row of tickets',
      body: BODY,
      targetLang: 'zh',
      sourceLang: 'en',
      onPartial: (t) => seen.push(t),
    });
    // 思考链里有花括号，不剥的话整段会被当成译文端上来
    expect(seen).toEqual(['票']);
  });

  it('clears the partial text when the call is retried', async () => {
    callAi.mockImplementationOnce(async (opts: StreamOpts) => {
      opts.onStreamChunk?.('{"translation":"第一趟翻的"');
      opts.onRetry?.(1, new Error('bad gateway'), 400);
      opts.onStreamChunk?.('{"translation":"第二趟翻的"');
      return '{"translation":"第二趟翻的","note":""}';
    });
    const seen: string[] = [];
    const result = await runBookTranslate({
      config,
      title: 'Demo',
      selection: 'a row of tickets',
      body: BODY,
      targetLang: 'zh',
      sourceLang: 'en',
      onPartial: (t) => seen.push(t),
    });
    // 重试是从头再问一遍，不接着上一趟往下写——否则浮层上是两句拼起来的话
    expect(seen).toContain('');
    expect(seen[seen.length - 1]).toBe('第二趟翻的');
    expect(result.translation).toBe('第二趟翻的');
  });
});
