import { Fragment } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from 'react-i18next';
import logoUrl from '../../LOGO.png';
import { MarketingFooter } from './MarketingFooter';
import { MarketingNavLink } from './MarketingNavLink';
import { GUIDES, getGuide, guideCopy, guidePath } from '../geo/guidesContent';
import { prepareGuideMarkdown } from '../geo/guideMarkdown';
import { GUIDES_PATH, APP_PATH, COMMUNITY_PATH, guideSlug } from '../utils/appRoute';
import '../landing.css';
import './landing.community.css';
import './policy-modal.css';
import './guides.css';

const GALLERY_PAPER = ['note', 'quote', 'note', 'quote', 'note'] as const;

type GuidesPageProps = {
  pathname: string;
};

export function GuidesPage({ pathname }: GuidesPageProps) {
  const { t, i18n } = useTranslation();
  const slug = guideSlug(pathname);
  const guide = getGuide(slug);
  const isZh = i18n.language?.startsWith('zh') ?? false;

  return (
    <div
      className={`spoor-landing policy-page guide-page flex flex-col min-h-screen${
        guide ? '' : ' spoor-community guide-page--gallery'
      }`}
    >
      <header className="policy-page__topbar">
        <MarketingNavLink href="/" className="policy-page__brand">
          <img src={logoUrl} alt="" />
          <span>Spoor</span>
        </MarketingNavLink>
        <nav className="guide-page__nav">
          <MarketingNavLink href={GUIDES_PATH} className="policy-page__back">
            {t('landing.nav_guides')}
          </MarketingNavLink>
          <MarketingNavLink href={COMMUNITY_PATH} className="policy-page__back">
            {t('landing.nav_community')}
          </MarketingNavLink>
          <button
            type="button"
            className="policy-page__back"
            onClick={() => void i18n.changeLanguage(isZh ? 'en' : 'zh')}
          >
            {isZh ? 'EN' : '中文'}
          </button>
          <MarketingNavLink href={APP_PATH} className="lp-pricing-mini-cta">
            {t('landing.guides_open_canvas')}
          </MarketingNavLink>
        </nav>
      </header>

      <main className="policy-page__main">
        {guide ? <GuideArticle slug={guide.slug} /> : <GuideIndex />}
      </main>

      <MarketingFooter />
    </div>
  );
}

function GuideIndex() {
  const { t, i18n } = useTranslation();
  const zh = i18n.language?.startsWith('zh') ?? false;

  return (
    <div className="guide-page__gallery">
      <header className="cm-hero">
        <p className="cm-kicker">{t('landing.guides_eyebrow')}</p>
        <h1>{t('landing.guides_index_title')}</h1>
        <p>{t('landing.guides_lede')}</p>
      </header>
      <div className="cm-grid">
        {GUIDES.map((item, index) => {
          const copy = guideCopy(item, zh ? 'zh' : 'en');
          const paper = GALLERY_PAPER[index % GALLERY_PAPER.length];
          return (
            <MarketingNavLink
              key={item.slug}
              href={guidePath(item.slug)}
              className={`cm-card cm-card--${paper}`}
            >
              <span className="cm-kicker">{t('landing.guides_card_kicker')}</span>
              <h2 className="cm-card__title">{copy.h1}</h2>
              <p className="cm-card__lede">{copy.description}</p>
            </MarketingNavLink>
          );
        })}
      </div>
    </div>
  );
}

function GuideArticle({ slug }: { slug: string }) {
  const { t, i18n } = useTranslation();
  const guide = getGuide(slug);
  if (!guide) return <GuideIndex />;
  const copy = guideCopy(guide, i18n.language);
  const lang = i18n.language?.startsWith('zh') ? 'zh' : 'en';

  return (
    <article className="policy-page__article">
      <p className="guide-page__kicker">
        <MarketingNavLink href={GUIDES_PATH}>{t('landing.nav_guides')}</MarketingNavLink>
      </p>
      <h1 className="policy-page__title">{copy.h1}</h1>
      {copy.bodyMarkdown ? (
        <div className="guide-page__body">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => <h2>{children}</h2>,
            }}
          >
            {prepareGuideMarkdown(copy.bodyMarkdown, copy.h1)}
          </ReactMarkdown>
        </div>
      ) : (
        <>
          <p className="guide-page__lede">{copy.lede}</p>
          <div className="guide-page__body">
            {guide.sections.map((section) => (
              <section key={section.heading}>
                <h2>{section.heading}</h2>
                {section.paragraphs.map((paragraph, index) => (
                  <Fragment key={`${section.heading}-${index}`}>
                    <p>{paragraph}</p>
                    {(section.lists ?? [])
                      .filter((list) => list.after === index)
                      .map((list) => (
                        <ul key={`${section.heading}-list-${index}-${list.items[0] ?? ''}`}>
                          {list.items.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      ))}
                  </Fragment>
                ))}
              </section>
            ))}
            {guide.closer ? <p className="guide-page__closer">{guide.closer}</p> : null}
          </div>
        </>
      )}
      <aside className="guide-page__related">
        <h2>{t('landing.guides_related')}</h2>
        <ul>
          {guide.related.map((rel) => {
            const other = getGuide(rel);
            if (!other) return null;
            return (
              <li key={rel}>
                <MarketingNavLink href={guidePath(other.slug)}>
                  {guideCopy(other, lang).h1}
                </MarketingNavLink>
              </li>
            );
          })}
          <li>
            <MarketingNavLink href={GUIDES_PATH}>{t('landing.guides_all')}</MarketingNavLink>
          </li>
          <li>
            <MarketingNavLink href="/">{t('landing.guides_home')}</MarketingNavLink>
          </li>
          <li>
            <MarketingNavLink href={COMMUNITY_PATH}>
              {t('landing.guides_community_canvases')}
            </MarketingNavLink>
          </li>
          <li>
            <MarketingNavLink href={APP_PATH}>{t('landing.guides_open_the_canvas')}</MarketingNavLink>
          </li>
        </ul>
      </aside>
    </article>
  );
}
