import React, { createContext, useContext, useMemo } from 'react';
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

/** Resolve promo audio — bundled WAV is most reliable in Studio; staticFile is fallback. */
function resolvePromoAudioSrc(audioUrl, locale = 'en') {
  if (/^https?:\/\//i.test(audioUrl)) return audioUrl;
  if (audioUrl && (audioUrl.startsWith('/') || /^[a-zA-Z]:/.test(audioUrl))) return audioUrl;
  if (
    locale === 'en' &&
    (!audioUrl || audioUrl === 'audio/en.wav' || audioUrl === 'en.wav' || audioUrl === '../en.wav')
  ) {
    return promoEnAudio;
  }
  if (
    locale === 'zh' &&
    (!audioUrl || audioUrl === 'audio/zh.wav' || audioUrl === 'zh.wav' || audioUrl === '../zh.wav')
  ) {
    return promoZhAudio;
  }
  if (audioUrl) return staticFile(audioUrl);
  return '';
}

import mirrorIcon from './assets/agents/mirror.png';
import weavingIcon from './assets/agents/weaving.png';
import ironIcon from './assets/agents/iron.png';
import compassIcon from './assets/agents/compass.png';
import promoEnAudio from './assets/audio/en.wav';
import promoZhAudio from './assets/audio/zh.wav';
import { getPromoCopy } from './spoor-promo-copy.js';

export const SpoorPromoDuration = 1740;

const AGENT_ICONS = {
  interviewer: mirrorIcon,
  synthesizer: weavingIcon,
  stylist: ironIcon,
  futurist: compassIcon,
};

const PromoContext = createContext(null);

function usePromo() {
  const ctx = useContext(PromoContext);
  if (!ctx) throw new Error('usePromo must be used within SpoorPromo');
  return ctx;
}

function buildAgentPersonas(copy) {
  return copy.agents.map((agent) => ({ ...agent, icon: AGENT_ICONS[agent.id] }));
}

const ACCENT = '#C2410C';
const ACCENT_SOFT = 'rgba(194,65,12,0.10)';
const ACCENT_LINE = 'rgba(194,65,12,0.32)';
const INK = '#1F1B18';
const INK_SOFT = '#3F3833';
const MUTED = '#8B847C';
const LINE = '#E5DDD3';
const PAPER = '#FBF8F2';
const SERIF = 'Georgia, "Noto Serif SC", serif';
const SANS = 'Inter, "Helvetica Neue", "Noto Sans SC", sans-serif';

const STAGE = {
  width: 1920,
  height: 1080,
  margin: 96,
  headerY: 72,
  appX: 824,
  appY: 148,
  appW: 1000,
  appH: 700,
  copyX: 96,
  copyY: 248,
  copyW: 680,
  /** Vertical gap between app window bottom and subtitle block */
  captionGap: 72,
  captionH: 92,
  timelineY: 996,
};

STAGE.captionY = STAGE.appY + STAGE.appH + STAGE.captionGap;

const APP_SIDEBAR_W = 200;
const APP_CHROME_H = 44;
const APP_CONTENT_W = STAGE.appW - APP_SIDEBAR_W;
const APP_CONTENT_H = STAGE.appH - APP_CHROME_H;

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

/** Fade window aligned to a scene (for App UI layers). */
function sceneLayerWindow(scenes, id, padIn = 0.5, padOut = 0.6) {
  const [start, end] = sceneRange(scenes, id);
  return [start - padIn, start + padIn, end, end + padOut];
}

/** Map 0–1 progress inside a scene to absolute seconds. */
function withinScene(scenes, id, t0, t1) {
  const [start, end] = sceneRange(scenes, id);
  const span = end - start;
  return [start + span * t0, start + span * t1];
}

function promoDurationSec(scenes) {
  const last = scenes[scenes.length - 1];
  return last?.end ?? 58;
}

function scenePresence(scene, sec) {
  const fade = 0.75;
  return smoothFade(sec, [scene.start, scene.start + fade, scene.end - fade, scene.end]);
}

function findCaption(segments, sec) {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  return (
    segments.find((seg) => sec >= Number(seg.startSec) && sec < Number(seg.endSec)) ||
    segments[segments.length - 1]
  );
}

/** Renders title with optional `\n` line breaks (used for Chinese copy rhythm). */
function PromoTitle({ text, style }) {
  return <div style={{ whiteSpace: 'pre-line', ...style }}>{text}</div>;
}

function HeroCopy({ scene, sec }) {
  const { locale } = usePromo();
  const presence = scenePresence(scene, sec);
  const lift = interpolate(presence, [0, 1], [28, 0]);

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 380,
        textAlign: 'center',
        opacity: presence,
        transform: `translateY(${lift}px)`,
      }}
    >
      {scene.id !== 'opening' && scene.eyebrow ? (
        <div
          style={{
            fontFamily: SANS,
            fontSize: 18,
            letterSpacing: locale === 'zh' ? '0.14em' : '0.32em',
            textTransform: locale === 'zh' ? 'none' : 'uppercase',
            color: ACCENT,
            fontWeight: 600,
            marginBottom: 36,
          }}
        >
          {scene.eyebrow}
        </div>
      ) : null}
      <PromoTitle
        text={scene.title}
        style={{
          fontFamily: SERIF,
          fontSize: 116,
          lineHeight: locale === 'zh' ? 1.32 : 1.02,
          letterSpacing: locale === 'zh' ? '0.02em' : '-0.045em',
          color: INK,
          fontWeight: 500,
          margin: '0 auto',
          maxWidth: 1240,
        }}
      />
      <PromoTitle
        text={scene.caption}
        style={{
          marginTop: 38,
          fontFamily: SANS,
          fontSize: 26,
          lineHeight: locale === 'zh' ? 1.68 : 1.5,
          color: MUTED,
          maxWidth: 820,
          margin: '38px auto 0',
        }}
      />
    </div>
  );
}

function SplitCopy({ scene, sec }) {
  const { locale } = usePromo();
  const presence = scenePresence(scene, sec);
  const lift = interpolate(presence, [0, 1], [22, 0]);

  return (
    <div
      style={{
        position: 'absolute',
        left: STAGE.copyX,
        top: STAGE.copyY,
        width: STAGE.copyW,
        opacity: presence,
        transform: `translateY(${lift}px)`,
      }}
    >
      <div
        style={{
          fontFamily: SANS,
          fontSize: 17,
          letterSpacing: locale === 'zh' ? '0.12em' : '0.28em',
          textTransform: locale === 'zh' ? 'none' : 'uppercase',
          color: ACCENT,
          fontWeight: 600,
          marginBottom: 28,
        }}
      >
        {scene.eyebrow}
      </div>
      <PromoTitle
        text={scene.title}
        style={{
          fontFamily: SERIF,
          fontSize: locale === 'zh' ? 72 : 78,
          lineHeight: locale === 'zh' ? 1.4 : 1.08,
          letterSpacing: locale === 'zh' ? '0.02em' : '-0.04em',
          color: INK,
          fontWeight: 500,
        }}
      />
      <PromoTitle
        text={scene.caption}
        style={{
          marginTop: 30,
          fontFamily: SANS,
          fontSize: 23,
          lineHeight: locale === 'zh' ? 1.72 : 1.55,
          color: MUTED,
          maxWidth: 600,
        }}
      />
    </div>
  );
}

function SceneLayer({ window: [a, b, c, d], sec, children }) {
  const opacity = smoothFade(sec, [a, b, c, d]);
  if (opacity < 0.01) return null;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        opacity,
        transition: 'opacity 0.4s ease',
      }}
    >
      {children}
    </div>
  );
}

const RECEIPT_PAPER = '#fcf8f9';
const JAGGED_TOP = {
  height: 10,
  width: '100%',
  background: `linear-gradient(-45deg, transparent 5px, ${RECEIPT_PAPER} 5px) bottom left, linear-gradient(45deg, transparent 5px, ${RECEIPT_PAPER} 5px) bottom left`,
  backgroundSize: '10px 10px',
  backgroundRepeat: 'repeat-x',
};
const JAGGED_BOTTOM = {
  height: 10,
  width: '100%',
  background: `linear-gradient(-45deg, ${RECEIPT_PAPER} 5px, transparent 5px) top right, linear-gradient(45deg, ${RECEIPT_PAPER} 5px, transparent 5px) top right`,
  backgroundSize: '10px 10px',
  backgroundRepeat: 'repeat-x',
};

function ReceiptNotePreview({ w, h, title, body, receipt, highlight }) {
  return (
    <div
      style={{
        width: w,
        height: h,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'ui-monospace, monospace',
        color: '#2c281f',
        boxShadow: highlight
          ? '0 20px 40px -10px rgba(0,0,0,0.12), 0 0 0 1px rgba(194,65,12,0.2)'
          : '0 20px 40px -10px rgba(0,0,0,0.1), 5px 0 15px -5px rgba(0,0,0,0.02), -5px 0 15px -5px rgba(0,0,0,0.02)',
        outline: '1px solid transparent',
      }}
    >
      <div style={JAGGED_TOP} />
      <div
        style={{
          flex: 1,
          background: RECEIPT_PAPER,
          padding: '14px 16px 12px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 0.04,
            fontSize: 120,
            pointerEvents: 'none',
          }}
        >
          ☕
        </div>
        <div style={{ textAlign: 'center', borderBottom: '2px dashed #c7c5bd', paddingBottom: 10, marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
            {receipt.header}
          </div>
          <div style={{ marginTop: 6, fontSize: 11, textTransform: 'uppercase' }}>{receipt.store}</div>
          <div style={{ marginTop: 8, fontSize: 10, lineHeight: 1.5 }}>{receipt.date}</div>
          <div style={{ fontSize: 10, lineHeight: 1.5 }}>{receipt.time}</div>
          <div style={{ fontSize: 10, lineHeight: 1.5 }}>{receipt.txn}</div>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            borderBottom: '1px dashed #c7c5bd',
            paddingBottom: 4,
          }}
        >
          <span>{receipt.colItem}</span>
          <span>{receipt.colAmt}</span>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 10,
            opacity: 0.85,
            marginTop: 2,
            marginBottom: 8,
          }}
        >
          <span style={{ paddingRight: 8 }}>{receipt.rowLabel}</span>
          <span>{receipt.rowValue ?? '—'}</span>
        </div>
        <div style={{ flex: 1, fontSize: 11, lineHeight: 1.45, position: 'relative', zIndex: 1 }}>{body}</div>
        <div style={{ borderTop: '2px dashed #c7c5bd', paddingTop: 10, textAlign: 'center', marginTop: 8 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              marginBottom: 6,
            }}
          >
            <span>{receipt.total}</span>
            <span>{receipt.paid}</span>
          </div>
          <div style={{ fontSize: 9, textTransform: 'uppercase', opacity: 0.8 }}>{receipt.thanks}</div>
          <div style={{ marginTop: 4, fontSize: 8, opacity: 0.55 }}>{receipt.policy}</div>
          <div
            style={{
              marginTop: 8,
              height: 32,
              width: '100%',
              opacity: 0.75,
              backgroundImage:
                'repeating-linear-gradient(90deg, #1b1b1c, #1b1b1c 2px, transparent 2px, transparent 4px, #1b1b1c 4px, #1b1b1c 5px, transparent 5px, transparent 8px, #1b1b1c 8px, #1b1b1c 12px, transparent 12px, transparent 14px)',
            }}
          />
          <div style={{ marginTop: 4, fontSize: 8, letterSpacing: '0.16em', opacity: 0.85 }}>{receipt.barcode}</div>
        </div>
      </div>
      <div style={JAGGED_BOTTOM} />
    </div>
  );
}

function NoteCard({ kind, x, y, w = 200, h = 120, title, body, highlight, receipt }) {
  if (kind === 'receipt' && receipt) {
    return (
      <div style={{ position: 'absolute', left: x, top: y }}>
        <ReceiptNotePreview w={w} h={h} title={title} body={body} receipt={receipt} highlight={highlight} />
      </div>
    );
  }

  const styles = {
    base: {
      width: w,
      height: h,
      borderRadius: 12,
      border: `1px solid ${highlight ? ACCENT_LINE : LINE}`,
      background: '#FFFFFF',
      boxShadow: highlight
        ? '0 0 0 1px rgba(194,65,12,0.18), 0 16px 36px rgba(31,27,24,0.10)'
        : '0 10px 26px rgba(31,27,24,0.06)',
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      fontFamily: SANS,
      color: INK,
    },
    glass: {
      width: w,
      height: h,
      borderRadius: 18,
      border: `1px solid ${ACCENT_LINE}`,
      background: 'linear-gradient(135deg, rgba(255,255,255,0.86), rgba(255,237,213,0.7))',
      boxShadow:
        '0 14px 36px rgba(31,27,24,0.10), inset 0 0 0 1px rgba(255,255,255,0.6)',
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      backdropFilter: 'blur(10px)',
      fontFamily: SANS,
      color: INK,
    },
    minimal: {
      width: w,
      height: h,
      borderRadius: 8,
      border: `1px solid ${LINE}`,
      background: '#F4F1ED',
      padding: 14,
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'ui-monospace, "JetBrains Mono", monospace',
      color: INK_SOFT,
      boxShadow: '0 6px 18px rgba(31,27,24,0.04)',
    },
    neo: {
      width: w,
      height: h,
      borderRadius: 4,
      border: '2px solid #1B1B1C',
      background: '#FFFFFF',
      padding: 18,
      display: 'flex',
      flexDirection: 'column',
      boxShadow: '6px 6px 0 0 #1B1B1C',
      fontFamily: SERIF,
      color: INK,
    },
  };

  const style = styles[kind] || styles.base;

  return (
    <div style={{ position: 'absolute', left: x, top: y }}>
      <div style={style}>
        {title ? (
          <div
            style={{
              fontSize: kind === 'minimal' ? 9 : 10,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: kind === 'neo' ? '#fff' : ACCENT,
              background: kind === 'neo' ? '#1B1B1C' : 'transparent',
              alignSelf: kind === 'neo' ? 'flex-start' : 'auto',
              padding: kind === 'neo' ? '3px 7px' : 0,
              marginBottom: 10,
              fontWeight: 700,
              fontFamily: SANS,
            }}
          >
            {title}
          </div>
        ) : null}
        <div
          style={{
            fontSize: kind === 'neo' ? 17 : kind === 'minimal' ? 12 : 14,
            lineHeight: 1.45,
            color: kind === 'minimal' ? INK_SOFT : INK,
            flex: 1,
          }}
        >
          {body}
        </div>
      </div>
    </div>
  );
}

const EDGE_GRAY = '#d1cfca';

/** Straight connector — matches canvas node-connector lines. */
function AgentConnector({ x1, y1, x2, y2 }) {
  return (
    <svg width={APP_CONTENT_W} height={APP_CONTENT_H} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={ACCENT} strokeWidth={2} strokeLinecap="round" opacity={0.85} />
    </svg>
  );
}

function AppEdges({ progress }) {
  const segments = [
    { x1: 250, y1: 126, x2: 170, y2: 256, delay: 0.0 },
    { x1: 250, y1: 126, x2: 395, y2: 282, delay: 0.18 },
    { x1: 380, y1: 79, x2: 400, y2: 78, delay: 0.34 },
    { x1: 170, y1: 364, x2: 238, y2: 380, delay: 0.5 },
  ];

  return (
    <svg width={APP_CONTENT_W} height={APP_CONTENT_H} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {segments.map((seg, i) => {
        const local = Math.max(0, Math.min(1, (progress - seg.delay) / 0.32));
        const length = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
        const dash = length - local * length;
        return (
          <line
            key={i}
            x1={seg.x1}
            y1={seg.y1}
            x2={seg.x2}
            y2={seg.y2}
            stroke={EDGE_GRAY}
            strokeWidth={2}
            strokeDasharray={length}
            strokeDashoffset={dash}
          />
        );
      })}
    </svg>
  );
}

function CanvasGraphScene({ sec }) {
  const { copy, scenes } = usePromo();
  const g = copy.graph;
  const [g0, g1] = sceneRange(scenes, 'graph');
  const t = interpolate(sec, [g0, g1], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <>
      <NoteCard
        kind="base"
        x={120}
        y={32}
        w={260}
        h={94}
        title={g.themeTitle}
        body={g.themeBody}
        highlight
      />
      <NoteCard kind="base" x={400} y={28} w={170} h={100} title={g.imageTitle} body={g.imageBody} />
      <NoteCard kind="glass" x={70} y={256} w={200} h={108} title={g.obsTitle} body={g.obsBody} />
      <NoteCard kind="minimal" x={290} y={282} w={210} h={88} title={g.obsTitle} body={copy.forms.items[2].body} />
      <NoteCard kind="base" x={88} y={380} w={300} h={90} title={copy.forms.items[0].title} body={copy.forms.items[0].body} />
      <AppEdges progress={t} />
    </>
  );
}

function getFormsBeat(sec, sceneStart, sceneEnd) {
  const span = sceneEnd - sceneStart;
  const beats = [0, 0.14, 0.28, 0.42, 0.56, 1].map((r) => sceneStart + span * r);
  const t = Math.max(0, sec - sceneStart);
  let idx = 0;
  for (let i = 1; i < beats.length - 1; i += 1) {
    if (t >= beats[i] - sceneStart) idx = i;
  }
  const segStart = beats[idx] - sceneStart;
  const segEnd = beats[idx + 1] - sceneStart;
  const localT = segEnd > segStart ? (t - segStart) / (segEnd - segStart) : 0;
  return { idx: Math.min(4, idx), localT };
}

function FormsScene({ sec }) {
  const { copy, scenes } = usePromo();
  const [sceneStart, sceneEnd] = sceneRange(scenes, 'forms');
  const layouts = copy.forms.items;
  const items = copy.forms.labels;
  const receiptMeta = copy.forms.receipt;

  const { idx, localT } = getFormsBeat(sec, sceneStart, sceneEnd);
  const current = layouts[Math.max(0, idx)];
  const next = layouts[Math.max(0, Math.min(layouts.length - 1, idx + 1))];

  const showNext = localT > 0.72 && idx < layouts.length - 1;
  const crossfade = interpolate(localT, [0.72, 1], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const cardH = current.kind === 'receipt' ? 268 : 220;

  const renderFormCard = (item, highlighted) => (
    <NoteCard
      kind={item.kind}
      x={0}
      y={0}
      w={320}
      h={cardH}
      title={item.title}
      body={item.body}
      highlight={highlighted}
      receipt={item.kind === 'receipt' ? receiptMeta : undefined}
    />
  );

  return (
    <>
      <div style={{ position: 'absolute', left: 248, top: 84, width: 320, height: cardH }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            opacity: showNext ? 1 - crossfade : 1,
            transition: 'opacity 0.3s',
          }}
        >
          {renderFormCard(current, true)}
        </div>
        {showNext ? (
          <div style={{ position: 'absolute', inset: 0, opacity: crossfade }}>
            {renderFormCard(next, true)}
          </div>
        ) : null}
      </div>

      <div
        style={{
          position: 'absolute',
          left: 8,
          right: 8,
          bottom: 48,
          display: 'flex',
          justifyContent: 'center',
          flexWrap: 'nowrap',
          gap: 8,
          fontFamily: SANS,
          fontSize: 10,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
        }}
      >
        {items.map((label, i) => (
          <div
            key={label}
            style={{
              padding: '7px 10px',
              borderRadius: 999,
              border: `1px solid ${i === idx ? ACCENT_LINE : LINE}`,
              color: i === idx ? ACCENT : MUTED,
              background: i === idx ? ACCENT_SOFT : 'transparent',
              fontWeight: i === idx ? 600 : 400,
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </div>
        ))}
      </div>
    </>
  );
}

function AgentNodeCard({ x, y, persona, active, width = 158 }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width,
        padding: '12px 12px 14px',
        borderRadius: 16,
        border: `1px solid ${active ? ACCENT_LINE : LINE}`,
        background: active ? 'rgba(255,247,237,0.96)' : 'rgba(255,255,255,0.88)',
        boxShadow: active ? '0 16px 36px rgba(194,65,12,0.14)' : '0 10px 24px rgba(31,27,24,0.06)',
        fontFamily: SANS,
        transition: 'all 0.35s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Img src={persona.icon} style={{ width: 36, height: 36, objectFit: 'contain', flexShrink: 0 }} />
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: INK }}>{persona.name}</div>
          <div style={{ fontSize: 9, color: MUTED, letterSpacing: '0.1em', marginTop: 2 }}>{persona.role}</div>
        </div>
      </div>
    </div>
  );
}

function AgentChatScene({ sec }) {
  const { personas, copy, scenes } = usePromo();
  const chat = copy.agentChat;
  const [a0, a1] = sceneRange(scenes, 'agentChat');
  const chatPhase = interpolate(sec, [a0, a0 + 1.1], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const studioPhase = interpolate(sec, [a1 - 1.8, a1 - 0.5], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const activeChat = Math.min(
    personas.length - 1,
    Math.floor(interpolate(sec, [a0 + 0.6, a1 - 1.8], [0, 4], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })),
  );
  const persona = personas[activeChat];

  const note = { x: 264, y: 36, w: 240, h: 108 };
  const noteBottom = { x: note.x + note.w / 2, y: note.y + note.h };
  const agentW = 158;
  const agentY = 248;
  const gap = 18;
  const rowWidth = personas.length * agentW + (personas.length - 1) * gap;
  const rowStartX = (768 - rowWidth) / 2;
  const agentPositions = personas.map((_, i) => ({
    x: rowStartX + i * (agentW + gap),
    y: agentY,
    cx: rowStartX + i * (agentW + gap) + agentW / 2,
    cy: agentY,
  }));
  const activePos = agentPositions[activeChat];

  return (
    <>
      <div style={{ position: 'absolute', inset: 0, opacity: 1 - studioPhase * 0.15 }}>
        <NoteCard
          kind="glass"
          x={note.x}
          y={note.y}
          w={note.w}
          h={note.h}
          title={chat.obsTitle}
          body={chat.obsBody}
          highlight
        />

        <AgentConnector x1={noteBottom.x} y1={noteBottom.y} x2={activePos.cx} y2={activePos.cy} />

        {agentPositions.map((pos, i) => (
          <AgentNodeCard
            key={personas[i].id}
            x={pos.x}
            y={pos.y}
            width={agentW}
            persona={personas[i]}
            active={i === activeChat}
          />
        ))}

        <div
          style={{
            position: 'absolute',
            left: 40,
            right: 40,
            bottom: 20,
            padding: '14px 18px',
            borderRadius: 18,
            border: `1px solid ${ACCENT_LINE}`,
            background: 'rgba(255,247,237,0.96)',
            boxShadow: '0 18px 42px rgba(194,65,12,0.12)',
            opacity: chatPhase * (1 - studioPhase * 0.6),
            fontFamily: SANS,
          }}
        >
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            <div style={{ flexShrink: 0, width: 72, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <Img src={persona.icon} style={{ width: 42, height: 42, objectFit: 'contain' }} />
              <div
                style={{
                  marginTop: 8,
                  fontSize: 9,
                  color: ACCENT,
                  letterSpacing: '0.1em',
                  fontWeight: 700,
                  textAlign: 'center',
                  lineHeight: 1.3,
                }}
              >
                {persona.name}
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
              <div style={{ fontSize: 16, lineHeight: 1.55, color: INK, fontFamily: SERIF }}>{persona.reply}</div>
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${LINE}` }}>
                <div style={{ fontSize: 11, color: MUTED }}>{chat.youLabel}</div>
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 13,
                    color: INK_SOFT,
                    borderLeft: `2px solid ${LINE}`,
                    paddingLeft: 10,
                  }}
                >
                  {chat.userQuestion}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          inset: '12px 14px 12px 14px',
          borderRadius: 22,
          background: 'rgba(255,255,255,0.94)',
          border: `1px solid ${LINE}`,
          boxShadow: '0 28px 70px rgba(31,27,24,0.14)',
          opacity: studioPhase,
          transform: `translateY(${interpolate(studioPhase, [0, 1], [16, 0])}px)`,
          display: 'grid',
          gridTemplateColumns: '200px 1fr',
          overflow: 'hidden',
          fontFamily: SANS,
        }}
      >
        <div style={{ borderRight: `1px solid ${LINE}`, padding: '18px 14px', background: '#F4EFE6' }}>
          <div style={{ fontSize: 10, letterSpacing: '0.18em', color: ACCENT, fontWeight: 700 }}>{chat.personasPanel}</div>
          {personas.map((p, i) => (
            <div
              key={p.id}
              style={{
                marginTop: 10,
                padding: '10px 10px',
                borderRadius: 12,
                border: `1px solid ${i === activeChat ? ACCENT_LINE : 'transparent'}`,
                background: i === activeChat ? '#fff' : 'transparent',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 11,
                color: INK_SOFT,
              }}
            >
              <Img src={p.icon} style={{ width: 22, height: 22, objectFit: 'contain' }} />
              <span>{p.name}</span>
            </div>
          ))}
          <div
            style={{
              marginTop: 12,
              padding: '12px 10px',
              borderRadius: 12,
              border: `2px dashed ${ACCENT}`,
              background: ACCENT_SOFT,
              fontSize: 11,
              fontWeight: 600,
              color: ACCENT,
              textAlign: 'center',
            }}
          >
            {chat.customPersona}
          </div>
        </div>
        <div style={{ padding: '22px 24px' }}>
          <div style={{ fontSize: 11, color: MUTED, letterSpacing: '0.14em' }}>{chat.defineOwn}</div>
          <div style={{ marginTop: 14, fontSize: 22, fontWeight: 600, color: INK, fontFamily: SERIF }}>{chat.sampleName}</div>
          <div style={{ marginTop: 6, fontSize: 12, color: ACCENT }}>{chat.sampleRole}</div>
          <div
            style={{
              marginTop: 18,
              padding: 14,
              borderRadius: 12,
              background: '#FAF8F3',
              border: `1px solid ${LINE}`,
              fontSize: 12,
              lineHeight: 1.55,
              color: INK_SOFT,
            }}
          >
            {chat.samplePrompt}
          </div>
          <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
            <span style={{ padding: '6px 12px', borderRadius: 999, background: ACCENT_SOFT, fontSize: 10, color: ACCENT }}>{chat.temperature}</span>
            <span style={{ padding: '6px 12px', borderRadius: 999, background: '#EFE7DC', fontSize: 10, color: MUTED }}>{chat.creativity}</span>
          </div>
        </div>
      </div>
    </>
  );
}

function SynthScene({ sec }) {
  const { copy, scenes } = usePromo();
  const s = copy.synth;
  const [s0, s1] = sceneRange(scenes, 'synth');
  const [selectionStart, selectionMid] = withinScene(scenes, 'synth', 0.08, 0.22);
  const [articleStart, articleMid] = withinScene(scenes, 'synth', 0.32, 0.55);
  const [linkStart, linkEnd] = withinScene(scenes, 'synth', 0.78, 0.98);

  const selectGlow = smoothFade(sec, [selectionStart, selectionMid, articleStart, articleMid]);
  const article = smoothFade(sec, [articleStart, articleMid, s1, s1 + 0.1]);
  const linkChip = smoothFade(sec, [linkStart, linkEnd, s1 + 0.1, s1 + 0.2]);

  return (
    <>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: 1 - article * 0.55,
        }}
      >
        <NoteCard kind="base" x={70} y={48} w={210} h={92} title={s.themeTitle} body={s.themeBody} highlight={selectGlow > 0.4} />
        <NoteCard kind="glass" x={70} y={170} w={210} h={102} title={s.obsTitle} body={s.obsBody} highlight={selectGlow > 0.4} />
        <NoteCard kind="minimal" x={70} y={302} w={210} h={86} title={s.imageTitle} body={s.imageBody} highlight={selectGlow > 0.4} />
      </div>

      <div
        style={{
          position: 'absolute',
          right: 40,
          top: 36,
          width: 460,
          height: 560,
          borderRadius: 18,
          background: '#FFFFFF',
          border: `1px solid ${LINE}`,
          boxShadow: '0 28px 70px rgba(31,27,24,0.14)',
          padding: '26px 28px',
          opacity: article,
          transform: `translateY(${interpolate(article, [0, 1], [22, 0])}px)`,
          display: 'flex',
          flexDirection: 'column',
          fontFamily: SANS,
        }}
      >
        <div style={{ fontSize: 11, letterSpacing: '0.2em', color: ACCENT, fontWeight: 700 }}>{s.refLabel}</div>
        <div
          style={{
            marginTop: 18,
            fontFamily: SERIF,
            fontSize: 30,
            lineHeight: 1.12,
            letterSpacing: '-0.025em',
            color: INK,
            fontWeight: 500,
          }}
        >
          {s.articleTitle}
        </div>
        <div style={{ marginTop: 18, fontSize: 14, lineHeight: 1.6, color: INK_SOFT }}>{s.articleBody}</div>
        <div style={{ marginTop: 14, width: '78%', height: 8, borderRadius: 999, background: '#EFE7DC' }} />
        <div style={{ marginTop: 10, width: '64%', height: 8, borderRadius: 999, background: '#EFE7DC' }} />
        <div style={{ marginTop: 10, width: '71%', height: 8, borderRadius: 999, background: '#EFE7DC' }} />

        <div
          style={{
            marginTop: 22,
            opacity: linkChip,
            display: 'inline-flex',
            alignSelf: 'flex-start',
            padding: '9px 14px',
            borderRadius: 999,
            background: ACCENT_SOFT,
            border: `1px solid ${ACCENT_LINE}`,
            color: ACCENT,
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {s.linkChip}
        </div>
      </div>
    </>
  );
}

function ResearchLabScene({ sec }) {
  const { copy, scenes } = usePromo();
  const r = copy.research;
  const [q0, q1] = withinScene(scenes, 'research', 0.02, 0.12);
  const [p0, p1] = withinScene(scenes, 'research', 0.14, 0.42);
  const [e0, e1] = withinScene(scenes, 'research', 0.4, 0.55);
  const [src0, src1] = withinScene(scenes, 'research', 0.38, 0.98);
  const [rep0, rep1] = withinScene(scenes, 'research', 0.52, 0.98);
  const queryPhase = smoothFade(sec, [q0, q1, q1 + 0.05, q1 + 0.1]);
  const planPhase = smoothFade(sec, [p0, p1, p1 + 0.05, p1 + 0.1]);
  const executePhase = smoothFade(sec, [e0, e1, e1 + 0.05, e1 + 0.1]);
  const sourcesPhase = smoothFade(sec, [src0, src0 + 0.4, sceneRange(scenes, 'research')[1], sceneRange(scenes, 'research')[1] + 0.1]);
  const reportPhase = smoothFade(sec, [rep0, rep1, sceneRange(scenes, 'research')[1] + 0.1, sceneRange(scenes, 'research')[1] + 0.2]);
  const [step0, step1] = withinScene(scenes, 'research', 0.2, 0.48);
  const activeStep = Math.min(
    r.plan.length - 1,
    Math.floor(interpolate(sec, [step0, step1], [0, 3], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })),
  );
  const showSearching = sourcesPhase > 0.4 && reportPhase < 0.35;

  const layer = (visible) => ({
    position: 'absolute',
    inset: 0,
    padding: '16px 20px',
    opacity: visible,
    pointerEvents: 'none',
    overflow: 'hidden',
  });

  return (
    <div style={{ position: 'absolute', inset: 0, background: PAPER, fontFamily: SANS }}>
      {/* Sources sidebar */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          width: 188,
          borderRight: `1px solid ${LINE}`,
          background: '#FAF8F3',
          padding: '14px 12px',
          opacity: interpolate(sourcesPhase, [0, 1], [0, 1]),
        }}
      >
        <div style={{ fontSize: 9, letterSpacing: '0.16em', color: MUTED, fontWeight: 700 }}>{r.sourcesTitle}</div>
        {r.sources.map((src, i) => (
          <div
            key={src.title}
            style={{
              marginTop: 10,
              padding: '10px 10px',
              borderRadius: 10,
              background: '#fff',
              border: `1px solid ${LINE}`,
              opacity: i < 2 ? sourcesPhase : sourcesPhase * interpolate(reportPhase, [0, 1], [0.5, 1]),
              boxShadow: '0 6px 14px rgba(31,27,24,0.05)',
            }}
          >
            <div style={{ fontSize: 9, color: '#16a34a', fontWeight: 700, marginBottom: 4, fontFamily: 'ui-monospace, monospace' }}>
              {r.processed}
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: INK, lineHeight: 1.35, fontFamily: SERIF }}>{src.title}</div>
            <div style={{ marginTop: 4, fontSize: 10, color: MUTED, lineHeight: 1.4 }}>{src.snippet}</div>
          </div>
        ))}
        {showSearching ? (
          <div
            style={{
              marginTop: 10,
              padding: '8px 10px',
              borderRadius: 8,
              border: `1px solid ${ACCENT_LINE}`,
              background: '#fff',
              fontSize: 10,
              color: ACCENT,
              fontFamily: 'ui-monospace, monospace',
            }}
          >
            {r.searching}
          </div>
        ) : null}
      </div>

      {/* Main workspace — stacked layers (avoid report pushed below fold) */}
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: 188, right: 0, overflow: 'hidden' }}>
        {/* Query entry */}
        <div style={{ ...layer(queryPhase * (1 - planPhase)), textAlign: 'center', paddingTop: 36 }}>
          <div
            style={{
              width: 48,
              height: 48,
              margin: '0 auto 14px',
              borderRadius: 14,
              background: '#fff',
              border: `1px solid ${LINE}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 22,
            }}
          >
            🔬
          </div>
          <div style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 600, color: INK }}>{r.investigate}</div>
          <div
            style={{
              margin: '14px auto 0',
              maxWidth: 420,
              padding: '12px 44px 12px 16px',
              borderRadius: 12,
              background: '#fff',
              border: `1px solid ${LINE}`,
              boxShadow: '0 12px 28px rgba(31,27,24,0.08)',
              fontSize: 14,
              color: INK,
              textAlign: 'left',
              position: 'relative',
            }}
          >
            {r.query}
            <span
              style={{
                position: 'absolute',
                right: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                width: 28,
                height: 28,
                borderRadius: 8,
                background: ACCENT,
                color: '#fff',
                fontSize: 14,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              →
            </span>
          </div>
        </div>

        {/* Research plan */}
        <div
          style={{
            ...layer(planPhase * (1 - executePhase * 0.85)),
            transform: `translateY(${interpolate(planPhase, [0, 1], [12, 0])}px)`,
          }}
        >
          <div style={{ fontSize: 10, color: ACCENT, letterSpacing: '0.12em', fontFamily: 'ui-monospace, monospace' }}>
            {r.targetInquiry}
          </div>
          <div style={{ marginTop: 6, fontFamily: SERIF, fontSize: 20, fontWeight: 600, color: INK, lineHeight: 1.2 }}>
            {r.query}
          </div>
          <div
            style={{
              marginTop: 14,
              padding: '14px 16px',
              borderRadius: 14,
              background: '#fff',
              border: `1px solid ${LINE}`,
              boxShadow: '0 14px 32px rgba(31,27,24,0.08)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ color: '#16a34a', fontSize: 14 }}>☑</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: INK }}>{r.planTitle}</span>
            </div>
            {r.plan.map((step, i) => (
              <div
                key={step.title}
                style={{
                  display: 'flex',
                  gap: 10,
                  marginTop: i === 0 ? 0 : 10,
                  opacity: i <= activeStep ? 1 : 0.35,
                }}
              >
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 999,
                    background: i === activeStep ? ACCENT_SOFT : '#F4EFE6',
                    border: `1px solid ${i === activeStep ? ACCENT_LINE : LINE}`,
                    fontSize: 10,
                    fontWeight: 700,
                    color: i === activeStep ? ACCENT : MUTED,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    marginTop: 2,
                  }}
                >
                  {i + 1}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: INK }}>{step.title}</div>
                  <div style={{ marginTop: 3, fontSize: 10, lineHeight: 1.45, color: MUTED }}>{step.desc}</div>
                </div>
              </div>
            ))}
            <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
              <span
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  background: ACCENT,
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {r.approve}
              </span>
            </div>
          </div>
        </div>

        {/* Executing pipeline */}
        <div style={layer(executePhase * (1 - reportPhase * 0.9))}>
          <div
            style={{
              maxWidth: 400,
              margin: '48px auto 0',
              padding: '18px 20px',
              borderRadius: 14,
              background: '#fff',
              border: `1px solid ${LINE}`,
              boxShadow: '0 14px 32px rgba(31,27,24,0.08)',
              fontFamily: 'ui-monospace, monospace',
              fontSize: 11,
            }}
          >
            <div style={{ color: ACCENT, fontWeight: 700, marginBottom: 14 }}>{r.executing}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#16a34a', marginBottom: 10 }}>
              <span>✓</span>
              <span>{r.sourcesFound}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: INK, marginBottom: 10 }}>
              <span style={{ color: ACCENT }}>◌</span>
              <span>{r.resolving}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: MUTED }}>
              <span style={{ width: 14, height: 14, borderRadius: 999, border: `2px solid ${LINE}`, display: 'inline-block' }} />
              <span>{r.generating}</span>
            </div>
          </div>
        </div>

        {/* Completed report — matches Research Lab `completed` view */}
        <div
          style={{
            ...layer(reportPhase),
            background: '#FAF9F6',
            transform: `translateY(${interpolate(reportPhase, [0, 1], [8, 0])}px)`,
          }}
        >
          <div style={{ textAlign: 'center', paddingTop: 8, paddingBottom: 12 }}>
            <div
              style={{
                fontSize: 10,
                letterSpacing: '0.2em',
                color: ACCENT,
                fontWeight: 700,
                fontFamily: 'ui-monospace, monospace',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              {r.reportLabel}
            </div>
            <div
              style={{
                marginTop: 10,
                fontFamily: SERIF,
                fontSize: 26,
                fontWeight: 600,
                color: INK,
                lineHeight: 1.15,
                padding: '0 12px',
              }}
            >
              {r.query}
            </div>
            <div style={{ marginTop: 10, width: 56, height: 2, background: INK, marginLeft: 'auto', marginRight: 'auto' }} />
            <div style={{ marginTop: 8, fontSize: 10, color: MUTED, fontFamily: 'ui-monospace, monospace' }}>
              {r.reportFooter}
            </div>
          </div>

          <div
            style={{
              padding: '0 20px 16px',
              fontFamily: SERIF,
              fontSize: 13,
              lineHeight: 1.65,
              color: INK,
              maxHeight: 340,
              overflow: 'hidden',
            }}
          >
            <p style={{ margin: 0, color: INK_SOFT }}>{r.report.intro}</p>
            {r.report.points.map((pt, idx) => (
              <div key={pt.title} style={{ marginTop: 14 }}>
                <div style={{ fontFamily: SANS, fontSize: 14, fontWeight: 700, color: INK, marginBottom: 6 }}>
                  {idx + 1}. {pt.title}
                </div>
                <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: INK_SOFT }}>{pt.text}</p>
              </div>
            ))}
            <div
              style={{
                marginTop: 16,
                padding: '12px 14px',
                borderLeft: `4px solid ${ACCENT}`,
                background: '#FFF9E6',
                borderRadius: '0 10px 10px 0',
                fontFamily: SANS,
                fontSize: 11,
                lineHeight: 1.5,
                color: INK_SOFT,
              }}
            >
              <strong style={{ color: INK }}>{r.conclusionLabel}</strong>
              {r.report.conclusion}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PrivacyOverlay({ sec }) {
  const { scenes } = usePromo();
  const [p0, p1, p2, p3] = sceneLayerWindow(scenes, 'privacy', 0.4, 0.1);
  const opacity = smoothFade(sec, [p0, p1, p2, p3]);
  if (opacity < 0.01) return null;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(251,248,242,0.62) 100%)',
        opacity,
        pointerEvents: 'none',
      }}
    />
  );
}

function AppWindow({ sec }) {
  const { copy, scenes } = usePromo();
  const scene = currentScene(sec, scenes);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const entrance = spring({
    frame: frame - 0.25 * fps,
    fps,
    config: { damping: 22, mass: 0.7, stiffness: 65 },
  });
  const enterOffset = interpolate(entrance, [0, 1], [28, 0]);
  const totalSec = promoDurationSec(scenes);
  const drift = interpolate(sec, [0, totalSec], [-10, 10], {
    easing: Easing.inOut(Easing.ease),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const zoom = interpolate(sec, [0, totalSec], [0.985, 1.025], {
    easing: Easing.inOut(Easing.ease),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const sidebarActive = (() => {
    if (scene.id === 'synth') return 'reference';
    if (scene.id === 'agentChat') return 'agents';
    if (scene.id === 'research') return 'lab';
    if (scene.id === 'privacy') return 'canvas';
    return 'canvas';
  })();

  return (
    <div
      style={{
        position: 'absolute',
        left: STAGE.appX,
        top: STAGE.appY,
        width: STAGE.appW,
        height: STAGE.appH,
        borderRadius: 28,
        overflow: 'hidden',
        background: '#FBF8F2',
        border: `1px solid ${LINE}`,
        boxShadow: '0 48px 110px rgba(40,28,18,0.18), 0 0 0 1px rgba(255,255,255,0.6) inset',
        opacity: interpolate(entrance, [0, 1], [0, 1]) * (1 - scenePresence(scenes[scenes.length - 1], sec) * 0.92),
        transform: `translate(${drift}px, ${enterOffset}px) scale(${zoom})`,
        fontFamily: SANS,
      }}
    >
      <div
        style={{
          height: 44,
          background: 'rgba(244, 239, 232, 0.82)',
          borderBottom: `1px solid ${LINE}`,
          display: 'flex',
          alignItems: 'center',
          padding: '0 18px',
          gap: 10,
        }}
      >
        {['#E8AAA0', '#E9D2A1', '#BFD8B8'].map((c) => (
          <span key={c} style={{ width: 11, height: 11, borderRadius: 999, background: c }} />
        ))}
        <span style={{ marginLeft: 14, fontSize: 12, color: MUTED }}>{copy.windowTitle}</span>
      </div>

      <div style={{ position: 'absolute', top: APP_CHROME_H, bottom: 0, left: 0, width: APP_SIDEBAR_W, background: '#F4EFE6', borderRight: `1px solid ${LINE}`, padding: '22px 16px', boxSizing: 'border-box' }}>
        <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: ACCENT, fontWeight: 700 }}>{copy.brandTitle}</div>
        <div style={{ marginTop: 6, fontSize: 10, color: MUTED, letterSpacing: '0.16em' }}>{copy.focusMode}</div>
        <div style={{ marginTop: 22, fontSize: 10, color: MUTED, letterSpacing: '0.16em' }}>{copy.modules}</div>
        {[
          { id: 'canvas', label: copy.tabs.canvas },
          { id: 'reference', label: copy.tabs.reference },
          { id: 'lab', label: copy.tabs.lab },
          { id: 'agents', label: copy.tabs.agents },
        ].map((tab) => {
          const active = sidebarActive === tab.id;
          return (
            <div
              key={tab.id}
              style={{
                marginTop: 8,
                padding: '8px 10px',
                borderRadius: 8,
                background: active ? '#FFFFFF' : 'transparent',
                border: `1px solid ${active ? LINE : 'transparent'}`,
                color: active ? ACCENT : INK_SOFT,
                fontSize: 13,
                fontWeight: active ? 600 : 400,
              }}
            >
              {tab.label}
            </div>
          );
        })}
      </div>

      <div
        style={{
          position: 'absolute',
          top: APP_CHROME_H,
          bottom: 0,
          left: APP_SIDEBAR_W,
          right: 0,
          background: PAPER,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: 'radial-gradient(circle, rgba(31,27,24,0.10) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
            opacity: 0.42,
          }}
        />

        <SceneLayer window={sceneLayerWindow(scenes, 'graph')} sec={sec}>
          <CanvasGraphScene sec={sec} />
        </SceneLayer>
        <SceneLayer window={sceneLayerWindow(scenes, 'forms')} sec={sec}>
          <FormsScene sec={sec} />
        </SceneLayer>
        <SceneLayer window={sceneLayerWindow(scenes, 'synth')} sec={sec}>
          <SynthScene sec={sec} />
        </SceneLayer>
        <SceneLayer window={sceneLayerWindow(scenes, 'privacy')} sec={sec}>
          <CanvasGraphScene sec={sec} />
        </SceneLayer>
        <SceneLayer window={sceneLayerWindow(scenes, 'research')} sec={sec}>
          <ResearchLabScene sec={sec} />
        </SceneLayer>
        <SceneLayer window={sceneLayerWindow(scenes, 'agentChat')} sec={sec}>
          <AgentChatScene sec={sec} />
        </SceneLayer>

        <PrivacyOverlay sec={sec} />

        <div
          style={{
            position: 'absolute',
            top: 14,
            right: 18,
            display: 'flex',
            gap: 8,
            opacity: smoothFade(sec, sceneLayerWindow(scenes, 'privacy', 0.4, 0.1)),
          }}
        >
          <div
            style={{
              padding: '6px 12px',
              borderRadius: 999,
              background: 'rgba(255,255,255,0.94)',
              border: `1px solid ${LINE}`,
              fontSize: 11,
              color: MUTED,
              letterSpacing: '0.06em',
            }}
          >
            {copy.privacyBadge}
          </div>
        </div>
      </div>
    </div>
  );
}

function PromoCaption({ caption, sec }) {
  const { locale, scenes } = usePromo();
  const closing = scenePresence(scenes[scenes.length - 1], sec);
  const opening = scenePresence(scenes[0], sec);
  const opacity = (1 - closing) * (1 - opening * 0.45);
  const text = locale === 'zh' ? caption?.zh : caption?.en;
  if (opacity < 0.02 || !text) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: STAGE.captionY,
        opacity,
        textAlign: 'center',
        fontFamily: SANS,
      }}
    >
      <PromoTitle
        text={text}
        style={{
          margin: '0 auto',
          maxWidth: 1320,
          fontSize: locale === 'zh' ? 32 : 34,
          lineHeight: locale === 'zh' ? 1.58 : 1.42,
          fontWeight: 450,
          color: INK_SOFT,
          letterSpacing: locale === 'zh' ? '0.04em' : '0.01em',
        }}
      />
    </div>
  );
}

function ClosingCTA({ scene, sec, ctaText, ctaUrl }) {
  const { locale } = usePromo();
  const presence = scenePresence(scene, sec);
  if (presence < 0.02) return null;
  const lift = interpolate(presence, [0, 1], [24, 0]);
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        opacity: presence,
        transform: `translateY(${lift}px)`,
      }}
    >
      <div style={{ maxWidth: 1100 }}>
        <div
          style={{
            fontFamily: SANS,
            fontSize: 17,
            letterSpacing: locale === 'zh' ? '0.14em' : '0.32em',
            textTransform: locale === 'zh' ? 'none' : 'uppercase',
            color: ACCENT,
            fontWeight: 600,
            marginBottom: 30,
          }}
        >
          {scene.eyebrow}
        </div>
        <PromoTitle
          text={scene.title}
          style={{
            fontFamily: SERIF,
            fontSize: 116,
            lineHeight: locale === 'zh' ? 1.32 : 1.02,
            letterSpacing: locale === 'zh' ? '0.02em' : '-0.045em',
            color: INK,
            fontWeight: 500,
          }}
        />
        <div
          style={{
            marginTop: 30,
            fontFamily: SANS,
            fontSize: 22,
            color: MUTED,
          }}
        >
          {ctaUrl}
        </div>
        <div
          style={{
            marginTop: 42,
            display: 'inline-flex',
            padding: '16px 30px',
            borderRadius: 999,
            background: ACCENT,
            color: '#fff',
            fontFamily: SANS,
            fontSize: 16,
            letterSpacing: '0.06em',
            fontWeight: 600,
            boxShadow: '0 24px 50px rgba(194,65,12,0.24)',
          }}
        >
          {ctaText}
        </div>
      </div>
    </div>
  );
}

function SpoorPromoInner({
  title,
  subtitle,
  ctaUrl = 'scribe-ai-canvas.netlify.app',
  ctaText,
  audioUrl = '',
  timestampSegments = [],
  locale = 'en',
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sec = frame / fps;
  const { copy, scenes } = usePromo();
  const audioSrc = resolvePromoAudioSrc(audioUrl, locale);
  const scene = currentScene(sec, scenes);
  const caption = findCaption(timestampSegments, sec);
  const closingPresence = scenePresence(scenes[scenes.length - 1], sec);
  const openingPresence = scenePresence(scenes[0], sec);
  const heroTitle = title ?? copy.brandTitle;

  return (
    <AbsoluteFill
      style={{
        background:
          'radial-gradient(ellipse 90% 60% at 50% 22%, #FFF6EA 0%, #FBF6EC 46%, #EFE6D9 100%)',
        fontFamily: SERIF,
        color: INK,
        overflow: 'hidden',
      }}
    >
      {audioSrc ? <Audio src={audioSrc} volume={1} /> : null}

      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(circle at 16% 22%, rgba(194,65,12,0.07), transparent 32%), linear-gradient(120deg, rgba(255,255,255,0.6), transparent 36%)',
          opacity: 0.94,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 80,
          top: 100,
          width: 540,
          height: 540,
          borderRadius: '50%',
          border: '1px solid rgba(194,65,12,0.10)',
          opacity: 1 - closingPresence * 0.9,
        }}
      />

      {scene.layout === 'hero' && scene.id === 'opening' ? (
        <HeroCopy scene={{ ...scene, title: heroTitle }} sec={sec} />
      ) : null}

      {scene.layout === 'split' ? (
        <>
          <SplitCopy scene={scene} sec={sec} />
          <AppWindow sec={sec} />
        </>
      ) : null}

      {scene.id !== 'closing' ? <PromoCaption caption={caption} sec={sec} /> : null}

      <ClosingCTA scene={scenes[scenes.length - 1]} sec={sec} ctaText={ctaText} ctaUrl={ctaUrl} />
    </AbsoluteFill>
  );
}

export const SpoorPromo = ({
  locale = 'en',
  title,
  subtitle,
  brandLabel,
  ctaUrl = 'scribe-ai-canvas.netlify.app',
  ctaText,
  audioUrl = '',
  timestampSegments = [],
}) => {
  const copy = useMemo(() => getPromoCopy(locale), [locale]);
  const ctx = useMemo(
    () => ({
      copy,
      scenes: copy.scenes,
      locale,
      personas: buildAgentPersonas(copy),
    }),
    [copy, locale],
  );

  return (
    <PromoContext.Provider value={ctx}>
      <SpoorPromoInner
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

/** Chinese promo — same timeline and layout as SpoorPromo. */
export const SpoorPromoZH = (props) => <SpoorPromo locale="zh" {...props} />;
