import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import logoUrl from '../../LOGO.png';
import { AUP_PATH, REPORT_EMAIL } from '../constants/siteLegal';
import { navigateToLanding } from '../utils/appRoute';
import { MarketingFooter } from './MarketingFooter';
import '../landing.css';
import './policy-modal.css';

const CATEGORIES = [
  'nsfw',
  'violence',
  'hate',
  'csam',
  'deepfake',
  'ip',
  'other',
] as const;

type CategoryId = (typeof CATEGORIES)[number];

export function ReportPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [url, setUrl] = useState('');
  const [details, setDetails] = useState('');
  const [categories, setCategories] = useState<CategoryId[]>([]);

  const mailtoHref = useMemo(() => {
    const picked = categories.map((id) => t(`report.category_${id}`)).join(', ');
    const body = [
      t('report.mail_email', { email: email.trim() || '—' }),
      t('report.mail_url', { url: url.trim() || '—' }),
      t('report.mail_categories', { categories: picked || '—' }),
      '',
      details.trim() || t('report.mail_details_empty'),
    ].join('\n');
    const params = new URLSearchParams({
      subject: t('report.mail_subject'),
      body,
    });
    return `mailto:${REPORT_EMAIL}?${params.toString().replace(/\+/g, '%20')}`;
  }, [categories, details, email, t, url]);

  const toggle = (id: CategoryId) => {
    setCategories((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <div className="spoor-landing policy-page flex flex-col min-h-screen">
      <header className="policy-page__topbar">
        <button type="button" className="policy-page__brand" onClick={navigateToLanding}>
          <img src={logoUrl} alt="" />
          <span>Spoor</span>
        </button>
        <div className="policy-page__actions">
          <button type="button" className="policy-page__back" onClick={navigateToLanding}>
            {t('policy.back_home')}
          </button>
        </div>
      </header>

      <main className="policy-page__main">
        <article className="policy-page__article" aria-label={t('report.title')}>
          <h1 className="policy-page__title">{t('report.title')}</h1>
          <div className="policy-page__body policy-modal__body policy-modal__body--page">
            <p>{t('report.lede')}</p>
            <p>
              {t('report.mailbox_label')}{' '}
              <a href={`mailto:${REPORT_EMAIL}`}>{REPORT_EMAIL}</a>
            </p>
            <p>
              <a href={AUP_PATH}>{t('report.read_aup')}</a>
            </p>

            <form
              className="report-form"
              onSubmit={(e) => {
                e.preventDefault();
                window.location.href = mailtoHref;
              }}
            >
              <label className="report-form__field">
                <span>{t('report.field_email')}</span>
                <input
                  type="email"
                  value={email}
                  onChange={(ev) => setEmail(ev.target.value)}
                  autoComplete="email"
                />
              </label>
              <label className="report-form__field">
                <span>{t('report.field_url')}</span>
                <input type="text" value={url} onChange={(ev) => setUrl(ev.target.value)} />
              </label>
              <fieldset className="report-form__field">
                <legend>{t('report.field_categories')}</legend>
                {CATEGORIES.map((id) => (
                  <label key={id} className="report-form__check">
                    <input
                      type="checkbox"
                      checked={categories.includes(id)}
                      onChange={() => toggle(id)}
                    />
                    {t(`report.category_${id}`)}
                  </label>
                ))}
              </fieldset>
              <label className="report-form__field">
                <span>{t('report.field_details')}</span>
                <textarea
                  rows={8}
                  value={details}
                  onChange={(ev) => setDetails(ev.target.value)}
                  required
                />
              </label>
              <button type="submit" className="report-form__submit">
                {t('report.submit')}
              </button>
            </form>
          </div>
        </article>
      </main>

      <MarketingFooter />
    </div>
  );
}
