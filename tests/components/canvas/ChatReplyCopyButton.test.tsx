import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../../src/i18n';
import {
  ChatReplyCopyButton,
  ChatReplyCopyHost,
} from '../../../src/components/canvas/ChatReplyCopyButton';

const copyTextToClipboard = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../../../src/utils/copyTextToClipboard', () => ({ copyTextToClipboard }));

describe('ChatReplyCopyButton', () => {
  beforeEach(() => {
    copyTextToClipboard.mockClear();
    copyTextToClipboard.mockResolvedValue(undefined);
  });

  it('copies the reply text and shows a done label', async () => {
    const user = userEvent.setup();
    await i18n.changeLanguage('zh');
    render(
      <I18nextProvider i18n={i18n}>
        <ChatReplyCopyButton text="  Is less really more?  " />
      </I18nextProvider>,
    );

    const button = screen.getByTestId('chat-reply-copy');
    expect(button).toHaveAttribute('aria-label', '复制文本');
    await user.click(button);
    await waitFor(() => {
      expect(copyTextToClipboard).toHaveBeenCalledWith('Is less really more?');
    });
    expect(button).toHaveAttribute('aria-label', '已复制');
  });

  it('keeps the copy button on the same line as the last paragraph', async () => {
    await i18n.changeLanguage('zh');
    render(
      <I18nextProvider i18n={i18n}>
        <ChatReplyCopyHost text="there." showCopy>
          <p>I will move it to Notion later and organize it there.</p>
        </ChatReplyCopyHost>
      </I18nextProvider>,
    );
    const paragraph = screen.getByText(/organize it there/);
    const button = screen.getByTestId('chat-reply-copy');
    expect(paragraph.tagName).toBe('P');
    expect(paragraph).toHaveStyle({ display: 'inline' });
    expect(button.parentElement).toBe(paragraph.parentElement);
  });
});
