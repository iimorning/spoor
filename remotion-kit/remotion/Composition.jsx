import React from 'react';
import { AbsoluteFill, Audio, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

function activeSegmentAt(segments, sec) {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  return segments.find((seg) => sec >= Number(seg.startSec) && sec < Number(seg.endSec)) || segments[segments.length - 1];
}

export const MyComposition = ({
  title = 'JustTalk',
  subtitle = '播客推广',
  audioUrl = '',
  timestampSegments = []
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sec = frame / fps;
  const active = activeSegmentAt(timestampSegments, sec);
  const fade = interpolate(frame, [0, 24], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill
      style={{
        background: 'linear-gradient(135deg, #f8efe3 0%, #f5f0e8 45%, #eadfd2 100%)',
        fontFamily: 'Georgia, "Noto Serif SC", serif',
        color: '#2f241d',
        padding: 96,
        overflow: 'hidden'
      }}
    >
      {audioUrl ? <Audio src={audioUrl} /> : null}
      <div style={{ opacity: 0.18, position: 'absolute', inset: 48, border: '2px solid #8b5f48', borderRadius: 44 }} />
      <div style={{ display: 'flex', height: '100%', gap: 72, alignItems: 'center' }}>
        <div style={{ width: 560 }}>
          <div style={{ fontSize: 24, letterSpacing: '0.18em', color: '#9b6b56', marginBottom: 28 }}>JUST TALK</div>
          <h1 style={{ margin: 0, fontSize: 78, lineHeight: 1.08, fontWeight: 700 }}>{title}</h1>
          <p style={{ marginTop: 28, fontSize: 30, lineHeight: 1.5, color: '#735847' }}>{subtitle}</p>
        </div>
        <div
          style={{
            flex: 1,
            minHeight: 360,
            borderRadius: 36,
            backgroundColor: 'rgba(255,255,255,0.62)',
            boxShadow: '0 28px 80px rgba(83, 57, 42, 0.14)',
            padding: '64px 72px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            opacity: fade
          }}
        >
          <p style={{ margin: 0, fontSize: 42, lineHeight: 1.35, color: '#231a15' }}>
            {active?.en || 'Your podcast audio will play here.'}
          </p>
          <p style={{ margin: '36px 0 0', fontSize: 30, lineHeight: 1.55, color: '#7c5d4a' }}>
            {active?.zh || '双语字幕会跟随时间轴显示。'}
          </p>
        </div>
      </div>
    </AbsoluteFill>
  );
};
