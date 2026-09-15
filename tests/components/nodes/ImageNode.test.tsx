import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ImageNode } from '../../../src/components/nodes/ImageNode';
import type { CanvasNode } from '../../../src/db';
import { db } from '../../../src/db';
import { downloadImageUrl } from '../../../src/utils/aiGeneratedImage';
import i18n from '../../../src/i18n';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: i18n.t.bind(i18n),
      i18n,
    }),
  };
});

vi.mock('../../../src/utils/aiGeneratedImage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/utils/aiGeneratedImage')>();
  return { ...actual, downloadImageUrl: vi.fn().mockResolvedValue(undefined) };
});

vi.mock('../../../src/services/searchImageSrc', () => ({
  useSearchImageDisplaySrc: (url: string) => url,
}));

vi.mock('lucide-react', () => {
  const icon = (name: string) => (props: Record<string, unknown>) =>
    React.createElement('svg', { 'data-testid': `icon-${name}`, ...props });
  return {
    AlertTriangle: icon('AlertTriangle'),
    Download: icon('Download'),
    ExternalLink: icon('ExternalLink'),
    Loader2: icon('Loader2'),
    RefreshCw: icon('RefreshCw'),
    X: icon('X'),
  };
});

function makeNode(overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id: 'img-1',
    type: 'image',
    x: 0,
    y: 0,
    content: 'https://cdn.example/a.jpg',
    ...overrides,
  };
}

describe('ImageNode search caption', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('shows the relation line under a web-search image', () => {
    render(
      <ImageNode
        node={makeNode({
          description: 'Denim pile\n检索「vintage denim」得到，用来补充这张卡片里的「古着怎么搭配」。',
          webSearchParentId: 'ai-1',
          webSearchIndex: 0,
          sourceUrl: 'https://example.com/a',
        })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
      />,
    );
    expect(screen.getByText('Denim pile')).toBeInTheDocument();
    expect(screen.getByText(/vintage denim/)).toBeInTheDocument();
    expect(screen.getByText(/古着怎么搭配/)).toBeInTheDocument();
  });

  it('does not split a generated-image prompt across two caption lines', () => {
    render(
      <ImageNode
        node={makeNode({
          description: 'A red bicycle\nin a rainy street',
          aiGenerated: true,
        })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
      />,
    );
    expect(screen.getByText(/A red bicycle/)).toBeInTheDocument();
    expect(screen.queryByText('in a rainy street')).not.toBeInTheDocument();
  });
});

describe('ImageNode generation states', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders a ghost card with a spinner while generating', () => {
    render(
      <ImageNode
        node={makeNode({
          content: '',
          description: 'A fox',
          aiGenerated: true,
          imageStatus: 'generating',
          imagePrompt: 'a fox in the woods',
        })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
      />,
    );
    expect(screen.getByTestId('image-generating')).toBeInTheDocument();
    expect(screen.getByTestId('icon-Loader2')).toBeInTheDocument();
    // The title is already visible, so the user can tell what is being drawn.
    expect(screen.getByText('A fox')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByTestId('image-generating-slow')).not.toBeInTheDocument();
    expect(screen.queryByTestId('image-retry')).not.toBeInTheDocument();
  });

  it('shows wait time and Retry when generation has been spinning too long', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <ImageNode
        node={makeNode({
          content: '',
          description: '深夜酒店走廊',
          aiGenerated: true,
          imageStatus: 'generating',
          imagePrompt: 'a hotel corridor',
          createdAt: Date.now() - 45_000,
        })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByTestId('image-generating')).toBeInTheDocument();
    expect(screen.getByTestId('image-generating-waited')).toBeInTheDocument();
    expect(screen.getByTestId('image-generating-slow')).toBeInTheDocument();
    await user.click(screen.getByTestId('image-retry'));
    expect(onRetry).toHaveBeenCalledWith('img-1');
  });

  it('turns a hung generating card into an error with a timeout reason', () => {
    render(
      <ImageNode
        node={makeNode({
          content: '',
          description: '深夜酒店走廊',
          aiGenerated: true,
          imageStatus: 'generating',
          createdAt: Date.now() - 130_000,
        })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByTestId('image-error')).toBeInTheDocument();
    expect(screen.getByTestId('image-retry')).toBeInTheDocument();
    expect(screen.queryByTestId('image-generating')).not.toBeInTheDocument();
  });

  it('translates a stored timeout code instead of showing the raw key', () => {
    render(
      <ImageNode
        node={makeNode({
          content: '',
          imageStatus: 'error',
          imageError: 'timeout',
        })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.queryByText('timeout')).not.toBeInTheDocument();
    expect(screen.getByTestId('image-error').textContent).toMatch(/network|网络/i);
  });

  it('renders the failure reason and a retry button on error', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <ImageNode
        node={makeNode({
          content: '',
          description: 'A fox',
          aiGenerated: true,
          imageStatus: 'error',
          imageError: '402 quota exceeded',
          imagePrompt: 'a fox in the woods',
        })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByTestId('image-error')).toBeInTheDocument();
    expect(screen.getByText('402 quota exceeded')).toBeInTheDocument();

    await user.click(screen.getByTestId('image-retry'));
    expect(onRetry).toHaveBeenCalledWith('img-1');
  });

  it('omits the retry button when no handler is wired', () => {
    render(
      <ImageNode
        node={makeNode({ content: '', imageStatus: 'error', imageError: 'boom' })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('image-retry')).not.toBeInTheDocument();
  });

  it('renders the plain image when no status is set (existing cards)', () => {
    render(
      <ImageNode
        node={makeNode({ description: 'A fox', aiGenerated: true })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('image-generating')).not.toBeInTheDocument();
    expect(screen.queryByTestId('image-error')).not.toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://cdn.example/a.jpg');
  });

  it('downloads the generated image when 下载 is clicked', async () => {
    const user = userEvent.setup();
    render(
      <ImageNode
        node={makeNode({
          description: '席琳看着我的脖子',
          aiGenerated: true,
          content: 'https://file.302ai.cn/gpt/imgs/a.jpg',
        })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
      />,
    );
    await user.click(screen.getByTestId('icon-Download').closest('button')!);
    expect(downloadImageUrl).toHaveBeenCalledWith(
      'https://file.302ai.cn/gpt/imgs/a.jpg',
      '席琳看着我的脖子.jpg',
    );
  });

  it('double-clicking the image opens a fullscreen lightbox', async () => {
    const user = userEvent.setup();
    render(
      <ImageNode
        node={makeNode({ description: '席琳看着我的脖子', aiGenerated: true })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('image-lightbox')).not.toBeInTheDocument();
    await user.dblClick(screen.getByTestId('image-frame'));
    expect(screen.getByTestId('image-lightbox')).toBeInTheDocument();
    const enlarged = screen.getAllByRole('img').find((el) => el.className.includes('object-contain'));
    expect(enlarged).toHaveAttribute('src', 'https://cdn.example/a.jpg');
  });

  it('closes the lightbox on Escape or the close button', async () => {
    const user = userEvent.setup();
    render(
      <ImageNode
        node={makeNode({ description: 'A fox', aiGenerated: true })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
      />,
    );
    await user.dblClick(screen.getByTestId('image-frame'));
    expect(screen.getByTestId('image-lightbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('image-lightbox')).not.toBeInTheDocument();

    await user.dblClick(screen.getByTestId('image-frame'));
    await user.click(screen.getByTestId('image-lightbox-close'));
    expect(screen.queryByTestId('image-lightbox')).not.toBeInTheDocument();
  });
});

describe('ImageNode broken search image', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.edges.clear();
  });

  it('removes a search image card when the image fails to load', async () => {
    await db.nodes.add({
      id: 'img-1',
      canvasId: 'c1',
      type: 'image',
      content: 'https://cdn.example/broken.jpg',
      x: 0,
      y: 0,
      webSearchParentId: 'ai-1',
      webSearchIndex: 0,
    });
    await db.edges.add({ id: 'e1', canvasId: 'c1', from: 'ai-1', to: 'img-1' });

    const { container } = render(
      <ImageNode
        node={makeNode({
          content: 'https://cdn.example/broken.jpg',
          webSearchParentId: 'ai-1',
          webSearchIndex: 0,
        })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
      />,
    );

    fireEvent.error(screen.getByRole('img'));
    await waitFor(() => expect(container.firstChild).toBeNull());
    await waitFor(async () => {
      expect(await db.nodes.get('img-1')).toBeUndefined();
      expect(await db.edges.toArray()).toEqual([]);
    });
  });

  it('does not remove a non-search image on load error', async () => {
    await db.nodes.add({
      id: 'img-1',
      canvasId: 'c1',
      type: 'image',
      content: 'https://cdn.example/broken.jpg',
      x: 0,
      y: 0,
    });

    render(
      <ImageNode
        node={makeNode({ content: 'https://cdn.example/broken.jpg' })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
      />,
    );
    fireEvent.error(screen.getByRole('img'));
    await waitFor(() => expect(screen.getByRole('img')).toBeInTheDocument());
    expect(await db.nodes.get('img-1')).toBeTruthy();
  });
});
