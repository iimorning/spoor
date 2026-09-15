import { useTranslation } from 'react-i18next';
import { AUP_PATH, PRIVACY_PATH, REPORT_PATH, SUPPORT_EMAIL, TERMS_PATH } from '../constants/siteLegal';
import { GUIDES_PATH } from '../utils/appRoute';
import { MarketingNavLink } from './MarketingNavLink';

function FooterDot() {
  return (
    <span className="lp-footer__dot" aria-hidden>
      ·
    </span>
  );
}

export function MarketingFooter() {
  const { t } = useTranslation();

  return (
    <footer className="lp-footer">
      <p className="lp-footer__copy">{t('landing.footer_copy')}</p>
      <div className="lp-footer__links">
        <MarketingNavLink href={GUIDES_PATH} className="lp-footer__link">
          {t('landing.nav_guides')}
        </MarketingNavLink>
        <FooterDot />
        <a href={TERMS_PATH} className="lp-footer__link">
          {t('landing.policy.tos')}
        </a>
        <FooterDot />
        <a href={AUP_PATH} className="lp-footer__link">
          {t('landing.policy.aup')}
        </a>
        <FooterDot />
        <a href={PRIVACY_PATH} className="lp-footer__link">
          {t('landing.policy.privacy')}
        </a>
        <FooterDot />
        <a href={REPORT_PATH} className="lp-footer__link">
          {t('landing.policy.report')}
        </a>
        <FooterDot />
        <a href={`mailto:${SUPPORT_EMAIL}`} className="lp-footer__link">
          {t('landing.footer_contact', { email: SUPPORT_EMAIL })}
        </a>
      </div>
    </footer>
  );
}
