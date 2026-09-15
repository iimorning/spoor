import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import logoUrl from '../../LOGO.png';
import { navigateToLanding } from '../utils/appRoute';
import { MarketingFooter } from './MarketingFooter';
import {
  POLICY_DOCS,
  PolicyDocumentBody,
  pickInitialPolicyLocale,
  type PolicyKind,
  type PolicyLocale,
} from './policyContent';
import '../landing.css';
import './policy-modal.css';

type PolicyPageProps = {
  kind: PolicyKind;
};

export function PolicyPage({ kind }: PolicyPageProps) {
  const { t, i18n } = useTranslation();
  const [locale, setLocale] = useState<PolicyLocale>(() => pickInitialPolicyLocale(i18n.language));

  useEffect(() => {
    setLocale(pickInitialPolicyLocale(i18n.language));
  }, [kind, i18n.language]);

  const doc = POLICY_DOCS[kind][locale];
  const title = t(doc.titleKeyEn);

  return (
    <div className="spoor-landing policy-page flex flex-col min-h-screen">
      <header className="policy-page__topbar">
        <button type="button" className="policy-page__brand" onClick={navigateToLanding}>
          <img src={logoUrl} alt="" />
          <span>Spoor</span>
        </button>
        <div className="policy-page__actions">
          <div className="policy-modal__lang" role="group" aria-label={t('policy.lang_toggle')}>
            <button
              type="button"
              className={`policy-modal__lang-btn ${locale === 'en' ? 'is-active' : ''}`}
              aria-pressed={locale === 'en'}
              onClick={() => setLocale('en')}
            >
              EN
            </button>
            <button
              type="button"
              className={`policy-modal__lang-btn ${locale === 'zh' ? 'is-active' : ''}`}
              aria-pressed={locale === 'zh'}
              onClick={() => setLocale('zh')}
            >
              中文
            </button>
          </div>
          <button type="button" className="policy-page__back" onClick={navigateToLanding}>
            {t('policy.back_home')}
          </button>
        </div>
      </header>

      <main className="policy-page__main">
        <article className="policy-page__article" aria-label={title}>
          <h1 className="policy-page__title">{title}</h1>
          <div className="policy-page__body policy-modal__body policy-modal__body--page">
            <PolicyDocumentBody source={doc.source} />
          </div>
        </article>
      </main>

      <MarketingFooter />
    </div>
  );
}
