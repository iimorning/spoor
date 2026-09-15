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

describe('CanvasChatPanel composer prefill', () => {
  beforeEach(async () => {
    await db.canvasPersonaThreads.clear();
  });

  it('stamps a book quote into the composer for that persona', async () => {
    await i18n.changeLanguage('zh');
    const nodesRef = { current: {} };
    render(
      <I18nextProvider i18n={i18n}>
        <CanvasChatPanel
          canvasId="c1"
          agentNode={agent}
          nodes={[
            agent,
            {
              id: 'book-1',
              canvasId: 'c1',
              type: 'book',
              x: 0,
              y: 0,
              content: 'Demo.epub',
            },
          ]}
          nodesRef={nodesRef}
          isStreaming={false}
          streamingMessageId={null}
          streamingThought=""
          onClose={() => {}}
          onSend={() => {}}
          composerPrefill={{
            personaNodeId: 'ask-1',
            composerSegments: [
              { type: 'card', nodeId: 'book-1' },
              { type: 'text', content: 'Demo.epub\n\na passage' },
            ],
            token: 1,
          }}
        />
      </I18nextProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('canvas-chat-input').textContent).toBe('Demo.epub\n\na passage');
    });
  });
});
