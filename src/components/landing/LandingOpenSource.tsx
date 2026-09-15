import { Github } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SOURCE_REPO_URL } from '../../constants/desktopRelease';

const BULLETS = ['landing.oss_b1', 'landing.oss_b2', 'landing.oss_b3'] as const;

export function LandingOpenSource() {
  const { t } = useTranslation();

  return (
    <section
      id="open-source"
      aria-labelledby="open-source-heading"
      className="relative px-6 md:px-10 max-w-[1400px] mx-auto pt-[var(--lp-section-padding)] pb-[var(--lp-section-padding)]"
    >
      <div className="lp-oss-hero mb-10 md:mb-12">
        <p className="lp-oss-eyebrow">{t('landing.oss_eyebrow')}</p>
        <h1 id="open-source-heading" className="lp-oss-heading">
          {t('landing.oss_heading')}
        </h1>
        <p className="lp-oss-lede">{t('landing.oss_lede')}</p>
      </div>
      <div className="lp-oss-chrome">
        <ul className="lp-oss-list">
          {BULLETS.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
        <p className="lp-oss-license">{t('landing.oss_license')}</p>
        <a
          className="lp-oss-cta"
          href={SOURCE_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="lp-oss-github"
        >
          <Github className="w-4 h-4" aria-hidden />
          <span>{t('landing.oss_cta')}</span>
        </a>
      </div>
    </section>
  );
}
