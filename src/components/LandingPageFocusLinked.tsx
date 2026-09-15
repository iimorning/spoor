/**
 * LandingPageFocusLinked — focus-linked editorial landing (archived).
 *
 * Not wired to `/`. Production uses `LandingPage.tsx`; this experiment
 * remains self-contained here with `landing.focus-linked.css` and
 * `landing-collage.tsx` for possible reuse.
 *
 * The screen is a magazine spread: five long titles are stacked in the
 * center, slightly rotated and overlapping like headlines on a broadsheet.
 * Hovering a title flips the whole page — background color, ink color,
 * and a pair of collage illustrations pasted at the edges.
 *
 * No scroll-jacking. No click-to-toggle. The cursor *is* the page-turner.
 */

import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import logoUrl from '../../LOGO.png';
import {
  TOPIC_ILLUSTRATIONS,
  type LeftIllustration,
  type RightIllustration,
} from './landing-collage';
import '../landing.focus-linked.css';

type TopicId = '01' | '02' | '03' | '04' | '05';
const TOPIC_IDS: readonly TopicId[] = ['01', '02', '03', '04', '05'] as const;

const TOPIC_ATMO: Record<TopicId, { bg: string; ink: string }> = {
  '01': { bg: 'paper',  ink: '#1c1b1b' },
  '02': { bg: 'red',    ink: '#ffe7d2' },
  '03': { bg: 'cream',  ink: '#2a1f17' },
  '04': { bg: 'gray',   ink: '#1c1b1b' },
  '05': { bg: 'ink',    ink: '#efe6d9' },
};

/** Each topic has its own collage placement — rotated, offset, large.
 *  These are not thumbnails; they are full-size cutouts that bleed
 *  off the screen edge. */
const COLLAGE_LAYOUT: Record<
  TopicId,
  {
    left:  React.CSSProperties;
    right: React.CSSProperties;
  }
> = {
  '01': {
    left:  { top: '6%',  left: '-4%', transform: 'rotate(-4deg) scale(1.1)' },
    right: { top: '14%', right: '-3%', transform: 'rotate(3deg) scale(1.05)' },
  },
  '02': {
    left:  { bottom: '10%', left: '-5%',  transform: 'rotate(3deg) scale(1.15)' },
    right: { bottom: '6%',  right: '-4%', transform: 'rotate(-2deg) scale(1.1)' },
  },
  '03': {
    left:  { top: '18%',  left: '-3%',  transform: 'rotate(2deg) scale(1.08)' },
    right: { bottom: '14%', right: '-5%', transform: 'rotate(-3deg) scale(1.12)' },
  },
  '04': {
    left:  { bottom: '16%', left: '-4%',  transform: 'rotate(-2deg) scale(1.1)' },
    right: { top: '20%',    right: '-3%', transform: 'rotate(4deg) scale(1.06)' },
  },
  '05': {
    left:  { top: '26%',  left: '-5%',  transform: 'rotate(1deg) scale(1.15)' },
    right: { bottom: '20%', right: '-4%', transform: 'rotate(-4deg) scale(1.1)' },
  },
};

/** Title stack — each line is a different size, slightly offset, so the
 *  five topics read as a single chaotic headline block. */
const TITLE_LAYOUT: Record<
  TopicId,
  { size: 'xxl' | 'xl' | 'l'; offset: number; rotate: number }
> = {
  '01': { size: 'xxl', offset: 0,   rotate: -0.5 },
  '02': { size: 'xl',  offset: 24,  rotate: 0.5 },
  '03': { size: 'xxl', offset: -12, rotate: -0.3 },
  '04': { size: 'l',   offset: 32,  rotate: 0.4 },
  '05': { size: 'xl',  offset: 8,   rotate: -0.6 },
};

type LandingPageFocusLinkedProps = {
  onEnterApp: () => void;
};

export function LandingPageFocusLinked({ onEnterApp }: LandingPageFocusLinkedProps) {
  const { t, i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh') ?? false;

  const [active, setActive] = useState<TopicId | null>(null);
  const pendingRef = useRef<TopicId | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activate = useCallback((id: TopicId) => {
    // Debounce rapid hover — the cursor may sweep across multiple titles
    // in quick succession; we only want the final resting one to take effect.
    pendingRef.current = id;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setActive(pendingRef.current);
      timerRef.current = null;
    }, 80);
  }, []);

  const dismiss = useCallback(() => {
    pendingRef.current = null;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setActive(null);
  }, []);

  React.useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, dismiss]);

  // Cleanup timer on unmount
  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const atmoBg = active ? TOPIC_ATMO[active].bg : 'paper';
  const atmoInk = active ? TOPIC_ATMO[active].ink : '#1c1b1b';

  const switchLanguage = useCallback(() => {
    void i18n.changeLanguage(isZh ? 'en' : 'zh');
  }, [i18n, isZh]);

  return (
    <div
      className="spoor-landing spoor-landing--focus-linked"
      data-atmo={atmoBg}
      data-atmo-ink={atmoInk}
      data-active-topic={active ?? 'none'}
    >
      {/* Top bar */}
      <header className="lp-topbar">
        <div className="lp-topbar__brand">
          <img src={logoUrl} alt="" className="lp-topbar__logo" />
          <span className="lp-topbar__name">Spoor</span>
        </div>
        <button
          type="button"
          onClick={switchLanguage}
          className="lp-topbar__lang"
        >
          {isZh ? 'EN' : '中文'}
        </button>
      </header>

      {/* Keep every image mounted so switching never waits for decoding.
          Only opacity changes; the collage cannot alter page geometry. */}
      <div className="lp-collage" aria-hidden>
        {TOPIC_IDS.map((id) => (
          <CollagePair key={id} id={id} active={active === id} />
        ))}
      </div>

      {/* Hero — the five titles stacked like a magazine cover. */}
      <main className="lp-main">
        <section className="lp-hero" data-active={active ? 'topic' : 'default'}>
          <div className="lp-hero__inner">
            {/* DEFAULT hero */}
            <div className="lp-hero__default" aria-hidden={Boolean(active)}>
              <div className="lp-hero__stamp-wrap">
                <span className="lp-stamp">{t('landing.hero_eyebrow')}</span>
              </div>
              <h1 className="lp-stack">
                <span className="lp-stack__line lp-stack__line--xxl">
                  {t('landing.hero_line_a')}
                </span>
                <span className="lp-stack__line lp-stack__line--xl">
                  {t('landing.hero_line_b')}
                </span>
                <span className="lp-stack__line lp-stack__line--xl">
                  {t('landing.hero_line_c')}
                </span>
              </h1>
              <hr className="lp-rule" />
              <span className="lp-stack__italic">{t('landing.hero_italic')}</span>
              <span className="lp-stack__mark">{t('landing.hero_mark')}</span>
              <div className="lp-hero__cta-row">
                <button
                  type="button"
                  onClick={onEnterApp}
                  className="lp-cta-primary"
                >
                  {t('landing.hero_cta_primary')}
                </button>
              </div>
            </div>

            {/* ACTIVE-TOPIC hero — crossfade via motion, not CSS. */}
            <AnimatePresence mode="wait">
              {active && (
                <motion.div
                  key={active}
                  className="lp-hero__topic"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  <div className="lp-hero__stamp-wrap">
                    <span className="lp-stamp">
                      {t(`landing.topics.${active}.stamp`)}
                    </span>
                  </div>
                  <h2 className="lp-stack">
                    <span className="lp-stack__line lp-stack__line--xxl">
                      {t(`landing.topics.${active}.head_l1`)}
                    </span>
                    <span className="lp-stack__line lp-stack__line--xl">
                      {t(`landing.topics.${active}.head_l2`)}
                    </span>
                    <span className="lp-stack__line lp-stack__line--xl">
                      {t(`landing.topics.${active}.head_l3`)}
                    </span>
                  </h2>
                  <hr className="lp-rule" />
                  <p className="lp-lede">{t(`landing.topics.${active}.lede`)}</p>
                  <p className="lp-footnote">{t(`landing.topics.${active}.italic_note`)}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </section>

        {/* Topic stack — the five titles, overlapping like headlines. */}
        <nav
          className="lp-topic-stack"
          aria-label={t('landing.nav_manifesto')}
        >
          {TOPIC_IDS.map((id) => {
            const layout = TITLE_LAYOUT[id];
            const stamp = t(`landing.topics.${id}.stamp`);
            const head = t(`landing.topics.${id}.head_l1`);
            const isActive = active === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onEnterApp()}
                onMouseEnter={() => activate(id)}
                onFocus={() => activate(id)}
                className={`lp-topic-line lp-topic-line--${layout.size} ${isActive ? 'is-active' : ''}`}
                data-topic-id={id}
                style={{
                  marginLeft: layout.offset,
                  transform: `rotate(${layout.rotate}deg)`,
                }}
              >
                <span className="lp-topic-line__stamp">{stamp}</span>
                <span className="lp-topic-line__title">{head}</span>
              </button>
            );
          })}
        </nav>

        {active && (
          <button
            type="button"
            onClick={dismiss}
            className="lp-dismiss"
            aria-label={t('dialog.close')}
          >
            ×
          </button>
        )}
      </main>

      {/* Footer — quiet */}
      <footer className="lp-footer-mini">
        <span className="lp-footer-mini__brand">Spoor · 雪泥</span>
        <span className="lp-footer-mini__copy">{t('landing.footer_copy')}</span>
      </footer>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 * CollagePair — motion-driven, only rendered when active.
 * No CSS opacity transition = no flash between states.
 * ───────────────────────────────────────────────────────────────────── */

type CollagePairProps = {
  id: TopicId;
  active: boolean;
};

function CollagePair({ id, active }: CollagePairProps) {
  const pair = TOPIC_ILLUSTRATIONS[id];
  if (!pair) return null;
  const Left = pair.Left;
  const Right = pair.Right;
  const layout = COLLAGE_LAYOUT[id];

  return (
    <motion.div
      className="lp-collage__pair"
      data-topic-id={id}
      initial={false}
      animate={{ opacity: active ? 1 : 0 }}
      transition={{ duration: 0.18 }}
      style={{ pointerEvents: 'none', zIndex: active ? 1 : 0 }}
    >
      <div
        className="lp-collage__slot lp-collage__slot--left"
        style={layout.left}
      >
        <Left />
      </div>
      <div
        className="lp-collage__slot lp-collage__slot--right"
        style={layout.right}
      >
        <Right />
      </div>
    </motion.div>
  );
}
