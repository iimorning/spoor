/**
 * LandingPage — classic hero + interactive notes canvas demo.
 *
 * Production `/` route. Editorial variants are archived (not wired):
 *   • LandingPageFocusLinked.tsx + landing.focus-linked.css + landing-collage.tsx
 *   • LandingPageStacked.tsx + landing.stacked.css
 * See those files' headers for how to reactivate.
 */

import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Volume2, VolumeX, Play } from 'lucide-react';
import logoUrl from '../../LOGO.png';
import { LandingCanvas } from './LandingCanvas';
import seaImg from '../assets/landing/sea.jpg';
import forestImg from '../assets/landing/forest.jpg';
import { LandingAiSearchResultThumb } from './landing/LandingAiSearchResultThumb';
import { LandingAiGeneratedImage } from './landing/LandingAiGeneratedImage';
import { LandingRolesDemo } from './landing/LandingRolesDemo';
import { LandingPromoFilm } from './landing/LandingPromoFilm';
import { LandingPhoneMemo } from './landing/LandingPhoneMemo';
import { LandingOpenSource } from './landing/LandingOpenSource';
import { MarketingFooter } from './MarketingFooter';
import { useLandingAmbience } from '../hooks/useLandingAmbience';
import {
  isActiveAmbiance,
  type LandingAmbiance,
} from '../utils/landingAmbience';
import { MarketingNavLink } from './MarketingNavLink';
import {
  COMMUNITY_PATH,
  GUIDES_PATH,
  navigateToCommunity,
} from '../utils/appRoute';
import {
  OFFICIAL_AUTHOR_UID,
  OFFICIAL_LISTINGS,
  resolveOfficialListingMeta,
  resolveOfficialListingThumbUrl,
} from '../constants/officialCommunityListings';
import { applyCommunityListing } from '../utils/applyCommunityListing';
import type { CommunityListing } from '../services/community';
import { useAppDialog } from './AppDialogProvider';
import '../landing.css';
import './landing.community.css';
import './policy-modal.css';

type LandingPageProps = {
  onEnterApp: () => void;
  onGoToPricing?: () => void;
};

// Same tilt rhythm as CommunityPage so embedded cards feel like the gallery.
const COMMUNITY_TILTS = [
  'cm-card--tilt-l',
  'cm-card--tilt-r',
  'cm-card--tilt-h',
  'cm-card--tilt-l',
  'cm-card--tilt-r',
];

export function LandingPage({ onEnterApp }: LandingPageProps) {
  const { t, i18n } = useTranslation();
  const { alert: appAlert } = useAppDialog();

  const isZh = i18n.language?.startsWith('zh') ?? false;
  const demoLocale: 'zh' | 'en' = isZh ? 'zh' : 'en';

  const [ambiance, setAmbiance] = useState<LandingAmbiance>('default');
  const [muted, setMuted] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [applyingListingId, setApplyingListingId] = useState<string | null>(null);

  useLandingAmbience({ ambiance, muted, audioUnlocked });

  const unlockAudio = useCallback(() => {
    setAudioUnlocked(true);
  }, []);

  // One-click apply mirrors CommunityPage.handleApply but works directly off
  // OFFICIAL_LISTINGS — the apply path doesn't need Supabase, so signed-out
  // visitors can spawn a canvas too. For official rows, applyCommunityListing
  // ignores the supplied payload and rebuilds it from the official overlay
  // (applyCommunityListing.ts:17-19), so we just hand it the minimum fields
  // it actually reads: id, is_official, title.
  const handleApplyFromLanding = useCallback(
    async (listingId: string, title: string) => {
      setApplyingListingId(listingId);
      try {
        const listing = {
          id: listingId,
          is_official: true,
          title,
          author_id: OFFICIAL_AUTHOR_UID,
          author_name: 'Spoor',
          // Placeholder values for fields applyCommunityListing never reads
          // on the official path.
          kind: 'canvas' as const,
          description: '',
          cover_url: null,
          payload: {
            version: 1 as const,
            kind: 'canvas' as const,
            template: {
              id: '',
              name: '',
              description: '',
              origin: 'user' as const,
              builtinKey: null,
              listed: true,
              personaIds: [],
              nodes: [],
              edges: [],
              createdAt: 0,
              updatedAt: 0,
            },
            agents: [],
          },
          published: true,
          like_count: 0,
          favorite_count: 0,
          comment_count: 0,
          apply_count: 0,
          created_at: new Date().toISOString(),
        } as unknown as CommunityListing;
        await applyCommunityListing(listing);
        onEnterApp();
      } catch (e) {
        await appAlert({
          title: t('community.error_title'),
          message: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setApplyingListingId(null);
      }
    },
    [appAlert, onEnterApp, t],
  );

  return (
    <div className="spoor-landing flex flex-col" data-ambiance={ambiance}>
      <div className="lp-ambiance-bed" aria-hidden>
        <div
          className={`lp-ambiance-layer lp-ambiance-layer--sea${ambiance === 'sea' ? ' is-on' : ''}`}
        />
        <div
          className={`lp-ambiance-layer lp-ambiance-layer--forest${ambiance === 'forest' ? ' is-on' : ''}`}
        />
        <div
          className={`lp-ambiance-layer lp-ambiance-layer--volcano${ambiance === 'volcano' ? ' is-on' : ''}`}
        />
      </div>

      <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-10 py-5 pointer-events-none">
        <div className="flex items-center gap-2.5 text-[color:var(--lp-primary)] pointer-events-auto">
          <img src={logoUrl} alt="" className="w-8 h-8 rounded-lg object-contain" />
          <span className="text-xl font-extrabold tracking-tighter">Spoor</span>
        </div>
        <div className="flex items-center gap-3 pointer-events-auto">
          <MarketingNavLink
            href={GUIDES_PATH}
            className="text-xs font-semibold text-[color:var(--lp-primary)] hover:opacity-80 transition-opacity px-2 py-1"
          >
            {t('landing.nav_guides')}
          </MarketingNavLink>
          <MarketingNavLink
            href={COMMUNITY_PATH}
            className="text-xs font-semibold text-[color:var(--lp-primary)] hover:opacity-80 transition-opacity px-2 py-1"
          >
            {t('landing.nav_community')}
          </MarketingNavLink>
          {isActiveAmbiance(ambiance) ? (
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              className="inline-flex items-center justify-center w-8 h-8 rounded-full text-[color:var(--lp-primary)] hover:bg-[color:var(--lp-primary)]/8 transition-colors"
              aria-label={muted ? t('landing.unmute') : t('landing.mute')}
              title={muted ? t('landing.unmute') : t('landing.mute')}
            >
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void i18n.changeLanguage(isZh ? 'en' : 'zh')}
            className="text-xs font-semibold text-[color:var(--lp-primary)] hover:opacity-80 transition-opacity px-2 py-1"
          >
            {isZh ? 'EN' : '中文'}
          </button>
        </div>
      </div>

      <main className="flex-grow pt-20 md:pt-24 pb-[var(--lp-section-padding)] relative">
        <section className="relative min-h-[90vh] flex flex-col items-center justify-start pt-6 md:pt-10 px-6 md:px-10 max-w-[1400px] mx-auto">
          <div className="z-10 text-center max-w-3xl mb-4 relative">
            <h1 className="text-[clamp(2rem,5vw,3rem)] font-extrabold tracking-[-0.035em] leading-none text-[color:var(--lp-on-background)] mb-7 flex flex-col items-center gap-3 md:gap-5">
              <span>{t('landing.hero_title_line1')}</span>
              <span>{t('landing.hero_title_line2')}</span>
            </h1>
            <div className="flex flex-wrap items-center justify-center gap-4 mb-6">
              <button
                type="button"
                onClick={onEnterApp}
                className="px-7 py-3.5 bg-[color:var(--lp-primary)] text-white rounded-full text-xs font-semibold shadow-[0_10px_24px_rgba(126,37,0,0.22)] hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(126,37,0,0.28)] transition-all duration-300"
              >
                {t('landing.cta_explore')}
              </button>
            </div>
          </div>

          <div className="w-full mt-6 md:mt-8">
            <LandingCanvas
              locale={demoLocale}
              ambiance={ambiance}
              onAmbianceChange={setAmbiance}
              onUserGesture={unlockAudio}
            />
          </div>
        </section>

        <LandingPromoFilm locale={demoLocale} />

        {/* Drop-to-canvas — show visitors that any book, image, or video can
            become a card on the canvas and feed the AI. Three real-looking
            covers (a Penguin-style book cover rendered inline, a film-still
            photo with play overlay, a plain photo) carry the meaning without
            needing explanatory text. */}
        <section
          id="drop-to-canvas"
          aria-labelledby="drop-to-canvas-heading"
          className="relative px-6 md:px-10 max-w-[1400px] mx-auto pt-[var(--lp-section-padding)] pb-[var(--lp-section-padding)]"
        >
          <div className="lp-drop-hero mb-12 md:mb-16">
            <p className="lp-drop-eyebrow">
              {t('landing.drop_eyebrow')}
            </p>
            <h1
              id="drop-to-canvas-heading"
              className="lp-drop-heading"
            >
              {t('landing.drop_heading_l1')}
              <br />
              {t('landing.drop_heading_l2')}
            </h1>
          </div>

          <div className="lp-drop-grid">
            {/* Book — SVG-rendered cover, Penguin-classic style. No third-party
                asset: the title text is generic ("Reader's Notebook") so we
                don't ship a real published cover we don't have rights to. */}
            <figure
              data-testid="lp-drop-card-book"
              className="lp-drop-cover lp-drop-tilt-l"
            >
              <div className="lp-drop-cover__chrome" aria-hidden>
                <div className="lp-drop-cover__frame">
                  <svg viewBox="0 0 240 360" className="lp-drop-cover__svg" role="img">
                    <defs>
                      <linearGradient id="lp-book-bg" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#7e2500" />
                        <stop offset="100%" stopColor="#a63400" />
                      </linearGradient>
                    </defs>
                    <rect x="0" y="0" width="240" height="360" fill="url(#lp-book-bg)" />
                    <rect x="0" y="0" width="240" height="360" fill="none" stroke="#ffc8b6" strokeWidth="3" />
                    <rect x="14" y="14" width="212" height="332" fill="none" stroke="#ffc8b6" strokeWidth="1" />
                    <text
                      x="120"
                      y="148"
                      textAnchor="middle"
                      fill="#ffc8b6"
                      fontFamily="var(--font-newsreader), Georgia, var(--cjk-ui), serif"
                      fontSize="22"
                      fontStyle="italic"
                    >{t('landing.drop_card_book_title_line1')}</text>
                    <text
                      x="120"
                      y="180"
                      textAnchor="middle"
                      fill="#ffc8b6"
                      fontFamily="var(--font-newsreader), Georgia, var(--cjk-ui), serif"
                      fontSize="22"
                      fontStyle="italic"
                    >{t('landing.drop_card_book_title_line2')}</text>
                    <line x1="48" y1="208" x2="192" y2="208" stroke="#ffc8b6" strokeWidth="1" />
                    <text
                      x="120"
                      y="240"
                      textAnchor="middle"
                      fill="#ffc8b6"
                      fontFamily="var(--font-sans)"
                      fontSize="9"
                      letterSpacing="2"
                    >{t('landing.drop_card_book_author')}</text>
                    <text
                      x="120"
                      y="330"
                      textAnchor="middle"
                      fill="#ffc8b6"
                      fontFamily="var(--font-sans)"
                      fontSize="9"
                      letterSpacing="3"
                    >SPOOR · CLASSICS</text>
                  </svg>
                </div>
              </div>
              <figcaption className="lp-drop-cover__chip">PDF · EPUB · DOCX · TXT · MD</figcaption>
            </figure>

            {/* Image — a real photo from the existing Spoor ambiance set. */}
            <figure
              data-testid="lp-drop-card-image"
              className="lp-drop-cover lp-drop-tilt-r"
            >
              <div className="lp-drop-cover__chrome" aria-hidden>
                <div className="lp-drop-cover__frame">
                  <img src={forestImg} alt="" className="lp-drop-cover__img" />
                </div>
              </div>
              <figcaption className="lp-drop-cover__chip">PNG · JPG · WebP · GIF · SVG</figcaption>
            </figure>

            {/* Video — film-still treatment: a real photo with a centered play
                button and a "0:42" timestamp badge. Reads as a video thumbnail
                without needing a poster asset. */}
            <figure
              data-testid="lp-drop-card-video"
              className="lp-drop-cover lp-drop-tilt-h"
            >
              <div className="lp-drop-cover__chrome" aria-hidden>
                <div className="lp-drop-cover__frame">
                  <img src={seaImg} alt="" className="lp-drop-cover__img lp-drop-cover__img--film" />
                  <div className="lp-drop-cover__film" />
                  <div className="lp-drop-cover__play">
                    <Play className="w-7 h-7" fill="currentColor" />
                  </div>
                  <div className="lp-drop-cover__time">
                    <span>0:42</span>
                  </div>
                </div>
              </div>
              <figcaption className="lp-drop-cover__chip">MP4 · MOV · WebM · MKV</figcaption>
            </figure>
          </div>
        </section>

        {/* AI capabilities — once a book / image / video is on the canvas, the
            AI can search the web for context and generate illustrations. Two
            cards mirror the canvas chrome and show what each capability
            actually looks like in practice. Sits before the multi-persona
            reading demo. */}
        <section
          id="ai-capabilities"
          aria-labelledby="ai-capabilities-heading"
          className="relative px-6 md:px-10 max-w-[1400px] mx-auto pt-[var(--lp-section-padding)] pb-[var(--lp-section-padding)]"
        >
          <div className="lp-ai-hero mb-12 md:mb-16">
            <p className="lp-ai-eyebrow">{t('landing.ai_eyebrow')}</p>
            <h1 id="ai-capabilities-heading" className="lp-ai-heading">
              <span>{t('landing.ai_heading_l1')}</span>
              <span>{t('landing.ai_heading_l2')}</span>
            </h1>
            <p className="lp-ai-lede">{t('landing.ai_lede')}</p>
          </div>

          <div className="lp-ai-grid">
            {/* Web search — a notebook excerpt that asks a question, then a
                vertical stack of search-result rows (thumb + title + URL).
                Reads like a real search results page. */}
            <figure data-testid="lp-ai-card-search" className="lp-ai-card">
              <div className="lp-ai-card__chrome">
                <div className="lp-ai-card__ask">
                  <span className="lp-ai-card__ask-icon" aria-hidden>?</span>
                  <p className="lp-ai-card__ask-text">
                    {t('landing.ai_search_question')}
                  </p>
                </div>
                <div className="lp-ai-card__divider" aria-hidden />
                <ol className="lp-ai-card__results">
                  {[
                    { i: '01', kind: 'wikipedia' as const, titleKey: 'landing.ai_search_r1_title', urlKey: 'landing.ai_search_r1_url' },
                    { i: '02', kind: 'aeon' as const, titleKey: 'landing.ai_search_r2_title', urlKey: 'landing.ai_search_r2_url' },
                    { i: '03', kind: 'journal' as const, titleKey: 'landing.ai_search_r3_title', urlKey: 'landing.ai_search_r3_url' },
                  ].map((row) => (
                    <li key={row.i} className="lp-ai-card__result">
                      <span className="lp-ai-card__result-num">{row.i}</span>
                      <span className="lp-ai-card__result-thumb">
                        <LandingAiSearchResultThumb kind={row.kind} />
                      </span>
                      <span className="lp-ai-card__result-text">
                        <span className="lp-ai-card__result-title">
                          {t(row.titleKey)}
                        </span>
                        <span className="lp-ai-card__result-url">
                          {t(row.urlKey)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
              <figcaption className="lp-ai-card__caption">
                {t('landing.ai_search_caption')}
              </figcaption>
            </figure>

            {/* Image generation — an AI-generated illustration card with the
                prompt printed on the front and a small "Gemini Flash Image" badge.
                Same dimensions as the search card so the row stays balanced. */}
            <figure data-testid="lp-ai-card-image" className="lp-ai-card">
              <div className="lp-ai-card__chrome">
                <div className="lp-ai-card__frame">
                  <LandingAiGeneratedImage className="lp-ai-card__img" />
                  <div className="lp-ai-card__gen-badge">
                    {t('landing.ai_image_badge')}
                  </div>
                  <div className="lp-ai-card__prompt" aria-hidden>
                    <span className="lp-ai-card__prompt-label">
                      {t('landing.ai_image_prompt_label')}
                    </span>
                    <span className="lp-ai-card__prompt-text">
                      {t('landing.ai_image_prompt_text')}
                    </span>
                  </div>
                </div>
                <div className="lp-ai-card__meta">
                  <span className="lp-ai-card__meta-label">
                    {t('landing.ai_image_meta_label')}
                  </span>
                  <span className="lp-ai-card__meta-text">
                    {t('landing.ai_image_meta_text')}
                  </span>
                </div>
              </div>
              <figcaption className="lp-ai-card__caption">
                {t('landing.ai_image_caption')}
              </figcaption>
            </figure>
          </div>
        </section>

        {/* Multi-persona reading — one ordinary note, two voices, and a
            visible “add a persona” slot. */}
        <section
          id="roles"
          aria-labelledby="roles-heading"
          className="relative px-6 md:px-10 max-w-[1400px] mx-auto pt-[var(--lp-section-padding)] pb-[var(--lp-section-padding)]"
        >
          <div className="lp-roles-hero mb-12 md:mb-16">
            <p className="lp-roles-eyebrow">{t('landing.roles_eyebrow')}</p>
            <h1 id="roles-heading" className="lp-roles-heading">
              <span>{t('landing.roles_heading_l1')}</span>
              <span>{t('landing.roles_heading_l2')}</span>
            </h1>
            <p className="lp-roles-lede">{t('landing.roles_lede')}</p>
          </div>
          <LandingRolesDemo />
        </section>

        <LandingPhoneMemo />

        {/* Community play packs — sourced from OFFICIAL_LISTINGS so the page
            stays in sync with /community and the Supabase seed migration.
            Wrapped in .spoor-community to reuse the .cm-card / .cm-grid styles
            from landing.community.css. min-height is overridden inline because
            the .spoor-community page-wrapper style assumes 100vh; embedded as
            a landing section we want it to size to content. */}
        <section
          id="community"
          aria-labelledby="community-heading"
          className="relative px-6 md:px-10 max-w-[1400px] mx-auto"
        >
          <div className="spoor-community" style={{ minHeight: 'auto' }}>
            <div className="cm-hero">
              <h1 id="community-heading">{t('landing.community_heading')}</h1>
              <p>{t('landing.community_subtitle')}</p>
            </div>
            <div className="cm-grid">
              {OFFICIAL_LISTINGS.map((listing, index) => {
                const meta = resolveOfficialListingMeta(listing.listingId);
                // Thumbnail only — the full-res cover is reserved for the
                // canvas-side persona card where the larger source matters.
                const cover = resolveOfficialListingThumbUrl(listing.listingId);
                const tiltClass = COMMUNITY_TILTS[index % COMMUNITY_TILTS.length];
                return (
                  <article
                    key={listing.listingId}
                    className={`cm-card cm-card--polaroid ${tiltClass}`}
                    onClick={() => navigateToCommunity(listing.listingId)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        navigateToCommunity(listing.listingId);
                      }
                    }}
                    role="link"
                    tabIndex={0}
                    aria-label={meta?.title ?? ''}
                  >
                    {cover ? (
                      <img className="cm-card__cover" src={cover} alt="" />
                    ) : null}
                    <div className="cm-card__body">
                      <h2 className="cm-card__title">{meta?.title ?? ''}</h2>
                      <p className="cm-card__lede line-clamp-3">
                        {meta?.description ?? ''}
                      </p>
                    </div>
                    <div
                      className="cm-card__actions justify-end"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        className="lp-pricing-mini-cta"
                        disabled={applyingListingId === listing.listingId}
                        onClick={() =>
                          void handleApplyFromLanding(listing.listingId, meta?.title ?? '')
                        }
                      >
                        {t('community.apply')}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="mt-12 flex justify-center">
              <MarketingNavLink href={COMMUNITY_PATH} className="lp-pricing-mini-cta">
                {t('landing.community_browse_all')}
              </MarketingNavLink>
            </div>
          </div>
        </section>

        <LandingOpenSource />
      </main>

      <MarketingFooter />
    </div>
  );
}
