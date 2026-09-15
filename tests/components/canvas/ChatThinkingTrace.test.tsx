import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../../src/i18n';
import { ChatThinkingTrace, resolveChatThought } from '../../../src/components/canvas/ChatThinkingTrace';

describe('resolveChatThought', () => {
  it('prefers the live stream while the turn is in flight', () => {
    expect(
      resolveChatThought({
        thinkingTrace: 'saved',
        isStreaming: true,
        streamingThought: 'live now',
      }),
    ).toBe('live now');
  });

  it('falls back to the saved trace', () => {
    expect(resolveChatThought({ thinkingTrace: '  saved  ' })).toBe('saved');
  });
});

describe('ChatThinkingTrace', () => {
  it('shows a brain on the name row and opens the thinking card', async () => {
    await i18n.changeLanguage('zh');
    render(
      <I18nextProvider i18n={i18n}>
        <ChatThinkingTrace
          name="阿狸"
          thought="先看题里的矛盾"
          messageId="m1"
          canEdit
          onExcerptSelection={() => {}}
        />
      </I18nextProvider>,
    );
    expect(screen.queryByTestId('chat-thinking-trace-panel')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('chat-thinking-trace'));
    expect(screen.getByTestId('chat-thinking-trace-panel')).toHaveTextContent('先看题里的矛盾');
  });

  it('hides the brain when there is no thought', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <ChatThinkingTrace
          name="阿狸"
          thought=""
          messageId="m1"
          canEdit
          onExcerptSelection={() => {}}
        />
      </I18nextProvider>,
    );
    expect(screen.queryByTestId('chat-thinking-trace')).not.toBeInTheDocument();
    expect(screen.getByText('阿狸')).toBeInTheDocument();
  });
});
