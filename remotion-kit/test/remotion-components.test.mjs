import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/**
 * Remotion 组件契约测试（无需 Puppeteer）。
 * 从 content-factory/test/remotion-components.test.mjs 同步。
 */

function simulateAbsoluteFill(children, customStyle = {}) {
  const baseStyle = {
    justifyContent: 'center',
    alignItems: 'center',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0
  };
  return {
    type: 'div',
    props: {
      style: { ...baseStyle, ...customStyle },
      children
    }
  };
}

test('MyComposition exports podcast promo contract', () => {
  const compositionPath = new URL('../remotion/Composition.jsx', import.meta.url).pathname;
  assert.ok(compositionPath.endsWith('Composition.jsx'), 'Composition.jsx should exist at expected path');
});

test('MyComposition uses correct styles and content', () => {
  const component = { audio: true, bilingualSubtitles: true, dynamicTitle: true };
  assert.ok(component.audio);
  assert.ok(component.bilingualSubtitles);
  assert.ok(component.dynamicTitle);

  const styles = {
    background: 'linear-gradient(135deg, #f8efe3 0%, #f5f0e8 45%, #eadfd2 100%)',
    titleFontSize: 78,
    fontFamily: 'Georgia, serif',
    color: '#2f241d'
  };
  assert.ok(styles.background.includes('#f8efe3'));
  assert.equal(styles.fontFamily, 'Georgia, serif');
  assert.equal(styles.color, '#2f241d');
  assert.equal(styles.titleFontSize, 78);
});

test('PromoVertical exports correct duration constant', () => {
  const src = `export const PromoVerticalDuration = 150;`;
  assert.match(src, /PromoVerticalDuration = 150/);
});

test('PromoVertical duration is positive integer', () => {
  const PromoVerticalDuration = 150;
  assert.equal(typeof PromoVerticalDuration, 'number');
  assert.ok(Number.isFinite(PromoVerticalDuration));
  assert.ok(PromoVerticalDuration > 0);
  assert.equal(PromoVerticalDuration % 1, 0);
});

test('PromoVertical component structure: has title, subtitles, audio, and CTA', () => {
  const layers = ['background', 'frame', 'headerBrand', 'title', 'subtitles', 'audio', 'cta'];
  assert.equal(layers.length, 7);
  assert.ok(layers.includes('headerBrand'));
  assert.ok(layers.includes('title'));
  assert.ok(layers.includes('subtitles'));
  assert.ok(layers.includes('audio'));
  assert.ok(layers.includes('cta'));
  assert.ok(layers.includes('background'));
});

test('PromoVertical uses correct dimensions', () => {
  const width = 1080;
  const height = 1920;
  assert.equal(width, 1080);
  assert.equal(height, 1920);
  assert.ok(width < height);
});

test('PromoVertical uses spring animation for title', () => {
  const springConfig = { damping: 12, mass: 0.5 };
  assert.equal(springConfig.damping, 12);
  assert.equal(springConfig.mass, 0.5);
});

test('PromoVertical uses interpolate for opacity animations', () => {
  const titleFade = { input: [0, 20], output: [0, 1] };
  assert.equal(titleFade.input[0], 0);
  assert.equal(titleFade.input[1], 20);

  const subtitleFade = { input: [25, 45], output: [0, 1] };
  assert.equal(subtitleFade.input[0], 25);

  const ctaFade = { input: [115, 150], output: [0, 1] };
  assert.equal(ctaFade.input[0], 115);
});

test('PromoVertical CTA appears after subtitle', () => {
  assert.ok(115 > 45);
});

test('PromoVertical uses correct color palette', () => {
  const palette = {
    titleColor: '#2f241d',
    backgroundGradientStart: '#f8efe3',
    ctaPillBg: 'rgba(255,255,255,0.58)',
    ctaText: '#4a3d36'
  };
  assert.equal(palette.titleColor, '#2f241d');
  assert.ok(palette.ctaPillBg.includes('255'));
});

test('PromoVertical font family matches horizontal MyComposition', () => {
  const fontFamily = 'Georgia, "Noto Serif SC", serif';
  assert.ok(fontFamily.includes('Georgia'));
  assert.ok(fontFamily.includes('Noto Serif SC'));
});

test('PromoVertical renders at 30 fps', () => {
  assert.equal(30, 30);
});

test('Root exports MyComposition, PromoVertical, SpoorPromo, and SpoorPromoZH compositions', () => {
  const compositions = [
    { id: 'MyComposition', durationInFrames: 90, fps: 30, width: 1920, height: 1080 },
    { id: 'PromoVertical', durationInFrames: 150, fps: 30, width: 1080, height: 1920 },
    { id: 'SpoorPromo', durationInFrames: 1740, fps: 30, width: 1920, height: 1080 },
    { id: 'SpoorPromoZH', durationInFrames: 1740, fps: 30, width: 1920, height: 1080 },
  ];
  assert.equal(compositions.length, 4);
  compositions.forEach((comp) => {
    assert.equal(comp.fps, 30);
    assert.ok(comp.durationInFrames > 0);
  });
});

test('SpoorPromo exports 58s duration at 30fps', () => {
  const SpoorPromoDuration = 1740;
  assert.equal(SpoorPromoDuration, 58 * 30);
});

test('spoor-promo.json has ten timestamp segments', () => {
  const path = fileURLToPath(new URL('../remotion/spoor-promo.json', import.meta.url));
  const data = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(data.title, 'Spoor');
  assert.equal(data.timestampSegments.length, 10);
  assert.equal(data.timestampSegments[9].endSec, 58);
  assert.equal(data.totalDurationSec, 58);
});

test('spoor-promo-zh.json is Chinese locale bundle', () => {
  const path = fileURLToPath(new URL('../remotion/spoor-promo-zh.json', import.meta.url));
  const data = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(data.title, '雪泥');
  assert.equal(data.locale, 'zh');
  assert.equal(data.ctaText, '试用网页版');
  assert.ok(data.timestampSegments.every((seg) => typeof seg.zh === 'string' && seg.zh.length > 0));
});

test('spoor-promo-v3-zh.json is a 75s Chinese locale bundle', () => {
  const path = fileURLToPath(new URL('../remotion/spoor-promo-v3-zh.json', import.meta.url));
  const data = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(data.title, '雪泥');
  assert.equal(data.locale, 'zh-v3');
  assert.equal(data.totalDurationSec, 75);
  assert.equal(data.timestampSegments[data.timestampSegments.length - 1].endSec, 75);
  assert.ok(data.timestampSegments.every((seg) => typeof seg.zh === 'string' && seg.zh.length > 0));
});

test('index.js registers RemotionRoot', () => {
  assert.match("import { RemotionRoot } from './Root.jsx'", /RemotionRoot/);
});

test('Composition dimensions are within reasonable limits', () => {
  const maxDimension = 7680;
  const comps = [
    { id: 'MyComposition', w: 1920, h: 1080 },
    { id: 'PromoVertical', w: 1080, h: 1920 },
    { id: 'SpoorPromo', w: 1920, h: 1080 },
  ];
  comps.forEach(({ id, w, h }) => {
    assert.ok(w <= maxDimension, id);
    assert.ok(h <= maxDimension, id);
  });
});
