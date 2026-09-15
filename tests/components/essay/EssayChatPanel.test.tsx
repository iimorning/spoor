import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { EssayChatPanel } from '../../../src/components/essay/EssayChatPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <div>{String(children ?? '')}</div>,
}));

const confirmMock = vi.fn(async () => true);
vi.mock('../../../src/components/AppDialogProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/components/AppDialogProvider')>();
  return {
    ...actual,
    useAppDialog: () => ({ confirm: confirmMock, alert: vi.fn() }),
  };
});

describe('EssayChatPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmMock.mockResolvedValue(true);
  });

  it('renders a voice button when voice chat is available', async () => {
    const onToggleVoice = vi.fn();
    const user = userEvent.setup();
    render(
      <EssayChatPanel
        messages={[]}
        sending={false}
        error={null}
        onSend={() => {}}
        onToggleVoice={onToggleVoice}
        voiceEnabled
      />,
    );
    await user.click(screen.getByTestId('essay-chat-voice'));
    expect(onToggleVoice).toHaveBeenCalledTimes(1);
  });

  it('sends trimmed text from the composer', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(
      <EssayChatPanel messages={[]} sending={false} error={null} onSend={onSend} />,
    );
    await user.type(screen.getByTestId('essay-chat-input'), '  tighten the opening  ');
    await user.click(screen.getByTestId('essay-chat-send'));
    expect(onSend).toHaveBeenCalledWith('tighten the opening', undefined);
  });

  it('starts a new chat and opens archived history', async () => {
    const onNewChat = vi.fn();
    const user = userEvent.setup();
    render(
      <EssayChatPanel
        messages={[{ id: '1', role: 'user', text: 'Current turn', createdAt: 1 }]}
        archivedSessions={[
          {
            id: 's1',
            createdAt: 1,
            endedAt: 2,
            preview: 'Old question about App Store',
            messages: [
              { id: 'u-old', role: 'user', text: 'Old question about App Store', createdAt: 1 },
              { id: 'a-old', role: 'assistant', text: 'Old answer', createdAt: 2 },
            ],
          },
        ]}
        sending={false}
        error={null}
        onSend={() => {}}
        onNewChat={onNewChat}
      />,
    );

    await user.click(screen.getByTestId('essay-chat-new'));
    expect(confirmMock).toHaveBeenCalled();
    expect(onNewChat).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId('essay-chat-history'));
    await user.click(screen.getByTestId('essay-chat-history-item-s1'));
    expect(screen.getByText('Old answer')).toBeInTheDocument();
    expect(screen.getByTestId('essay-chat-input')).toBeDisabled();

    await user.click(screen.getByTestId('essay-chat-history-back'));
    expect(screen.getByText('Current turn')).toBeInTheDocument();
    expect(screen.getByTestId('essay-chat-input')).not.toBeDisabled();
  });

  it('restores an archived session after confirmation', async () => {
    const onRestoreSession = vi.fn();
    const user = userEvent.setup();
    render(
      <EssayChatPanel
        messages={[{ id: '1', role: 'user', text: 'Current turn', createdAt: 1 }]}
        archivedSessions={[
          {
            id: 's1',
            createdAt: 1,
            endedAt: 2,
            preview: 'Old question about App Store',
            messages: [
              { id: 'u-old', role: 'user', text: 'Old question about App Store', createdAt: 1 },
              { id: 'a-old', role: 'assistant', text: 'Old answer', createdAt: 2 },
            ],
          },
        ]}
        sending={false}
        error={null}
        onSend={() => {}}
        onNewChat={() => {}}
        onRestoreSession={onRestoreSession}
      />,
    );

    await user.click(screen.getByTestId('essay-chat-history'));
    await user.click(screen.getByTestId('essay-chat-history-item-s1'));
    await user.click(screen.getByTestId('essay-chat-restore'));
    expect(confirmMock).toHaveBeenCalled();
    expect(onRestoreSession).toHaveBeenCalledWith('s1');
  });

  it('shows prior messages', () => {
    render(
      <EssayChatPanel
        messages={[
          { id: '1', role: 'user', text: 'Make it shorter', createdAt: 1 },
          { id: '2', role: 'assistant', text: 'Done as placeholders', createdAt: 2, editCount: 1 },
        ]}
        sending={false}
        error={null}
        onSend={() => {}}
      />,
    );
    expect(screen.getByText('Make it shorter')).toBeInTheDocument();
    expect(screen.getByText('Done as placeholders')).toBeInTheDocument();
  });

  it('shows the current article selection above the composer', async () => {
    const onClear = vi.fn();
    const user = userEvent.setup();
    render(
      <EssayChatPanel
        messages={[]}
        sending={false}
        error={null}
        selectedText="《我是许凉凉》是台湾作家李维菁创作的一部小说。"
        onClearSelection={onClear}
        onSend={() => {}}
      />,
    );
    expect(screen.getByTestId('essay-chat-selection')).toHaveTextContent('许凉凉');
    expect(screen.getByTestId('essay-chat-input')).toHaveAttribute(
      'placeholder',
      'reference.essay_chat_placeholder_selection',
    );
    await user.click(screen.getByTestId('essay-chat-selection-clear'));
    expect(onClear).toHaveBeenCalled();
  });

  it('drags a search hit into the editor instead of showing an excerpt button', () => {
    const onDropSearchHitAt = vi.fn();
    render(
      <EssayChatPanel
        messages={[
          {
            id: '2',
            role: 'assistant',
            text: 'Here are sources.',
            createdAt: 2,
            searchHits: [
              {
                kind: 'webpage',
                query: 'moon',
                title: '月球有多老',
                snippet: '45.1亿年',
                link: 'https://tech.qq.com/a.html',
              },
            ],
          },
        ]}
        sending={false}
        error={null}
        onSend={() => {}}
        onDropSearchHitAt={onDropSearchHitAt}
      />,
    );
    expect(screen.queryByTestId('chat-search-hit-excerpt')).not.toBeInTheDocument();
    const handle = screen.getByLabelText('reference.essay_chat_drag_search_hit');
    handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 30, clientY: 30 }));
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 30, clientY: 30 }));
    expect(onDropSearchHitAt).toHaveBeenCalledTimes(1);
    expect(onDropSearchHitAt.mock.calls[0]?.[1]?.title).toBe('月球有多老');
  });

  it('shows the excerpt toolbar above essay fullscreen when text is selected', async () => {
    const onExcerpt = vi.fn();
    render(
      <div data-testid="essay-fullscreen">
        <EssayChatPanel
          messages={[
            {
              id: '2',
              role: 'assistant',
              text: '做 AI 应用，国内上架审核到底怎么过？',
              createdAt: 2,
            },
          ]}
          sending={false}
          error={null}
          onSend={() => {}}
          onExcerpt={onExcerpt}
          onDropSelectionAt={() => {}}
        />
      </div>,
    );
    const textEl = screen.getByText(/做 AI 应用/);
    const range = document.createRange();
    range.selectNodeContents(textEl);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    await act(async () => {
      document.dispatchEvent(new Event('selectionchange'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('text-selection-toolbar')).toBeInTheDocument();
    });
    const host = document.querySelector('[data-testid="essay-fullscreen"]');
    expect(host?.contains(screen.getByTestId('text-selection-toolbar'))).toBe(true);
  });

  it('shows a drag handle for assistant replies', () => {
    render(
      <EssayChatPanel
        messages={[
          {
            id: '2',
            role: 'assistant',
            text: 'Try these title options.',
            createdAt: 2,
          },
        ]}
        sending={false}
        error={null}
        onSend={() => {}}
        onDropReplyAt={() => {}}
      />,
    );
    expect(screen.getByTestId('essay-chat-reply-drag-handle')).toBeInTheDocument();
    expect(screen.queryByTestId('essay-chat-reply-excerpt')).not.toBeInTheDocument();
  });

  it('shows a copy button on assistant replies only', () => {
    render(
      <EssayChatPanel
        messages={[
          { id: '1', role: 'user', text: 'Make it shorter', createdAt: 1 },
          { id: '2', role: 'assistant', text: 'Try these title options.', createdAt: 2 },
        ]}
        sending={false}
        error={null}
        onSend={() => {}}
      />,
    );
    expect(screen.getByTestId('chat-reply-copy')).toBeInTheDocument();
    expect(screen.getAllByTestId('chat-reply-copy')).toHaveLength(1);
  });

  it('queues uploaded files until send', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(
      <EssayChatPanel
        messages={[]}
        sending={false}
        error={null}
        onSend={onSend}
        onIngestFiles={(files) => files}
      />,
    );
    const input = screen.getByTestId('essay-chat-upload-input') as HTMLInputElement;
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    await user.upload(input, file);
    expect(screen.getByTestId('essay-chat-pending-files')).toHaveTextContent('notes.txt');
    await user.type(screen.getByTestId('essay-chat-input'), 'read this');
    await user.click(screen.getByTestId('essay-chat-send'));
    expect(onSend).toHaveBeenCalledWith('read this', [file]);
  });

  it('excerpts a generated image as markdown', async () => {
    const onExcerpt = vi.fn();
    const user = userEvent.setup();
    render(
      <EssayChatPanel
        messages={[
          {
            id: '2',
            role: 'assistant',
            text: 'Drawn.',
            createdAt: 2,
            images: [
              {
                id: 'img-1',
                title: '封面',
                prompt: 'a cover',
                url: 'https://img.example/c.jpg',
                status: 'ready',
              },
            ],
          },
        ]}
        sending={false}
        error={null}
        onSend={() => {}}
        onExcerpt={onExcerpt}
      />,
    );
    await user.click(screen.getByTestId('essay-chat-image-excerpt'));
    expect(onExcerpt).toHaveBeenCalledWith('![封面](https://img.example/c.jpg)');
  });
});
