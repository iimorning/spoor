import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function renderPanel(onIngestFiles = vi.fn()) {
  const nodesRef = { current: {} };
  render(
    <I18nextProvider i18n={i18n}>
      <CanvasChatPanel
        canvasId="c1"
        agentNode={agent}
        nodes={[agent]}
        nodesRef={nodesRef}
        isStreaming={false}
        streamingMessageId={null}
        streamingThought=""
        onClose={() => {}}
        onSend={() => {}}
        onIngestFiles={onIngestFiles}
      />
    </I18nextProvider>,
  );
  return { onIngestFiles, nodesRef };
}

describe('CanvasChatPanel uploads', () => {
  beforeEach(async () => {
    await db.canvasPersonaThreads.clear();
  });

  it('shows a + button that forwards picked files', async () => {
    const user = userEvent.setup();
    const onIngestFiles = vi.fn();
    renderPanel(onIngestFiles);

    const input = screen.getByTestId('canvas-chat-upload-input') as HTMLInputElement;
    const file = new File(['a'], 'a.png', { type: 'image/png' });
    await user.upload(input, file);

    expect(onIngestFiles).toHaveBeenCalledTimes(1);
    expect(onIngestFiles.mock.calls[0]?.[0]).toHaveLength(1);
    expect(onIngestFiles.mock.calls[0]?.[0][0].name).toBe('a.png');
  });

  it('forwards pasted clipboard files from the composer', async () => {
    const onIngestFiles = vi.fn();
    renderPanel(onIngestFiles);
    const file = new File(['x'], 'shot.png', { type: 'image/png' });
    const textarea = screen.getByTestId('canvas-chat-input');

    fireEvent.paste(textarea, {
      clipboardData: {
        files: [file],
        items: [{ kind: 'file', getAsFile: () => file }],
      },
    });

    await waitFor(() => expect(onIngestFiles).toHaveBeenCalledTimes(1));
  });

  it('forwards dropped files onto the composer', async () => {
    const onIngestFiles = vi.fn();
    renderPanel(onIngestFiles);
    const file = new File(['x'], 'notes.pdf', { type: 'application/pdf' });
    const composer = screen.getByTestId('canvas-chat-upload').closest('div.flex.gap-2')!;

    fireEvent.drop(composer, {
      dataTransfer: {
        files: [file],
        types: ['Files'],
      },
    });

    expect(onIngestFiles).toHaveBeenCalledTimes(1);
    expect(onIngestFiles.mock.calls[0]?.[0][0].name).toBe('notes.pdf');
  });
});
