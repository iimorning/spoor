import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    Check: icon('Check'),
    ChevronLeft: icon('ChevronLeft'),
    Copy: icon('Copy'),
    FileText: icon('FileText'),
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

describe('CanvasChatPanel suggested follow-ups', () => {
  beforeEach(async () => {
    await db.canvasPersonaThreads.clear();
  });

  it('sends a clicked related question as the next turn', async () => {
    await db.canvasPersonaThreads.put({
      id: 'c1:ask-1',
      canvasId: 'c1',
      agentNodeId: 'ask-1',
      updatedAt: 1,
      messages: [
        { id: 'u1', role: 'user', text: '这个方案怎么样', createdAt: 1 },
        {
          id: 'a1',
          role: 'assistant',
          text: '先看约束。',
          createdAt: 2,
          suggestedFollowUps: ['风险在哪？', '还有别的做法吗', '预算减半会怎样'],
        },
      ],
    });
    const onSend = vi.fn((_segments, onAccepted: () => void) => {
      onAccepted();
    });
    const user = userEvent.setup();

    render(
      <I18nextProvider i18n={i18n}>
        <CanvasChatPanel
          canvasId="c1"
          agentNode={agent}
          nodes={[agent]}
          nodesRef={{ current: {} }}
          isStreaming={false}
          streamingMessageId={null}
          streamingThought=""
          onClose={() => {}}
          onSend={onSend}
        />
      </I18nextProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('风险在哪？')).toBeInTheDocument();
    });
    expect(screen.getAllByTestId('chat-suggested-follow-up')).toHaveLength(3);
    await user.click(screen.getByText('风险在哪？'));
    expect(onSend).toHaveBeenCalledWith([{ type: 'text', content: '风险在哪？' }], expect.any(Function));
  });

  it('hides follow-ups while the latest reply is still streaming', async () => {
    await db.canvasPersonaThreads.put({
      id: 'c1:ask-1',
      canvasId: 'c1',
      agentNodeId: 'ask-1',
      updatedAt: 1,
      messages: [
        { id: 'u1', role: 'user', text: '这个方案怎么样', createdAt: 1 },
        {
          id: 'a1',
          role: 'assistant',
          text: '先看',
          createdAt: 2,
          suggestedFollowUps: ['风险在哪？'],
        },
      ],
    });

    render(
      <I18nextProvider i18n={i18n}>
        <CanvasChatPanel
          canvasId="c1"
          agentNode={agent}
          nodes={[agent]}
          nodesRef={{ current: {} }}
          isStreaming
          streamingMessageId="a1"
          streamingThought=""
          onClose={() => {}}
          onSend={() => {}}
        />
      </I18nextProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('先看')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('chat-suggested-follow-ups')).not.toBeInTheDocument();
  });
});
