import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../src/i18n';
import { CjkFontProgressBar } from '../../src/components/CjkFontProgressBar';
import { loadNoteCjkFont } from '../../src/hooks/useNoteCjk';

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CjkFontProgressBar', () => {
  it('shows while a CJK face downloads, then hides', async () => {
    const load = vi.fn(async function (this: { family: string }) {
      return this;
    });
    class FakeFontFace {
      family: string;
      load = load;
      constructor(family: string) {
        this.family = family;
      }
    }
    vi.stubGlobal('FontFace', FakeFontFace);
    Object.defineProperty(document, 'fonts', { configurable: true, value: { add: vi.fn() } });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'Content-Length': '4' } })),
    );

    render(
      <I18nextProvider i18n={i18n}>
        <CjkFontProgressBar />
      </I18nextProvider>,
    );

    const pending = loadNoteCjkFont('liyu');
    await waitFor(() => {
      expect(screen.getByTestId('cjk-font-progress')).toBeInTheDocument();
    });
    await pending;
    await waitFor(() => {
      expect(screen.queryByTestId('cjk-font-progress')).not.toBeInTheDocument();
    });
  });
});
