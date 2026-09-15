import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

describe('CanvasChatPanel copy reply', () => {
  beforeEach(async () => {
    await db.canvasPersonaThreads.clear();
  });

  it('shows a copy button on assistant replies only', async () => {
    await db.canvasPersonaThreads.put({
      id: 'c1:ask-1',
      canvasId: 'c1',
      agentNodeId: 'ask-1',
      updatedAt: 1,
      messages: [
        { id: 'u1', role: 'user', text: 'hello', createdAt: 1 },
        { id: 'a1', role: 'assistant', text: 'Is less really more?', createdAt: 2 },
      ],
    });

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
          onSend={() => {}}
        />
      </I18nextProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Is less really more?')).toBeInTheDocument();
    });
    expect(screen.getAllByTestId('chat-reply-copy')).toHaveLength(1);
  });
});
