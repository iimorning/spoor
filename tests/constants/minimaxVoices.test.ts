import { describe, expect, it } from 'vitest';
import {
  MINIMAX_EN_VOICES,
  MINIMAX_SYSTEM_VOICES,
  MINIMAX_ZH_VOICES,
  minimaxVoiceGroups,
  minimaxVoiceLanguage,
} from '../../src/constants/minimaxVoices';
import {
  MINIMAX_DEFAULT_VOICE_ID,
  MINIMAX_ENGLISH_VOICE_ID,
} from '../../src/constants/voiceWriting';

describe('MiniMax 音色表', () => {
  it('id 唯一且没有前后空格，标签不为空', () => {
    const ids = MINIMAX_SYSTEM_VOICES.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const voice of MINIMAX_SYSTEM_VOICES) {
      expect(voice.id.trim()).toBe(voice.id);
      expect(voice.id.length).toBeGreaterThan(0);
      expect(voice.label.trim().length).toBeGreaterThan(0);
    }
  });

  it('分组与语言标签一致', () => {
    expect(MINIMAX_ZH_VOICES.every((v) => v.language === 'zh')).toBe(true);
    expect(MINIMAX_EN_VOICES.every((v) => v.language === 'en')).toBe(true);
  });

  /**
   * 这条就是 English_CalmWoman 那个坑：默认音色必须在我们实际调用的
   * 国内版（api.minimaxi.com）列表里，否则英文界面朗读会发一个无效 id。
   */
  it('两个默认音色都在表里，且语言对得上', () => {
    expect(minimaxVoiceLanguage(MINIMAX_DEFAULT_VOICE_ID)).toBe('zh');
    expect(minimaxVoiceLanguage(MINIMAX_ENGLISH_VOICE_ID)).toBe('en');
  });

  it('不认识的 id（自填或克隆音色）返回 undefined', () => {
    expect(minimaxVoiceLanguage('my-cloned-voice')).toBeUndefined();
    expect(minimaxVoiceLanguage('   ')).toBeUndefined();
  });

  it('选择器按界面语言排序，且中英文两组都在', () => {
    expect(minimaxVoiceGroups('zh-CN').map((g) => g.language)).toEqual(['zh', 'en']);
    expect(minimaxVoiceGroups('en').map((g) => g.language)).toEqual(['en', 'zh']);
    for (const group of minimaxVoiceGroups('zh')) {
      expect(group.voices.length).toBeGreaterThan(0);
    }
  });
});
