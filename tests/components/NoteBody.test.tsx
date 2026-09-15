import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { NoteBody } from '../../src/components/nodes/note/NoteBody';
import { NOTE_CARD_SCROLL_MAX_HEIGHT_PX } from '../../src/utils/canvas';

const updateMock = vi.fn();

vi.mock('../../src/db', () => ({
  db: {
    nodes: {
      update: (...args: unknown[]) => updateMock(...args),
    },
  },
}));

const persistenceDisabled = vi.fn(() => true);

vi.mock('../../src/config/persistence', () => ({
  isContentBlurPersistenceDisabled: () => persistenceDisabled(),
}));

const baseNode = {
  id: 'n1',
  type: 'text' as const,
  content: '',
  x: 0,
  y: 0,
};

describe('NoteBody', () => {
  beforeEach(() => {
    updateMock.mockClear();
    persistenceDisabled.mockReturnValue(true);
  });

  it('启用 blur 持久化时 onBlur 将 innerText 写入数据库并清空编辑态', () => {
    persistenceDisabled.mockReturnValue(false);
    const setEditing = vi.fn();

    const { container } = render(
      <NoteBody
        node={{ ...baseNode, content: 'initial' }}
        editingNodeId="n1"
        setEditingNodeId={setEditing}
        editClassName="edit"
        viewClassName="view"
        emptyNotePlaceholder="_empty_"
      />
    );

    const editable = container.querySelector('[contenteditable="true"]') as HTMLDivElement;
    expect(editable).toBeTruthy();

    editable.innerText = 'persisted line';
    fireEvent.blur(editable);

    expect(updateMock).toHaveBeenCalledWith('n1', { content: 'persisted line' });
    expect(setEditing).toHaveBeenCalledWith(null);
  });

  it('禁用 blur 持久化时 onBlur 仍会清空编辑态但不写库', () => {
    persistenceDisabled.mockReturnValue(true);
    const setEditing = vi.fn();

    const { container } = render(
      <NoteBody
        node={{ ...baseNode, content: 'whatever' }}
        editingNodeId="n1"
        setEditingNodeId={setEditing}
        editClassName="edit"
        viewClassName="view"
        emptyNotePlaceholder="_empty_"
      />
    );

    const editable = container.querySelector('[contenteditable="true"]') as HTMLDivElement;
    fireEvent.blur(editable);

    expect(updateMock).not.toHaveBeenCalled();
    expect(setEditing).toHaveBeenCalledWith(null);
  });

  it('点击预览区进入编辑（核心：view onClick → setEditingNodeId）', () => {
    const setEditing = vi.fn();
    const { container } = render(
      <NoteBody
        node={{ ...baseNode, content: 'click me' }}
        editingNodeId={null}
        setEditingNodeId={setEditing}
        editClassName="edit"
        viewClassName="view"
        emptyNotePlaceholder="_empty_"
      />,
    );

    const preview = container.querySelector('.cursor-text') as HTMLElement;
    expect(preview).toBeTruthy();
    fireEvent.click(preview);
    expect(setEditing).toHaveBeenCalledTimes(1);
    expect(setEditing).toHaveBeenCalledWith('n1');
  });

  it('未拖拽高度时正文区有 maxHeight，长粘贴在卡内滚动', () => {
    const { getByTestId } = render(
      <NoteBody
        node={{ ...baseNode, content: '很长的一段' }}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        editClassName="edit"
        viewClassName="view"
        emptyNotePlaceholder="_empty_"
      />,
    );
    expect(getByTestId('note-body-scroll').style.maxHeight).toBe(`${NOTE_CARD_SCROLL_MAX_HEIGHT_PX}px`);
  });

  it('用户拖拽过高度后取消正文 maxHeight，由卡片外壳约束', () => {
    const { getByTestId } = render(
      <NoteBody
        node={{ ...baseNode, content: '很长的一段', height: 520 }}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        editClassName="edit"
        viewClassName="view"
        emptyNotePlaceholder="_empty_"
      />,
    );
    expect(getByTestId('note-body-scroll').style.maxHeight).toBe('');
  });

  it('预览与编辑都用 pre-wrap 纯文本，单行回车不会被 Markdown 吞掉', () => {
    const { container } = render(
      <NoteBody
        node={{ ...baseNode, content: '我\n要么\n这样的？' }}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        editClassName="edit"
        viewClassName="view"
        emptyNotePlaceholder="_empty_"
      />
    );

    const preview = container.querySelector('.cursor-text') as HTMLElement;
    expect(preview).toBeTruthy();
    expect(preview.style.whiteSpace).toBe('pre-wrap');
    expect(preview.textContent).toBe('我\n要么\n这样的？');
  });

  it('从编辑切到预览后卸掉 contentEditable，正文仍是同一段纯文本', () => {
    const setEditing = vi.fn();

    function Harness({ editingId, content }: { editingId: string | null; content: string }) {
      return (
        <NoteBody
          node={{ ...baseNode, content }}
          editingNodeId={editingId}
          setEditingNodeId={setEditing}
          editClassName="edit"
          viewClassName="view"
          emptyNotePlaceholder="_empty_"
        />
      );
    }

    const typed = 'unique-note-body-preview-once';
    const { container, rerender } = render(<Harness editingId="n1" content={typed} />);
    expect(container.querySelector('[contenteditable="true"]')).toBeTruthy();

    rerender(<Harness editingId={null} content={typed} />);

    expect(container.querySelector('[contenteditable="true"]')).toBeNull();
    const preview = container.querySelector('.cursor-text') as HTMLElement;
    expect(preview).toBeTruthy();
    expect(preview.textContent ?? '').toContain(typed);
    expect((preview.textContent ?? '').split(typed).length - 1).toBe(1);
  });

  it('从预览滚到底再点进编辑，滚动位置保持不变', () => {
    const setEditing = vi.fn();
    const long = `${'段落开头。\n'.repeat(8)}段落结尾。`;

    function Harness({ editingId }: { editingId: string | null }) {
      return (
        <NoteBody
          node={{ ...baseNode, content: long }}
          editingNodeId={editingId}
          setEditingNodeId={setEditing}
          editClassName="edit"
          viewClassName="view"
          emptyNotePlaceholder="_empty_"
        />
      );
    }

    const { container, rerender } = render(<Harness editingId={null} />);
    const scroller = container.firstElementChild as HTMLElement;
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 800 });
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 200 });
    scroller.scrollTop = 420;

    fireEvent.click(container.querySelector('.cursor-text') as HTMLElement);
    expect(setEditing).toHaveBeenCalledWith('n1');

    rerender(<Harness editingId="n1" />);
    expect((container.firstElementChild as HTMLElement).scrollTop).toBe(420);
  });

  it('退出编辑时也把滚动位置还给预览', () => {
    const setEditing = vi.fn();
    const long = `${'段落开头。\n'.repeat(8)}段落结尾。`;

    function Harness({ editingId }: { editingId: string | null }) {
      return (
        <NoteBody
          node={{ ...baseNode, content: long }}
          editingNodeId={editingId}
          setEditingNodeId={setEditing}
          editClassName="edit"
          viewClassName="view"
          emptyNotePlaceholder="_empty_"
        />
      );
    }

    const { container, rerender } = render(<Harness editingId="n1" />);
    const scroller = container.firstElementChild as HTMLElement;
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 800 });
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 200 });
    scroller.scrollTop = 360;

    const editable = container.querySelector('[contenteditable="true"]') as HTMLElement;
    fireEvent.blur(editable);
    rerender(<Harness editingId={null} />);
    expect((container.firstElementChild as HTMLElement).scrollTop).toBe(360);
  });

  it('编辑态显式设置 white-space: pre-wrap（避免 node.content 里的 \\n 在 contentEditable 中被折叠成空格）', () => {
    const { container } = render(
      <NoteBody
        node={{ ...baseNode, content: '我\n要么\n这样的？' }}
        editingNodeId="n1"
        setEditingNodeId={vi.fn()}
        editClassName="edit"
        viewClassName="view"
        emptyNotePlaceholder="_empty_"
      />
    );
    const editable = container.querySelector('[contenteditable="true"]') as HTMLElement;
    expect(editable.style.whiteSpace).toBe('pre-wrap');
  });

  it('onBlur 后预览立即用乐观值，避免「db 异步 + useLiveQuery 同步」之间的内容回退闪烁', () => {
    persistenceDisabled.mockReturnValue(false);
    const setEditing = vi.fn();

    function Harness({ editingId, content }: { editingId: string | null; content: string }) {
      return (
        <NoteBody
          node={{ ...baseNode, content }}
          editingNodeId={editingId}
          setEditingNodeId={setEditing}
          editClassName="edit"
          viewClassName="view"
          emptyNotePlaceholder="_empty_"
        />
      );
    }

    const { container, rerender } = render(<Harness editingId="n1" content="" />);
    const editable = container.querySelector('[contenteditable="true"]') as HTMLDivElement;
    editable.innerText = 'fresh\nlines';
    fireEvent.blur(editable);

    /** 模拟 React 在 db 写完之前先完成 isEditing→false 的 rerender；node.content 仍是旧值 "" */
    rerender(<Harness editingId={null} content="" />);

    const preview = container.querySelector('.cursor-text') as HTMLElement;
    expect(preview).toBeTruthy();
    /** 没有乐观值时这里会是 emptyMarkdown；有乐观值则立即显示用户刚保存的内容 */
    expect(preview.textContent ?? '').toContain('fresh');
    expect(preview.textContent ?? '').toContain('lines');
  });

  it('非受控编辑：父组件重渲染或 props.content 变化时，不覆盖用户已输入的内容（避免光标乱跳/重复字）', () => {
    function Harness({ flag, content }: { flag: number; content: string }) {
      return (
        <div>
          <span data-testid="flag">{flag}</span>
          <NoteBody
            node={{ ...baseNode, content }}
            editingNodeId="n1"
            setEditingNodeId={vi.fn()}
            editClassName="edit"
            viewClassName="view"
            emptyNotePlaceholder="_empty_"
          />
        </div>
      );
    }

    const { container, rerender } = render(<Harness flag={0} content="hello" />);
    const editable = container.querySelector('[contenteditable="true"]') as HTMLElement;
    expect(editable.textContent).toBe('hello');
    editable.textContent = 'hello typed';

    rerender(<Harness flag={1} content="hello from asr" />);

    const editableAfter = container.querySelector('[contenteditable="true"]') as HTMLElement;
    expect(editableAfter.textContent).toBe('hello typed');
  });

  // 守护 bf6112f 的"ASR 与用户编辑冲突"端到端契约：用户在编辑时，ASR 通过 db 写库
  // （即父组件重渲染带新 content）；blur 时，写回 db 的必须是用户的输入，不能是 ASR 的最新值。
  it('编辑中 ASR 改写 props.content，blur 时仍把用户输入（不是 ASR 内容）写回 db', () => {
    persistenceDisabled.mockReturnValue(false);
    const setEditing = vi.fn();
    function Harness({ content }: { content: string }) {
      return (
        <NoteBody
          node={{ ...baseNode, content }}
          editingNodeId="n1"
          setEditingNodeId={setEditing}
          editClassName="edit"
          viewClassName="view"
          emptyNotePlaceholder="_empty_"
        />
      );
    }

    const { container, rerender } = render(<Harness content="初始内容" />);
    const editable = container.querySelector('[contenteditable="true"]') as HTMLDivElement;
    // 1) 用户在编辑区里输入新文字（用 textContent 在 jsdom 里更可靠）
    editable.textContent = '用户手动输入的文字';

    // 2) ASR 这时把 db 里的 content 改成了"ASR 写入"
    rerender(<Harness content="ASR 写入" />);

    // 编辑区应当保留用户输入（不能被 ASR 覆盖）
    const editableAfter = container.querySelector('[contenteditable="true"]') as HTMLDivElement;
    expect(editableAfter.textContent).toBe('用户手动输入的文字');

    // 3) 用户 blur
    fireEvent.blur(editableAfter);

    // 关键断言：写库的必须是"用户手动输入的文字"，不能是"ASR 写入"
    expect(updateMock).toHaveBeenCalledWith('n1', { content: '用户手动输入的文字' });
    expect(setEditing).toHaveBeenCalledWith(null);
  });

  // 配套守护：编辑中 ASR 不改 props.content（极少见）时，编辑器 seed 一开始的内容
  // 后不再被任何 props 变化干扰（连续重渲染 3 次都是同一个 props 仍不动）。
  it('连续多次 props 重渲染不触发 seed-once 重置（光标不会因为父组件频繁更新而跳到开头）', () => {
    function Harness({ tick, content }: { tick: number; content: string }) {
      return (
        <div>
          <span data-testid="tick">{tick}</span>
          <NoteBody
            node={{ ...baseNode, content }}
            editingNodeId="n1"
            setEditingNodeId={vi.fn()}
            editClassName="edit"
            viewClassName="view"
            emptyNotePlaceholder="_empty_"
          />
        </div>
      );
    }

    const { container, rerender } = render(<Harness tick={0} content="起始" />);
    const editable = container.querySelector('[contenteditable="true"]') as HTMLElement;
    expect(editable.textContent).toBe('起始');
    // 用户输入
    editable.textContent = '输入1';
    // 父组件重渲染，content 没变
    rerender(<Harness tick={1} content="起始" />);
    let ed = container.querySelector('[contenteditable="true"]') as HTMLElement;
    expect(ed.textContent).toBe('输入1');
    // 再输入
    ed.textContent = '输入1输入2';
    // 父组件重渲染，content 还是没变
    rerender(<Harness tick={2} content="起始" />);
    ed = container.querySelector('[contenteditable="true"]') as HTMLElement;
    expect(ed.textContent).toBe('输入1输入2');
  });

  it('进入编辑时种 pendingContent，而不是仍滞后的 node.content', () => {
    persistenceDisabled.mockReturnValue(false);
    const setEditing = vi.fn();

    function Harness({ editingId, content }: { editingId: string | null; content: string }) {
      return (
        <NoteBody
          node={{ ...baseNode, content }}
          editingNodeId={editingId}
          setEditingNodeId={setEditing}
          editClassName="edit"
          viewClassName="view"
          emptyNotePlaceholder="_empty_"
        />
      );
    }

    const { container, rerender } = render(<Harness editingId="n1" content="旧稿" />);
    const editable = container.querySelector('[contenteditable="true"]') as HTMLDivElement;
    editable.innerText = '平台。\n而是\nskill就行。\n\n单独做一个AI软件成本很高。';
    fireEvent.blur(editable);

    rerender(<Harness editingId={null} content="旧稿" />);
    const preview = container.querySelector('.cursor-text') as HTMLElement;
    expect(preview.textContent ?? '').toContain('单独做一个AI软件成本很高。');

    rerender(<Harness editingId="n1" content="旧稿" />);
    const again = container.querySelector('[contenteditable="true"]') as HTMLElement;
    expect(again.textContent).toContain('单独做一个AI软件成本很高。');
    expect(again.textContent).not.toBe('旧稿');
  });

  it('预览和编辑看到同一段正文（含空行后的第二段）', () => {
    const raw = '平台。\n而是\nskill就行。\n\n单独做一个AI软件成本很高，周期长，会\n有很多东西。';
    const view = render(
      <NoteBody
        node={{ ...baseNode, content: raw }}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        editClassName="edit"
        viewClassName="view"
        emptyNotePlaceholder="_empty_"
      />,
    );
    expect(view.container.querySelector('.cursor-text')?.textContent).toBe(raw);
    view.unmount();

    const edit = render(
      <NoteBody
        node={{ ...baseNode, content: raw }}
        editingNodeId="n1"
        setEditingNodeId={vi.fn()}
        editClassName="edit"
        viewClassName="view"
        emptyNotePlaceholder="_empty_"
      />,
    );
    expect(edit.container.querySelector('[contenteditable="true"]')?.textContent).toBe(raw);
  });

  it('进入编辑时把 HTML 段落展成可见纯文本，而不是丢掉', () => {
    const raw =
      '平台。\n而是\nskill就行。\n\n<p>单独做一个AI软件成本很高，周期长，会\n有很多东西。</p>';
    const { container } = render(
      <NoteBody
        node={{ ...baseNode, content: raw }}
        editingNodeId="n1"
        setEditingNodeId={vi.fn()}
        editClassName="edit"
        viewClassName="view"
        emptyNotePlaceholder="_empty_"
      />,
    );

    const editable = container.querySelector('[contenteditable="true"]') as HTMLElement;
    expect(editable.textContent).toContain('单独做一个AI软件成本很高，周期长，会');
    expect(editable.textContent).toContain('有很多东西。');
    expect(editable.textContent).not.toMatch(/<\/?p>/i);
  });
});

