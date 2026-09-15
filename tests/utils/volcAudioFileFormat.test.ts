import { describe, expect, it } from 'vitest';
import { inferVolcAudioFormat } from '../../src/utils/volcAudioFileFormat';
import { parseVolcFlashTranscript, volcFlashStatusMessage } from '../../src/utils/volcAsrFlashResult';

describe('inferVolcAudioFormat', () => {
  it('prefers MIME over magic', () => {
    const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
    expect(inferVolcAudioFormat('audio/mpeg', wav, 'clip.wav')).toBe('mp3');
  });

  it('detects WAV magic', () => {
    const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
    expect(inferVolcAudioFormat('', wav, 'blob:1')).toBe('wav');
  });
});

describe('parseVolcFlashTranscript', () => {
  it('reads result.text', () => {
    expect(parseVolcFlashTranscript({ result: { text: '  hi  ' } })).toBe('hi');
  });

  it('joins utterances when text is empty', () => {
    expect(
      parseVolcFlashTranscript({
        result: { utterances: [{ text: 'a' }, { text: 'b' }] },
      }),
    ).toBe('ab');
  });
});

describe('volcFlashStatusMessage', () => {
  it('ignores success codes', () => {
    expect(volcFlashStatusMessage('20000000', null, {})).toBeNull();
  });

  it('surfaces timeout-style codes', () => {
    expect(volcFlashStatusMessage('45000081', 'timeout', {})).toContain('45000081');
  });
});
