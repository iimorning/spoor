import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

// Root 用的是具名导出（lazy 里 .then(m => ({ default: m.LandingPage }))）。
vi.mock('../src/components/LandingPage', () => ({
  LandingPage: () => <div data-testid="landing" />,
  default: () => <div data-testid="landing" />,
}));
vi.mock('../src/AppEntry', () => ({
  default: () => <div data-testid="app" />,
  AppEntry: () => <div data-testid="app" />,
}));
vi.mock('../src/components/CjkFontProgressBar', () => ({ CjkFontProgressBar: () => null }));
vi.mock('../src/components/AppLoadingScreen', () => ({ AppLoadingScreen: () => null }));
vi.mock('../src/utils/isTauriRuntime', () => ({ isTauriRuntime: () => false }));

import Root from '../src/Root';
import { AppEntryGateProvider } from '../src/contexts/AppEntryGateContext';

function renderRoot() {
  return render(
    <AppEntryGateProvider>
      <Root />
    </AppEntryGateProvider>,
  );
}

function goto(path: string) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

describe('Root — 营销页不参与暗色', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = '';
    document.documentElement.dataset.theme = 'dark';
    goto('/');
  });

  it('renders the landing page in light even when the app theme is dark', async () => {
    renderRoot();
    // 落地页的演示卡是拿 bg-white 做白底的，暗色层会把它改写成深色——
    // 页面本身却是亮色，于是变成"浅底 + 黑卡"。这里把根主题按亮色钉住。
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
  });

  it('leaves the app on its own theme', async () => {
    goto('/app');
    renderRoot();
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
  });

  it('gives the theme back when the reader walks into the app', async () => {
    const view = renderRoot();
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));

    goto('/app');
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    view.unmount();
  });
});
