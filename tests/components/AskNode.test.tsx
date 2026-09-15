import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AskNode } from '../../src/components/nodes/AskNode';
import type { CanvasNode } from '../../src/db';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

vi.mock('lucide-react', () => {
  const names = ['Loader2', 'Layers2'] as const;
  const icons: Record<string, React.FC> = {};
  for (const name of names) {
    icons[name] = (props: Record<string, unknown>) => {
      const { createElement } = require('react');
      return createElement('svg', { 'data-testid': `icon-${name}`, ...props });
    };
  }
  return icons;
});

const baseNode: CanvasNode = { id: 'ask-1', canvasId: 'c1', type: 'ask', x: 0, y: 0, content: '' };

describe('AskNode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the fox illustration and no input or send controls', () => {
    render(
      <AskNode
        node={baseNode}
        isSubmitting={false}
      />,
    );
    expect(screen.getByTestId('ask-card')).toBeInTheDocument();
    expect(screen.getByTestId('ask-fox')).toBeInTheDocument();
    expect(screen.queryByTestId('ask-character-name')).toBeNull();
    expect(screen.queryByTestId('ask-input')).toBeNull();
    expect(screen.queryByTestId('ask-send')).toBeNull();
    expect(screen.queryByTestId('ask-voice-toggle')).toBeNull();
  });

  it('shows a submitting overlay while an Ask turn is in flight', () => {
    render(
      <AskNode
        node={baseNode}
        isSubmitting
      />,
    );
    expect(screen.getByTestId('ask-submitting')).toBeInTheDocument();
    expect(screen.getByTestId('icon-Loader2')).toBeInTheDocument();
  });

  it('does not render Ask title or context badge', () => {
    render(
      <AskNode
        node={baseNode}
        isSubmitting={false}
      />,
    );
    expect(screen.queryByText('Ask')).toBeNull();
    expect(screen.queryByTestId('ask-context-badge')).toBeNull();
  });
});
