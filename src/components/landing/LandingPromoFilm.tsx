import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Maximize2, Minimize2, Play } from 'lucide-react';

export const LANDING_ZH_PROMO_SRC = '/landing/xueni-promo-zh.mp4';
export const LANDING_EN_PROMO_SRC = '/landing/xueni-promo-en.mp4';
export const LANDING_ZH_PROMO_POSTER = '/landing/xueni-promo-poster.jpg';
export const LANDING_EN_PROMO_POSTER = '/landing/xueni-promo-poster-en.jpg';

type LandingPromoFilmProps = {
  locale: 'zh' | 'en';
};

type VideoWithWebkitFullscreen = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
};

function isStageFullscreen(stage: HTMLElement | null): boolean {
  if (!stage) return false;
  const fs = document.fullscreenElement;
  return fs === stage || stage.contains(fs);
}

async function enterPromoFullscreen(stage: HTMLElement, video: HTMLVideoElement) {
  try {
    if (stage.requestFullscreen) {
      await stage.requestFullscreen();
      return;
    }
  } catch {
    /* fall through to iOS video fullscreen */
  }
  (video as VideoWithWebkitFullscreen).webkitEnterFullscreen?.();
}

export function LandingPromoFilm({ locale }: LandingPromoFilmProps) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const src = locale === 'zh' ? LANDING_ZH_PROMO_SRC : LANDING_EN_PROMO_SRC;
  const poster = locale === 'zh' ? LANDING_ZH_PROMO_POSTER : LANDING_EN_PROMO_POSTER;
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    videoRef.current?.pause();
    setPlaying(false);
    setProgress(0);
  }, [src]);

  useEffect(() => {
    const sync = () => setFullscreen(isStageFullscreen(stageRef.current));
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const play = async () => {
    const el = videoRef.current;
    if (!el) return;
    try {
      await el.play();
    } catch {
      /* autoplay policies / missing file in tests */
    }
  };

  const toggle = () => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) void play();
    else el.pause();
  };

  const toggleFullscreen = () => {
    const stage = stageRef.current;
    const video = videoRef.current;
    if (!stage || !video) return;
    if (isStageFullscreen(stage)) {
      void document.exitFullscreen?.();
      return;
    }
    void enterPromoFullscreen(stage, video);
  };

  return (
    <section
      id="promo-film"
      aria-labelledby="promo-film-heading"
      className="relative px-6 md:px-10 max-w-[1400px] mx-auto pt-[var(--lp-section-padding)] pb-[var(--lp-section-padding)]"
    >
      <div className="lp-promo-hero mb-10 md:mb-12">
        <p className="lp-promo-eyebrow">{t('landing.promo_eyebrow')}</p>
        <h1 id="promo-film-heading" className="lp-promo-heading">
          {t('landing.promo_heading')}
        </h1>
      </div>
      <div className="lp-promo-chrome">
        <div ref={stageRef} className="lp-promo-stage" data-testid="lp-promo-stage">
          <video
            key={src}
            ref={videoRef}
            data-testid="lp-promo-video"
            className="lp-promo-video"
            playsInline
            preload="none"
            src={src}
            poster={poster}
            aria-label={t('landing.promo_video_label')}
            onClick={toggle}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => {
              setPlaying(false);
              setProgress(0);
            }}
            onTimeUpdate={(e) => {
              const el = e.currentTarget;
              if (!el.duration) return;
              setProgress(el.currentTime / el.duration);
            }}
          />
          {playing ? (
            <div className="lp-promo-progress" aria-hidden>
              <span style={{ width: `${Math.min(100, progress * 100)}%` }} />
            </div>
          ) : (
            <button
              type="button"
              data-testid="lp-promo-play"
              className="lp-promo-play"
              onClick={() => void play()}
              aria-label={t('landing.promo_play')}
            >
              <Play className="w-7 h-7" fill="currentColor" />
            </button>
          )}
          <button
            type="button"
            data-testid="lp-promo-fullscreen"
            className="lp-promo-fs"
            onClick={(e) => {
              e.stopPropagation();
              toggleFullscreen();
            }}
            aria-label={t(fullscreen ? 'landing.promo_exit_fullscreen' : 'landing.promo_fullscreen')}
          >
            {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </section>
  );
}
