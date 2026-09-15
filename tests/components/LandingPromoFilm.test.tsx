import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../src/i18n';
import {
  LANDING_EN_PROMO_POSTER,
  LANDING_EN_PROMO_SRC,
  LANDING_ZH_PROMO_POSTER,
  LANDING_ZH_PROMO_SRC,
  LandingPromoFilm,
} from '../../src/components/landing/LandingPromoFilm';

function renderFilm(locale: 'zh' | 'en') {
  return render(
    <I18nextProvider i18n={i18n}>
      <LandingPromoFilm locale={locale} />
    </I18nextProvider>,
  );
}

describe('LandingPromoFilm', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('shows the Chinese trailer for zh visitors', async () => {
    await i18n.changeLanguage('zh');
    renderFilm('zh');
    const video = screen.getByTestId('lp-promo-video');
    expect(video).toHaveAttribute('src', LANDING_ZH_PROMO_SRC);
    expect(video).toHaveAttribute('poster', LANDING_ZH_PROMO_POSTER);
    expect(video).not.toHaveAttribute('controls');
    expect(screen.getByTestId('lp-promo-play')).toBeInTheDocument();
  });

  it('shows the English trailer for en visitors', () => {
    renderFilm('en');
    const video = screen.getByTestId('lp-promo-video');
    expect(video).toHaveAttribute('src', LANDING_EN_PROMO_SRC);
    expect(video).toHaveAttribute('poster', LANDING_EN_PROMO_POSTER);
    expect(screen.getByTestId('lp-promo-play')).toBeInTheDocument();
    expect(screen.queryByTestId('lp-promo-placeholder')).not.toBeInTheDocument();
  });

  it('puts the stage into fullscreen from the corner control', () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    renderFilm('en');
    const stage = screen.getByTestId('lp-promo-stage');
    stage.requestFullscreen = requestFullscreen;
    fireEvent.click(screen.getByTestId('lp-promo-fullscreen'));
    expect(requestFullscreen).toHaveBeenCalled();
  });
});
