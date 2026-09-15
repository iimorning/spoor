import { describe, expect, it } from 'vitest';
import { isCanvasAudioCard } from '../../src/utils/canvasAudioCard';

describe('isCanvasAudioCard', () => {
  it('matches uploaded wav mime and data URLs', () => {
    expect(isCanvasAudioCard({ fileType: 'audio/wav', content: 'data:audio/wav;base64,AA' })).toBe(true);
    expect(isCanvasAudioCard({ fileType: 'audio', content: 'https://cdn.example/ep.mp3' })).toBe(true);
    expect(isCanvasAudioCard({ content: 'https://cdn.example/clip.wav' })).toBe(true);
  });

  it('rejects video cards', () => {
    expect(isCanvasAudioCard({ fileType: 'video/mp4', content: 'data:video/mp4;base64,AA' })).toBe(false);
    expect(isCanvasAudioCard({ fileType: 'iframe', content: 'https://www.youtube.com/embed/x' })).toBe(false);
  });
});
