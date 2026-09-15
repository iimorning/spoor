import { useTranslation } from 'react-i18next';
import phoneMemoEditEn from '../../assets/landing/phone-memo-edit-en.png';
import phoneMemoEditZh from '../../assets/landing/phone-memo-edit-zh.png';
import phoneMemoListEn from '../../assets/landing/phone-memo-list-en.png';
import phoneMemoListZh from '../../assets/landing/phone-memo-list-zh.png';

type PhoneShot = {
  src: string;
  alt: string;
  caption: string;
  testId: string;
};

function PhoneDevice({ shot }: { shot: PhoneShot }) {
  return (
    <figure className="lp-phone-shot" data-testid={shot.testId}>
      <div className="lp-phone-device">
        <div className="lp-phone-device__notch" aria-hidden />
        <img
          className="lp-phone-device__screen"
          src={shot.src}
          alt={shot.alt}
          width={390}
          height={844}
          loading="lazy"
          decoding="async"
        />
      </div>
      <figcaption className="lp-phone-caption">{shot.caption}</figcaption>
    </figure>
  );
}

export function LandingPhoneMemo() {
  const { t, i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh') ?? false;

  const shots: PhoneShot[] = [
    {
      src: isZh ? phoneMemoListZh : phoneMemoListEn,
      alt: t('landing.phone_shot_list_alt'),
      caption: t('landing.phone_caption_list'),
      testId: 'lp-phone-memo-list',
    },
    {
      src: isZh ? phoneMemoEditZh : phoneMemoEditEn,
      alt: t('landing.phone_shot_edit_alt'),
      caption: t('landing.phone_caption_edit'),
      testId: 'lp-phone-memo-edit',
    },
  ];

  return (
    <section
      id="phone-memo"
      aria-labelledby="phone-memo-heading"
      className="relative px-6 md:px-10 max-w-[1400px] mx-auto pt-[var(--lp-section-padding)] pb-[var(--lp-section-padding)]"
    >
      <div className="lp-phone-hero mb-10 md:mb-14">
        <p className="lp-phone-eyebrow">{t('landing.phone_eyebrow')}</p>
        <h1 id="phone-memo-heading" className="lp-phone-heading">
          <span>{t('landing.phone_heading_l1')}</span>
          <span>{t('landing.phone_heading_l2')}</span>
        </h1>
        <p className="lp-phone-lede">{t('landing.phone_lede')}</p>
      </div>

      <div className="lp-phone-grid" data-testid="lp-phone-memo">
        {shots.map((shot) => (
          <PhoneDevice key={shot.testId} shot={shot} />
        ))}
      </div>
    </section>
  );
}
