import { describe, expect, it } from 'vitest';
import { isDrawChaseUp, parseVoiceDrawIntent } from '../../src/utils/voiceDrawIntent';

describe('parseVoiceDrawIntent', () => {
  it('extracts Chinese draw prompts', () => {
    expect(parseVoiceDrawIntent('画一张教室里的对比图')?.prompt).toBe('教室里的对比图');
    expect(parseVoiceDrawIntent('帮我画：海边的灯塔')?.prompt).toBe('海边的灯塔');
  });

  it('extracts English draw prompts', () => {
    expect(parseVoiceDrawIntent('draw a foggy mountain path')?.prompt).toBe('a foggy mountain path');
  });

  it('returns null for unrelated speech', () => {
    expect(parseVoiceDrawIntent('继续讲注意力经济')).toBeNull();
  });

  it('extracts 帮我生成…的图片', () => {
    expect(parseVoiceDrawIntent('帮我生成意大利冰淇淋的图片')?.prompt).toBe('意大利冰淇淋');
  });

  it('detects chase-ups that do not name a new subject', () => {
    expect(isDrawChaseUp('？？在哪里，你不是可以调用302AI吗')).toBe(true);
    expect(isDrawChaseUp('继续讲注意力经济')).toBe(false);
  });
});
