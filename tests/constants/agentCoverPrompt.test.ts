import { describe, it, expect } from 'vitest';
import {
  buildAgentCoverPrompt,
  buildAgentCoverSubject,
  excerptAgentPromptForCover,
} from '../../src/constants/agentCoverPrompt';

describe('agentCoverPrompt', () => {
  it('excerptAgentPromptForCover 截断过长提示词', () => {
    const long = '字'.repeat(400);
    const out = excerptAgentPromptForCover(long, 360);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(361);
  });

  it('buildAgentCoverSubject 写入名字、身份和气质', () => {
    const subject = buildAgentCoverSubject({
      name: '阿狸',
      role: '绘本旅人',
      prompt: '温柔、安静，喜欢在纸页间散步。',
    });
    expect(subject).toContain('角色「阿狸」');
    expect(subject).toContain('绘本旅人');
    expect(subject).toContain('温柔、安静');
  });

  it('buildAgentCoverPrompt 填入人物名字并保留文学水彩规则', () => {
    const prompt = buildAgentCoverPrompt({
      name: '阿狸',
      role: '绘本旅人',
      prompt: '温柔安静',
    });
    expect(prompt).toContain('人物名字：阿狸');
    expect(prompt).not.toContain('{{CHARACTER_NAME}}');
    expect(prompt).not.toContain('{{USER_SUBJECT}}');
    expect(prompt).toContain('16:9');
    expect(prompt).toMatch(/watercolor|水彩/i);
  });

  it('没有名字时要求画面不写字、不盖章', () => {
    const prompt = buildAgentCoverPrompt({
      name: '  ',
      role: '',
      prompt: '',
    });
    expect(prompt).toContain('用户未提供人物名字：画面中不要书写任何文字，也不要印章。');
    expect(prompt).not.toContain('{{CHARACTER_NAME}}');
    expect(prompt).toContain('一位安静的文学绘本角色');
  });
});
