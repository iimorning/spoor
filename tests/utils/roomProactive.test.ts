import { describe, expect, it } from 'vitest';
import type { CanvasNode } from '../../src/db';
import {
  ROOM_PROACTIVE_MAX_MESSAGES,
  ROOM_PROACTIVE_MESSAGE_MAX_CHARS,
  ROOM_PROACTIVE_MIN_CHARS,
  computeRoomSignature,
  isRoomNodeStillMoving,
  pickProactiveMessages,
  planRoomProactivePass,
} from '../../src/utils/roomProactive';
import {
  roomProactiveSystemEn,
  roomProactiveSystemZh,
} from '../../src/i18n/roomProactivePrompts';

function note(id: string, content: string, extra: Partial<CanvasNode> = {}): CanvasNode {
  return { id, type: 'note', x: 0, y: 0, content, ...extra };
}

describe('computeRoomSignature', () => {
  it('is stable for the same content in any order', () => {
    const nodes = [note('a', 'one'), note('b', 'two')];
    expect(computeRoomSignature(['a', 'b'], nodes)).toBe(computeRoomSignature(['b', 'a'], nodes));
  });

  it('changes when a card is added or removed', () => {
    const before = computeRoomSignature(['a'], [note('a', 'one')]);
    const after = computeRoomSignature(['a', 'b'], [note('a', 'one'), note('b', 'two')]);
    expect(before).not.toBe(after);
  });

  it('changes when an existing card is edited', () => {
    const before = computeRoomSignature(['a'], [note('a', 'one')]);
    const after = computeRoomSignature(['a'], [note('a', 'one, edited')]);
    expect(before).not.toBe(after);
  });

  it('leaves a still-generating card out of the fingerprint entirely', () => {
    // 排除，不是"当作已静止"：流到一半的正文不是这个房间的最终内容。
    // 排除还有一个好处——它写完之后指纹才会变，也才会真的触发一次。
    const settled = note('keep', 'one');
    expect(computeRoomSignature(['keep', 'wip'], [settled, note('wip', 'half a sen', { aiStatus: 'generating' })])).toBe(
      computeRoomSignature(['keep'], [settled]),
    );
  });

  it('does not churn while a card streams in', () => {
    const base = note('keep', 'one');
    const a = computeRoomSignature(['keep', 'wip'], [base, note('wip', 'half', { aiStatus: 'generating' })]);
    const b = computeRoomSignature(['keep', 'wip'], [base, note('wip', 'half a sentence and then', { aiStatus: 'generating' })]);
    expect(a).toBe(b);
  });

  it('is empty and stable for an empty room', () => {
    expect(computeRoomSignature([], [])).toBe(computeRoomSignature([], []));
  });
});

describe('isRoomNodeStillMoving', () => {
  it('is true only for cards still being generated', () => {
    expect(isRoomNodeStillMoving(note('a', 'x', { aiStatus: 'generating' }))).toBe(true);
    expect(isRoomNodeStillMoving(note('a', 'x', { aiStatus: 'error' }))).toBe(false);
    expect(isRoomNodeStillMoving(note('a', 'x'))).toBe(false);
  });

  it('reads the essay generation flag out of its payload', () => {
    expect(isRoomNodeStillMoving({ id: 'e', type: 'essay', x: 0, y: 0, content: '{"generating":true}' })).toBe(
      true,
    );
    expect(isRoomNodeStillMoving({ id: 'e', type: 'essay', x: 0, y: 0, content: '{"generating":false}' })).toBe(
      false,
    );
  });
});

describe('planRoomProactivePass', () => {
  it('says nothing for an empty room', () => {
    expect(planRoomProactivePass({ cardCount: 0, totalChars: 5000, imageCount: 0 })).toBeNull();
  });

  it('says nothing when there is too little text, and never calls the model for it', () => {
    expect(
      planRoomProactivePass({ cardCount: 4, totalChars: ROOM_PROACTIVE_MIN_CHARS - 1, imageCount: 0 }),
    ).toBeNull();
  });

  it('scales the budget with how much is in the room', () => {
    const chars = ROOM_PROACTIVE_MIN_CHARS * 10;
    expect(planRoomProactivePass({ cardCount: 1, totalChars: chars, imageCount: 0 })).toEqual({
      maxMessages: 1,
    });
    expect(planRoomProactivePass({ cardCount: 2, totalChars: chars, imageCount: 0 })).toEqual({
      maxMessages: 2,
    });
    expect(planRoomProactivePass({ cardCount: 3, totalChars: chars, imageCount: 0 })).toEqual({
      maxMessages: 2,
    });
    expect(planRoomProactivePass({ cardCount: 9, totalChars: chars, imageCount: 0 })).toEqual({
      maxMessages: ROOM_PROACTIVE_MAX_MESSAGES,
    });
  });

  it('never exceeds the hard cap however many cards there are', () => {
    const plan = planRoomProactivePass({ cardCount: 200, totalChars: 99999, imageCount: 50 });
    expect(plan?.maxMessages).toBeLessThanOrEqual(ROOM_PROACTIVE_MAX_MESSAGES);
  });
});

describe('pickProactiveMessages', () => {
  it('keeps good messages in order and stops at the budget', () => {
    const out = pickProactiveMessages(['第一条值得说的话在这里', '第二条也值得说一句', '第三条也是'], 2);
    expect(out).toEqual(['第一条值得说的话在这里', '第二条也值得说一句']);
  });

  it('accepts a bare string as well as an array', () => {
    expect(pickProactiveMessages('这是一句值得说出口的话', 3)).toEqual(['这是一句值得说出口的话']);
  });

  it('drops the model punctuation it uses to fake speaking', () => {
    expect(pickProactiveMessages(['…', '   ', '...'], 3)).toEqual([]);
  });

  it('drops an over-long message rather than truncating it mid-sentence', () => {
    const ramble = '话'.repeat(ROOM_PROACTIVE_MESSAGE_MAX_CHARS + 1);
    expect(pickProactiveMessages([ramble], 3)).toEqual([]);
  });

  it('drops repeats', () => {
    const once = '同一句话说两遍没有意义';
    expect(pickProactiveMessages([once, once], 3)).toEqual([once]);
  });

  it('returns nothing when the budget is zero', () => {
    expect(pickProactiveMessages(['一句挺像样的话'], 0)).toEqual([]);
  });
});

describe('prompt and budget agree', () => {
  // 提示词里的条数上限和代码强制的是同一个数，两边一旦漂移用户就会看到
  // "最多 2 条"却收到 3 条。抄自 bookFocusMarks.test.ts 的防漂移断言。
  it.each([1, 2, ROOM_PROACTIVE_MAX_MESSAGES])('both prompts carry the %i-message budget', (n) => {
    expect(roomProactiveSystemZh.replace(/\{\{maxMessages\}\}/g, String(n))).toContain(`${n} 条`);
    expect(roomProactiveSystemEn.replace(/\{\{maxMessages\}\}/g, String(n))).toContain(
      `${n} message`,
    );
  });

  it('tells the model silence is a valid answer', () => {
    expect(roomProactiveSystemZh).toContain('闭嘴');
    expect(roomProactiveSystemZh).toContain('空数组');
    expect(roomProactiveSystemEn.toLowerCase()).toContain('empty list');
  });
});
