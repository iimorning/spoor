import { describe, expect, it } from 'vitest';
import {
  extractVoiceSpokenText,
  spokenFallbackFromWritten,
  stripVoiceSpeakFence,
} from '../../src/utils/voiceSpokenBrief';

describe('extractVoiceSpokenText', () => {
  it('reads the written body after a closed speak fence', () => {
    const raw = '```speak\n科技教育公司主要分两类。\n```\n\n## 详细\n很长的正文';
    expect(extractVoiceSpokenText(raw)).toBe('## 详细\n很长的正文');
  });

  it('returns empty while an open speak fence has no written follow-up', () => {
    expect(extractVoiceSpokenText('```speak\n我先说重点')).toBe('');
  });

  it('reads the full written answer when there is no fence', () => {
    expect(extractVoiceSpokenText('很长的书面回答。第二句。')).toBe('很长的书面回答。第二句。');
  });
});

describe('stripVoiceSpeakFence', () => {
  it('removes the speak block so the card only shows written prose', () => {
    const raw = '```speak\n概况一句。\n```\n\n正文第一段。';
    expect(stripVoiceSpeakFence(raw).trim()).toBe('正文第一段。');
  });
});

describe('spokenFallbackFromWritten', () => {
  it('reads the whole written card, not a short lead-in', () => {
    const written = '科技教育公司一般分两类。后面还有很长的展开，列举了很多厂商与产品线。';
    expect(spokenFallbackFromWritten(written)).toBe(written);
  });
});
