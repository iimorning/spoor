/**
 * LandingPageStacked — alternative landing composition.
 *
 * ─── Origin ────────────────────────────────────────────────────────────
 * Built 2026-08-11 from a video reference (a Bilibili / YouTube essay
 * channel demonstrating a website with heavy editorial typography). The
 * website the video was showing used:
 *   • a hero of stacked serif words of mixed sizes ("GRECOPUTURISM?")
 *   • a vertical topic-index listing each "scene" by long uppercase name
 *   • atmosphere-switching full-width sections (paper / red / grayscale)
 *   • per-topic small editorial stamps ("20XX?", "I. / Canvas")
 *   • a small italic intro phrase ("What is", "Method")
 *   • small line-art graphic marks for each topic
 *
 * ─── What this file does ───────────────────────────────────────────────
 * Re-implements that editorial pattern with Spoor's product narrative:
 *   5 stacked topic sections in order
 *     01 / A QUIET CANVAS       — paper (with the original LandingCanvas demo)
 *     02 / LOCAL-FIRST          — cream
 *     03 / FOUR PERSONAS        — warm red (#7e2500)
 *     04 / IN AN EDITABLE PLAN  — gray
 *     05 / A TRACE OF THOUGHT   — ink (closing)
 * Plus an editorial hero with double CTA + a quiet footer.
 *
 * ─── Status ────────────────────────────────────────────────────────────
 * NOT WIRED to the live `/` route. Production `/` uses classic
 * `LandingPage.tsx` (hero + LandingCanvas). Sibling archive:
 * `LandingPageFocusLinked.tsx` (topic-click atmosphere + Met collage).
 *
 * This component is kept so it can be A/B-tested or revived later without rewriting.
 *
 * ─── To activate ───────────────────────────────────────────────────────
 * Two-line change in `src/Root.tsx`:
 *   import { LandingPageStacked } from './components/LandingPageStacked';
 *   // …
 *   return <LandingPageStacked onEnterApp={enterApp} />;
 * The companion CSS file is already imported by this component, so no CSS
 * change is needed.
 *
 * ─── Trade-offs vs. the live landing ──────────────────────────────────
 * This composition was rejected in favor of going back to the simpler hero:
 *   • Reads as an editorial site rather than a product page — wrong audience
 *     signal for a tool that wants 30-second conversion.
 *   • The two-portrait video reference is the channel host's voice, which we
 *     don't want to inherit on a product surface (see git log around the
 *     tool-calling plan for context).
 *   • Atmosphere-switching (sea / forest / volcano) doesn't translate to the
 *     hardcoded scenes here — keyed ambience only affects non-scene chrome.
 *
 * But the typography primitives (serif stack, stamp, italic intro, small mark)
 * and the topic-index structure survive nicely and may be reused later — e.g.
 * in a dedicated "/promo" page, or in a series of in-app empty states.
 */

import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Volume2, VolumeX } from 'lucide-react';
import logoUrl from '../../LOGO.png';
import { LandingCanvas } from './LandingCanvas';
import { useLandingAmbience } from '../hooks/useLandingAmbience';
import {
  isActiveAmbiance,
  type LandingAmbiance,
} from '../utils/landingAmbience';
import '../landing.stacked.css';

type Locale = 'zh' | 'en';
type TopicId = '01' | '02' | '03' | '04' | '05';

const TOPIC_ATMO: Record<TopicId, 'paper' | 'cream' | 'red' | 'gray' | 'ink'> = {
  '01': 'paper',
  '02': 'cream',
  '03': 'red',
  '04': 'gray',
  '05': 'ink',
};

/** Per-topic decorative SVG mark, drawn in `currentColor` so each scene's
    inherited color (paper / cream / red / gray / ink + their text colors)
    drives the ink. No raster, no asset pipeline. */
function TopicMark({ kind }: { kind: TopicId }) {
  switch (kind) {
    case '01': // three cards connected by gentle curves
      return (
        <svg viewBox="0 0 120 80" aria-hidden focusable="false">
          <g fill="none" stroke="currentColor" strokeWidth="1.2">
            <rect x="6"  y="22" width="32" height="44" />
            <rect x="44" y="14" width="32" height="44" />
            <rect x="82" y="22" width="32" height="44" />
            <path d="M38 32 C 41 32 41 26 44 26" />
            <path d="M76 26 C 79 26 79 32 82 32" />
          </g>
        </svg>
      );
    case '02': // a small device with a tiny lock dot
      return (
        <svg viewBox="0 0 120 80" aria-hidden focusable="false">
          <g fill="none" stroke="currentColor" strokeWidth="1.2">
            <rect x="20" y="22" width="80" height="44" rx="2" />
            <circle cx="60" cy="44" r="5" />
            <path d="M55 39 C 55 33 65 33 65 39" />
          </g>
        </svg>
      );
    case '03': // four softly-opaque circles representing four personas
      return (
        <svg viewBox="0 0 120 60" aria-hidden focusable="false">
          <g fill="currentColor">
            <circle cx="14"  cy="30" r="9" />
            <circle cx="44"  cy="30" r="9" opacity="0.72" />
            <circle cx="74"  cy="30" r="9" opacity="0.45" />
            <circle cx="104" cy="30" r="9" opacity="0.22" />
          </g>
        </svg>
      );
    case '04': // a stacked outline (3–4 horizontal lines of shrinking length)
      return (
        <svg viewBox="0 0 120 80" aria-hidden focusable="false">
          <g fill="none" stroke="currentColor" strokeWidth="1.2">
            <line x1="14" y1="22" x2="106" y2="22" />
            <line x1="14" y1="38" x2="84"  y2="38" />
            <line x1="14" y1="54" x2="94"  y2="54" />
            <line x1="14" y1="70" x2="68"  y2="70" />
          </g>
        </svg>
      );
    case '05': // a single arcing trail — the "trace of thought"
      return (
        <svg viewBox="0 0 120 80" aria-hidden focusable="false">
          <g fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
            <path d="M 8 60 C 30 30 58 22 92 36 C 102 40 108 48 112 58" />
            <path d="M 96 30 L 102 38 L 92 38" />
          </g>
        </svg>
      );
  }
}

type TopicProps = {
  id: TopicId;
  /** Right column is a small mark (vs. the canvas demo, set elsewhere). */
  hasMark?: boolean;
  /** Hooks forwarded so the demo (Topic 01 only) can write back. */
  ambiance: LandingAmbiance;
  onAmbianceChange: (next: LandingAmbiance) => void;
  onUserGesture: () => void;
  demoLocale: Locale;
};

function Topic({
  id,
  hasMark,
  ambiance,
  onAmbianceChange,
  onUserGesture,
  demoLocale,
}: TopicProps) {
  const { t } = useTranslation();
  // i18next's `t` returns a string by default; opt in to the object form for
  // the nested topics namespace.
  const topic = t(`landing.topics.${id}`, { returnObjects: true }) as {
    stamp: string;
    head_l1: string;
    head_l2: string;
    head_l3: string;
    italic_note: string;
  };
  const atmo = TOPIC_ATMO[id];
  const isSplit = Boolean(hasMark) || id === '01';

  return (
    <section className={`lp-scene lp-scene--${atmo}`}>
      <div className={`lp-scene__inner ${isSplit ? 'is-split' : ''}`}>
        <div>
          <div className="lp-topic__stamp-wrap">
            <span className="lp-stamp">{topic.stamp}</span>
          </div>
          <h2 className="lp-stack">
            <span className="lp-stack__line lp-stack__line--xl">{topic.head_l1}</span>
            <span className="lp-stack__line lp-stack__line--l">{topic.head_l2}</span>
            <span className="lp-stack__line lp-stack__line--l">{topic.head_l3}</span>
          </h2>
          <hr className="lp-rule" />
          <p className="lp-footnote">{topic.italic_note}</p>
        </div>
        {id === '01' ? (
          <div className="lp-canvas-col">
            <LandingCanvas
              locale={demoLocale}
              ambiance={ambiance}
              onAmbianceChange={onAmbianceChange}
              onUserGesture={onUserGesture}
            />
          </div>
        ) : hasMark ? (
          <div className="lp-mark-col">
            <div className="lp-mark">
              <TopicMark kind={id} />
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

type LandingPageStackedProps = {
  onEnterApp: () => void;
};

export function LandingPageStacked({ onEnterApp }: LandingPageStackedProps) {
  const { t, i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh') ?? false;
  const demoLocale: Locale = isZh ? 'zh' : 'en';

  const [ambiance, setAmbiance] = useState<LandingAmbiance>('default');
  const [muted, setMuted] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);

  useLandingAmbience({ ambiance, muted, audioUnlocked });

  const unlockAudio = useCallback(() => {
    setAudioUnlocked(true);
  }, []);

  const switchLanguage = useCallback(() => {
    void i18n.changeLanguage(isZh ? 'en' : 'zh');
  }, [i18n, isZh]);

  return (
    <div className="spoor-landing flex flex-col" data-ambiance={ambiance}>
      <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-10 py-5 pointer-events-none">
        <div className="flex items-center gap-2.5 pointer-events-auto text-[color:var(--lp-on-background)]">
          <img src={logoUrl} alt="" className="w-8 h-8 rounded-lg object-contain" />
          <span className="text-xl font-extrabold tracking-tighter" style={{ fontFamily: 'var(--lp-serif)' }}>
            Spoor
          </span>
        </div>
        <div className="flex items-center gap-3 pointer-events-auto">
          {isActiveAmbiance(ambiance) ? (
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              className="inline-flex items-center justify-center w-8 h-8 rounded-full text-[color:var(--lp-on-background)] hover:bg-black/8 transition-colors"
              aria-label={muted ? t('landing.unmute') : t('landing.mute')}
              title={muted ? t('landing.unmute') : t('landing.mute')}
            >
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
          ) : null}
          <button
            type="button"
            onClick={switchLanguage}
            className="text-xs font-semibold text-[color:var(--lp-on-background)] hover:opacity-80 transition-opacity px-2 py-1"
          >
            {isZh ? 'EN' : '中文'}
          </button>
        </div>
      </div>

      <main className="flex-grow">
        {/* Hero — editorial stack + dual CTA */}
        <section className="lp-hero">
          <div className="lp-hero__inner">
            <div className="lp-topic__stamp-wrap">
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
              <a
                href="https://www.youtube.com/@spoor"
                className="lp-cta-secondary"
                target="_blank"
                rel="noreferrer"
              >
                {t('landing.hero_cta_secondary')} →
              </a>
            </div>
          </div>
        </section>

        {/* Topic 01 — A QUIET CANVAS (paper, with interactive demo) */}
        <Topic
          id="01"
          ambiance={ambiance}
          onAmbianceChange={setAmbiance}
          onUserGesture={unlockAudio}
          demoLocale={demoLocale}
        />

        {/* Topic 02 — LOCAL-FIRST (cream, with mark) */}
        <Topic
          id="02"
          hasMark
          ambiance={ambiance}
          onAmbianceChange={setAmbiance}
          onUserGesture={unlockAudio}
          demoLocale={demoLocale}
        />

        {/* Topic 03 — FOUR PERSONAS (red, with mark) */}
        <Topic
          id="03"
          hasMark
          ambiance={ambiance}
          onAmbianceChange={setAmbiance}
          onUserGesture={unlockAudio}
          demoLocale={demoLocale}
        />

        {/* Topic 04 — IN AN EDITABLE PLAN (gray, with mark) */}
        <Topic
          id="04"
          hasMark
          ambiance={ambiance}
          onAmbianceChange={setAmbiance}
          onUserGesture={unlockAudio}
          demoLocale={demoLocale}
        />

        {/* Topic 05 — A TRACE OF THOUGHT (ink, closing) */}
        <Topic
          id="05"
          hasMark
          ambiance={ambiance}
          onAmbianceChange={setAmbiance}
          onUserGesture={unlockAudio}
          demoLocale={demoLocale}
        />

        {/* Footer */}
        <footer className="lp-footer">
          <div className="lp-footer__inner">
            <span className="lp-footer__brand">Spoor · 雪泥</span>
            <div className="lp-footer__nav">
              <a href="https://github.com/iimorning/spoor-pro" target="_blank" rel="noreferrer">
                {t('landing.footer_link_source')}
              </a>
              <a href="#how-it-works">{t('landing.footer_link_docs')}</a>
              <button type="button" onClick={switchLanguage}>
                {isZh ? 'EN' : '中文'}
              </button>
            </div>
            <span className="lp-footer__copy">{t('landing.footer_copy')}</span>
          </div>
        </footer>
      </main>
    </div>
  );
}
