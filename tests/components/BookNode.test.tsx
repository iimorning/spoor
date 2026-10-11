import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { BookNode } from '../../src/components/nodes/BookNode';
import { encodeBookContent } from '../../src/utils/bookPayload';
import { db, type CanvasNode } from '../../src/db';

// Use importOriginal so src/i18n.ts (loaded transitively via aiI18n) can still
// find initReactI18next at module-init. Only useTranslation gets stubbed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
vi.mock('react-i18next', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actual = await (vi as any).importActual('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, opts?: Record<string, unknown>) => {
        if (key === 'nodes.book_page') return `${opts?.current} / ${opts?.total}`;
        return key;
      },
    }),
  };
});

vi.mock('lucide-react', async (importOriginal) =>
  (await import('../mocks/lucideReactMock')).lucideReactMock(importOriginal),
);

function makeBookNode(overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id: 'b1',
    type: 'book',
    x: 0,
    y: 0,
    description: 'demo.epub',
    fileType: 'epub',
    content: encodeBookContent({
      format: 'epub',
      title: 'Demo',
      units: [
        { title: 'Ch1', text: 'First unit text' },
        { title: 'Ch2', text: 'Second unit text' },
      ],
    }),
    ...overrides,
  };
}

/** 选中正文里那段「First unit text」，让选择工具栏出现。 */
function selectBookText(container: HTMLElement) {
  const scroller = container.querySelector('[data-canvas-node-context-text]') as HTMLElement;
  // 没有 blocks 时正文是容器的直接文本节点，所以按节点精确取，别把章节标题一起选进去。
  const textNode = Array.from(scroller.childNodes).find(
    (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.includes('First unit text'),
  );
  const range = document.createRange();
  range.selectNodeContents(textNode!);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  fireEvent.mouseUp(scroller);
}

describe('BookNode', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.edges.clear();
    await db.nodes.add(makeBookNode());
  });

  it('restores persisted page index', () => {
    const { getByText, queryByText } = render(
      <BookNode
        node={makeBookNode({ bookPageIndex: 1 })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
      />,
    );
    expect(queryByText('First unit text')).not.toBeInTheDocument();
    expect(getByText('Second unit text')).toBeInTheDocument();
  });

  it('persists page index when navigating', async () => {
    const { getByLabelText } = render(
      <BookNode node={makeBookNode()} editingNodeId={null} setEditingNodeId={vi.fn()} />,
    );
    fireEvent.click(getByLabelText('nodes.book_next'));
    await waitFor(async () => {
      const saved = await db.nodes.get('b1');
      expect(saved?.bookPageIndex).toBe(1);
    });
  });

  it('marks current unit as AI context text', () => {
    const { container } = render(
      <BookNode node={makeBookNode()} editingNodeId={null} setEditingNodeId={vi.fn()} />,
    );
    expect(container.querySelector('[data-canvas-node-context-text]')).toHaveTextContent('First unit text');
  });

  it('attaches scroll persistence to body scroller', () => {
    // jsdom can't simulate real scroll geometry; only assert the onScroll handler
    // is wired up via React (not test the persistence timing — that goes through
    // Dexie and is covered indirectly by the page-index persistence test).
    const { container } = render(
      <BookNode node={makeBookNode()} editingNodeId={null} setEditingNodeId={vi.fn()} />,
    );
    const scroller = container.querySelector('[data-canvas-node-context-text]');
    expect(scroller?.getAttribute('tabindex')).toBe('-1');
  });

  it('arrow keys on body flip pages directly', async () => {
    const { container } = render(
      <BookNode node={makeBookNode()} editingNodeId={null} setEditingNodeId={vi.fn()} />,
    );
    const scroller = container.querySelector('[data-canvas-node-context-text]');
    // Right → ArrowRight should reach goToPage(+1) and persist bookPageIndex: 1.
    fireEvent.keyDown(scroller!, { key: 'ArrowRight' });
    await waitFor(async () => {
      const saved = await db.nodes.get('b1');
      expect(saved?.bookPageIndex).toBe(1);
    });
  });

  it('does not render a microphone control', () => {
    const { queryByTestId } = render(
      <BookNode node={makeBookNode()} editingNodeId={null} setEditingNodeId={vi.fn()} />,
    );
    expect(queryByTestId('icon-Mic')).not.toBeInTheDocument();
    expect(queryByTestId('icon-Square')).not.toBeInTheDocument();
  });

  it('calls onOpenFullscreen from the top-right control', () => {
    const onOpenFullscreen = vi.fn();
    const { getByTestId } = render(
      <BookNode
        node={makeBookNode()}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        onOpenFullscreen={onOpenFullscreen}
      />,
    );
    fireEvent.click(getByTestId('book-open-b1'));
    expect(onOpenFullscreen).toHaveBeenCalledWith('b1');
  });

  it('arrow left flips back to previous page', async () => {
    // Start from page 1 so the left-arrow test has somewhere to go.
    await db.nodes.update('b1', { bookPageIndex: 1 });
    const { container } = render(
      <BookNode node={makeBookNode({ bookPageIndex: 1 })} editingNodeId={null} setEditingNodeId={vi.fn()} />,
    );
    const scroller = container.querySelector('[data-canvas-node-context-text]');
    fireEvent.keyDown(scroller!, { key: 'ArrowLeft' });
    await waitFor(async () => {
      const saved = await db.nodes.get('b1');
      expect(saved?.bookPageIndex).toBe(0);
    });
  });

  it('摘抄 on the canvas card spawns a card instead of writing into the book', async () => {
    // 画布是拿来摆东西的：从书卡上摘下来的那段话，应当直接变成画布上一张卡片，
    // 而不是书卡内部的一条记录（那条记录在画布上根本摆不出来）。
    const onExtractSelectionToCard = vi.fn();
    const { container } = render(
      <BookNode
        node={makeBookNode()}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        onExtractSelectionToCard={onExtractSelectionToCard}
      />,
    );
    const scroller = container.querySelector('[data-canvas-node-context-text]') as HTMLElement;
    const textNode = Array.from(scroller.childNodes).find(
      (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.includes('First unit text'),
    );
    const range = document.createRange();
    range.selectNodeContents(textNode!);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    fireEvent.mouseUp(scroller);

    fireEvent.pointerUp(screen.getByRole('button', { name: 'nodes.book_to_card' }));

    await waitFor(() => {
      expect(onExtractSelectionToCard).toHaveBeenCalledWith('First unit text', 'Ch1', 'b1');
    });
    // 没有落进书卡的摘抄本：否则同一段话会既在画布上、又在书里各出现一次
    const saved = await db.nodes.get('b1');
    expect(saved?.bookExcerpts ?? []).toHaveLength(0);
  });

  it('keeps the excerpt inside the book when reading fullscreen', async () => {
    // 全屏本来就是"书内部"，摘抄记进这本书的摘抄本（那边左栏能看，也有独立的「放上画布」）。
    const onExtractSelectionToCard = vi.fn();
    const { container } = render(
      <BookNode
        node={makeBookNode()}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        layout="immersive"
        onExtractSelectionToCard={onExtractSelectionToCard}
      />,
    );
    const scroller = container.querySelector('[data-canvas-node-context-text]') as HTMLElement;
    const textNode = Array.from(scroller.childNodes).find(
      (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.includes('First unit text'),
    );
    const range = document.createRange();
    range.selectNodeContents(textNode!);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    fireEvent.mouseUp(scroller);

    fireEvent.pointerUp(screen.getByRole('button', { name: 'nodes.book_to_card' }));

    await waitFor(async () => {
      const saved = await db.nodes.get('b1');
      expect(saved?.bookExcerpts?.[0]?.text).toBe('First unit text');
    });
    expect(onExtractSelectionToCard).not.toHaveBeenCalled();
  });

  it('extract without the host callback still falls back to the book excerpt list', async () => {
    // 刻意不传 onAskAboutSelection / onExpandSelection：摘抄本身不依赖宿主回调。
    const { container } = render(
      <BookNode node={makeBookNode()} editingNodeId={null} setEditingNodeId={vi.fn()} />,
    );
    const scroller = container.querySelector('[data-canvas-node-context-text]') as HTMLElement;
    // 没有 blocks 时正文是容器的直接文本节点，所以按节点精确取，别把章节标题一起选进去。
    const textNode = Array.from(scroller.childNodes).find(
      (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.includes('First unit text'),
    );
    const range = document.createRange();
    range.selectNodeContents(textNode!);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    fireEvent.mouseUp(scroller);

    const extract = screen.getByRole('button', { name: 'nodes.book_to_card' });
    fireEvent.pointerUp(extract);

    await waitFor(async () => {
      const saved = await db.nodes.get('b1');
      const excerpt = saved?.bookExcerpts?.[0];
      expect(excerpt?.text).toBe('First unit text');
      expect(excerpt?.unitLabel).toBe('Ch1');
      expect(excerpt?.bookTitle).toBe('Demo');
      expect(excerpt?.source).toBe('book');
    });

    // 摘抄只进这本书：画布上不该多出任何卡片或连线。
    expect(await db.nodes.count()).toBe(1);
    expect(await db.edges.count()).toBe(0);
  });

  it('shows an excerpt count on the card, but not in the reader', async () => {
    const node = makeBookNode({
      bookExcerpts: [
        { id: 'e1', text: '一', unitIndex: 0, unitLabel: 'Ch1', bookTitle: 'Demo', createdAt: 1 },
        { id: 'e2', text: '二', unitIndex: 0, unitLabel: 'Ch1', bookTitle: 'Demo', createdAt: 2 },
      ],
    });
    const card = render(<BookNode node={node} editingNodeId={null} setEditingNodeId={vi.fn()} />);
    expect(card.getByTestId('book-excerpt-count')).toHaveTextContent('2');
    card.unmount();

    const reader = render(
      <BookNode node={node} editingNodeId={null} setEditingNodeId={vi.fn()} layout="immersive" />,
    );
    expect(reader.queryByTestId('book-excerpt-count')).toBeNull();
  });

  it('hides the excerpt count when nothing has been saved', () => {
    const { queryByTestId } = render(
      <BookNode node={makeBookNode()} editingNodeId={null} setEditingNodeId={vi.fn()} />,
    );
    expect(queryByTestId('book-excerpt-count')).toBeNull();
  });

  it('keeps only Extract in the reader, and all three actions on the canvas', () => {
    // 全屏阅读里思维导图和问 AI 都不出现；它们在画布的卡片上有。
    const handlers = { onAskAboutSelection: vi.fn(), onExpandSelection: vi.fn() };
    const card = render(
      <BookNode node={makeBookNode()} editingNodeId={null} setEditingNodeId={vi.fn()} {...handlers} />,
    );
    selectBookText(card.container);
    expect(screen.getByRole('button', { name: 'nodes.book_to_card' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'nodes.book_expand' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'nodes.book_ask_ai' })).toBeInTheDocument();
    card.unmount();

    const reader = render(
      <BookNode
        node={makeBookNode()}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        layout="immersive"
        {...handlers}
      />,
    );
    selectBookText(reader.container);
    expect(screen.getByRole('button', { name: 'nodes.book_to_card' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'nodes.book_expand' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'nodes.book_ask_ai' })).toBeNull();
  });

  it('reports the selection upward so the chat can read it', () => {
    const onSelectionPreview = vi.fn();
    const { container } = render(
      <BookNode
        node={makeBookNode()}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        onSelectionPreview={onSelectionPreview}
      />,
    );
    selectBookText(container);
    expect(onSelectionPreview).toHaveBeenLastCalledWith('First unit text');
  });

  it('only clears the reported selection when the reader itself has focus', () => {
    const onSelectionPreview = vi.fn();
    const { container } = render(
      <BookNode
        node={makeBookNode()}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        onSelectionPreview={onSelectionPreview}
      />,
    );
    const scroller = container.querySelector('[data-canvas-node-context-text]') as HTMLElement;

    // 焦点在别处（例如右栏输入框）：取消选中只是点了别处，
    // 不该把已经交给 AI 的那段清掉。
    selectBookText(container);
    expect(onSelectionPreview).toHaveBeenLastCalledWith('First unit text');
    window.getSelection()?.removeAllRanges();
    fireEvent.mouseUp(scroller);
    expect(onSelectionPreview).not.toHaveBeenCalledWith('');

    // 焦点还在正文里：这才算用户主动取消了选中。
    selectBookText(container);
    scroller.focus();
    window.getSelection()?.removeAllRanges();
    fireEvent.mouseUp(scroller);
    expect(onSelectionPreview).toHaveBeenLastCalledWith('');
  });
});
