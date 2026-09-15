import React from 'react';
import { AbsoluteFill, Audio, useCurrentFrame, interpolate, spring, useVideoConfig } from 'remotion';

export const PromoVerticalDuration = 150;

/** 画布 1080×1920：顶部状态栏 / 底部进度条与头像安全区 */
const HEADER_TOP = 200;
const TITLE_TOP = 320;
const CARD_TOP = 820;
/** 字幕卡片主要落在 820–1350 视觉重心区 */
const CARD_MAX_HEIGHT = 530;
const SIDE_INSET = 64;
/** 底部预留约 280px，药丸 CTA 贴安全区上沿 */
const CTA_BOTTOM = 285;

const BG_GRADIENT = 'linear-gradient(135deg, #f8efe3 0%, #f5f0e8 45%, #eadfd2 100%)';
const ROOT_FONT_FALLBACK = 'Georgia, "Noto Serif SC", serif';
const FONT_EN = 'Georgia, serif';
const FONT_ZH = '"Noto Serif SC", serif';

/** 比米色底深约两阶，用于 CTA 字色 */
const CTA_TEXT = '#4a3d36';
const CTA_PILL_BG = 'rgba(255,255,255,0.58)';

function activeSegmentAt(segments, sec) {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  return segments.find((seg) => sec >= Number(seg.startSec) && sec < Number(seg.endSec)) || segments[segments.length - 1];
}

export const PromoVertical = ({
  title = 'JustTalk',
  subtitle = '播客内容 · 触达世界',
  audioUrl = '',
  timestampSegments = []
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sec = frame / fps;
  const active = activeSegmentAt(timestampSegments, sec);

  const titleOpacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });
  const titleY = spring({
    frame,
    fps: 30,
    config: { damping: 12, mass: 0.5 },
  });

  const subtitleOpacity = interpolate(frame, [25, 45], [0, 1], { extrapolateRight: 'clamp' });
  const cardFade = interpolate(frame, [25, 52], [0, 1], { extrapolateRight: 'clamp' });

  const ctaScale = interpolate(frame >= 120 ? frame - 120 : 0, [0, 10], [0.95, 1], {
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        background: BG_GRADIENT,
        fontFamily: ROOT_FONT_FALLBACK,
        color: '#2f241d',
        padding: 0,
        overflow: 'hidden',
      }}
    >
      {audioUrl ? <Audio src={audioUrl} /> : null}
      <div style={{ opacity: 0.18, position: 'absolute', inset: 48, border: '2px solid #8b5f48', borderRadius: 44 }} />

      {/* Header：品牌半透明标签（水印感） */}
      <div
        style={{
          position: 'absolute',
          top: HEADER_TOP,
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '10px 32px',
          borderRadius: 999,
          backgroundColor: 'rgba(255,255,255,0.4)',
          border: '1px solid rgba(139, 95, 72, 0.22)',
          boxShadow: '0 8px 24px rgba(83, 57, 42, 0.06)',
        }}
      >
        <span
          style={{
            fontSize: 22,
            fontWeight: 500,
            lineHeight: 1,
            letterSpacing: '0.2em',
            color: 'rgba(47, 36, 29, 0.78)',
            fontFamily: ROOT_FONT_FALLBACK,
          }}
        >
          JUST TALK
        </span>
      </div>

      {/* Title 区：集数 / 主标题 */}
      <div
        style={{
          opacity: titleOpacity,
          transform: `translateY(${(1 - titleY) * 36}px)`,
          textAlign: 'center',
          position: 'absolute',
          top: TITLE_TOP,
          left: SIDE_INSET,
          right: SIDE_INSET,
        }}
      >
        <h1
          style={{
            fontSize: 72,
            fontWeight: 700,
            lineHeight: 1.25,
            letterSpacing: '0.02em',
            color: '#2f241d',
            margin: 0,
            fontFamily: FONT_EN,
          }}
        >
          {title}
        </h1>
        <p
          style={{
            fontSize: 28,
            fontWeight: 400,
            lineHeight: 1.6,
            letterSpacing: '0.08em',
            color: '#735847',
            marginTop: 20,
            marginBottom: 0,
            fontFamily: ROOT_FONT_FALLBACK,
          }}
        >
          {subtitle}
        </p>
      </div>

      {/* Content：字幕卡片（视觉重心区，略深米色 + 轻阴影） */}
      <div
        style={{
          opacity: subtitleOpacity * cardFade,
          position: 'absolute',
          left: SIDE_INSET,
          right: SIDE_INSET,
          top: CARD_TOP,
          maxHeight: CARD_MAX_HEIGHT,
          borderRadius: 40,
          padding: '84px 64px',
          backgroundColor: 'rgba(232, 223, 212, 0.92)',
          boxShadow: '0 15px 45px rgba(0,0,0,0.05)',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 52,
            fontWeight: 500,
            lineHeight: 1.5,
            color: '#231a15',
            fontFamily: FONT_EN,
          }}
        >
          {active?.en || 'Your podcast audio will play here.'}
        </p>
        <p
          style={{
            margin: '40px 0 0',
            fontSize: 38,
            fontWeight: 400,
            lineHeight: 1.7,
            letterSpacing: '0.03em',
            color: '#5c4a3e',
            fontFamily: FONT_ZH,
          }}
        >
          {active?.zh || '双语字幕会跟随时间轴显示。'}
        </p>
      </div>

      {/* CTA：浅色药丸 + 深字（避开通栏红底） */}
      <div
        style={{
          position: 'absolute',
          bottom: CTA_BOTTOM,
          left: '50%',
          padding: '14px 48px',
          borderRadius: 999,
          backgroundColor: CTA_PILL_BG,
          border: '1px solid rgba(74, 61, 54, 0.12)',
          transform: `translateX(-50%) scale(${ctaScale})`,
          opacity: interpolate(frame, [115, 150], [0, 1], { extrapolateLeft: 'clamp' }),
          boxShadow: '0 10px 28px rgba(83, 57, 42, 0.08)',
        }}
      >
        <span
          style={{
            fontSize: 22,
            fontWeight: 600,
            lineHeight: 1,
            letterSpacing: '0.15em',
            color: CTA_TEXT,
            fontFamily: ROOT_FONT_FALLBACK,
          }}
        >
          just talk
        </span>
      </div>
    </AbsoluteFill>
  );
};
