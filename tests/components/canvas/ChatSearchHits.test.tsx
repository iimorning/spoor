import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../../src/i18n';
import { ChatSearchHits } from '../../../src/components/canvas/ChatSearchHits';

describe('ChatSearchHits', () => {
  it('renders webpage rows and skips the live-search brief', async () => {
    await i18n.changeLanguage('zh');
    render(
      <I18nextProvider i18n={i18n}>
        <ChatSearchHits
          hits={[
            {
              kind: 'webpage',
              query: 'moon',
              title: 'Live search brief',
              snippet: 'hidden',
            },
            {
              kind: 'webpage',
              query: 'moon',
              title: '月球有多老',
              snippet: '45.1亿年',
              link: 'https://tech.qq.com/a.html',
              date: '2023年01月01日',
            },
          ]}
        />
      </I18nextProvider>,
    );
    expect(screen.getByTestId('chat-search-hits')).toBeInTheDocument();
    expect(screen.getByText('月球有多老')).toBeInTheDocument();
    expect(screen.queryByText('Live search brief')).not.toBeInTheDocument();
    expect(screen.queryByText(/tech\.qq\.com/)).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-search-hit-open')).toHaveAttribute(
      'href',
      'https://tech.qq.com/a.html',
    );
    expect(screen.queryByTestId('chat-search-hit-excerpt')).not.toBeInTheDocument();
  });

  it('excerpts a hit without following the source link', async () => {
    await i18n.changeLanguage('zh');
    const onExcerptHit = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <ChatSearchHits
          hits={[
            {
              kind: 'webpage',
              query: 'moon',
              title: '月球有多老',
              snippet: '45.1亿年',
              link: 'https://tech.qq.com/a.html',
            },
          ]}
          onExcerptHit={onExcerptHit}
        />
      </I18nextProvider>,
    );
    await userEvent.click(screen.getByTestId('chat-search-hit-excerpt'));
    expect(onExcerptHit).toHaveBeenCalledTimes(1);
    expect(onExcerptHit.mock.calls[0]?.[0]?.title).toBe('月球有多老');
  });
});
