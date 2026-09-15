import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../src/i18n';
import { SOURCE_REPO_URL } from '../../src/constants/desktopRelease';
import { LandingOpenSource } from '../../src/components/landing/LandingOpenSource';

function renderOss() {
  return render(
    <I18nextProvider i18n={i18n}>
      <LandingOpenSource />
    </I18nextProvider>,
  );
}

describe('LandingOpenSource', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('links to the public Spoor GitHub repo', () => {
    renderOss();
    const link = screen.getByTestId('lp-oss-github');
    expect(link).toHaveAttribute('href', SOURCE_REPO_URL);
    expect(link).toHaveTextContent('github.com/iimorning/spoor');
  });

  it('shows the Chinese project intro when the locale is zh', async () => {
    await i18n.changeLanguage('zh');
    renderOss();
    expect(screen.getByRole('heading', { name: '开源项目，数据在本地' })).toBeInTheDocument();
    expect(screen.getByText(/本地优先的无限画布/)).toBeInTheDocument();
    expect(screen.getByText(/手机上就能打开记录/)).toBeInTheDocument();
  });
});
