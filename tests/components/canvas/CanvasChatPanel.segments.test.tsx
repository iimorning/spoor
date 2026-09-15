import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { I18nextProvider } from 'react-i18next';
import { CanvasChatPanel } from '../../../src/components/canvas/CanvasChatPanel';
import { db, type CanvasNode } from '../../../src/db';
import i18n from '../../../src/i18n';

vi.mock('lucide-react', () => {
  const icon = (name: string) => (props: Record<string, unknown>) =>
    React.createElement('svg', { 'data-testid': `icon-${name}`, ...props });
  return {
    ArrowUp: icon('ArrowUp'),
    ChevronLeft: icon('ChevronLeft'),
    FileText: icon('FileText'),
    Check: icon('Check'),
    Copy: icon('Copy'),
    GripVertical: icon('GripVertical'),
    History: icon('History'),
    Loader2: icon('Loader2'),
    Mic: icon('Mic'),
    Plus: icon('Plus'),
    SquarePen: icon('SquarePen'),
    X: icon('X'),
    Brain: icon('Brain'),
    ExternalLink: icon('ExternalLink'),
  };
});

const agent: CanvasNode = {
  id: 'ask-1',
  canvasId: 'c1',
  type: 'ask',
  x: 0,
  y: 0,
  content: '',
};

const note: CanvasNode = {
  id: 'note-1',
  canvasId: 'c1',
  type: 'note',
  x: 0,
  y: 0,
  content: 'sample note',
};

describe('CanvasChatPanel mixed composer segments', () => {
  beforeEach(async () => {
    await db.canvasPersonaThreads.clear();
  });

  it('sends composer segments and shows focus chip inline', async () => {
    await i18n.changeLanguage('zh');
    const onSend = vi.fn();
    const nodesRef = { current: {} as Record<string, HTMLElement | null> };
    render(
      <I18nextProvider i18n={i18n}>
        <CanvasChatPanel
          canvasId="c1"
          agentNode={agent}
          nodes={[agent, note]}
          nodesRef={nodesRef}
          composerSegments={[
            { type: 'card', nodeId: 'note-1' },
            { type: 'text', content: '请总结' },
          ]}
          isStreaming={false}
          streamingMessageId={null}
          streamingThought=""
          onClose={() => {}}
          onSend={onSend}
        />
      </I18nextProvider>,
    );

    expect(screen.getByTestId('chat-focus-chip')).toBeTruthy();
    expect(screen.queryByTestId('composer-card-grip')).toBeNull();
    expect(screen.getByTestId('canvas-chat-input').textContent).toBe('请总结');
    expect(screen.getByTestId('composer-segments')).toHaveClass('cursor-text');
    expect(screen.getByTestId('canvas-chat-input')).toHaveClass('cursor-text');
    fireEvent.click(screen.getByTestId('canvas-chat-send'));
    expect(onSend).toHaveBeenCalledWith(
      [
        { type: 'card', nodeId: 'note-1' },
        { type: 'text', content: '请总结' },
      ],
      expect.any(Function),
    );
  });

  it('removes the previous chip with Backspace without clearing other chips', async () => {
    const note2: CanvasNode = { ...note, id: 'note-2', content: 'other' };
    const onRemoveFocus = vi.fn();
    function Harness() {
      const [segments, setSegments] = React.useState<
        Array<{ type: 'card'; nodeId: string } | { type: 'text'; content: string }>
      >([
        { type: 'card', nodeId: 'note-1' },
        { type: 'text', content: '中间' },
        { type: 'card', nodeId: 'note-2' },
        { type: 'text', content: '结尾' },
      ]);
      return (
        <I18nextProvider i18n={i18n}>
          <CanvasChatPanel
            canvasId="c1"
            agentNode={agent}
            nodes={[agent, note, note2]}
            nodesRef={{ current: {} }}
            composerSegments={segments}
            onComposerSegmentsChange={setSegments}
            isStreaming={false}
            streamingMessageId={null}
            streamingThought=""
            onClose={() => {}}
            onSend={() => {}}
            onRemoveFocus={onRemoveFocus}
          />
        </I18nextProvider>
      );
    }
    render(<Harness />);
    const input = screen.getByTestId('canvas-chat-input');
    input.focus();
    const node = input.firstChild ?? input;
    const range = document.createRange();
    if (node.nodeType === Node.TEXT_NODE) range.setStart(node, 0);
    else range.selectNodeContents(input);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onRemoveFocus).toHaveBeenCalledTimes(1);
    expect(onRemoveFocus).toHaveBeenCalledWith('note-2');
    expect(onRemoveFocus).not.toHaveBeenCalledWith('note-1');
    const chips = screen.getAllByTestId('chat-focus-chip');
    expect(chips).toHaveLength(1);
    expect(screen.getByTestId('canvas-chat-input').textContent).toBe('中间结尾');
  });
});
