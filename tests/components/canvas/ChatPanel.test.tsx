import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ChatPanel } from '../../../src/components/canvas/ChatPanel';

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

describe('ChatPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmMock.mockResolvedValue(true);
  });

  it('fills the send circle only once there is something to send', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const { rerender } = render(
      <ChatPanel messages={[]} sending={false} error={null} onSend={onSend} />,
    );
    const send = () => screen.getByTestId('chat-panel-send');
    // 按完整 token 判，不能用 toContain 找子串：disabled: 变体里常藏着同样的片段。
    const tokens = () => (send().getAttribute('class') ?? '').split(/\s+/);

    // 空着：不能发，浅灰的中性圆。rounded-full 没有底色就没有形状，圆会整个
    // 消失——所以中性底不是装饰，是这个圆存在的前提。
    expect(send()).toBeDisabled();
    expect(tokens()).toContain('rounded-full');
    expect(tokens()).toContain('bg-[#F4F1ED]');
    expect(tokens()).not.toContain('bg-[#C2410C]');

    // 有内容：能发，填上项目主橙。填色跟着"能不能发"走，而不是常亮或常灭。
    const input = screen.getByRole('textbox');
    await user.type(input, '写点什么');
    expect(send()).not.toBeDisabled();
    expect(tokens()).toContain('bg-[#C2410C]');
    expect(tokens()).toContain('text-white');
    expect(tokens()).not.toContain('bg-[#F4F1ED]');
    // 图标仍是向上箭头。
    const iconClass = send().querySelector('svg')?.getAttribute('class') ?? '';
    expect(iconClass).toMatch(/arrow-up/);
    expect(iconClass).not.toMatch(/mail/);
    // 无障碍名字仍然说"发送"。
    expect(send().getAttribute('aria-label') ?? '').toMatch(/send/i);
  });

  it('renders a voice button when voice chat is available', async () => {
    const onToggleVoice = vi.fn();
    const user = userEvent.setup();
    render(
      <ChatPanel
        messages={[]}
        sending={false}
        error={null}
        onSend={() => {}}
        onToggleVoice={onToggleVoice}
        voiceEnabled
      />,
    );
    await user.click(screen.getByTestId('chat-panel-voice'));
    expect(onToggleVoice).toHaveBeenCalledTimes(1);
  });

  it('dictation writes the transcript into the input, not above it', async () => {
    render(
      <ChatPanel
        messages={[]}
        sending={false}
        error={null}
        onSend={() => {}}
        voiceModeActive
        voicePhase="listening"
        voiceInputMode="dictation"
        liveTranscript="为什么在国内做 AI 应用就这么难?"
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('chat-panel-input')).toHaveValue('为什么在国内做 AI 应用就这么难?');
    });
    expect(screen.queryByText('voice.phase_listening')).not.toBeInTheDocument();
  });

  it('lets the user edit dictation text in the box and send it', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(
      <ChatPanel
        messages={[]}
        sending={false}
        error={null}
        onSend={onSend}
        voiceModeActive
        voicePhase="draft"
        voiceInputMode="dictation"
        liveTranscript="原稿"
      />,
    );
    const input = screen.getByTestId('chat-panel-input');
    await user.clear(input);
    await user.type(input, '改过的问题');
    await user.click(screen.getByTestId('chat-panel-send'));
    expect(onSend).toHaveBeenCalledWith('改过的问题', undefined);
  });

  it('writes a new dictation after the user edited, left voice, and listened again', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ChatPanel
        messages={[]}
        sending={false}
        error={null}
        onSend={() => {}}
        onToggleVoice={() => {}}
        voiceModeActive
        voicePhase="listening"
        voiceInputMode="dictation"
        liveTranscript="原稿"
      />,
    );
    const input = screen.getByTestId('chat-panel-input');
    await waitFor(() => {
      expect(input).toHaveValue('原稿');
    });
    await user.clear(input);
    expect(input).toHaveValue('');

    rerender(
      <ChatPanel
        messages={[]}
        sending={false}
        error={null}
        onSend={() => {}}
        onToggleVoice={() => {}}
        voiceModeActive={false}
        voicePhase="idle"
        voiceInputMode="dictation"
        liveTranscript=""
      />,
    );
    rerender(
      <ChatPanel
        messages={[]}
        sending={false}
        error={null}
        onSend={() => {}}
        onToggleVoice={() => {}}
        voiceModeActive
        voicePhase="listening"
        voiceInputMode="dictation"
        liveTranscript="第二段转写"
      />,
    );
    await waitFor(() => {
      expect(input).toHaveValue('第二段转写');
    });
  });

  it('sends trimmed text from the composer', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(
      <ChatPanel messages={[]} sending={false} error={null} onSend={onSend} />,
    );
    await user.type(screen.getByTestId('chat-panel-input'), '  tighten the opening  ');
    await user.click(screen.getByTestId('chat-panel-send'));
    expect(onSend).toHaveBeenCalledWith('tighten the opening', undefined);
  });

  it('Shift+Enter 换行，Enter 发送，输入法确认不发送', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<ChatPanel messages={[]} sending={false} error={null} onSend={onSend} />);
    const input = screen.getByTestId('chat-panel-input');
    await user.click(input);
    await user.keyboard('hello{Shift>}{Enter}{/Shift}world');
    expect(input).toHaveValue('hello\nworld');
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('hello\nworld', undefined);
  });

  it('does not send a newline-only draft', () => {
    const onSend = vi.fn();
    render(<ChatPanel messages={[]} sending={false} error={null} onSend={onSend} />);
    const input = screen.getByTestId('chat-panel-input');
    fireEvent.change(input, { target: { value: '\n  \n' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('starts a new chat and opens archived history', async () => {
    const onNewChat = vi.fn();
    const user = userEvent.setup();
    render(
      <ChatPanel
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

    await user.click(screen.getByTestId('chat-panel-new'));
    expect(confirmMock).toHaveBeenCalled();
    expect(onNewChat).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId('chat-panel-history'));
    await user.click(screen.getByTestId('chat-panel-history-item-s1'));
    expect(screen.getByText('Old answer')).toBeInTheDocument();
    expect(screen.getByTestId('chat-panel-input')).toBeDisabled();

    await user.click(screen.getByTestId('chat-panel-history-back'));
    expect(screen.getByText('Current turn')).toBeInTheDocument();
    expect(screen.getByTestId('chat-panel-input')).not.toBeDisabled();
  });

  it('leaves the header to the two session buttons when the title is hidden', async () => {
    render(
      <ChatPanel
        messages={[{ id: '1', role: 'user', text: '这一轮', createdAt: 1 }]}
        archivedSessions={[
          { id: 's1', createdAt: 1, endedAt: 2, preview: '上一段', messages: [] },
        ]}
        sending={false}
        error={null}
        onSend={() => {}}
        onNewChat={() => {}}
        hideTitle
      />,
    );
    // 面板名是重复的：省下来的是常驻在屏幕右侧的对话正文。
    expect(screen.queryByText('reference.essay_chat_title')).toBeNull();
    // 两个按钮还得在，而且得留在顶上——它们是这一行剩下的全部内容。
    const header = screen.getByTestId('chat-panel').firstElementChild as HTMLElement;
    expect(header.contains(screen.getByTestId('chat-panel-history'))).toBe(true);
    expect(header.contains(screen.getByTestId('chat-panel-new'))).toBe(true);
  });

  it('renders into a host and drops its own header when one is given', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    try {
      render(
        <ChatPanel
          messages={[{ id: '1', role: 'user', text: '这一轮', createdAt: 1 }]}
          archivedSessions={[
            { id: 's1', createdAt: 1, endedAt: 2, preview: '上一段', messages: [] },
          ]}
          sending={false}
          error={null}
          onSend={() => {}}
          onNewChat={() => {}}
          hideTitle
          headerControlsHost={host}
        />,
      );
      // 按钮整个搬走了，栏里那行标题就没有内容了——对话从栏顶开始。
      expect(host.contains(screen.getByTestId('chat-panel-new'))).toBe(true);
      expect(host.contains(screen.getByTestId('chat-panel-history'))).toBe(true);
      const panel = screen.getByTestId('chat-panel');
      expect(panel.contains(screen.getByTestId('chat-panel-new'))).toBe(false);
      // 只剩消息列表顶到栏的第一行，没有那条 40px 的边框行。
      expect(panel.querySelector('.border-b')).toBeNull();
    } finally {
      host.remove();
    }
  });

  it('keeps the buttons in its own header when no host is given', () => {
    render(
      <ChatPanel
        messages={[{ id: '1', role: 'user', text: '这一轮', createdAt: 1 }]}
        archivedSessions={[
          { id: 's1', createdAt: 1, endedAt: 2, preview: '上一段', messages: [] },
        ]}
        sending={false}
        error={null}
        onSend={() => {}}
        onNewChat={() => {}}
        hideTitle
      />,
    );
    // 没有顶栏可去时不能让按钮跟着栏一起消失。
    const header = screen.getByTestId('chat-panel').firstElementChild as HTMLElement;
    expect(header.contains(screen.getByTestId('chat-panel-new'))).toBe(true);
  });

  it('still names the session while reading history, title hidden or not', async () => {
    const user = userEvent.setup();
    render(
      <ChatPanel
        messages={[{ id: '1', role: 'user', text: '这一轮', createdAt: 1 }]}
        archivedSessions={[
          {
            id: 's1',
            createdAt: 1,
            endedAt: 2,
            preview: '上一段在问什么',
            messages: [{ id: 'u-old', role: 'user', text: '旧问题', createdAt: 1 }],
          },
        ]}
        sending={false}
        error={null}
        onSend={() => {}}
        onNewChat={() => {}}
        hideTitle
      />,
    );
    await user.click(screen.getByTestId('chat-panel-history'));
    await user.click(screen.getByTestId('chat-panel-history-item-s1'));
    // 翻历史时标题位置是唯一说明在看哪段对话的地方，不能被 hideTitle 一起藏掉。
    expect(screen.getByText('上一段在问什么')).toBeInTheDocument();
    expect(screen.getByTestId('chat-panel-history-back')).toBeInTheDocument();
  });

  it('restores an archived session after confirmation', async () => {
    const onRestoreSession = vi.fn();
    const user = userEvent.setup();
    render(
      <ChatPanel
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

    await user.click(screen.getByTestId('chat-panel-history'));
    await user.click(screen.getByTestId('chat-panel-history-item-s1'));
    await user.click(screen.getByTestId('chat-panel-restore'));
    expect(confirmMock).toHaveBeenCalled();
    expect(onRestoreSession).toHaveBeenCalledWith('s1');
  });

  it('shows prior messages', () => {
    render(
      <ChatPanel
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
      <ChatPanel
        messages={[]}
        sending={false}
        error={null}
        selectedText="《我是许凉凉》是台湾作家李维菁创作的一部小说。"
        onClearSelection={onClear}
        onSend={() => {}}
      />,
    );
    expect(screen.getByTestId('chat-panel-selection')).toHaveTextContent('许凉凉');
    expect(screen.getByTestId('chat-panel-input')).toHaveAttribute(
      'placeholder',
      'reference.essay_chat_placeholder_selection',
    );
    await user.click(screen.getByTestId('chat-panel-selection-clear'));
    expect(onClear).toHaveBeenCalled();
  });

  it('drags a search hit into the editor instead of showing an excerpt button', () => {
    const onDropSearchHitAt = vi.fn();
    render(
      <ChatPanel
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
        <ChatPanel
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
      <ChatPanel
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
    expect(screen.getByTestId('chat-panel-reply-drag-handle')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-panel-reply-excerpt')).not.toBeInTheDocument();
  });

  it('shows a copy button on assistant replies only', () => {
    render(
      <ChatPanel
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
      <ChatPanel
        messages={[]}
        sending={false}
        error={null}
        onSend={onSend}
        onIngestFiles={(files) => files}
      />,
    );
    const input = screen.getByTestId('chat-panel-upload-input') as HTMLInputElement;
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    await user.upload(input, file);
    expect(screen.getByTestId('chat-panel-pending-files')).toHaveTextContent('notes.txt');
    await user.type(screen.getByTestId('chat-panel-input'), 'read this');
    await user.click(screen.getByTestId('chat-panel-send'));
    expect(onSend).toHaveBeenCalledWith('read this', [file]);
  });

  it('excerpts a generated image as markdown', async () => {
    const onExcerpt = vi.fn();
    const user = userEvent.setup();
    render(
      <ChatPanel
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
    await user.click(screen.getByTestId('chat-panel-image-excerpt'));
    expect(onExcerpt).toHaveBeenCalledWith('![封面](https://img.example/c.jpg)');
  });

  it('sends a clicked related question', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(
      <ChatPanel
        messages={[
          { id: 'u1', role: 'user', text: '改开头', createdAt: 1 },
          {
            id: 'a1',
            role: 'assistant',
            text: '先把第一句收紧。',
            createdAt: 2,
            suggestedFollowUps: ['这个标题还能更短吗', '开头要不要改语气'],
          },
        ]}
        sending={false}
        error={null}
        onSend={onSend}
      />,
    );
    await user.type(screen.getByTestId('chat-panel-input'), '输入框里还留着字');
    expect(screen.getAllByTestId('chat-suggested-follow-up')).toHaveLength(2);
    await user.click(screen.getByText('这个标题还能更短吗'));
    expect(onSend).toHaveBeenCalledWith('这个标题还能更短吗');
    expect(screen.getByTestId('chat-panel-input')).toHaveValue('');
  });
});

