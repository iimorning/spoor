import { describe, expect, it } from 'vitest';
import { parseRoomProactivePass } from '../../src/services/roomProactivePass';

describe('parseRoomProactivePass', () => {
  it('reads the messages array', () => {
    const raw = JSON.stringify({ messages: ['这两张卡说的其实不是一回事。', '第二张我一直没读懂。'] });
    expect(parseRoomProactivePass(raw, 3).messages).toEqual([
      '这两张卡说的其实不是一回事。',
      '第二张我一直没读懂。',
    ]);
  });

  it('treats silence as a normal outcome, not a failure', () => {
    expect(parseRoomProactivePass('{"messages":[]}', 3).messages).toEqual([]);
  });

  it('survives a reply that is not the envelope at all', () => {
    // 主动发言是自动触发的。模型某次先写一句"好的，我看看"不该把这一趟炸掉。
    expect(parseRoomProactivePass('好的，我看看这个房间。', 3).messages).toEqual([]);
    expect(
      parseRoomProactivePass('```json\n{"messages":["这两张卡说的不是一回事"]}\n```', 3).messages,
    ).toEqual(['这两张卡说的不是一回事']);
    expect(parseRoomProactivePass('', 3).messages).toEqual([]);
    expect(parseRoomProactivePass(null, 3).messages).toEqual([]);
    expect(parseRoomProactivePass('["不是一个对象"]', 3).messages).toEqual([]);
  });

  it('enforces the budget it was given even when the model overshoots', () => {
    const raw = JSON.stringify({
      messages: [
        '这两张卡说的其实不是一回事。',
        '第二张我一直没读懂。',
        '第三张大概是想说另一件事。',
        '第四张和前面对不上。',
      ],
    });
    expect(parseRoomProactivePass(raw, 2).messages).toEqual([
      '这两张卡说的其实不是一回事。',
      '第二张我一直没读懂。',
    ]);
  });

  it('drops the filler the model reaches for when it has nothing', () => {
    const raw = JSON.stringify({ messages: ['……', '嗯。'] });
    expect(parseRoomProactivePass(raw, 3).messages).toEqual([]);
  });
});
