import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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

vi.mock('lucide-react', async (importOriginal) =>
  (await import('../mocks/lucideReactMock')).lucideReactMock(importOriginal),
);

const { copyTextToClipboard } = vi.hoisted(() => ({
  copyTextToClipboard: vi.fn(async () => {}),
}));
vi.mock('../../src/utils/copyTextToClipboard', () => ({ copyTextToClipboard }));

function excerpt(overrides: Partial<BookExcerpt> = {}): BookExcerpt {
  return {
    id: 'e1',
    text: '他带的研究生的科研技能，大部分并不是由他亲自传授的。',
    unitIndex: 4,
    unitLabel: '5 / 21',
    bookTitle: '思考如何超越思考',
    createdAt: 1,
    ...overrides,
  };
}

describe('BookExcerptRail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    copyTextToClipboard.mockResolvedValue(undefined);
  });

  it('shows an empty hint when nothing is saved', () => {
    render(<BookExcerptRail excerpts={[]} onAsk={vi.fn()} onJump={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByTestId('book-excerpt-rail')).toBeInTheDocument();
    expect(screen.queryByTestId('book-excerpt-list')).toBeNull();
    expect(screen.getByText('reference.book_excerpt_empty')).toBeInTheDocument();
  });

  it('lists every excerpt with its location label', () => {
    render(
      <BookExcerptRail
        excerpts={[excerpt(), excerpt({ id: 'e2', text: '第二条', unitLabel: 'Ch9' })]}
        onAsk={vi.fn()}
        onJump={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId('book-excerpt-card')).toHaveLength(2);
    expect(screen.getByText('第二条')).toBeInTheDocument();
    expect(screen.getByText('Ch9')).toBeInTheDocument();
  });

  it('asks about the excerpt when the card itself is clicked', () => {
    const onAsk = vi.fn();
    const row = excerpt();
    render(<BookExcerptRail excerpts={[row]} onAsk={onAsk} onJump={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('book-excerpt-card'));
    expect(onAsk).toHaveBeenCalledWith(row);
  });

  it('asks on Enter or Space too, so the card is reachable from the keyboard', () => {
    const onAsk = vi.fn();
    const row = excerpt();
    render(<BookExcerptRail excerpts={[row]} onAsk={onAsk} onJump={vi.fn()} onDelete={vi.fn()} />);
    const card = screen.getByTestId('book-excerpt-card');
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });
    fireEvent.keyDown(card, { key: 'Tab' });
    expect(onAsk).toHaveBeenCalledTimes(2);
  });

  it('does not ask when a card action is clicked', () => {
    const onAsk = vi.fn();
    const onJump = vi.fn();
    const row = excerpt();
    render(
      <BookExcerptRail
        excerpts={[row]}
        selectedId={row.id}
        onAsk={onAsk}
        onJump={onJump}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('book-excerpt-jump'));
    expect(onJump).toHaveBeenCalledWith(row);
    expect(onAsk).not.toHaveBeenCalled();
  });

  it('keeps the excerpt text clear of any icon', () => {
    // 防回归：删除按钮曾经浮在卡片右上角，把首行文字挤短。
    render(
      <BookExcerptRail
        excerpts={[excerpt()]}
        onAsk={vi.fn()}
        onJump={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const card = screen.getByTestId('book-excerpt-card');
    expect(card.querySelector('[data-testid="book-excerpt-delete"]')).toBeNull();
    // 卡片自己说明它是干什么用的（单击＝问 AI）。
    expect(card).toHaveAttribute('title', 'reference.book_excerpt_ask');
  });

  it('keeps the three whole-excerpt actions in the rail header', () => {
    // 跳回原文 / 放上画布 / 删除都作用在选中的那条上，就该和标题行待在一起，
    // 而不是每张卡各挂一排，把正文和章节标签挤短。
    const row = excerpt();
    render(
      <BookExcerptRail
        excerpts={[row]}
        selectedId={row.id}
        onAsk={vi.fn()}
        onJump={vi.fn()}
        onDelete={vi.fn()}
        onToCanvas={vi.fn()}
      />,
    );
    const header = screen.getByTestId('book-excerpt-rail').querySelector('header') as HTMLElement;
    for (const id of ['book-excerpt-jump', 'book-excerpt-to-canvas', 'book-excerpt-delete']) {
      const button = screen.getByTestId(id);
      expect(header.contains(button)).toBe(true);
      expect(screen.getByTestId('book-excerpt-card').contains(button)).toBe(false);
    }
  });

  it('shows the rail header actions always, and hides only the per-card ones', () => {
    // 顶栏那排是作用在**选中那条**上的（跳回原文 / 放上画布 / 删除）。藏起来
    // 等于让功能凭空消失，用户也不会想到顶栏能悬停——而且点完卡片指针未必在
    // 顶栏上，动作就再也露不出来。
    const row = excerpt();
    // 先不选：这时每张卡尾部那排应当收着。
    const { rerender } = render(
      <BookExcerptRail
        excerpts={[row]}
        onAsk={vi.fn()}
        onJump={vi.fn()}
        onDelete={vi.fn()}
        onToCanvas={vi.fn()}
      />,
    );
    // RailAction 外面还包了一层 span（为了给灰掉的按钮挂 title），所以要从按钮
    // 往上找到那一排动作的 div，不能直接取 parentElement。
    const rowOf = (testId: string) => screen.getByTestId(testId).closest('div');
    const cls = (el: Element | null) => el?.getAttribute('class') ?? '';

    for (const id of ['book-excerpt-jump', 'book-excerpt-to-canvas', 'book-excerpt-delete', 'book-excerpt-multi']) {
      expect(cls(rowOf(id)), `${id} row must stay visible`).not.toContain('opacity-0');
    }

    // 每张卡尾部那排才收起来：悬停、或选中、或焦点进来才显形。
    const cardRow = () => cls(rowOf('book-excerpt-copy'));
    expect(cardRow(), 'copy row hidden while nothing is selected')
      .toContain('opacity-0');
    expect(cardRow(), 'copy row must come back on keyboard focus')
      .toContain('focus-within:opacity-100');

    // 再选中：点了卡片就该看得见动作。
    rerender(
      <BookExcerptRail
        excerpts={[row]}
        selectedId={row.id}
        onAsk={vi.fn()}
        onJump={vi.fn()}
        onDelete={vi.fn()}
        onToCanvas={vi.fn()}
      />,
    );
    // 已选中：点了卡片就该看得见动作，不用再把鼠标挪回那张卡上。
    expect(cardRow(), 'copy row visible once the card is selected')
      .toContain('opacity-100');
    expect(cardRow()).not.toContain('opacity-0');
  });

  it('greys out the whole-excerpt actions until an excerpt is selected', () => {
    const onJump = vi.fn();
    const onToCanvas = vi.fn();
    const onDelete = vi.fn();
    render(
      <BookExcerptRail
        excerpts={[excerpt()]}
        onAsk={vi.fn()}
        onJump={onJump}
        onDelete={onDelete}
        onToCanvas={onToCanvas}
      />,
    );
    for (const id of ['book-excerpt-jump', 'book-excerpt-to-canvas', 'book-excerpt-delete']) {
      const button = screen.getByTestId(id);
      expect(button).toBeDisabled();
      // 灰掉的按钮收不到鼠标事件，提示只能挂在外层：否则"为什么是灰的"没人看得到。
      expect(button.parentElement).toHaveAttribute('title', 'reference.book_excerpt_pick_first');
      fireEvent.click(button);
    }
    expect(onJump).not.toHaveBeenCalled();
    expect(onToCanvas).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('applies the header actions to whichever excerpt is selected', () => {
    const onJump = vi.fn();
    const onToCanvas = vi.fn();
    const first = excerpt({ id: 'e1', text: '第一条' });
    const second = excerpt({ id: 'e2', text: '第二条' });
    render(
      <BookExcerptRail
        excerpts={[first, second]}
        selectedId="e2"
        onAsk={vi.fn()}
        onJump={onJump}
        onDelete={vi.fn()}
        onToCanvas={onToCanvas}
      />,
    );
    fireEvent.click(screen.getByTestId('book-excerpt-jump'));
    fireEvent.click(screen.getByTestId('book-excerpt-to-canvas'));
    expect(onJump).toHaveBeenCalledWith(second);
    expect(onToCanvas).toHaveBeenCalledWith([second]);
    expect(onJump).not.toHaveBeenCalledWith(first);
  });

  it('offers no delete until an excerpt is selected', () => {
    const onDelete = vi.fn();
    render(
      <BookExcerptRail
        excerpts={[excerpt()]}
        onAsk={vi.fn()}
        onJump={vi.fn()}
        onDelete={onDelete}
      />,
    );
    const remove = screen.getByTestId('book-excerpt-delete');
    expect(remove).toBeDisabled();
    fireEvent.click(remove);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('deletes the selected excerpt from the rail header', () => {
    const onDelete = vi.fn();
    const first = excerpt({ id: 'e1', text: '第一条' });
    const second = excerpt({ id: 'e2', text: '第二条' });
    render(
      <BookExcerptRail
        excerpts={[first, second]}
        selectedId="e2"
        onAsk={vi.fn()}
        onJump={vi.fn()}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByTestId('book-excerpt-delete'));
    expect(onDelete).toHaveBeenCalledWith([second]);
  });

  it('marks the excerpt the chat panel is reading', () => {
    const first = excerpt({ id: 'e1', text: '第一条' });
    const second = excerpt({ id: 'e2', text: '第二条' });
    const props = { excerpts: [first, second], onAsk: vi.fn(), onJump: vi.fn(), onDelete: vi.fn() };
    const { rerender } = render(<BookExcerptRail {...props} selectedId="e2" />);
    const cards = screen.getAllByTestId('book-excerpt-card');
    expect(cards[0]).toHaveAttribute('aria-pressed', 'false');
    expect(cards[1]).toHaveAttribute('aria-pressed', 'true');

    rerender(<BookExcerptRail {...props} selectedId={null} />);
    expect(screen.getAllByTestId('book-excerpt-card')[1]).toHaveAttribute('aria-pressed', 'false');
  });

  it('disables the jump for excerpts taken from the chat', () => {
    const row = excerpt({ source: 'chat', unitIndex: -1, unitLabel: '', text: 'AI 的解释' });
    const onJump = vi.fn();
    render(
      <BookExcerptRail
        excerpts={[row]}
        selectedId={row.id}
        onAsk={vi.fn()}
        onJump={onJump}
        onDelete={vi.fn()}
      />,
    );
    // 没有原文可跳：按钮留在标题行上（换选中项时不至于跳一下），但是灰的。
    const jump = screen.getByTestId('book-excerpt-jump');
    expect(jump).toBeDisabled();
    expect(jump.parentElement).toHaveAttribute(
      'title',
      'reference.book_excerpt_jump_unavailable',
    );
    fireEvent.click(jump);
    expect(onJump).not.toHaveBeenCalled();
    // 位置标签换成对话的名字，复制 / 删除 仍然可用。
    expect(screen.getByText('reference.book_chat_title')).toBeInTheDocument();
    expect(screen.getByTestId('book-excerpt-copy')).toBeInTheDocument();
    expect(screen.getByTestId('book-excerpt-delete')).not.toBeDisabled();
  });

  it('copies the full text, not the truncated preview', async () => {
    const long = '正'.repeat(400);
    render(
      <BookExcerptRail
        excerpts={[excerpt({ text: long })]}
        onAsk={vi.fn()}
        onJump={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('book-excerpt-copy'));
    await waitFor(() => expect(copyTextToClipboard).toHaveBeenCalledWith(long));
    expect(await screen.findByTestId('book-excerpt-copy')).toBeInTheDocument();
  });

  it('only offers the canvas export when the host wires it up', () => {
    const row = excerpt();
    const { unmount } = render(
      <BookExcerptRail excerpts={[row]} onAsk={vi.fn()} onJump={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(screen.queryByTestId('book-excerpt-to-canvas')).toBeNull();
    unmount();

    const onToCanvas = vi.fn();
    render(
      <BookExcerptRail
        excerpts={[row]}
        selectedId={row.id}
        onAsk={vi.fn()}
        onJump={vi.fn()}
        onDelete={vi.fn()}
        onToCanvas={onToCanvas}
      />,
    );
    fireEvent.click(screen.getByTestId('book-excerpt-to-canvas'));
    expect(onToCanvas).toHaveBeenCalledWith([row]);
  });

  it('hides the thought affordance when the host cannot save one', () => {
    render(
      <BookExcerptRail excerpts={[excerpt()]} onAsk={vi.fn()} onJump={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(screen.queryByTestId('book-excerpt-note-add')).toBeNull();
    expect(screen.queryByTestId('book-excerpt-note-edit')).toBeNull();
  });

  it('shows a saved thought under the excerpt, labelled as the user’s', () => {
    render(
      <BookExcerptRail
        excerpts={[excerpt({ note: '这跟我手上的项目对得上' })]}
        onAsk={vi.fn()}
        onJump={vi.fn()}
        onDelete={vi.fn()}
        onNoteChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('book-excerpt-note')).toHaveTextContent('这跟我手上的项目对得上');
    // 有想法时给的是"改"，没有时才是"写"。
    expect(screen.getByTestId('book-excerpt-note-edit')).toBeInTheDocument();
    expect(screen.queryByTestId('book-excerpt-note-add')).toBeNull();
  });
  it('opens a blank editor for an excerpt without a thought and auto-saves on blur', () => {
    const onNoteChange = vi.fn();
    render(
      <BookExcerptRail
        excerpts={[excerpt({ id: 'e1' })]}
        onAsk={vi.fn()}
        onJump={vi.fn()}
        onDelete={vi.fn()}
        onNoteChange={onNoteChange}
      />,
    );
    fireEvent.click(screen.getByTestId('book-excerpt-note-add'));
    const input = screen.getByTestId('book-excerpt-note-input');
    expect(input).toHaveValue('');

    fireEvent.change(input, { target: { value: '这跟我想的对得上' } });
    fireEvent.blur(input);

    expect(onNoteChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'e1' }),
      '这跟我想的对得上',
    );
    // 自动保存不该把编辑器关掉——用户可能还要接着写
    expect(screen.getByTestId('book-excerpt-note-input')).toBeInTheDocument();
  });

  it('edits an existing thought and clears it by emptying the box', () => {
    const onNoteChange = vi.fn();
    render(
      <BookExcerptRail
        excerpts={[excerpt({ id: 'e1', note: '旧的想法' })]}
        onAsk={vi.fn()}
        onJump={vi.fn()}
        onDelete={vi.fn()}
        onNoteChange={onNoteChange}
      />,
    );
    fireEvent.click(screen.getByTestId('book-excerpt-note-edit'));
    const input = screen.getByTestId('book-excerpt-note-input');
    expect(input).toHaveValue('旧的想法');

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);

    // 空串 = 清掉这条想法，这是自动保存之后"不想要了"的唯一表达方式
    expect(onNoteChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }), '');
  });

  it('offers no save or cancel button — the editor saves itself', () => {
    // 「保存 / 取消」两个按钮太繁琐，而且自动保存之后"取消"已经无从谈起：
    // 内容在打字过程中就已经写回去了。想去掉就清空输入框。
    render(
      <BookExcerptRail
        excerpts={[excerpt({ id: 'e1' })]}
        onAsk={vi.fn()}
        onJump={vi.fn()}
        onDelete={vi.fn()}
        onNoteChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('book-excerpt-note-add'));
    expect(screen.getByTestId('book-excerpt-note-editor')).toBeInTheDocument();
    expect(screen.queryByTestId('book-excerpt-note-save')).toBeNull();
    expect(screen.queryByTestId('book-excerpt-note-cancel')).toBeNull();
  });

  it('flushes the draft when the rail unmounts', () => {
    // 关掉左栏不会触发 blur，草稿必须自己冲出去，否则写一半就没了。
    const onNoteChange = vi.fn();
    const { unmount } = render(
      <BookExcerptRail
        excerpts={[excerpt({ id: 'e1' })]}
        onAsk={vi.fn()}
        onJump={vi.fn()}
        onDelete={vi.fn()}
        onNoteChange={onNoteChange}
      />,
    );
    fireEvent.click(screen.getByTestId('book-excerpt-note-add'));
    fireEvent.change(screen.getByTestId('book-excerpt-note-input'), {
      target: { value: '写到一半' },
    });
    unmount();
    expect(onNoteChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }), '写到一半');
  });

  it('does not write when the draft ends up exactly as it started', () => {
    const onNoteChange = vi.fn();
    render(
      <BookExcerptRail
        excerpts={[excerpt({ id: 'e1', note: '原来的想法' })]}
        onAsk={vi.fn()}
        onJump={vi.fn()}
        onDelete={vi.fn()}
        onNoteChange={onNoteChange}
      />,
    );
    fireEvent.click(screen.getByTestId('book-excerpt-note-edit'));
    const input = screen.getByTestId('book-excerpt-note-input');
    fireEvent.blur(input);
    expect(onNoteChange).not.toHaveBeenCalled();
  });

  it('does not ask AI when the user is typing the thought', () => {
    const onAsk = vi.fn();
    render(
      <BookExcerptRail
        excerpts={[excerpt({ id: 'e1' })]}
        onAsk={onAsk}
        onJump={vi.fn()}
        onDelete={vi.fn()}
        onNoteChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('book-excerpt-note-add'));
    fireEvent.change(screen.getByTestId('book-excerpt-note-input'), {
      target: { value: '随便写点' },
    });
    expect(onAsk).not.toHaveBeenCalled();
  });

  it('lets Enter insert a newline instead of asking AI', () => {
    const onAsk = vi.fn();
    render(
      <BookExcerptRail
        excerpts={[excerpt({ id: 'e1' })]}
        onAsk={onAsk}
        onJump={vi.fn()}
        onDelete={vi.fn()}
        onNoteChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('book-excerpt-note-add'));
    // 想法是多行的，回车必须换行（以前是"回车＝保存"）
    fireEvent.keyDown(screen.getByTestId('book-excerpt-note-input'), { key: 'Enter' });
    expect(onAsk).not.toHaveBeenCalled();
    expect(screen.getByTestId('book-excerpt-note-input')).toBeInTheDocument();
  });

  it('closes the editor on Escape, and what was typed is already saved', () => {
    // 自动保存之后 Esc 只是"我写完了"，不是"别存"。
    const onNoteChange = vi.fn();
    render(
      <BookExcerptRail
        excerpts={[excerpt({ id: 'e1' })]}
        onAsk={vi.fn()}
        onJump={vi.fn()}
        onDelete={vi.fn()}
        onNoteChange={onNoteChange}
      />,
    );
    fireEvent.click(screen.getByTestId('book-excerpt-note-add'));
    fireEvent.change(screen.getByTestId('book-excerpt-note-input'), {
      target: { value: '想到的' },
    });
    fireEvent.focus(screen.getByTestId('book-excerpt-note-input'));
    fireEvent.keyDown(screen.getByTestId('book-excerpt-note-input'), { key: 'Escape' });

    expect(onNoteChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }), '想到的');
    expect(screen.queryByTestId('book-excerpt-note-input')).toBeNull();
  });

  it('closes the editor when the click lands outside the rail, saving what was typed', () => {
    // 和伴读栏那条 chip、标题行那个高亮同一条规则：结束按点击位置判，不看焦点。
    const onNoteChange = vi.fn();
    render(
      <BookExcerptRail
        excerpts={[excerpt({ id: 'e1' })]}
        onAsk={vi.fn()}
        onJump={vi.fn()}
        onDelete={vi.fn()}
        onNoteChange={onNoteChange}
      />,
    );
    fireEvent.click(screen.getByTestId('book-excerpt-note-add'));
    fireEvent.change(screen.getByTestId('book-excerpt-note-input'), {
      target: { value: '想到的' },
    });

    // 监听器挂在 document 上，body 在摘抄本之外，正好是"点了别处"。
    fireEvent.pointerDown(document.body);

    expect(onNoteChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }), '想到的');
    expect(screen.queryByTestId('book-excerpt-note-input')).toBeNull();
  });

  it('keeps the editor open when the click stays inside the rail', () => {
    // 在栏里点想法/保存这些按钮不能顺手把编辑器收了——否则字还没写完就没了落点。
    render(
      <BookExcerptRail
        excerpts={[excerpt({ id: 'e1' })]}
        onAsk={vi.fn()}
        onJump={vi.fn()}
        onDelete={vi.fn()}
        onNoteChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('book-excerpt-note-add'));

    fireEvent.pointerDown(screen.getByTestId('book-excerpt-rail'));
    fireEvent.pointerDown(screen.getByTestId('book-excerpt-note-input'));

    expect(screen.getByTestId('book-excerpt-note-input')).toBeInTheDocument();
  });

  it('does not ask AI from a keyboard press on the card’s own copy button', () => {
    const onAsk = vi.fn();
    render(
      <BookExcerptRail
        excerpts={[excerpt({ id: 'e1' })]}
        onAsk={onAsk}
        onJump={vi.fn()}
        onDelete={vi.fn()}
        onNoteChange={vi.fn()}
      />,
    );
    fireEvent.keyDown(screen.getByTestId('book-excerpt-copy'), { key: 'Enter' });
    expect(onAsk).not.toHaveBeenCalled();
  });


  it('keeps only one editor open at a time', () => {
    render(
      <BookExcerptRail
        excerpts={[excerpt({ id: 'e1' }), excerpt({ id: 'e2', note: '第二条的想法' })]}
        onAsk={vi.fn()}
        onJump={vi.fn()}
        onDelete={vi.fn()}
        onNoteChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getAllByTestId('book-excerpt-note-add')[0]);
    fireEvent.click(screen.getByTestId('book-excerpt-note-edit'));
    expect(screen.getAllByTestId('book-excerpt-note-input')).toHaveLength(1);
    expect(screen.getByTestId('book-excerpt-note-input')).toHaveValue('第二条的想法');
  });

  describe('multi-select', () => {
    const first = excerpt({ id: 'e1', text: '第一条' });
    const second = excerpt({ id: 'e2', text: '第二条' });
    const third = excerpt({ id: 'e3', text: '第三条' });

    function renderMulti(props: {
      selectionMode?: boolean;
      checkedIds?: string[];
      onDelete?: (excerpts: BookExcerpt[]) => void;
      onToCanvas?: (excerpts: BookExcerpt[]) => void;
      onAsk?: (excerpt: BookExcerpt) => void;
      onJump?: (excerpt: BookExcerpt) => void;
      onSelectionModeChange?: (next: boolean) => void;
      onToggleChecked?: (excerptId: string) => void;
      onSetChecked?: (excerptIds: string[]) => void;
      onClearChecked?: () => void;
    }) {
      render(
        <BookExcerptRail
          excerpts={[first, second, third]}
          selectionMode={props.selectionMode}
          checkedIds={props.checkedIds}
          onAsk={props.onAsk ?? vi.fn()}
          onJump={props.onJump ?? vi.fn()}
          onDelete={props.onDelete ?? vi.fn()}
          onToCanvas={props.onToCanvas}
          onSelectionModeChange={props.onSelectionModeChange}
          onToggleChecked={props.onToggleChecked}
          onSetChecked={props.onSetChecked}
          onClearChecked={props.onClearChecked}
        />,
      );
    }

    it('offers a way into multi-select, and single-click still asks until it is on', () => {
      const onAsk = vi.fn();
      const onSelectionModeChange = vi.fn();
      renderMulti({ onAsk, onSelectionModeChange });

      fireEvent.click(screen.getAllByTestId('book-excerpt-card')[0]);
      expect(onAsk).toHaveBeenCalledWith(first);
      fireEvent.click(screen.getByTestId('book-excerpt-multi'));
      expect(onSelectionModeChange).toHaveBeenCalledWith(true);
    });

    it('toggles instead of asking while multi-select is on', () => {
      const onAsk = vi.fn();
      const onToggleChecked = vi.fn();
      renderMulti({ selectionMode: true, onAsk, onToggleChecked });

      fireEvent.click(screen.getAllByTestId('book-excerpt-card')[1]);
      expect(onToggleChecked).toHaveBeenCalledWith('e2');
      // 圈选一路问一路会把右栏塞满，所以这一轮单击不再问 AI。
      expect(onAsk).not.toHaveBeenCalled();
    });

    it('says so after the canvas export, then settles back', () => {
      // 这颗按钮"看着像什么都没发生"：点一下，画布那头多出几张卡，
      // 而人还盯着左栏。不给交代的话多半会再点一次，画布上就多一份重复的。
      vi.useFakeTimers();
      try {
        const onToCanvas = vi.fn();
        renderMulti({ selectionMode: true, checkedIds: ['e1', 'e3'], onToCanvas });

        expect(screen.getByTestId('book-excerpt-to-canvas')).toHaveAttribute(
          'aria-label',
          'reference.book_excerpt_to_canvas_many',
        );
        fireEvent.click(screen.getByTestId('book-excerpt-to-canvas'));
        expect(onToCanvas).toHaveBeenCalledWith([first, third]);
        expect(screen.getByTestId('book-excerpt-to-canvas')).toHaveAttribute(
          'aria-label',
          'reference.book_excerpt_to_canvas_done_many',
        );

        act(() => {
          vi.advanceTimersByTime(1600);
        });
        expect(screen.getByTestId('book-excerpt-to-canvas')).toHaveAttribute(
          'aria-label',
          'reference.book_excerpt_to_canvas_many',
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('applies delete and the canvas export to every checked excerpt', () => {
      const onDelete = vi.fn();
      const onToCanvas = vi.fn();
      renderMulti({ selectionMode: true, checkedIds: ['e1', 'e3'], onDelete, onToCanvas });

      fireEvent.click(screen.getByTestId('book-excerpt-delete'));
      expect(onDelete).toHaveBeenCalledWith([first, third]);

      fireEvent.click(screen.getByTestId('book-excerpt-to-canvas'));
      expect(onToCanvas).toHaveBeenCalledWith([first, third]);
    });

    it('keeps the header actions inert until something is checked', () => {
      const onDelete = vi.fn();
      renderMulti({ selectionMode: true, checkedIds: [], onDelete });
      expect(screen.getByTestId('book-excerpt-delete')).toBeDisabled();
      fireEvent.click(screen.getByTestId('book-excerpt-delete'));
      expect(onDelete).not.toHaveBeenCalled();
    });

    it('offers no separate "show these to the AI" button', () => {
      // 勾选本身就是"这一轮递 AI 这几条"，右栏输入框上方也会挂一条提示。
      // 再摆一颗按钮只是把同一件事说两遍，还会让人以为不点它就生效不了。
      const { unmount } = render(
        <BookExcerptRail
          excerpts={[first, second, third]}
          selectionMode
          checkedIds={['e1', 'e3']}
          onAsk={vi.fn()}
          onJump={vi.fn()}
          onDelete={vi.fn()}
          onToCanvas={vi.fn()}
        />,
      );
      expect(screen.queryByTestId('book-excerpt-ask-many')).toBeNull();
      expect(screen.getByTestId('book-excerpt-to-canvas')).toBeInTheDocument();
      unmount();
    });

    it('select-all adds the rest instead of flipping the ticked ones off', () => {
      // 勾了一半再点"全选"，逐条 toggle 会把勾上的那几条翻成没勾——
      // 用户明明点的是"全都要"。所以这一格得能直接设置整个勾选集。
      const onSetChecked = vi.fn();
      renderMulti({ selectionMode: true, checkedIds: ['e1'], onSetChecked });
      fireEvent.click(screen.getByTestId('book-excerpt-select-all'));
      expect(onSetChecked).toHaveBeenCalledWith(['e1', 'e2', 'e3']);
    });

    it('hides jump, which only ever moves to one passage', () => {
      renderMulti({ selectionMode: true, checkedIds: ['e1'] });
      expect(screen.queryByTestId('book-excerpt-jump')).toBeNull();
    });

    it('selects everything at once, then clears the whole set', () => {
      const onToggleChecked = vi.fn();
      renderMulti({ selectionMode: true, checkedIds: [], onToggleChecked });

      fireEvent.click(screen.getByTestId('book-excerpt-select-all'));
      expect(onToggleChecked).toHaveBeenCalledTimes(3);

      const onClearChecked = vi.fn();
      renderMulti({ selectionMode: true, checkedIds: ['e1', 'e2', 'e3'], onClearChecked });
      fireEvent.click(screen.getAllByTestId('book-excerpt-select-all')[1]);
      expect(onClearChecked).toHaveBeenCalled();
    });

    it('leaves multi-select and drops the checkboxes when done', () => {
      const onSelectionModeChange = vi.fn();
      const onClearChecked = vi.fn();
      renderMulti({ selectionMode: true, checkedIds: ['e1'], onSelectionModeChange, onClearChecked });

      expect(screen.getAllByTestId('book-excerpt-checkbox')).toHaveLength(3);
      fireEvent.click(screen.getByTestId('book-excerpt-selection-done'));
      expect(onClearChecked).toHaveBeenCalled();
      expect(onSelectionModeChange).toHaveBeenCalledWith(false);
    });
  });
});
