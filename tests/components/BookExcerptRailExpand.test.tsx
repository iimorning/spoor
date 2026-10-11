import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { BookExcerptRail } from '../../src/components/BookExcerptRail';
import type { BookExcerpt } from '../../src/db';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key }),
  };
});

function excerpt(overrides: Partial<BookExcerpt> = {}): BookExcerpt {
  return {
    id: 'x1',
    text: '摘抄正文',
    unitIndex: 0,
    unitLabel: 'Ch1',
    bookTitle: 'Demo',
    createdAt: Date.now(),
    ...overrides,
  };
}

const LONG = '很长的一段摘抄。'.repeat(40);

describe('BookExcerptRail 展开全文', () => {
  it('双击展开完整原文，再双击收起', async () => {
    const onAsk = vi.fn();
    const row = excerpt({ text: LONG });
    render(<BookExcerptRail excerpts={[row]} onAsk={onAsk} onJump={vi.fn()} onDelete={vi.fn()} />);

    const card = screen.getByTestId('book-excerpt-card');
    // 收起时是缩略
    expect(card.textContent).toContain('…');
    expect(card.textContent!.length).toBeLessThan(LONG.length);

    fireEvent.doubleClick(card);
    await waitFor(() => {
      expect(screen.getByTestId('book-excerpt-card').textContent).toContain('很长的一段摘抄。'.repeat(10));
    });

    fireEvent.doubleClick(screen.getByTestId('book-excerpt-card'));
    await waitFor(() => {
      expect(screen.getByTestId('book-excerpt-card').textContent).toContain('…');
    });
  });

  it('焦点离开这张卡就收起', async () => {
    const a = excerpt({ id: 'x1', text: LONG });
    const b = excerpt({ id: 'x2', text: LONG });
    render(<BookExcerptRail excerpts={[a, b]} onAsk={vi.fn()} onJump={vi.fn()} onDelete={vi.fn()} />);

    const cards = screen.getAllByTestId('book-excerpt-card');
    fireEvent.doubleClick(cards[0]!);
    await waitFor(() => {
      expect(screen.getAllByTestId('book-excerpt-card')[0]!.textContent).not.toContain('…');
    });

    // 焦点挪到第二张卡
    fireEvent.blur(cards[0]!, { relatedTarget: cards[1]! });
    await waitFor(() => {
      expect(screen.getAllByTestId('book-excerpt-card')[0]!.textContent).toContain('…');
    });
  });

  // 点卡片内部的想法输入框也会冒泡出 blur，但焦点还在这张卡里，不该收起。
  it('焦点还在卡内时不收起', async () => {
    const row = excerpt({ text: LONG });
    render(
      <BookExcerptRail
        excerpts={[row]}
        onAsk={vi.fn()}
        onJump={vi.fn()}
        onDelete={vi.fn()}
        onNoteChange={vi.fn()}
      />,
    );
    const card = screen.getByTestId('book-excerpt-card');
    fireEvent.doubleClick(card);
    await waitFor(() => {
      expect(screen.getByTestId('book-excerpt-card').textContent).not.toContain('…');
    });

    fireEvent.click(screen.getByTestId('book-excerpt-note-add'));
    const editor = screen.getByTestId('book-excerpt-note-input');
    fireEvent.blur(editor, { relatedTarget: editor });
    expect(screen.getByTestId('book-excerpt-card').textContent).not.toContain('…');
  });

  // 去掉红框之后，选中态用"填充"来表达，色调跟右栏自己发出去的消息气泡一致
  // （ChatPanel 的 bg-[#C2410C]/10），边框保持中性。
  it('选中态填充成和右栏已发送气泡同一个色调，且没有红框', () => {
    const a = excerpt({ id: 'x1' });
    const b = excerpt({ id: 'x2' });
    const { rerender } = render(
      <BookExcerptRail excerpts={[a, b]} selectedId={null} onAsk={vi.fn()} onJump={vi.fn()} onDelete={vi.fn()} />,
    );
    rerender(
      <BookExcerptRail excerpts={[a, b]} selectedId="x2" onAsk={vi.fn()} onJump={vi.fn()} onDelete={vi.fn()} />,
    );
    const selected = screen.getAllByTestId('book-excerpt-card')[1]!;
    expect(selected.className).toContain('bg-[#C2410C]/10');
    expect(selected.className).toContain('border-[#E6E4DF]');
    expect(selected.className).not.toContain('border-[#C2410C]');
  });
});
