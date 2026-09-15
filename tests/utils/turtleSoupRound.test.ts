import { describe, it, expect } from 'vitest';
import {
  findTurtleSoupRoundInHistory,
  formatTurtleSoupOpening,
  formatTurtleSoupRefereePacket,
  isTurtleSoupNewRoundRequest,
  parseTurtleSoupSetterOutput,
  sanitizeTurtleSoupPlayerText,
  shouldRunTurtleSoupSetter,
  composeTurtleSoupStreamChunk,
  turtleSoupLiveThought,
} from '../../src/utils/turtleSoupRound';

const sampleJson = JSON.stringify({
  language: 'zh',
  title: '深夜的早餐',
  surface: '男人每天清晨为两人摆好餐具。桌上只有他在吃。',
  secret_solution: '妻子已死，他无法接受，仍为她摆位。',
  key_facts: [
    '妻子已经死亡',
    '男人知道妻子死了',
    '他每天仍为两人摆早餐',
  ],
  people: '男人与已故妻子',
  timeline: '妻子死后持续数月',
  places: '家中餐厅',
  motives: '拒绝承认死亡',
  items: '两套餐具',
  surface_explanations: ['空位是给亡妻的'],
});

describe('turtleSoupRound', () => {
  it('parses setter JSON even when wrapped in a fence', () => {
    const round = parseTurtleSoupSetterOutput(`here\n\`\`\`json\n${sampleJson}\n\`\`\``);
    expect(round?.title).toBe('深夜的早餐');
    expect(round?.key_facts).toHaveLength(3);
    expect(round?.status).toBe('playing');
  });

  it('parses setter JSON after a thinking block', () => {
    const round = parseTurtleSoupSetterOutput(`<think>先写汤底</think>${sampleJson}`);
    expect(round?.title).toBe('深夜的早餐');
    expect(round?.secret_solution).toContain('妻子已死');
  });

  it('rejects JSON missing key_facts or secret', () => {
    expect(parseTurtleSoupSetterOutput('{"title":"a","surface":"b","secret_solution":"c","key_facts":[]}')).toBeNull();
    expect(parseTurtleSoupSetterOutput('not json')).toBeNull();
  });

  it('formats a player-facing opening without the secret', () => {
    const round = parseTurtleSoupSetterOutput(sampleJson)!;
    const opening = formatTurtleSoupOpening(round);
    expect(opening).toContain('汤面：');
    expect(opening).toContain('是 / 不是 / 与此无关');
    expect(opening).not.toContain(round.secret_solution);
  });

  it('referee packet keeps atomic facts for judging', () => {
    const round = parseTurtleSoupSetterOutput(sampleJson)!;
    const packet = formatTurtleSoupRefereePacket(round);
    expect(packet).toContain('妻子已经死亡');
    expect(packet).toContain('secret_solution:');
    expect(packet).toContain('Never quote');
  });

  it('treats start / swap lines as a new round', () => {
    expect(isTurtleSoupNewRoundRequest('开局')).toBe(true);
    expect(isTurtleSoupNewRoundRequest('换一题')).toBe(true);
    expect(isTurtleSoupNewRoundRequest('Start a round of Turtle Soup. Invent an original puzzle.')).toBe(true);
    expect(isTurtleSoupNewRoundRequest('凶手是男人吗？')).toBe(false);
  });

  it('does not re-deal after a surface is already on the thread', () => {
    expect(
      shouldRunTurtleSoupSetter('旧照片是外婆的吗', [
        { content: '半块月饼\n\n汤面：木匣里有半块月饼。' },
      ]),
    ).toBe(false);
    expect(shouldRunTurtleSoupSetter('开局', [])).toBe(true);
    expect(
      shouldRunTurtleSoupSetter('换一题', [{ content: '半块月饼\n\n汤面：木匣里有半块月饼。' }]),
    ).toBe(true);
  });

  it('never leaves secret_solution on the player-facing card', () => {
    const leak = `{"language":"zh","title":"半块月饼","surface":"木匣","secret_solution":"外婆是凶手","key_facts":["a"]}`;
    expect(sanitizeTurtleSoupPlayerText(leak, 'judge', {
      setterFailed: 'fail',
      leakHidden: 'hidden',
    })).toBe('hidden');
    expect(sanitizeTurtleSoupPlayerText(leak, 'setter', {
      setterFailed: 'fail',
      leakHidden: 'hidden',
    })).toContain('汤面：木匣');
    expect(sanitizeTurtleSoupPlayerText(leak, 'setter', {
      setterFailed: 'fail',
      leakHidden: 'hidden',
    })).not.toContain('外婆是凶手');
  });

  it('reads the latest stored round from history', () => {
    const first = parseTurtleSoupSetterOutput(sampleJson)!;
    const second = { ...first, title: '第二局', secret_solution: '另一汤底' };
    expect(findTurtleSoupRoundInHistory([{ turtleSoupRound: first }, { turtleSoupRound: second }])?.title).toBe(
      '第二局',
    );
  });

  it('keeps live thought after JSON prose starts, and prefixes it for the stream writer', () => {
    const acc = `<think>对照事实</think>${sampleJson}`;
    expect(turtleSoupLiveThought(acc)).toBe('对照事实');
    expect(composeTurtleSoupStreamChunk(acc, '是。')).toBe('<think>对照事实</think>是。');
  });
});
