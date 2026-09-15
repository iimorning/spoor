import React, { createContext, useContext, useMemo } from 'react';
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

/** V3 audio resolution — silent until `audio/zh-v3.wav` / `audio/en-v3.wav` drop in. */
function resolvePromoAudioSrc(audioUrl, locale = 'zh-v3') {
  if (/^https?:\/\//i.test(audioUrl)) return audioUrl;
  if (audioUrl && (audioUrl.startsWith('/') || /^[a-zA-Z]:/.test(audioUrl))) return audioUrl;
  if (
    (locale === 'zh-v3' &&
      (!audioUrl || audioUrl === 'audio/zh-v3.wav' || audioUrl === 'zh-v3.wav')) ||
    (locale === 'en-v3' &&
      (!audioUrl || audioUrl === 'audio/en-v3.wav' || audioUrl === 'en-v3.wav'))
  ) {
    return '';
  }
  if (audioUrl) return staticFile(audioUrl);
  return '';
}

import askFoxImg from './assets/agents/ask-fox.png';
import spoorLogo from './assets/agents/spoor-logo.png';
import oldStreetImg from './assets/covers/old-street.jpg';
import oldHouseVideoImg from './assets/covers/old-house-video.jpg';
import childhoodHomeImg from './assets/covers/childhood-home.jpg';
import { getPromoCopy } from './spoor-promo-copy.js';
import './zhuque-fangsong.css';

/** Mixkit “Typewriter soft click” (id 1125), Mixkit License — https://mixkit.co/free-sound-effects/typewriter/ */
const TYPEWRITER_CLICK = staticFile('sfx/mixkit-typewriter-soft-click.mp3');

const FANGSONG = '"Zhuque Fangsong", "STFangsong", FangSong, "仿宋", serif';

export const SpoorPromoV3Duration = 2250; // 75s @ 30fps

// ----- design tokens pulled from Spoor's actual Tailwind / inline styles.
const ACCENT = '#C2410C';
const ACCENT_LINE = 'rgba(194,65,12,0.32)';
const PAPER = '#FBF5EE';
const PAPER_2 = '#F4F1ED';
const CARD = '#FFFFFF';
const BORDER = '#E6E4DF';
const INK = '#1a1a1a';
const INK_SOFT = '#4a4a44';
const MUTED = '#5a5a54';
const FAINT = '#8c8a84';
const FAINT_2 = '#b0ada6';
const SERIF = 'Georgia, "Noto Serif SC", serif';
const SANS = 'Inter, "Helvetica Neue", "Noto Sans SC", sans-serif';
const MONO = 'ui-monospace, "JetBrains Mono", monospace';

const STAGE = { width: 1920, height: 1080 };

// ============================================================
// Lucide icon paths — copied verbatim from the live DOM so chrome
// matches the real app pixel-for-pixel.
// ============================================================
const ICONS = {
  archive: (
    <>
      <rect width="20" height="5" x="2" y="3" rx="1" />
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
      <path d="M10 12h4" />
    </>
  ),
  bot: (
    <>
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </>
  ),
  settings: (
    <>
      <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 0-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </>
  ),
  search: (
    <>
      <path d="m21 21-4.34-4.34" />
      <circle cx="11" cy="11" r="8" />
    </>
  ),
  maximize: (
    <>
      <path d="M15 3h6v6" />
      <path d="m21 3-7 7" />
      <path d="m3 21 7-7" />
      <path d="M9 21H3v-6" />
    </>
  ),
  plus: (
    <>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </>
  ),
  fileText: (
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </>
  ),
  mic: (
    <>
      <path d="M12 19v3" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <rect x="9" y="2" width="6" height="13" rx="3" />
    </>
  ),
  penLine: (
    <>
      <path d="M13 21h8" />
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
    </>
  ),
  zoomIn: (
    <>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" x2="16.65" y1="21" y2="16.65" />
      <line x1="11" x2="11" y1="8" y2="14" />
      <line x1="8" x2="14" y1="11" y2="11" />
    </>
  ),
  scan: (
    <>
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
    </>
  ),
  volume2: (
    <>
      <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" />
      <path d="M16 9a5 5 0 0 1 0 6" />
      <path d="M19.364 18.364a9 9 0 0 0 0-12.728" />
    </>
  ),
  play: (
    <>
      <path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" />
    </>
  ),
  droplets: (
    <>
      <path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z" />
      <path d="M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97" />
    </>
  ),
  waves: (
    <>
      <path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
      <path d="M2 12c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
      <path d="M2 18c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
    </>
  ),
  flame: (
    <path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4" />
  ),
  snowflake: (
    <>
      <path d="m10 20-1.25-2.5L6 18" />
      <path d="M10 4 8.75 6.5 6 6" />
      <path d="m14 20 1.25-2.5L18 18" />
      <path d="m14 4 1.25 2.5L18 6" />
      <path d="m17 21-3-6h-4" />
      <path d="m17 3-3 6 1.5 3" />
      <path d="M2 12h6.5L10 9" />
      <path d="m20 10-1.5 2 1.5 2" />
      <path d="M22 12h-6.5L14 15" />
      <path d="m4 10 1.5 2L4 14" />
      <path d="m7 21 3-6-1.5-3" />
      <path d="m7 3 3 6h4" />
    </>
  ),
  cloudLightning: (
    <>
      <path d="M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973" />
      <path d="m13 12-3 5h4l-3 5" />
    </>
  ),
  train: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2.25" />
      <path d="M12 3v6.75M12 14.25V21M3 12h6.75M14.25 12H21" />
      <path d="M6.2 6.2l4.2 4.2M13.6 13.6l4.2 4.2M17.8 6.2l-4.2 4.2M10.4 13.6l-4.2 4.2" />
    </>
  ),
  mapPin: (
    <>
      <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
      <circle cx="12" cy="10" r="3" />
    </>
  ),
  sparkles: (
    <>
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z" />
      <path d="M5 3v4" />
      <path d="M19 17v4" />
      <path d="M3 5h4" />
      <path d="M17 19h4" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a13.5 13.5 0 0 1 3.5 9 13.5 13.5 0 0 1-3.5 9 13.5 13.5 0 0 1-3.5-9 13.5 13.5 0 0 1 3.5-9" />
    </>
  ),
  copy: (
    <>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </>
  ),
  download: (
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M12 18v-6" />
      <path d="m9 15 3 3 3-3" />
    </>
  ),
  x: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  grip: (
    <>
      <circle cx="9" cy="12" r="1" />
      <circle cx="9" cy="5" r="1" />
      <circle cx="9" cy="19" r="1" />
      <circle cx="15" cy="12" r="1" />
      <circle cx="15" cy="5" r="1" />
      <circle cx="15" cy="19" r="1" />
    </>
  ),
  squareDashed: (
    <>
      <path d="M5 3a2 2 0 0 0-2 2" />
      <path d="M19 3a2 2 0 0 1 2 2" />
      <path d="M21 19a2 2 0 0 1-2 2" />
      <path d="M5 21a2 2 0 0 1-2-2" />
      <path d="M9 3h1" />
      <path d="M9 21h1" />
      <path d="M14 3h1" />
      <path d="M14 21h1" />
      <path d="M3 9v1" />
      <path d="M21 9v1" />
      <path d="M3 14v1" />
      <path d="M21 14v1" />
    </>
  ),
  arrowUp: (
    <>
      <path d="m5 12 7-7 7 7" />
      <path d="M12 19V5" />
    </>
  ),
  messageSquare: (
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  ),
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </>
  ),
};

function Icon({ name, size = 20, color = 'currentColor', strokeWidth = 2, fill, className }) {
  const path = ICONS[name];
  if (!path) return null;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill || 'none'}
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      style={{ flexShrink: 0 }}
    >
      {path}
    </svg>
  );
}

// ----- helpers ---------------------------------------------------
function smoothFade(sec, [a, b, c, d]) {
  return Math.min(
    interpolate(sec, [a, b], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
    interpolate(sec, [c, d], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
  );
}

function currentScene(sec, scenes) {
  return scenes.find((scene) => sec >= scene.start && sec < scene.end) || scenes[scenes.length - 1];
}

function findScene(scenes, id) {
  return scenes.find((scene) => scene.id === id);
}

function sceneRange(scenes, id) {
  const scene = findScene(scenes, id);
  return scene ? [scene.start, scene.end] : [0, 0];
}

function sceneLayerWindow(scenes, id, padIn = 0.5, padOut = 0.6) {
  const [start, end] = sceneRange(scenes, id);
  return [start - padIn, start + padIn, end, end + padOut];
}

function scenePresence(scene, sec, fadeIn = 0.6, fadeOut = 0.6) {
  const inn = interpolate(sec, [scene.start, scene.start + Math.max(fadeIn, 1 / 30)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  if (fadeOut <= 0) return inn;
  const out = interpolate(sec, [scene.end - fadeOut, scene.end], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return Math.min(inn, out);
}

function findCaption(segments, sec) {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  return (
    segments.find((seg) => sec >= Number(seg.startSec) && sec < Number(seg.endSec)) ||
    segments[segments.length - 1]
  );
}

// ----- context --------------------------------------------------------
const PromoContext = createContext(null);
function usePromo() {
  const ctx = useContext(PromoContext);
  if (!ctx) throw new Error('usePromo must be used within SpoorPromoV3');
  return ctx;
}

// ----- shared hero motion ----------------------------------------
function useStagger(sec, start, step, count) {
  return Array.from({ length: count }, (_, i) =>
    spring({
      frame: Math.max(0, (sec - start - i * step)) * 30,
      fps: 30,
      config: { damping: 22, mass: 0.9, stiffness: 90 },
    }),
  );
}

function WarmGlow({ sec, size = 900, top = '42%', left = '50%', strength = 0.16 }) {
  const breathe = 1 + Math.sin(sec * 1.1) * 0.04;
  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width: size,
        height: size,
        transform: `translate(-50%, -50%) scale(${breathe})`,
        background: `radial-gradient(circle, rgba(194,65,12,${strength}) 0%, rgba(194,65,12,${strength * 0.4}) 38%, transparent 68%)`,
        pointerEvents: 'none',
      }}
    />
  );
}

function TitleLines({ text, springs, fontSize, color = INK, lineHeight = 1.08 }) {
  const lines = String(text).split('\n');
  return (
    <div style={{ fontFamily: SERIF, fontWeight: 500, color, lineHeight, letterSpacing: '-0.04em' }}>
      {lines.map((line, i) => {
        const t = springs[Math.min(i, springs.length - 1)];
        return (
          <div key={i} style={{ overflow: 'hidden' }}>
            <div
              style={{
                fontSize,
                opacity: t,
                transform: `translateY(${(1 - t) * 44}px)`,
              }}
            >
              {line}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// Real chrome — exact match of the live app.
// ============================================================

function Brand() {
  return (
    <div style={{ position: 'absolute', left: 32, top: 26, display: 'flex', alignItems: 'center', gap: 12 }}>
      <Img
        src={spoorLogo}
        style={{ width: 44, height: 44, objectFit: 'contain', flexShrink: 0 }}
      />
      <span style={{ fontFamily: SERIF, fontSize: 28, color: INK, fontWeight: 500, letterSpacing: '-0.01em' }}>
        Spoor
      </span>
    </div>
  );
}

function SideRail({ activeId }) {
  const items = [
    { id: 'archive', icon: 'archive', label: '知识存档' },
    { id: 'agents', icon: 'bot', label: '角色' },
    { id: 'settings', icon: 'settings', label: '设置' },
  ];
  return (
    <div
      style={{
        position: 'absolute',
        left: 20,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        zIndex: 50,
      }}
    >
      {items.map((it) => {
        const active = it.id === activeId;
        return (
          <div
            key={it.id}
            style={{
              width: 48,
              height: 48,
              borderRadius: 999,
              background: active ? CARD : 'rgba(255,255,255,0.72)',
              border: `1px solid ${BORDER}`,
              color: active ? ACCENT : MUTED,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(31,27,24,0.05)',
              flexShrink: 0,
            }}
          >
            <Icon name={it.icon} size={22} />
          </div>
        );
      })}
    </div>
  );
}

function TopRightToolbar() {
  return (
    <div style={{ position: 'absolute', right: 28, top: 28, display: 'flex', gap: 10, zIndex: 30 }}>
      {[
        { name: 'history', label: '历史记录' },
        { name: 'search', label: '画布检索' },
        { name: 'maximize', label: '全屏' },
      ].map((it) => (
        <div
          key={it.name}
          style={{
            width: 44,
            height: 44,
            borderRadius: 999,
            background: CARD,
            border: `1px solid ${BORDER}`,
            color: INK,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(31,27,24,0.04)',
          }}
        >
          <Icon name={it.name} size={21} />
        </div>
      ))}
    </div>
  );
}

function BottomToolbar({ active = null, filled = false }) {
  const items = [
    { id: 'plus', name: 'plus' },
    { id: 'file', name: 'fileText' },
    { id: 'zone', name: 'squareDashed' },
    { id: 'compose', name: 'penLine' },
  ];
  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        bottom: 16,
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: 8,
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 16,
        boxShadow: '0 8px 24px rgba(31,27,24,0.08)',
        zIndex: 30,
      }}
    >
      {items.map((it) => {
        const accent = it.id === active;
        const solid = accent && filled;
        return (
          <div
            key={it.id}
            style={{
              width: 40,
              height: 40,
              borderRadius: 8,
              background: solid ? ACCENT : accent ? '#F4F1ED' : 'transparent',
              color: solid ? '#fff' : accent ? ACCENT : MUTED,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name={it.name} size={20} />
          </div>
        );
      })}
    </div>
  );
}

function ZoomToolbar() {
  return (
    <div
      style={{
        position: 'absolute',
        right: 28,
        bottom: 28,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '10px 16px',
        background: 'rgba(255,255,255,0.86)',
        backdropFilter: 'blur(6px)',
        border: `1px solid ${BORDER}`,
        borderRadius: 8,
        fontFamily: SANS,
        fontSize: 15,
        fontWeight: 700,
        color: FAINT,
        letterSpacing: '0.18em',
        zIndex: 30,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18 }}>
        −
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, width: 72, justifyContent: 'center' }}>
        <Icon name="zoomIn" size={16} /> 100%
      </span>
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18 }}>
        +
      </span>
      <span style={{ borderLeft: `1px solid ${BORDER}`, paddingLeft: 14, color: MUTED, display: 'flex' }}>
        <Icon name="scan" size={18} />
      </span>
    </div>
  );
}

// ----- Note card primitives (matching real nodes) -------------------
function AskCard({ x, y, w = 320, h = 180, rotate = 0 }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        borderRadius: 8,
        overflow: 'hidden',
        border: `1px solid ${BORDER}`,
        boxShadow: '0 18px 40px rgba(31,27,24,0.10)',
        transform: `rotate(${rotate}deg)`,
        background: PAPER,
      }}
    >
      <Img src={askFoxImg} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    </div>
  );
}

function ThemeCard({ x, y, w = 440, h = 270, rotate = 0, title = '核心主题', body }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        borderRadius: 0,
        background: CARD,
        border: `2px solid ${BORDER}`,
        boxShadow: '0 18px 40px rgba(31,27,24,0.10)',
        transform: `rotate(${rotate}deg)`,
        padding: 28,
        fontFamily: SANS,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <span style={{ color: ACCENT, display: 'flex' }}>
          <Icon name="mapPin" size={15} />
        </span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: ACCENT,
          }}
        >
          核心主题
        </span>
      </div>
      <div style={{ fontFamily: SERIF, fontSize: 32, fontWeight: 700, color: INK }}>{title}</div>
      <div style={{ marginTop: 10, fontFamily: SERIF, fontSize: 17, lineHeight: 1.55, color: INK_SOFT }}>
        {body || 'Central research objective for the current workspace.'}
      </div>
      <div
        style={{
          marginTop: 'auto',
          paddingTop: 16,
          borderTop: `1px solid ${PAPER_2}`,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span style={{ width: 5, height: 5, borderRadius: 999, background: ACCENT }} />
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: FAINT,
          }}
        >
          Spatial Encoding
        </span>
      </div>
    </div>
  );
}

function NoteCard({ x, y, w = 380, h = 250, rotate = 0, body, placeholder = false, selected = 0 }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        borderRadius: 0,
        background: CARD,
        border: `2px solid ${selected > 0.01 ? ACCENT : BORDER}`,
        boxShadow:
          selected > 0.01
            ? `0 18px 40px rgba(31,27,24,0.10), 0 0 0 ${6 * selected}px rgba(194,65,12,${0.14 * selected})`
            : '0 18px 40px rgba(31,27,24,0.10)',
        transform: `rotate(${rotate}deg)`,
        padding: 28,
        fontFamily: SERIF,
        fontSize: 19,
        lineHeight: 1.7,
        color: placeholder ? FAINT : INK_SOFT,
      }}
    >
      {body}
    </div>
  );
}

// ----- Ambience card — matches the live "Ambience" canvas node -----
function AmbienceCard({ x, y }) {
  const tracks = [
    { id: 'midnight-rain', icon: 'droplets', label: '午夜雨声', active: true },
    { id: 'soft-ocean', icon: 'waves', label: '浅滩海浪' },
    { id: 'evening-storm', icon: 'cloudLightning', label: '雷雨' },
    { id: 'crackling-fire', icon: 'flame', label: '柴火' },
    { id: 'winter-blizzard', icon: 'snowflake', label: '暴风雪' },
    { id: 'train-carriage', icon: 'train', label: '蒸汽火车' },
  ];
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: 290,
        background: CARD,
        border: `1px solid ${BORDER}`,
        boxShadow: '0 18px 40px rgba(31,27,24,0.10)',
        fontFamily: SANS,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Visualizer header */}
      <div
        style={{
          position: 'relative',
          height: 56,
          background: '#F7F4F0',
          borderBottom: `1px solid ${BORDER}`,
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'center',
          gap: 3,
          padding: '0 10px 10px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'radial-gradient(circle at 28% 40%, rgba(194,65,12,0.14), transparent 55%)',
            opacity: 0.6,
          }}
        />
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'flex-end', gap: 3, height: 28, opacity: 0.45 }}>
          {[0.35, 0.45, 0.55, 0.35, 0.45, 0.55, 0.35, 0.45, 0.55, 0.35].map((s, i) => (
            <div
              key={i}
              style={{
                width: 3,
                borderRadius: 999,
                background: ACCENT,
                height: 26,
                transform: `scaleY(${s})`,
                transformOrigin: 'bottom',
              }}
            />
          ))}
        </div>
      </div>

      {/* Track grid */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, padding: 12 }}>
        {tracks.map((t) => (
          <div
            key={t.id}
            style={{
              minHeight: 58,
              borderRadius: 10,
              background: t.active ? `${ACCENT}1F` : 'transparent',
              color: t.active ? ACCENT : FAINT_2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name={t.icon} size={28} />
          </div>
        ))}
      </div>

      {/* Play + volume */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '0 14px 14px',
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 999,
            background: ACCENT,
            color: CARD,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="play" size={14} fill="currentColor" strokeWidth={0} />
        </div>
        <span style={{ color: FAINT, display: 'flex' }}>
          <Icon name="volume2" size={16} />
        </span>
        <div
          style={{
            flex: 1,
            height: 5,
            background: PAPER_2,
            borderRadius: 3,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              height: 5,
              width: '70%',
              background: ACCENT,
              borderRadius: 3,
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ----- Ali avatar (the fox behind the Ask card) ------------------
function AliAvatar({ size = 30 }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        background: '#FFF7ED',
        border: `1px solid ${BORDER}`,
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      <Img src={askFoxImg} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    </div>
  );
}

// ============================================================
// SCENE 1 — Opening (hero)
// ============================================================
// ----- V3 opening: a blank canvas, a typed question, then the logo --
/** Split the opening question so it reads as ≤2 title lines.
 *  - Chinese: break at the first 「，」 (full-width comma) so the comma stays
 *    on the upper line.
 *  - English: prefer a literal `, `; if there's no comma and the line is long
 *    enough to overflow the per-character slot grid (CJK assumption), wrap at
 *    the word boundary nearest the midpoint. */
function splitHeroQuestion(q) {
  const zh = q.indexOf('，');
  if (zh !== -1) return [q.slice(0, zh + 1), q.slice(zh + 1).trim()];
  const en = q.indexOf(', ');
  if (en !== -1) return [q.slice(0, en + 1), q.slice(en + 2).trim()];
  // English fallback: long single-line questions overflow the CJK grid layout,
  // so break at the word closest to the midpoint.
  const LONG_LINE = 18;
  if (q.length > LONG_LINE) {
    const mid = q.length / 2;
    let bestBreak = -1;
    let bestDist = Infinity;
    for (let i = 0; i < q.length; i++) {
      if (q[i] === ' ') {
        const dist = Math.abs(i - mid);
        if (dist < bestDist) {
          bestDist = dist;
          bestBreak = i;
        }
      }
    }
    if (bestBreak > 0) return [q.slice(0, bestBreak), q.slice(bestBreak + 1)];
  }
  return [q];
}

const OPENING_TYPE_START = 0.65;
const OPENING_TYPE_RATE = 11;
const OPENING_LINE_PAUSE = 0.28;

function openingKeyTimes(lines) {
  const times = [];
  let t = OPENING_TYPE_START;
  for (let li = 0; li < lines.length; li++) {
    for (let i = 0; i < lines[li].length; i++) {
      times.push({ ch: lines[li][i], at: t, line: li });
      t += 1 / OPENING_TYPE_RATE;
    }
    t += OPENING_LINE_PAUSE;
  }
  return times;
}

function OpeningScene({ scene, sec }) {
  const { fps } = useVideoConfig();
  const { copy, locale } = usePromo();
  const story = copy.story || {};
  const presence = scenePresence(scene, sec, 0.5, 0);
  const land = interpolate(sec, [scene.end, scene.end + 1.0], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });
  const bgOp = interpolate(land, [0, 0.5], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const titleOp = interpolate(land, [0.68, 0.96], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const titleScale = interpolate(land, [0, 1], [1, 0.52], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const q = story.question || '';
  const lines = splitHeroQuestion(q);
  const keys = openingKeyTimes(lines);
  const typed = keys.filter((k) => sec >= k.at).length;
  const caretOn = land < 0.08 && Math.floor(sec * 3) % 2 === 0;
  const logoT = smoothFade(sec, [3.9, 4.4, 99, 100]) * (1 - land);
  let activeLine = lines.length - 1;
  {
    let acc = 0;
    for (let li = 0; li < lines.length; li++) {
      if (typed < acc + lines[li].length) {
        activeLine = li;
        break;
      }
      acc += lines[li].length;
    }
  }
  // CJK (zh-v2) keeps the deliberate 仿宋字格: each glyph in a 1em slot with
  // 30px gap between slots. Latin locales use natural text flow — English
  // glyphs occupy ~0.55em, the 1em-slot layout would push a 40-char line
  // past the 1480px container.
  const isCjk = String(locale).startsWith('zh');
  return (
    <AbsoluteFill style={{ opacity: presence, pointerEvents: 'none' }}>
      {keys.map((k, i) =>
        /\s/.test(k.ch) ? null : (
          <Sequence key={`type-${i}`} from={Math.round(k.at * fps)} durationInFrames={8} layout="none">
            <Audio src={TYPEWRITER_CLICK} volume={0.24} />
          </Sequence>
        ),
      )}
      {/* paper cover lifts so the canvas can grow in underneath the title */}
      <AbsoluteFill style={{ background: PAPER, opacity: bgOp }} />
      <AbsoluteFill
        style={{
          opacity: bgOp,
          backgroundImage: 'radial-gradient(circle, rgba(31,27,24,0.07) 1.2px, transparent 1.2px)',
          backgroundSize: '30px 30px',
        }}
      />
      <AbsoluteFill style={{ opacity: bgOp }}>
        <WarmGlow sec={sec} strength={0.1} />
      </AbsoluteFill>
      {/* the brand drifts in late — the question comes first */}
      <div style={{ position: 'absolute', left: 32, top: 26, display: 'flex', alignItems: 'center', gap: 12, opacity: logoT }}>
        <Img src={spoorLogo} style={{ width: 44, height: 44, objectFit: 'contain' }} />
        <span style={{ fontFamily: SERIF, fontSize: 28, color: INK, fontWeight: 500 }}>Spoor</span>
      </div>
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '48%',
          transform: `translate(-50%, -50%) scale(${titleScale})`,
          width: 1480,
          opacity: titleOp,
          transformOrigin: '50% 50%',
        }}
      >
        {/* 仿宋字格 (CJK only): 每字等宽、字距行距拉开，光标不挤版面 */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: isCjk ? 52 : 18,
            fontFamily: isCjk ? FANGSONG : SERIF,
            fontSize: isCjk ? 68 : 56,
            fontWeight: 400,
            color: INK,
            lineHeight: isCjk ? 1 : 1.2,
            letterSpacing: isCjk ? 'normal' : '0.005em',
          }}
        >
          {lines.map((line, i) => {
            const before = lines.slice(0, i).reduce((n, l) => n + l.length, 0);
            const take = Math.max(0, Math.min(line.length, typed - before));
            const showCaret = caretOn && i === activeLine;
            if (isCjk) {
              const caretLeft =
                take === 0
                  ? 'calc(-0.42em - 10px)'
                  : `calc(${take} * 1em + ${Math.max(0, take - 1)} * 30px + 8px)`;
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 30, position: 'relative' }}>
                  {Array.from(line).map((ch, j) => (
                    <span
                      key={j}
                      style={{
                        width: '1em',
                        textAlign: 'center',
                        flexShrink: 0,
                        opacity: j < take ? 1 : 0,
                      }}
                    >
                      {ch}
                    </span>
                  ))}
                  <span
                    style={{
                      position: 'absolute',
                      left: caretLeft,
                      top: '50%',
                      width: '0.42em',
                      height: '0.92em',
                      marginTop: '-0.46em',
                      background: ACCENT,
                      borderRadius: 4,
                      opacity: showCaret ? 1 : 0,
                      pointerEvents: 'none',
                    }}
                  />
                </div>
              );
            }
            // Latin: natural text flow, caret rides at the end of the typed text.
            const visible = line.slice(0, take);
            return (
              <div
                key={i}
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: '1em',
                }}
              >
                <span style={{ whiteSpace: 'pre' }}>{visible}</span>
                <span
                  style={{
                    display: 'inline-block',
                    width: 3,
                    height: '0.92em',
                    marginLeft: 4,
                    background: ACCENT,
                    borderRadius: 2,
                    opacity: showCaret ? 1 : 0,
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
}

// ============================================================
// SCENE 8 — Closing (hero)
// ============================================================
// ----- long-form editor: matches EssayFullscreen, not a promo card --
function EditorBlock({ block, t, hot = 0, suggestion = null }) {
  if (t < 0.01) return null;
  const style = { opacity: t, transform: `translateY(${(1 - t) * 10}px)` };
  let text = block.text;
  if (suggestion && suggestion.original && String(block.text).includes(suggestion.original)) {
    const [before, after] = String(block.text).split(suggestion.original);
    text = (
      <>
        {before}
        {suggestion.node}
        {after}
      </>
    );
  } else if (block.mark && block.text.includes(block.mark)) {
    text = (
      <>
        {block.text.split(block.mark)[0]}
        <span style={{ background: 'rgba(194,65,12,0.13)', color: ACCENT, padding: '0 3px', borderRadius: 3 }}>
          {block.mark}
        </span>
        {block.text.split(block.mark)[1]}
      </>
    );
  }
  if (block.type === 'h2') {
    return (
      <div
        style={{
          ...style,
          fontFamily: SERIF,
          fontSize: 32,
          fontWeight: 700,
          color: INK,
          lineHeight: 1.35,
          margin: '32px 0 16px',
          paddingBottom: 10,
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        {block.text}
      </div>
    );
  }
  if (block.type === 'quote') {
    return (
      <div
        style={{
          ...style,
          margin: '20px 0 24px',
          padding: '4px 0 4px 18px',
          borderLeft: `4px solid ${hot > 0.2 ? ACCENT : BORDER}`,
          boxShadow: hot > 0.01 ? `0 0 0 ${4 * hot}px rgba(194,65,12,${0.16 * hot})` : 'none',
        }}
      >
        <div style={{ fontFamily: SERIF, fontSize: 22, fontStyle: 'italic', lineHeight: 1.8, letterSpacing: '0.04em', color: MUTED }}>
          {block.text}
        </div>
        {block.from ? (
          <div style={{ marginTop: 8, fontFamily: SANS, fontSize: 15, color: FAINT }}>{block.from}</div>
        ) : null}
      </div>
    );
  }
  return (
    <div
      style={{
        ...style,
        fontFamily: SERIF,
        fontSize: 22,
        lineHeight: 1.85,
        letterSpacing: '0.05em',
        color: INK,
        margin: '0 0 18px',
      }}
    >
      {text}
    </div>
  );
}

function EditorChromeBtn({ children }) {
  return (
    <div
      style={{
        width: 46,
        height: 46,
        borderRadius: 8,
        border: `1px solid ${BORDER}`,
        background: CARD,
        color: MUTED,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 1px 2px rgba(31,27,24,0.06)',
        flexShrink: 0,
      }}
    >
      {children}
    </div>
  );
}

function EssayEditChip({ original, proposed, enter, applied, applyPressed, isCjk }) {
  if (enter < 0.02 && applied < 0.02) return <>{original}</>;
  if (applied > 0.72) {
    return (
      <span
        style={{
          background: 'rgba(194,65,12,0.10)',
          color: ACCENT,
          padding: '0 4px',
          borderRadius: 3,
        }}
      >
        {proposed}
      </span>
    );
  }
  return (
    <span
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 8,
        maxWidth: '100%',
        margin: '6px 0',
        padding: '10px 12px',
        border: `1px dashed ${ACCENT_LINE}`,
        borderRadius: 8,
        background: '#FFF7ED',
        verticalAlign: 'middle',
        opacity: enter,
        boxShadow: applyPressed > 0.2 ? '0 0 0 4px rgba(194,65,12,0.12)' : 'none',
      }}
    >
      <span style={{ display: 'flex', gap: 6 }}>
        <span
          style={{
            borderRadius: 6,
            padding: '5px 12px',
            fontSize: 14,
            fontFamily: SANS,
            fontWeight: 700,
            color: ACCENT,
            background: CARD,
            border: `1px solid ${ACCENT_LINE}`,
            transform: `scale(${1 - applyPressed * 0.08})`,
          }}
        >
          {isCjk ? '应用' : 'Apply'}
        </span>
        <span
          style={{
            borderRadius: 6,
            padding: '5px 12px',
            fontSize: 14,
            fontFamily: SANS,
            fontWeight: 700,
            color: MUTED,
            background: CARD,
            border: `1px solid ${BORDER}`,
          }}
        >
          {isCjk ? '拒绝' : 'Reject'}
        </span>
      </span>
      <span style={{ fontFamily: SERIF, fontSize: 21, lineHeight: 1.6, color: INK }}>
        <span
          style={{
            color: FAINT,
            textDecoration: 'line-through',
            textDecorationColor: 'rgba(194,65,12,0.45)',
            padding: '0 2px',
          }}
        >
          {original}
        </span>
        <span style={{ color: ACCENT, margin: '0 8px', fontSize: 15, fontFamily: SANS }}>→</span>
        <span
          style={{
            color: INK,
            background: 'rgba(194,65,12,0.10)',
            borderRadius: 2,
            padding: '0 3px',
            boxShadow: 'inset 0 -1px 0 rgba(194,65,12,0.35)',
          }}
        >
          {proposed}
        </span>
      </span>
    </span>
  );
}

function EditorScene({ sec }) {
  const { copy, locale } = usePromo();
  const isCjk = String(locale).startsWith('zh');
  const story = copy.story || {};
  const ed = story.editor || {};
  const blocks = ed.blocks || [];
  const sidebar = (ed.sidebar || []).slice(0, 4);
  const rise = (at, damping = 22) =>
    spring({ frame: Math.max(0, sec - at) * 30, fps: 30, config: { damping, mass: 0.8, stiffness: 80 } });
  const pan = interpolate(sec, [6.2, 9.6], [0, -380], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.4, 0, 0.35, 1),
  });
  const caretOn = Math.floor(sec * 3) % 2 === 0;
  const sourceHot = smoothFade(sec, [1.2, 1.6, 4.2, 4.8]);
  const wordCount = blocks.reduce((n, b) => n + String(b.text || '').replace(/\s/g, '').length, 0);

  const userChat = rise(1.55);
  const thinking = smoothFade(sec, [2.55, 2.75, 3.45, 3.7]);
  const replyChat = rise(3.55);
  const editEnter = rise(3.7, 18);
  const applyPressed = smoothFade(sec, [5.35, 5.48, 5.48, 5.7]);
  const applied = interpolate(sec, [5.55, 5.85], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const draftTyped = Math.floor(
    interpolate(sec, [1.15, 2.35], [0, String(story.essayChatUser || '').length + 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );
  const draftText = String(story.essayChatUser || '').slice(0, Math.max(0, draftTyped));
  const inputActive = sec >= 1.1 && sec < 2.55;
  const sendLit = sec >= 2.45 && sec < 2.8;

  const original = story.essayEditOriginal || '';
  const proposed = story.essayEditProposed || '';

  return (
    <AbsoluteFill style={{ background: '#FAF9F6', fontFamily: SANS, display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          height: 56,
          flexShrink: 0,
          background: 'rgba(255,255,255,0.9)',
          borderBottom: `1px solid ${BORDER}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          zIndex: 20,
          opacity: rise(0.05),
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: FAINT }}>
          {isCjk ? '长文' : 'Essay'}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <EditorChromeBtn><Icon name="copy" size={20} /></EditorChromeBtn>
          <EditorChromeBtn><Icon name="download" size={20} /></EditorChromeBtn>
          <EditorChromeBtn><Icon name="x" size={20} /></EditorChromeBtn>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0, opacity: rise(0.08) }}>
        <div
          style={{
            width: 500,
            flexShrink: 0,
            background: CARD,
            borderRight: `1px solid ${BORDER}`,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              height: 64,
              padding: '0 22px',
              borderBottom: `1px solid ${BORDER}`,
              display: 'flex',
              alignItems: 'center',
              fontSize: 22,
              fontWeight: 700,
              color: INK,
              background: 'rgba(244,241,237,0.5)',
              flexShrink: 0,
            }}
          >
            {isCjk ? '关联便签' : 'Linked notes'}
          </div>
          <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14, overflow: 'hidden' }}>
            {sidebar.map((card, i) => {
              const hot = i === 1 ? sourceHot : 0;
              const isPhoto = i === 1;
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 14,
                    padding: 18,
                    background: hot > 0.2 ? '#F4F1ED' : '#FAF9F6',
                    border: `1.5px solid ${hot > 0.2 ? ACCENT : BORDER}`,
                    borderRadius: 14,
                    opacity: rise(0.16 + i * 0.08),
                    boxShadow: hot > 0.01 ? `0 0 0 ${5 * hot}px rgba(194,65,12,${0.14 * hot})` : '0 8px 20px rgba(31,27,24,0.04)',
                  }}
                >
                  <span style={{ color: FAINT, display: 'flex', marginTop: 4, flexShrink: 0 }}>
                    <Icon name="grip" size={22} />
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: INK, lineHeight: 1.35 }}>{card.title}</div>
                    {isPhoto ? (
                      <div style={{ marginTop: 10, height: 92, borderRadius: 10, overflow: 'hidden', position: 'relative', background: '#E8D5C0' }}>
                        <Img src={childhoodHomeImg} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                      </div>
                    ) : null}
                    {card.preview ? (
                      <div style={{ marginTop: 10, fontSize: 16, lineHeight: 1.55, color: MUTED }}>{card.preview}</div>
                    ) : null}
                  </div>
                  <span style={{ color: FAINT, display: 'flex', flexShrink: 0, marginTop: 2 }}>
                    <Icon name="trash" size={18} />
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', position: 'relative' }}>
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: 20,
              width: 700,
              transform: `translateX(-50%) translateY(${pan}px)`,
            }}
          >
            <div style={{ marginBottom: 14, display: 'flex', justifyContent: 'center', gap: 8, opacity: rise(0.14) }}>
              {['B', 'I', '“'].map((mark) => (
                <div
                  key={mark}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    border: `1px solid ${BORDER}`,
                    background: CARD,
                    color: MUTED,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: SERIF,
                    fontSize: 15,
                    fontWeight: 700,
                  }}
                >
                  {mark}
                </div>
              ))}
            </div>
            <div
              style={{
                position: 'relative',
                background: CARD,
                border: `1px solid ${BORDER}`,
                boxShadow: '0 4px 14px rgba(31,27,24,0.08)',
              }}
            >
              <div style={{ position: 'absolute', left: -1, right: -1, top: -1, height: 4, background: ACCENT }} />
              <div style={{ padding: '48px 48px 64px' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 32,
                    borderBottom: `2px solid ${INK}`,
                    paddingBottom: 22,
                    marginBottom: 32,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: MONO, fontSize: 12, letterSpacing: '0.16em', textTransform: 'uppercase', color: FAINT, marginBottom: 12 }}>
                      {ed.docPrefix} {ed.docType}
                    </div>
                    <div style={{ fontFamily: SERIF, fontSize: 34, fontWeight: 700, lineHeight: 1.2, color: INK }}>
                      {ed.title}
                      <span style={{ color: ACCENT, opacity: caretOn && sec < 1.4 ? 1 : 0 }}>▍</span>
                    </div>
                  </div>
                  <div style={{ width: 132, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12, color: MUTED, textAlign: 'right' }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{ed.authorLabel}:</div>
                      <div style={{ padding: '4px 2px', minHeight: 18 }}>{ed.author || ' '}</div>
                    </div>
                    <div>
                      <div style={{ fontWeight: 700 }}>{ed.publishedLabel}:</div>
                      <div style={{ padding: '4px 2px' }}>{ed.date}</div>
                    </div>
                    <div>
                      <div style={{ fontWeight: 700 }}>{ed.wordCountLabel}:</div>
                      <div style={{ padding: '4px 2px', fontVariantNumeric: 'tabular-nums' }}>{wordCount.toLocaleString()}</div>
                    </div>
                  </div>
                </div>
                {blocks.map((b, i) => (
                  <EditorBlock
                    key={i}
                    block={b}
                    t={rise(0.26 + i * 0.08)}
                    hot={b.type === 'quote' ? sourceHot : 0}
                    suggestion={
                      i === 0 && b.type === 'p'
                        ? {
                            original,
                            node: (
                              <EssayEditChip
                                original={original}
                                proposed={proposed}
                                enter={editEnter}
                                applied={applied}
                                applyPressed={applyPressed}
                                isCjk={isCjk}
                              />
                            ),
                          }
                        : null
                    }
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            width: 460,
            flexShrink: 0,
            background: '#FAF9F6',
            borderLeft: `1px solid ${BORDER}`,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              height: 72,
              padding: '0 22px',
              borderBottom: `1px solid ${BORDER}`,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              fontSize: 26,
              fontWeight: 700,
              color: INK,
              background: 'rgba(244,241,237,0.5)',
              flexShrink: 0,
            }}
          >
            <span style={{ color: ACCENT, display: 'flex' }}>
              <Icon name="messageSquare" size={24} />
            </span>
            {isCjk ? 'AI 改稿' : 'AI editor'}
          </div>
          <div style={{ flex: 1, padding: 18, display: 'flex', flexDirection: 'column', gap: 14, overflow: 'hidden' }}>
            {userChat < 0.08 && thinking < 0.08 && replyChat < 0.08 ? (
              <p style={{ fontSize: 22, lineHeight: 1.55, color: FAINT, margin: 0 }}>
                {isCjk
                  ? '在这里对话即可改长文。建议会出现在正文里：点「应用」留下新句子，点「拒绝」留原文。'
                  : 'Chat here to edit the article. Suggestions appear in the draft — Apply or Reject.'}
              </p>
            ) : null}
            {userChat > 0.02 ? (
              <div
                style={{
                  alignSelf: 'flex-end',
                  maxWidth: '94%',
                  opacity: userChat,
                  transform: `translateY(${(1 - userChat) * 10}px)`,
                  background: 'rgba(194,65,12,0.10)',
                  borderRadius: 18,
                  padding: '16px 18px',
                  fontFamily: SERIF,
                  fontSize: 24,
                  lineHeight: 1.5,
                  color: INK,
                }}
              >
                {story.essayChatUser}
              </div>
            ) : null}
            {thinking > 0.02 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 20, color: MUTED, opacity: thinking }}>
                <span style={{ width: 9, height: 9, borderRadius: 999, background: ACCENT, opacity: 0.75 }} />
                {isCjk ? '正在改稿…' : 'Editing…'}
              </div>
            ) : null}
            {replyChat > 0.02 ? (
              <div
                style={{
                  alignSelf: 'stretch',
                  opacity: replyChat,
                  transform: `translateY(${(1 - replyChat) * 10}px)`,
                  background: CARD,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 18,
                  padding: '16px 18px',
                  fontFamily: SERIF,
                  fontSize: 24,
                  lineHeight: 1.5,
                  color: INK,
                }}
              >
                {story.essayChatReply}
                <div style={{ marginTop: 12, fontFamily: SANS, fontSize: 16, fontWeight: 700, color: ACCENT }}>
                  {isCjk ? '正文里有 1 处建议' : '1 suggestion in the article'}
                </div>
              </div>
            ) : null}
          </div>
          <div style={{ padding: 16, borderTop: `1px solid ${BORDER}`, background: CARD }}>
            <div
              style={{
                border: `1px solid ${inputActive ? ACCENT : BORDER}`,
                borderRadius: 14,
                padding: '14px 14px 12px',
                boxShadow: inputActive ? '0 0 0 4px rgba(194,65,12,0.12)' : 'none',
              }}
            >
              <div style={{ fontFamily: SERIF, fontSize: 22, color: draftText ? INK : FAINT_2, minHeight: 64, lineHeight: 1.45 }}>
                {inputActive ? draftText : sec >= 2.55 ? '' : isCjk ? '让 AI 改写、删减或扩写正文…' : 'Ask AI to rewrite, trim, or expand…'}
                {inputActive && caretOn ? <span style={{ color: ACCENT }}>▍</span> : null}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 999,
                    background: ACCENT,
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: sendLit || draftTyped > 8 ? 1 : 0.35,
                    transform: `scale(${sendLit ? 0.9 : 1})`,
                  }}
                >
                  <Icon name="arrowUp" size={20} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}

function Connector({ x1, y1, x2, y2, progress, opacity = 1, zIndex = 1, stroke = '#d1cfca', strokeWidth = 2 }) {
  if (progress < 0.01) return null;
  const len = Math.hypot(x2 - x1, y2 - y1);
  return (
    <svg
      width={3400}
      height={2200}
      viewBox={`-400 -300 3400 2200`}
      style={{ position: 'absolute', left: -400, top: -300, pointerEvents: 'none', zIndex }}
    >
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={len}
        strokeDashoffset={(1 - Math.min(1, progress)) * len}
        opacity={opacity}
      />
    </svg>
  );
}

// ----- fake cursor for interaction beats ---------------------------
function PointerArrowSvg() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" style={{ display: 'block' }}>
      <path
        d="M5.5 3.2 19.6 11.4a.6.6 0 0 1-.26 1.13l-5.36.93a.6.6 0 0 0-.44.44l-1.66 5.2a.6.6 0 0 1-1.13.18L5.02 4.3a.6.6 0 0 1 .48-1.1Z"
        fill="#1a1a1a"
        stroke="#fff"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GrabHandSvg({ closed, fid = 'grabOutline' }) {
  const finger = (x, y, h) => <rect x={x} y={y} width="8" height={h} rx="4" fill="#fff" />;
  return (
    <svg width="42" height="42" viewBox="0 0 48 48" style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <filter id={fid} x="-20%" y="-20%" width="140%" height="140%">
          <feMorphology in="SourceAlpha" operator="dilate" radius="1.55" result="dilated" />
          <feFlood floodColor="#1a1a1a" result="ink" />
          <feComposite in="ink" in2="dilated" operator="in" result="outline" />
          <feMerge>
            <feMergeNode in="outline" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g
        fill="#fff"
        filter={`url(#${fid})`}
        transform={closed ? 'rotate(-8 24 26)' : 'rotate(-12 22 22)'}
      >
        {closed ? (
          <>
            {finger(13, 15.5, 15)}
            {finger(20, 13.5, 16.5)}
            {finger(27, 15.5, 15)}
            <rect x="7.5" y="20" width="9" height="14" rx="4.5" transform="rotate(-32 12 27)" />
            <rect x="11" y="22" width="27" height="17" rx="8.5" />
          </>
        ) : (
          <>
            {finger(11, 7, 23)}
            {finger(18.5, 3.5, 25)}
            {finger(26, 7.5, 22)}
            {finger(33.5, 11, 18)}
            <rect x="5" y="20" width="10" height="16" rx="5" transform="rotate(-38 10 28)" />
            <rect x="10" y="22" width="29" height="18" rx="9" />
          </>
        )}
      </g>
    </svg>
  );
}

function MouseCursor({ x, y, scale = 1, clicking = 0, pressed = 0, kind = 'pointer', uid = 0 }) {
  const grabbing = kind === 'grab' && pressed > 0.22;
  const showGrab = kind === 'grab';
  const size = showGrab ? 1.2 : 1.15;
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        zIndex: 80,
        pointerEvents: 'none',
        transform: `scale(${scale * size * (1 - pressed * (showGrab ? 0.05 : 0.14))})`,
        transformOrigin: showGrab ? '18px 16px' : '4px 2px',
        filter: 'drop-shadow(0 3px 6px rgba(31,27,24,0.28))',
      }}
    >
      {clicking > 0.01 ? (
        <div
          style={{
            position: 'absolute',
            left: -14,
            top: -14,
            width: 28,
            height: 28,
            borderRadius: 999,
            border: `2px solid ${ACCENT}`,
            opacity: 1 - clicking,
            transform: `scale(${0.5 + clicking * 1.4})`,
          }}
        />
      ) : null}
      {showGrab ? <GrabHandSvg closed={grabbing} fid={`grabOutline-${uid}`} /> : <PointerArrowSvg />}
    </div>
  );
}

// ----- caption block (bottom of split scenes) ---------------------
function PromoCaption({ caption, sec }) {
  const { scenes, locale } = usePromo();
  const opening = scenePresence(scenes[0], sec);
  const closing = scenePresence(scenes[scenes.length - 1], sec);
  const afterOpen = interpolate(sec, [scenes[0].end + 0.55, scenes[0].end + 1.15], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const opacity = afterOpen * (1 - opening * 0.7) * (1 - closing * 0.7);
  // Pick the locale-matching subtitle text; the JSON segments use generic
  // `en` / `zh` fields, so map the v2 locale prefix to the right one and fall
  // back to whichever field the bundle exposes.
  const field = locale && locale.startsWith('en') ? 'en' : 'zh';
  const text = (caption && (caption[field] || caption.zh || caption.en)) || null;
  if (opacity < 0.02 || !text) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 116,
        display: 'flex',
        justifyContent: 'center',
        fontFamily: SANS,
        opacity,
        zIndex: 60,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 14,
          maxWidth: 1240,
          padding: '18px 34px',
          borderRadius: 999,
          background: 'rgba(255,255,255,0.78)',
          backdropFilter: 'blur(10px)',
          border: `1px solid ${BORDER}`,
          boxShadow: '0 10px 30px rgba(31,27,24,0.08)',
          fontSize: 26,
          lineHeight: 1.5,
          fontWeight: 500,
          color: INK_SOFT,
          letterSpacing: '0.02em',
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: 999, background: ACCENT, flexShrink: 0 }} />
        {text}
      </div>
    </div>
  );
}

// ============================================================
// THE NARRATIVE WORLD — one continuous canvas the camera walks.
// A single idea lands, connects, is challenged, and blooms.
// ============================================================

// Absolute seconds — opening types until ~6s, world through ~58s, editor + lockup to 75s.
const TL = {
  worldIn: 5.9,
  roomAt: 6.05,
  outsideAt: 7.35,
  dragPhotoReach: 12.85,
  dragPhoto0: 13.25,
  dragPhoto1: 14.95,
  dragNoteReach: 15.25,
  dragNote0: 15.6,
  dragNote1: 17.2,
  c1Start: 22.9,
  c1Click: 23.6,
  c1Out: 25.4,
  chatAt: 22.45,
  user1At: 23.35,
  ali1At: 26.15,
  ali2At: 28.05,
  user2At: 30.75,
  wikiChatAt: 32.55,
  imageChatAt: 34.75,
  chatHold: 45.4,
  chatOut: 46.2,
  dragExcerpt0: 38.55,
  dragExcerpt1: 40.45,
  excerptAt: 40.05,
  dragWiki0: 41.15,
  dragWiki1: 42.85,
  wikiAt: 42.45,
  dragImage0: 43.35,
  dragImage1: 45.05,
  imageAt: 44.65,
  dimAt: 50.35,
  select2At: 51.15,
  c3Start: 53.75,
  c3Click: 54.55,
  c3Out: 55.25,
  outlineAt: 54.85,
  outlineLineAt: 55.45,
  genPressAt: 57.15,
  worldOut: 58.2,
};

const CAM = {
  t: [5.8, 8.2, 11.4, 12.5, 18.0, 20.8, 22.6, 37.6, 40.5, 45.1, 49.2, 53.1, 56.1, 58.2],
  fx: [1100, 1180, 1320, 1320, 1320, 1100, 1040, 1040, 980, 1120, 1200, 1200, 1480, 1580],
  fy: [470, 540, 580, 580, 580, 620, 670, 670, 780, 760, 720, 720, 1080, 1160],
  s: [1.48, 1.18, 0.94, 0.94, 0.94, 1.06, 1.12, 1.12, 1.18, 1.12, 0.7, 0.7, 1.32, 1.68],
};

const POS = {
  room: { x: 420, y: 240, w: 1360, h: 860 },
  ask: { x: 448, y: 268, w: 280, h: 158 },
  q: { x: 756, y: 268, w: 520, h: 168 },
  photoOut: { x: 1860, y: 240, w: 360, h: 250 },
  noteOut: { x: 1860, y: 538, w: 360, h: 186 },
  themeOut: { x: 1860, y: 772, w: 360, h: 210 },
  photoIn: { x: 452, y: 470, w: 360, h: 250 },
  noteIn: { x: 840, y: 490, w: 360, h: 186 },
  excerpt: { x: 452, y: 750, w: 420, h: 140 },
  wiki: { x: 900, y: 748, w: 440, h: 300 },
  image: { x: 1280, y: 490, w: 340, h: 250 },
  outline: { x: 1280, y: 1140, w: 560, h: 380 },
};

function WorkRoom({ x, y, w, h, label, t }) {
  if (t < 0.01) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        opacity: t,
        border: '2px dashed rgba(194,65,12,0.38)',
        borderRadius: 22,
        background: 'rgba(255,255,255,0.22)',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.35)',
        zIndex: 1,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 20,
          top: -15,
          background: PAPER,
          padding: '3px 14px',
          borderRadius: 999,
          border: `1px solid ${BORDER}`,
          fontFamily: SANS,
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: '0.14em',
          color: ACCENT,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </div>
    </div>
  );
}

function ChatMsg({ mine, text, enter }) {
  const p = spring({
    frame: Math.max(0, enter) * 30,
    fps: 30,
    config: { damping: 18, mass: 0.7, stiffness: 100 },
  });
  if (p < 0.01) return null;
  return (
    <div
      style={{
        alignSelf: mine ? 'flex-end' : 'flex-start',
        maxWidth: '94%',
        opacity: p,
        transform: `translateY(${(1 - p) * 12}px)`,
        background: mine ? 'rgba(194,65,12,0.08)' : PAPER,
        border: `1px solid ${mine ? ACCENT_LINE : BORDER}`,
        borderRadius: mine ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
        padding: '16px 18px',
        fontFamily: SERIF,
        fontSize: 24,
        lineHeight: 1.5,
        color: INK,
      }}
    >
      {text}
    </div>
  );
}

function ChatMedia({ kind, title, body, cover, enter, dragging }) {
  const p = spring({
    frame: Math.max(0, enter) * 30,
    fps: 30,
    config: { damping: 18, mass: 0.75, stiffness: 90 },
  });
  if (p < 0.01) return null;
  return (
    <div
      style={{
        alignSelf: 'stretch',
        opacity: p * (dragging ? 0.35 : 1),
        transform: `translateY(${(1 - p) * 10}px)`,
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 14,
        overflow: 'hidden',
        boxShadow: '0 10px 24px rgba(31,27,24,0.08)',
      }}
    >
      {cover ? (
        <div style={{ height: 132, position: 'relative', background: '#E8D5C0' }}>
          <Img src={cover} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      ) : null}
      <div style={{ padding: '14px 16px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span style={{ color: FAINT, display: 'flex', marginTop: 4 }}>
          <Icon name="grip" size={20} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.14em', color: ACCENT, textTransform: 'uppercase' }}>
            {kind}
          </div>
          <div style={{ marginTop: 6, fontFamily: SERIF, fontSize: 22, fontWeight: 700, color: INK, lineHeight: 1.35 }}>{title}</div>
          {body ? (
            <div style={{ marginTop: 8, fontFamily: SERIF, fontSize: 18, lineHeight: 1.5, color: MUTED }}>{body}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ChatPanel({ sec, story, isCjk }) {
  const slide = interpolate(sec, [TL.chatAt, TL.chatAt + 0.55, TL.chatHold, TL.chatOut], [560, 0, 0, 560], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });
  const op = interpolate(sec, [TL.chatAt, TL.chatAt + 0.32, TL.chatHold, TL.chatOut], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  if (op < 0.01) return null;
  const wikiDragging = sec >= TL.dragWiki0 && sec <= TL.dragWiki1 + 0.15;
  const imageDragging = sec >= TL.dragImage0 && sec <= TL.dragImage1 + 0.15;
  const excerptDragging = sec >= TL.dragExcerpt0 && sec <= TL.dragExcerpt1 + 0.15;
  const voiceOn = sec >= TL.c1Click && sec < TL.c1Click + 2.6;
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: 500,
        transform: `translateX(${slide}px)`,
        opacity: op,
        background: 'rgba(255,255,255,0.96)',
        borderLeft: `1px solid ${BORDER}`,
        boxShadow: '-18px 0 40px rgba(31,27,24,0.08)',
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: SANS,
      }}
    >
      <div
        style={{
          height: 76,
          padding: '0 22px',
          borderBottom: `1px solid ${BORDER}`,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexShrink: 0,
        }}
      >
        <AliAvatar size={44} />
        <div>
          <div style={{ fontSize: 24, fontWeight: 700, color: INK }}>{isCjk ? '阿狸' : 'Ali'}</div>
          <div style={{ fontSize: 15, color: FAINT, marginTop: 2 }}>{isCjk ? '房间里的卡片是这一轮的记忆' : 'Cards in the room are this turn’s memory'}</div>
        </div>
      </div>
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14, overflow: 'hidden', flex: 1, minHeight: 0 }}>
        <ChatMsg mine text={story.userLook} enter={sec - TL.user1At} />
        <div style={{ opacity: excerptDragging ? 0.35 : 1 }}>
          <ChatMsg mine={false} text={story.aliKeep} enter={sec - TL.ali1At} />
        </div>
        <ChatMsg mine={false} text={story.aliKeep2} enter={sec - TL.ali2At} />
        <ChatMsg mine text={story.userSearch} enter={sec - TL.user2At} />
        <ChatMedia
          kind={isCjk ? '百科 · 可拖到画布' : 'Wiki · drag to canvas'}
          title={story.wikiTitle}
          body={story.wikiBody}
          enter={sec - TL.wikiChatAt}
          dragging={wikiDragging}
        />
        <ChatMedia
          kind={isCjk ? '图片 · 可拖到画布' : 'Image · drag to canvas'}
          title={story.imageCaption}
          cover={oldStreetImg}
          enter={sec - TL.imageChatAt}
          dragging={imageDragging}
        />
      </div>
      <div style={{ flexShrink: 0, padding: '10px 18px 18px' }}>
        {voiceOn ? (
          <p style={{ margin: '0 0 10px 4px', fontSize: 16, color: ACCENT, letterSpacing: '0.04em' }}>
            {isCjk ? '正在听写…' : 'Listening…'}
          </p>
        ) : null}
        <div
          style={{
            display: 'flex',
            gap: 8,
            border: `1px solid ${BORDER}`,
            borderRadius: 14,
            background: CARD,
            padding: '10px 10px 10px 16px',
            boxShadow: '0 2px 8px rgba(31,27,24,0.04)',
          }}
        >
          <div style={{ flex: 1, fontFamily: SERIF, fontSize: 22, color: FAINT_2, paddingTop: 8 }}>
            {isCjk ? '输入消息…' : 'Message…'}
          </div>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 999,
              background: voiceOn ? ACCENT : 'transparent',
              color: voiceOn ? '#fff' : MUTED,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              alignSelf: 'flex-end',
            }}
          >
            <Icon name="mic" size={18} />
          </div>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 999,
              background: PAPER_2,
              color: MUTED,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              alignSelf: 'flex-end',
            }}
          >
            <Icon name="arrowUp" size={18} />
          </div>
        </div>
      </div>
    </div>
  );
}

function WorldBackdrop() {
  return (
    <>
      <div style={{ position: 'absolute', left: -600, top: -500, width: 5000, height: 3000, background: PAPER }} />
      <div
        style={{
          position: 'absolute',
          left: -600,
          top: -500,
          width: 5000,
          height: 3000,
          backgroundImage:
            'radial-gradient(circle, rgba(31,27,24,0.10) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
          opacity: 0.35,
        }}
      />
    </>
  );
}

function AliBubble({ x, y, w, text, enter, leave }) {
  const { locale } = usePromo();
  const isCjk = String(locale).startsWith('zh');
  const p = spring({
    frame: Math.max(0, enter) * 30,
    fps: 30,
    config: { damping: 16, mass: 0.7, stiffness: 110 },
  });
  const opacity = Math.min(p, leave);
  if (opacity < 0.01) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        opacity,
        transform: `translateY(${(1 - p) * 18}px) scale(${interpolate(p, [0, 1], [0.9, 1])})`,
        transformOrigin: '0% 100%',
        zIndex: 6,
      }}
    >
      <div
        style={{
          background: CARD,
          border: `1px solid ${BORDER}`,
          borderRadius: 18,
          padding: '18px 20px',
          boxShadow: '0 20px 50px rgba(31,27,24,0.14)',
          fontFamily: SANS,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <AliAvatar size={30} />
          <span style={{ fontSize: 15, fontWeight: 700, color: ACCENT }}>{isCjk ? '阿狸' : 'Ali'}</span>
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.18em',
              color: FAINT,
              textTransform: 'uppercase',
            }}
          >
            {isCjk ? '问卡' : 'Ask card'}
          </span>
        </div>
        <div style={{ fontFamily: SERIF, fontSize: 19, lineHeight: 1.6, color: INK }}>{text}</div>
      </div>
    </div>
  );
}

// ----- media cards the fox brings back from the web ---------------
function WikiCard({ x, y, w = 420, h = 280, title, body, meta, loaded }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        boxShadow: '0 18px 40px rgba(31,27,24,0.10)',
        padding: 22,
        fontFamily: SANS,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexShrink: 0 }}>
        <span style={{ color: ACCENT, display: 'flex' }}>
          <Icon name="globe" size={15} />
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.14em', color: ACCENT, textTransform: 'uppercase' }}>
          {meta}
        </span>
        <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 11, color: FAINT_2, flexShrink: 0 }}>wikipedia.org ↗</span>
      </div>
      <div style={{ height: 4, background: PAPER_2, borderRadius: 2, overflow: 'hidden', marginBottom: 12, flexShrink: 0 }}>
        <div
          style={{
            height: 4,
            width: `${Math.min(1, loaded) * 100}%`,
            background: ACCENT,
            borderRadius: 2,
          }}
        />
      </div>
      <div style={{ opacity: loaded >= 1 ? 1 : 0.15, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div
          style={{
            fontFamily: SERIF,
            fontSize: 22,
            fontWeight: 700,
            color: INK,
            lineHeight: 1.3,
            overflowWrap: 'break-word',
          }}
        >
          {title}
        </div>
        <div
          style={{
            marginTop: 10,
            fontFamily: SERIF,
            fontSize: 15,
            lineHeight: 1.55,
            color: INK_SOFT,
            overflow: 'hidden',
          }}
        >
          {body}
        </div>
      </div>
    </div>
  );
}

function ImageCard({ x, y, w = 360, h = 300, caption, cover }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        boxShadow: '0 18px 40px rgba(31,27,24,0.10)',
        overflow: 'hidden',
        fontFamily: SANS,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ flex: 1, position: 'relative', background: '#E8D5C0' }}>
        {cover ? (
          <Img src={cover} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : null}
      </div>
      <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: ACCENT, display: 'flex' }}>
          <Icon name="scan" size={14} />
        </span>
        <span style={{ fontSize: 14, color: INK_SOFT, fontWeight: 600 }}>{caption}</span>
      </div>
    </div>
  );
}

function VideoCard({ x, y, w = 420, h = 280, meta, sec, cover }) {
  const pulse = 1 + Math.sin(sec * 2.2) * 0.05;
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        background: '#211D19',
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        boxShadow: '0 18px 40px rgba(31,27,24,0.14)',
        overflow: 'hidden',
        fontFamily: SANS,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {cover ? (
          <Img src={cover} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : null}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(180deg, rgba(33,29,25,0.15) 0%, rgba(33,29,25,0.45) 100%)',
          }}
        />
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 999,
            background: ACCENT,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: `scale(${pulse})`,
            boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
            zIndex: 1,
          }}
        >
          <Icon name="play" size={26} color="#fff" strokeWidth={2.2} />
        </div>
      </div>
      <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.16)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: 4, width: '38%', background: ACCENT, borderRadius: 2 }} />
        </div>
        <span style={{ fontFamily: MONO, fontSize: 12, color: 'rgba(255,255,255,0.75)' }}>00:42</span>
      </div>
      <div style={{ padding: '0 16px 12px', fontSize: 13, color: 'rgba(255,255,255,0.65)', fontWeight: 600 }}>
        {meta}
      </div>
    </div>
  );
}

function SelectRing({ x, y, w, h, rotate = 0, t }) {
  if (t < 0.01) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: x - 8,
        top: y - 8,
        width: w + 16,
        height: h + 16,
        borderRadius: 8,
        border: `3px solid ${ACCENT}`,
        boxShadow: `0 0 0 ${5 * t}px rgba(194,65,12,${0.16 * t})`,
        opacity: t,
        transform: `rotate(${rotate}deg)`,
        pointerEvents: 'none',
        zIndex: 7,
      }}
    />
  );
}

// ----- small auto-generated topic chip ------------------------------
function KeywordChip({ x, y, w = 180, h = 64, text, enter, dim = 1 }) {
  const p = enter;
  if (p * dim < 0.01) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        opacity: p * dim,
        transform: `translateY(${(1 - p) * 14}px) scale(${interpolate(p, [0, 1], [0.8, 1])})`,
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 999,
        boxShadow: '0 10px 26px rgba(31,27,24,0.08)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: SERIF,
        fontSize: 19,
        color: INK_SOFT,
        zIndex: 3,
      }}
    >
      {text}
    </div>
  );
}

// ----- small user text / voice card ----------------------------------
function VoiceNote({ x, y, w, h = 110, text, icon = 'mic', dim = 1 }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 14,
        boxShadow: '0 14px 34px rgba(31,27,24,0.10)',
        padding: '18px 22px',
        fontFamily: SERIF,
        fontSize: 20,
        lineHeight: 1.55,
        color: INK,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        zIndex: 4,
        opacity: dim,
      }}
    >
      {icon ? (
        <span style={{ color: ACCENT, display: 'flex', marginTop: 4, flexShrink: 0 }}>
          <Icon name={icon} size={17} />
        </span>
      ) : null}
      <span>{text}</span>
    </div>
  );
}

// ----- the discussion card: user and the fox think together ----------
function DialogueCard({ x, y, w = 680, h = 460, rows, sec }) {
  const { locale } = usePromo();
  const isCjk = String(locale).startsWith('zh');
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 14,
        boxShadow: '0 24px 60px rgba(31,27,24,0.14)',
        padding: '22px 26px',
        fontFamily: SANS,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        zIndex: 5,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 12, borderBottom: `1px solid ${PAPER_2}` }}>
        <AliAvatar size={32} />
        <span style={{ fontSize: 16, fontWeight: 700, color: INK }}>{isCjk ? '阿狸' : 'Ali'}</span>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', color: FAINT, textTransform: 'uppercase' }}>
          {isCjk ? '问卡 · 讨论中' : 'Ask card · In discussion'}
        </span>
        <span style={{ marginLeft: 'auto', color: ACCENT, display: 'flex' }}>
          <Icon name="sparkles" size={16} />
        </span>
      </div>
      {rows.map((row, i) => {
        const t = spring({
          frame: Math.max(0, (sec - row.at) * 30),
          fps: 30,
          config: { damping: 18, mass: 0.7, stiffness: 100 },
        });
        if (t < 0.01) return null;
        const mine = row.who === 'user';
        return (
          <div
            key={i}
            style={{
              alignSelf: mine ? 'flex-end' : 'flex-start',
              maxWidth: '82%',
              opacity: t,
              transform: `translateY(${(1 - t) * 12}px)`,
              background: mine ? 'rgba(194,65,12,0.08)' : PAPER,
              border: `1px solid ${mine ? ACCENT_LINE : BORDER}`,
              borderRadius: mine ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
              padding: '12px 18px',
              fontFamily: SERIF,
              fontSize: 20,
              lineHeight: 1.55,
              color: INK,
            }}
          >
            {row.text}
          </div>
        );
      })}
    </div>
  );
}

// ----- outline card: the structure before the article ----------------
function OutlineCard({ x, y, w = 560, h = 380, title, items, genLabel, press, enter }) {
  const p = enter;
  if (p < 0.01) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        opacity: p,
        transform: `scale(${interpolate(p, [0, 1], [0.85, 1])}) translateY(${(1 - p) * 24}px)`,
        transformOrigin: '0% 50%',
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 14,
        boxShadow: '0 26px 60px rgba(31,27,24,0.16)',
        padding: 28,
        fontFamily: SANS,
        display: 'flex',
        flexDirection: 'column',
        zIndex: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <span style={{ color: ACCENT, display: 'flex' }}>
          <Icon name="penLine" size={15} />
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase', color: ACCENT }}>
          合成文章 · 大纲
        </span>
      </div>
      <div style={{ fontFamily: SERIF, fontSize: 30, fontWeight: 700, color: INK, lineHeight: 1.3 }}>{title}</div>
      <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {items.map((it, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, fontFamily: SERIF, fontSize: 19, color: INK_SOFT }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: ACCENT, flexShrink: 0 }} />
            {it}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'flex-end' }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 26px',
            borderRadius: 999,
            background: ACCENT,
            color: '#fff',
            fontSize: 16,
            fontWeight: 700,
            transform: `scale(${1 - press * 0.1})`,
            boxShadow: '0 12px 30px rgba(194,65,12,0.3)',
          }}
        >
          <Icon name="sparkles" size={15} color="#fff" />
          {genLabel}
        </span>
      </div>
    </div>
  );
}

function NarrativeWorld({ sec }) {
  const { copy, scenes, locale } = usePromo();
  const isCjk = String(locale).startsWith('zh');
  const story = copy.story || {};
  const openingEnd = findScene(scenes, 'opening')?.end ?? 6;
  const worldIn = interpolate(sec, [openingEnd, openingEnd + 0.95], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });
  const worldOutFade = interpolate(sec, [TL.worldOut, TL.worldOut + 0.8], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const worldFade = worldIn * worldOutFade;
  if (worldFade < 0.01) return null;

  const ease = Easing.bezier(0.42, 0, 0.2, 1);
  const fx = interpolate(sec, CAM.t, CAM.fx, { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  const fy = interpolate(sec, CAM.t, CAM.fy, { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  const s = interpolate(sec, CAM.t, CAM.s, { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });

  const pop = (at, damping = 18, stiffness = 90) =>
    spring({ frame: Math.max(0, (sec - at)) * 30, fps: 30, config: { damping, mass: 0.85, stiffness } });
  const bob = (i, amp = 5) => Math.sin(sec * 1.4 + i * 1.7) * amp;

  const cursorEase = Easing.inOut(Easing.cubic);
  const cursorBeat = (t0, tc, t1, fromX, fromY, toX, toY) => ({
    x: interpolate(sec, [t0, tc - 0.15], [fromX, toX], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: cursorEase }),
    y: interpolate(sec, [t0, tc - 0.15], [fromY, toY], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: cursorEase }),
    click: smoothFade(sec, [tc, tc + 0.22, tc + 0.22, tc + 0.5]),
    op: smoothFade(sec, [t0 - 0.25, t0, t1 - 0.4, t1]),
  });
  const c1 = cursorBeat(TL.c1Start, TL.c1Click, TL.c1Out, 1480, 720, 1834, 1006);
  c1.pressed = smoothFade(sec, [TL.c1Click, TL.c1Click + 0.18, TL.c1Click + 2.2, TL.c1Click + 2.7]);
  const c3 = cursorBeat(TL.c3Start, TL.c3Click, TL.c3Out, 1180, 700, 1044, 1027);

  const toScreen = (wx, wy) => [STAGE.width / 2 + (wx - fx) * s, STAGE.height / 2 + (wy - fy) * s];
  const GRAB = { x: 52, y: 28 };
  const TIP_GRAB = { x: 18, y: 16 };
  const dragP = (t0, t1) =>
    interpolate(sec, [t0, t1], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: cursorEase,
    });
  const lerp = (a, b, p) => a + (b - a) * p;
  const cursorOnWorld = (wx, wy, tReach, t0, t1) => {
    const [sx, sy] = toScreen(wx, wy);
    return {
      x: sx - TIP_GRAB.x,
      y: sy - TIP_GRAB.y,
      click: 0,
      kind: 'grab',
      pressed: smoothFade(sec, [t0 - 0.06, t0, t1, t1 + 0.14]),
      op: smoothFade(sec, [tReach - 0.12, tReach, t1 + 0.06, t1 + 0.38]),
    };
  };

  const photoP = dragP(TL.dragPhoto0, TL.dragPhoto1);
  const noteP = dragP(TL.dragNote0, TL.dragNote1);
  const photoX = lerp(POS.photoOut.x, POS.photoIn.x, photoP);
  const photoY = lerp(POS.photoOut.y, POS.photoIn.y, photoP);
  const noteX = lerp(POS.noteOut.x, POS.noteIn.x, noteP);
  const noteY = lerp(POS.noteOut.y, POS.noteIn.y, noteP);
  const photoDragging = sec >= TL.dragPhoto0 - 0.02 && sec <= TL.dragPhoto1 + 0.04;
  const noteDragging = sec >= TL.dragNote0 - 0.02 && sec <= TL.dragNote1 + 0.04;

  const photoGrabX = interpolate(
    sec,
    [TL.dragPhotoReach, TL.dragPhoto0, TL.dragPhoto1],
    [POS.photoOut.x + GRAB.x, POS.photoOut.x + GRAB.x, POS.photoIn.x + GRAB.x],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: cursorEase },
  );
  const photoGrabY = interpolate(
    sec,
    [TL.dragPhotoReach, TL.dragPhoto0, TL.dragPhoto1],
    [POS.photoOut.y + GRAB.y, POS.photoOut.y + GRAB.y, POS.photoIn.y + GRAB.y],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: cursorEase },
  );
  const noteGrabX = interpolate(
    sec,
    [TL.dragNoteReach, TL.dragNote0, TL.dragNote1],
    [POS.noteOut.x + GRAB.x, POS.noteOut.x + GRAB.x, POS.noteIn.x + GRAB.x],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: cursorEase },
  );
  const noteGrabY = interpolate(
    sec,
    [TL.dragNoteReach, TL.dragNote0, TL.dragNote1],
    [POS.noteOut.y + GRAB.y, POS.noteOut.y + GRAB.y, POS.noteIn.y + GRAB.y],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: cursorEase },
  );
  const cPhoto = cursorOnWorld(photoGrabX, photoGrabY, TL.dragPhotoReach, TL.dragPhoto0, TL.dragPhoto1);
  const cNote = cursorOnWorld(noteGrabX, noteGrabY, TL.dragNoteReach, TL.dragNote0, TL.dragNote1);

  const dragScreenToWorld = (t0, t1, sx1, sy1, wx2, wy2) => {
    const p = dragP(t0, t1);
    const [sx2, sy2] = toScreen(wx2, wy2);
    return {
      x: lerp(sx1, sx2, p) - TIP_GRAB.x,
      y: lerp(sy1, sy2, p) - TIP_GRAB.y,
      click: 0,
      kind: 'grab',
      pressed: smoothFade(sec, [t0, t0 + 0.12, t1, t1 + 0.18]),
      op: smoothFade(sec, [t0 - 0.3, t0, t1 + 0.12, t1 + 0.45]),
    };
  };
  const cExcerpt = dragScreenToWorld(TL.dragExcerpt0, TL.dragExcerpt1, 1688, 210, POS.excerpt.x + GRAB.x, POS.excerpt.y + GRAB.y);
  const cWiki = dragScreenToWorld(TL.dragWiki0, TL.dragWiki1, 1688, 520, POS.wiki.x + GRAB.x, POS.wiki.y + GRAB.y);
  const cImage = dragScreenToWorld(TL.dragImage0, TL.dragImage1, 1688, 720, POS.image.x + GRAB.x, POS.image.y + GRAB.y);

  const marqueeP = interpolate(sec, [TL.select2At - 1.55, TL.select2At - 0.12], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: cursorEase,
  });
  const marqueeT = smoothFade(sec, [TL.select2At - 1.55, TL.select2At - 1.32, TL.select2At + 0.2, TL.select2At + 0.55]);
  const [cMx, cMy] = toScreen(
    POS.room.x + 16 + (POS.room.w - 32) * marqueeP,
    POS.room.y + 16 + (POS.room.h - 48) * marqueeP,
  );
  const cMarquee = {
    x: cMx - TIP_GRAB.x,
    y: cMy - TIP_GRAB.y,
    click: 0,
    kind: 'grab',
    pressed: smoothFade(sec, [TL.select2At - 1.55, TL.select2At - 1.4, TL.select2At - 0.12, TL.select2At + 0.04]),
    op: smoothFade(sec, [TL.select2At - 1.85, TL.select2At - 1.55, TL.select2At, TL.select2At + 0.35]),
  };

  const toolbarActive = sec >= TL.select2At ? 'compose' : null;
  const toolbarFilled = toolbarActive === 'compose';

  const wikiLoaded = interpolate(sec, [TL.wikiAt + 0.05, TL.wikiAt + 0.9], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const selected = smoothFade(sec, [TL.select2At, TL.select2At + 0.4, TL.worldOut, TL.worldOut + 0.5]);
  const dimT = smoothFade(sec, [TL.dimAt, TL.dimAt + 0.55, 999, 1000]);
  const dim = 1 - dimT * 0.72;
  const genPress = smoothFade(sec, [TL.genPressAt, TL.genPressAt + 0.12, TL.genPressAt + 0.12, TL.genPressAt + 0.35]);
  const roomT = pop(TL.roomAt);
  const outsideT = pop(TL.outsideAt);
  const noteText = story.noteOwn || '';

  const cursors = [cPhoto, cNote, c1, cExcerpt, cWiki, cImage, cMarquee, c3];

  return (
    <AbsoluteFill style={{ opacity: worldFade }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `translate(${STAGE.width / 2 - fx * s}px, ${STAGE.height / 2 - fy * s}px) scale(${s})`,
          transformOrigin: '0 0',
        }}
      >
        <WorldBackdrop />
        <WorkRoom
          x={POS.room.x}
          y={POS.room.y}
          w={POS.room.w}
          h={POS.room.h}
          label={isCjk ? '阿狸的房间' : "Ali's room"}
          t={roomT}
        />

        {marqueeT > 0.01 ? (
          <div
            style={{
              position: 'absolute',
              left: POS.room.x + 16,
              top: POS.room.y + 16,
              width: (POS.room.w - 32) * marqueeP,
              height: (POS.room.h - 48) * marqueeP,
              border: `2px dashed ${ACCENT}`,
              background: 'rgba(194,65,12,0.05)',
              borderRadius: 6,
              zIndex: 8,
              pointerEvents: 'none',
              opacity: marqueeT,
            }}
          />
        ) : null}

        <div style={{ position: 'absolute', inset: 0, transform: `translateY(${bob(1, 3)}px)` }}>
          <AskCard x={POS.ask.x} y={POS.ask.y} w={POS.ask.w} h={POS.ask.h} rotate={-1.2} />
        </div>

        <div style={{ position: 'absolute', inset: 0, transform: `translateY(${bob(0, 3)}px)` }}>
          <div
            style={{
              position: 'absolute',
              left: POS.q.x,
              top: POS.q.y,
              width: POS.q.w,
              height: POS.q.h,
              background: CARD,
              border: `2px solid ${BORDER}`,
              boxShadow: '0 18px 40px rgba(31,27,24,0.10)',
              padding: '22px 26px',
              fontFamily: SANS,
              display: 'flex',
              flexDirection: 'column',
              transform: 'rotate(0.4deg)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ color: ACCENT, display: 'flex' }}>
                <Icon name="mapPin" size={15} />
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase', color: ACCENT }}>
                {isCjk ? '问题' : 'QUESTION'}
              </span>
            </div>
            <div
              style={{
                fontFamily: SERIF,
                fontSize: 26,
                fontWeight: 700,
                color: INK,
                lineHeight: 1.35,
                opacity: interpolate(worldIn, [0.72, 1], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
              }}
            >
              {story.question}
            </div>
          </div>
        </div>

        <div
          style={{
            position: 'absolute',
            inset: 0,
            opacity: outsideT,
            zIndex: photoDragging ? 8 : 4,
          }}
        >
          <ImageCard x={photoX} y={photoY} w={POS.photoOut.w} h={POS.photoOut.h} caption={story.photoCaption} cover={childhoodHomeImg} />
        </div>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            opacity: outsideT,
            zIndex: noteDragging ? 8 : 4,
          }}
        >
          <NoteCard x={noteX} y={noteY} w={POS.noteOut.w} h={POS.noteOut.h} rotate={0} body={noteText} />
        </div>
        <div style={{ position: 'absolute', inset: 0, opacity: outsideT * dim }}>
          <ThemeCard x={POS.themeOut.x} y={POS.themeOut.y} w={POS.themeOut.w} h={220} rotate={0} title={story.themeOutside} body={isCjk ? '先留在房间外面' : 'Waiting outside the room'} />
        </div>

        <div style={{ position: 'absolute', inset: 0, opacity: pop(TL.excerptAt), transform: `translateY(${bob(4, 3)}px)` }}>
          <VoiceNote x={POS.excerpt.x} y={POS.excerpt.y} w={POS.excerpt.w} h={POS.excerpt.h} text={story.aliKeep} icon="sparkles" />
        </div>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            opacity: pop(TL.wikiAt),
            transform: `translateY(${bob(5, 3)}px) scale(${interpolate(pop(TL.wikiAt), [0, 1], [0.92, 1])})`,
            transformOrigin: `${POS.wiki.x}px ${POS.wiki.y}px`,
          }}
        >
          <WikiCard
            x={POS.wiki.x}
            y={POS.wiki.y}
            w={POS.wiki.w}
            h={POS.wiki.h}
            title={story.wikiTitle}
            body={story.wikiBody}
            meta={story.wikiMeta}
            loaded={wikiLoaded}
          />
        </div>
        <div style={{ position: 'absolute', inset: 0, opacity: pop(TL.imageAt), transform: `translateY(${bob(6, 3)}px)` }}>
          <ImageCard x={POS.image.x} y={POS.image.y} w={POS.image.w} h={POS.image.h} caption={story.imageCaption} cover={oldStreetImg} />
        </div>

        <SelectRing x={POS.q.x} y={POS.q.y} w={POS.q.w} h={POS.q.h} rotate={0.4} t={selected} />
        <SelectRing x={POS.photoIn.x} y={POS.photoIn.y} w={POS.photoIn.w} h={POS.photoIn.h} t={selected} />
        <SelectRing x={POS.noteIn.x} y={POS.noteIn.y} w={POS.noteIn.w} h={POS.noteIn.h} t={selected} />
        <SelectRing x={POS.excerpt.x} y={POS.excerpt.y} w={POS.excerpt.w} h={POS.excerpt.h} t={selected} />
        <SelectRing x={POS.wiki.x} y={POS.wiki.y} w={POS.wiki.w} h={POS.wiki.h} t={selected} />
        <SelectRing x={POS.image.x} y={POS.image.y} w={POS.image.w} h={POS.image.h} t={selected} />

        <OutlineCard
          x={POS.outline.x}
          y={POS.outline.y}
          w={POS.outline.w}
          h={POS.outline.h}
          title={story.outlineTitle}
          items={story.outline || []}
          genLabel={story.generateLabel}
          press={genPress}
          enter={pop(TL.outlineAt, 17, 80)}
        />
      </div>

      <Brand />
      <SideRail />
      <TopRightToolbar />
      <BottomToolbar active={toolbarActive} filled={toolbarFilled} />
      <ZoomToolbar />
      <ChatPanel sec={sec} story={story} isCjk={isCjk} />

      {cursors.map((c, i) => (
        <div key={i} style={{ opacity: c.op }}>
          <MouseCursor x={c.x} y={c.y} clicking={c.click} pressed={c.pressed || 0} kind={c.kind || 'pointer'} uid={i} />
        </div>
      ))}
    </AbsoluteFill>
  );
}

// ----- V3 closing: one line + domain -------------------------
function ClosingScene({ sec, ctaUrl }) {
  const { copy, locale } = usePromo();
  const story = copy.story || {};
  const isCjk = String(locale).startsWith('zh');
  const brandName = copy.brandTitle || (isCjk ? '雪泥' : 'Spoor');
  const rise = (at, damping = 20) =>
    spring({ frame: Math.max(0, (sec - at) * 30), fps: 30, config: { damping, mass: 0.8, stiffness: 90 } });
  const logoT = rise(0.3);
  const lineT = rise(1.15);
  const subT = rise(2.1);
  return (
    <AbsoluteFill style={{ background: PAPER }}>
      <WarmGlow sec={sec} size={1000} top="46%" strength={0.14} />
      <div style={{ position: 'absolute', left: '50%', top: '46%', transform: 'translate(-50%, -50%)', textAlign: 'center', width: 1200 }}>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16, marginBottom: 30, opacity: logoT, transform: `scale(${interpolate(logoT, [0, 1], [0.8, 1])})` }}>
          <Img src={spoorLogo} style={{ width: 72, height: 72, objectFit: 'contain', filter: 'drop-shadow(0 14px 32px rgba(194,65,12,0.28))' }} />
          <span style={{ fontFamily: isCjk ? FANGSONG : SERIF, fontSize: 44, fontWeight: 400, color: INK, letterSpacing: isCjk ? '0.12em' : '-0.02em' }}>{brandName}</span>
        </div>
        <div style={{ fontFamily: FANGSONG, fontSize: 60, fontWeight: 400, lineHeight: 1.45, color: INK, opacity: lineT, transform: `translateY(${(1 - lineT) * 16}px)` }}>
          {story.closingLine}
        </div>
        <div style={{ marginTop: 36, opacity: subT, transform: `translateY(${(1 - subT) * 12}px)` }}>
          <div style={{ fontFamily: FANGSONG, fontSize: 40, color: ACCENT, letterSpacing: '0.1em' }}>{ctaUrl}</div>
        </div>
      </div>
    </AbsoluteFill>
  );
}

// ----- main inner ------------------------------------------------
function SpoorPromoV3Inner({
  title,
  subtitle,
  ctaUrl = 'spoor.ink',
  ctaText,
  audioUrl = '',
  timestampSegments = [],
  locale = 'zh-v3',
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sec = frame / fps;
  const { copy, scenes } = usePromo();
  const audioSrc = resolvePromoAudioSrc(audioUrl, locale);
  const scene = currentScene(sec, scenes);
  const openingScene = findScene(scenes, 'opening') || scene;
  const caption = findCaption(timestampSegments, sec);

  return (
    <AbsoluteFill
      style={{
        background: PAPER,
        fontFamily: SERIF,
        color: INK,
        overflow: 'hidden',
      }}
    >
      {audioSrc ? <Audio src={audioSrc} volume={1} /> : null}

      <NarrativeWorld sec={sec} />

      <SceneLayer window={[-0.5, 0.5, (openingScene.end ?? 6) + 1.0, (openingScene.end ?? 6) + 1.2]} sec={sec}>
        <OpeningScene scene={openingScene} sec={sec} />
      </SceneLayer>

      {scene.id !== 'opening' && scene.id !== 'closing' ? (
        <PromoCaption caption={caption} sec={sec} />
      ) : null}

      <SceneLayer window={[TL.worldOut, TL.worldOut + 0.4, TL.worldOut + 10.2, TL.worldOut + 10.7]} sec={sec}>
        <EditorScene sec={Math.max(0, sec - (TL.worldOut + 0.08))} />
      </SceneLayer>

      <SceneLayer window={[TL.worldOut + 9.9, TL.worldOut + 10.4, TL.worldOut + 16.8, TL.worldOut + 17.2]} sec={sec}>
        <ClosingScene sec={Math.max(0, sec - (TL.worldOut + 10.0))} ctaUrl={ctaUrl} />
      </SceneLayer>

      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(130% 100% at 50% 42%, transparent 62%, rgba(31,27,24,0.07) 100%)',
          pointerEvents: 'none',
          zIndex: 90,
        }}
      />
    </AbsoluteFill>
  );
}

function SceneLayer({ window: [a, b, c, d], sec, children }) {
  const hardOut = d <= c + 0.02;
  if (hardOut && sec >= c) return null;
  const opacity = hardOut
    ? interpolate(sec, [a, Math.max(b, a + 1 / 30)], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
    : smoothFade(sec, [a, b, c, d]);
  if (opacity < 0.01) return null;
  // Incoming scenes settle from a whisper of scale — reads as depth, not a cut.
  const settle = interpolate(opacity, [0, 1], [1.012, 1]);
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        opacity,
        transform: `scale(${settle})`,
      }}
    >
      {children}
    </div>
  );
}

// ----- public exports -------------------------------------------
export const SpoorPromoV3 = ({
  locale = 'zh-v3',
  title,
  subtitle,
  brandLabel,
  ctaUrl = 'spoor.ink',
  ctaText,
  audioUrl = '',
  timestampSegments = [],
}) => {
  const copy = useMemo(() => getPromoCopy(locale), [locale]);
  const personas = useMemo(
    () =>
      copy.agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        role: agent.role,
        reply: agent.reply,
        prompt: agent.prompt,
      })),
    [copy],
  );
  const ctx = useMemo(
    () => ({ copy, scenes: copy.scenes, locale, personas }),
    [copy, locale, personas],
  );

  return (
    <PromoContext.Provider value={ctx}>
      <SpoorPromoV3Inner
        title={title ?? copy.brandTitle}
        subtitle={subtitle ?? copy.brandSubtitle}
        ctaUrl={ctaUrl}
        ctaText={ctaText ?? copy.ctaText}
        audioUrl={audioUrl}
        timestampSegments={timestampSegments}
        locale={locale}
      />
    </PromoContext.Provider>
  );
};

export const SpoorPromoV3ZH = (props) => <SpoorPromoV3 locale="zh-v3" {...props} />;

export const SpoorPromoV3EN = (props) => <SpoorPromoV3 locale="en-v3" {...props} />;
