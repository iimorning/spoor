import { describe, expect, it } from 'vitest';
import {
  geminiAspectRatioForOrientation,
  geminiResolutionForOrientation,
  gptImage302FallbackSize,
  gptImageSizeForOrientation,
  inferImageOrientation,
  orientationFromCardSize,
  orientationFromGptImageSize,
  parseImageOrientation,
} from '../../src/utils/imageOrientation';

describe('parseImageOrientation', () => {
  it('reads portrait aliases', () => {
    expect(parseImageOrientation('portrait')).toBe('portrait');
    expect(parseImageOrientation('竖图')).toBe('portrait');
    expect(parseImageOrientation('1024x1536')).toBe('portrait');
  });

  it('reads poster, strip, and banner presets', () => {
    expect(parseImageOrientation('poster')).toBe('poster');
    expect(parseImageOrientation('海报')).toBe('poster');
    expect(parseImageOrientation('9:16')).toBe('poster');
    expect(parseImageOrientation('strip')).toBe('strip');
    expect(parseImageOrientation('长图')).toBe('strip');
    expect(parseImageOrientation('1:8')).toBe('strip');
    expect(parseImageOrientation('banner-mid')).toBe('banner-mid');
    expect(parseImageOrientation('4:1')).toBe('banner-mid');
    expect(parseImageOrientation('banner')).toBe('banner');
    expect(parseImageOrientation('8:1')).toBe('banner');
  });

  it('reads landscape and square aliases', () => {
    expect(parseImageOrientation('landscape')).toBe('landscape');
    expect(parseImageOrientation('横构图')).toBe('landscape');
    expect(parseImageOrientation('1:1')).toBe('square');
    expect(parseImageOrientation('square')).toBe('square');
  });

  it('returns null for empty or unknown values', () => {
    expect(parseImageOrientation('')).toBeNull();
    expect(parseImageOrientation('cinematic')).toBeNull();
  });
});

describe('inferImageOrientation', () => {
  it('prefers an explicit orientation', () => {
    expect(inferImageOrientation('a wide beach, 横图', 'portrait')).toBe('portrait');
  });

  it('detects vertical composition in the prompt', () => {
    expect(inferImageOrientation('全身立绘，医院病床上的女人看着镜头')).toBe('portrait');
    expect(inferImageOrientation('a standing full-body portrait of Celine')).toBe('portrait');
    expect(inferImageOrientation('竖构图，走廊尽头的人')).toBe('portrait');
  });

  it('detects poster, strip, and banner prompts', () => {
    expect(inferImageOrientation('活动海报，顶部大标题「深夜酒店」')).toBe('poster');
    expect(inferImageOrientation('小红书式营销长图，三段信息从上到下')).toBe('strip');
    expect(inferImageOrientation('ultra-wide web banner, 8:1 header')).toBe('banner');
    expect(inferImageOrientation('wide banner for a landing page hero, 4:1')).toBe('banner-mid');
  });

  it('detects landscape composition in the prompt', () => {
    expect(inferImageOrientation('横构图，病房全景')).toBe('landscape');
    expect(inferImageOrientation('cinematic widescreen shot of a foggy pier')).toBe('landscape');
  });

  it('defaults to landscape when the prompt is ambiguous', () => {
    expect(inferImageOrientation('a fox in the woods')).toBe('landscape');
  });
});

describe('orientationFromCardSize', () => {
  it('reads portrait / landscape / square from card dimensions', () => {
    expect(orientationFromCardSize(210, 320)).toBe('portrait');
    expect(orientationFromCardSize(320, 210)).toBe('landscape');
    expect(orientationFromCardSize(260, 260)).toBe('square');
    expect(orientationFromCardSize()).toBeNull();
  });

  it('reads extended presets from extreme card ratios', () => {
    expect(orientationFromCardSize(96, 768)).toBe('strip');
    expect(orientationFromCardSize(180, 320)).toBe('poster');
    expect(orientationFromCardSize(400, 100)).toBe('banner-mid');
    expect(orientationFromCardSize(480, 60)).toBe('banner');
  });
});

describe('geminiAspectRatioForOrientation', () => {
  it('maps presets to Nano Banana aspect ratios', () => {
    expect(geminiAspectRatioForOrientation('landscape')).toBe('3:2');
    expect(geminiAspectRatioForOrientation('portrait')).toBe('2:3');
    expect(geminiAspectRatioForOrientation('square')).toBe('1:1');
    expect(geminiAspectRatioForOrientation('poster')).toBe('9:16');
    expect(geminiAspectRatioForOrientation('strip')).toBe('1:8');
    expect(geminiAspectRatioForOrientation('banner-mid')).toBe('4:1');
    expect(geminiAspectRatioForOrientation('banner')).toBe('8:1');
  });
});

describe('geminiResolutionForOrientation', () => {
  it('uses 2K for poster / strip / banner presets', () => {
    expect(geminiResolutionForOrientation('landscape')).toBe('1K');
    expect(geminiResolutionForOrientation('poster')).toBe('2K');
    expect(geminiResolutionForOrientation('strip')).toBe('2K');
    expect(geminiResolutionForOrientation('banner')).toBe('2K');
  });
});

describe('gptImageSizeForOrientation', () => {
  it('maps to legacy or aspect tokens', () => {
    expect(gptImageSizeForOrientation('landscape')).toBe('1536x1024');
    expect(gptImageSizeForOrientation('portrait')).toBe('1024x1536');
    expect(gptImageSizeForOrientation('square')).toBe('1024x1024');
    expect(gptImageSizeForOrientation('strip')).toBe('aspect:1:8');
  });
});

describe('orientationFromGptImageSize', () => {
  it('round-trips aspect tokens', () => {
    expect(orientationFromGptImageSize('aspect:1:8')).toBe('strip');
    expect(orientationFromGptImageSize('aspect:9:16')).toBe('poster');
  });
});

describe('gptImage302FallbackSize', () => {
  it('maps exotic presets to nearest legacy 302 size', () => {
    expect(gptImage302FallbackSize('strip')).toBe('1024x1536');
    expect(gptImage302FallbackSize('banner')).toBe('1536x1024');
  });
});
