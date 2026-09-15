import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { createRef, type ComponentProps, type MutableRefObject } from 'react';
import { DraggableNode } from '../../src/components/canvas/DraggableNode';
import { cardGestureTransform } from '../../src/utils/nodeDragVisual';
import { clearAllAskComposerDrafts } from '../../src/utils/askComposerDraft';

const playUiSfxMock = vi.fn();
vi.mock('../../src/utils/uiSfx', () => ({
  playUiSfx: (kind: 'bubblePop') => playUiSfxMock(kind),
  preloadUiSfx: () => undefined,
}));

vi.mock('../../src/components/nodes/AgentNode', () => ({
  AgentRunAnalysisButton: ({
    onRunAnalysis,
    disabled,
  }: {
    onRunAnalysis: () => void;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      data-testid="agent-run-analysis"
      disabled={disabled}
      onClick={onRunAnalysis}
    >
      Run
    </button>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'canvas.link_note': 'Link',
        'canvas.delete_note': 'Delete',
        'canvas.archive_note': 'Archive',
        'canvas.cycle_layout': 'Layout',
        'canvas.select_note': 'Select',
        'canvas.rotate_note': 'Rotate',
        'canvas.change_color': '更改颜色',
        'canvas.change_font': '更改字体',
        'archive.pick_folder': 'Save to folder',
        'archive.unfiled': 'Unfiled',
        'archive.new_folder': 'New folder',
        'archive.folder_name_placeholder': 'Folder name',
        'nodes.search_while_writing': 'Web search',
        'nodes.ask_ai': 'Ask AI',
        'nodes.ask_ai_hint': 'Ask AI about this card',
        'nodes.ask_ai_need_persona': 'Connect any AI persona card first',
        'nodes.ai_thinking_label': 'Thinking',
        'nodes.ai_thinking_view': 'View thinking',
        'nodes.agent_run_analysis': 'Run analysis on linked notes',
        'nodes.agent_run_direct': 'Run now',
        'nodes.agent_ask_option': 'Ask',
        'ask.card_placeholder': 'Ask this card…',
        'ask.send': 'Send',
      }[key] ?? key),
  }),
}));

function renderNode(props: Partial<ComponentProps<typeof DraggableNode>> = {}) {
  const nodesRef = createRef<Record<string, HTMLElement | null>>();
  nodesRef.current = {};
  const { children, ...rest } = props;
  return render(
    <DraggableNode
      id="n1"
      nodesRef={nodesRef as MutableRefObject<Record<string, HTMLElement | null>>}
      isConnecting={false}
      onLink={vi.fn()}
      onDelete={vi.fn()}
      onCycleLayout={vi.fn()}
      isSelected
      {...rest}
    >
      {children ?? <div>Note body</div>}
    </DraggableNode>
  );
}

describe('DraggableNode', () => {
  beforeEach(() => {
    clearAllAskComposerDrafts();
  });
  it('编辑态隐藏外链、布局、删除、缩放手柄（避免 group-hover 再次点亮）', () => {
    renderNode({ isEditing: true, isSelected: true, onArchive: vi.fn() });

    const rightChrome = screen.getByTitle('Link').parentElement;
    expect(rightChrome).toHaveClass('pointer-events-none');
    expect(rightChrome).toHaveClass('!opacity-0');

    const topBar = screen.getByTitle('Layout').parentElement;
    expect(topBar).toHaveClass('pointer-events-none');
    expect(topBar).toHaveClass('!opacity-0');
    expect(topBar).toContainElement(screen.getByTitle('Archive'));

    const bottomBar = screen.getByTitle('Delete').parentElement;
    expect(bottomBar).toHaveClass('pointer-events-none');
    expect(bottomBar).toHaveClass('!opacity-0');

    const resize = document.querySelector('.cursor-nwse-resize');
    expect(resize).toBeTruthy();
    expect(resize).toHaveClass('pointer-events-none');
    expect(resize).toHaveClass('!opacity-0');

    const rotate = screen.getByTestId('node-rotate-handle');
    expect(rotate).toHaveClass('pointer-events-none');
    expect(rotate).toHaveClass('!opacity-0');
  });

  it('idle transform 用 CSS 变量，不能写成死值 translate（否则拖动 --drag-x/y 失效）', () => {
    const { container } = renderNode({ rotation: 12 });
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.transform).toBe(cardGestureTransform('12deg'));
    expect(root.style.transform).toContain('var(--drag-x');
    expect(root.style.transform).toContain('var(--node-rotate');
    expect(root.style.transform).not.toMatch(/translate\(\s*-?\d/);
  });

  it('卡片根节点 touch-action: none，避免触屏把单击拖动当成页面滚动', () => {
    const { container } = renderNode();
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('touch-none');
  });

  it('触屏在正文 stopPropagation 时仍能拖动卡片', () => {
    const { container } = renderNode({
      children: (
        <div
          data-no-drag=""
          data-testid="blocked-body"
          onPointerDown={(e) => e.stopPropagation()}
        >
          body
        </div>
      ),
    });
    const root = container.firstElementChild as HTMLElement;
    const body = screen.getByTestId('blocked-body');
    act(() => {
      fireEvent.pointerDown(body, {
        button: 0,
        clientX: 10,
        clientY: 10,
        pointerType: 'touch',
        pointerId: 11,
      });
      window.dispatchEvent(
        new PointerEvent('pointermove', {
          clientX: 28,
          clientY: 30,
          pointerType: 'touch',
          pointerId: 11,
        }),
      );
    });
    expect(root.style.getPropertyValue('--drag-x')).toBe('18px');
    expect(root.style.getPropertyValue('--drag-y')).toBe('20px');
    // Compositor path: live offset is CSS vars; React-owned left/top stay put.
    expect(root.style.left).toBe('100px');
  });

  it('鼠标轻点正文不吞 click，便签仍能进入编辑', () => {
    const onEdit = vi.fn();
    const { container } = renderNode({
      children: (
        <div data-testid="note-view" onClick={onEdit}>
          body
        </div>
      ),
    });
    const root = container.firstElementChild as HTMLElement;
    const body = screen.getByTestId('note-view');
    act(() => {
      fireEvent.pointerDown(body, {
        button: 0,
        clientX: 10,
        clientY: 10,
        pointerType: 'mouse',
        pointerId: 1,
      });
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'mouse' }));
    });
    fireEvent.click(body);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(root.style.left).toBe('100px');
  });

  it('鼠标在 data-no-drag 正文上不会拖动（留给划词/滚动）', () => {
    const { container } = renderNode({
      children: (
        <div
          data-no-drag=""
          data-testid="blocked-body"
          onPointerDown={(e) => e.stopPropagation()}
        >
          body
        </div>
      ),
    });
    const root = container.firstElementChild as HTMLElement;
    fireEvent.pointerDown(screen.getByTestId('blocked-body'), {
      button: 0,
      clientX: 10,
      clientY: 10,
      pointerType: 'mouse',
      pointerId: 1,
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent('pointermove', { clientX: 40, clientY: 50, pointerType: 'mouse', pointerId: 1 }),
      );
    });
    expect(root.style.getPropertyValue('--drag-x')).toBe('');
  });

  it('非编辑且选中时显示旋转把手', () => {
    renderNode({ isEditing: false, isSelected: true });
    const rotate = screen.getByTestId('node-rotate-handle');
    expect(rotate).toHaveClass('opacity-100');
    expect(rotate).not.toHaveClass('pointer-events-none');
  });

  it('非编辑且选中时外链按钮常态可见', () => {
    renderNode({ isEditing: false, isSelected: true });
    const rightChrome = screen.getByTitle('Link').parentElement;
    expect(rightChrome).toHaveClass('opacity-100');
    expect(rightChrome).not.toHaveClass('pointer-events-none');
  });

  it('提供 onAskAiSubmit 时点击问 AI 打开卡片旁输入框，发送后回调', () => {
    const onAskAiSubmit = vi.fn();
    renderNode({ isEditing: false, isSelected: true, onAskAiSubmit });
    expect(screen.getByTestId('note-ask-ai')).toBeInTheDocument();
    expect(screen.queryByTestId('note-ask-composer')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('note-ask-ai'));
    expect(screen.getByTestId('note-ask-composer')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('note-ask-input'), { target: { value: '解释一下' } });
    fireEvent.click(screen.getByTestId('note-ask-send'));
    expect(onAskAiSubmit).toHaveBeenCalledTimes(1);
    expect(onAskAiSubmit).toHaveBeenCalledWith('解释一下');
  });

  it('问 AI 输入框 Enter 发送，Shift+Enter 换行，输入法确认不发送', () => {
    const onAskAiSubmit = vi.fn();
    renderNode({ isEditing: false, isSelected: true, onAskAiSubmit });
    fireEvent.click(screen.getByTestId('note-ask-ai'));
    const input = screen.getByTestId('note-ask-input');
    expect(input.tagName).toBe('TEXTAREA');
    fireEvent.change(input, { target: { value: '第一行\n第二行' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onAskAiSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    expect(onAskAiSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAskAiSubmit).toHaveBeenCalledWith('第一行\n第二行');
  });

  it('语音提交开始后关闭问 AI 输入框并清空已发送内容', () => {
    const onAskAiSubmit = vi.fn();
    const nodesRef = createRef<Record<string, HTMLElement | null>>();
    nodesRef.current = {};
    const renderProps = {
      id: 'n1',
      nodesRef: nodesRef as MutableRefObject<Record<string, HTMLElement | null>>,
      isConnecting: false,
      onLink: vi.fn(),
      onDelete: vi.fn(),
      onCycleLayout: vi.fn(),
      isSelected: true,
      onAskAiSubmit,
      askComposerPrefill: { text: '告诉我汤底吧', token: 1 },
    };
    const { rerender } = render(
      <DraggableNode {...renderProps}>
        <div>Note body</div>
      </DraggableNode>,
    );
    expect(screen.getByTestId('note-ask-input')).toHaveValue('告诉我汤底吧');

    rerender(
      <DraggableNode {...renderProps} isAskAiSubmitting>
        <div>Note body</div>
      </DraggableNode>,
    );

    expect(screen.queryByTestId('note-ask-composer')).not.toBeInTheDocument();
    rerender(
      <DraggableNode {...renderProps}>
        <div>Note body</div>
      </DraggableNode>,
    );
    fireEvent.click(screen.getByTestId('note-ask-ai'));
    expect(screen.getByTestId('note-ask-input')).toHaveValue('');
  });

  it('关掉问 AI 输入框后再打开，草稿还在，光标在末尾', async () => {
    const onAskAiSubmit = vi.fn();
    const { unmount } = renderNode({ isEditing: false, isSelected: true, onAskAiSubmit });
    fireEvent.click(screen.getByTestId('note-ask-ai'));
    fireEvent.change(screen.getByTestId('note-ask-input'), { target: { value: '还没问完' } });
    fireEvent.click(screen.getByTestId('note-ask-ai'));
    expect(screen.queryByTestId('note-ask-composer')).not.toBeInTheDocument();
    unmount();

    renderNode({ isEditing: false, isSelected: true, onAskAiSubmit });
    fireEvent.click(screen.getByTestId('note-ask-ai'));
    expect(screen.getByTestId('note-ask-input')).toHaveValue('还没问完');
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    const restored = screen.getByTestId('note-ask-input') as HTMLTextAreaElement;
    expect(restored.selectionStart).toBe('还没问完'.length);
    expect(restored.selectionEnd).toBe('还没问完'.length);
  });

  it('点击画布空白处关闭问 AI 输入框，草稿仍保留', () => {
    const onAskAiSubmit = vi.fn();
    renderNode({ isEditing: false, isSelected: true, onAskAiSubmit });
    fireEvent.click(screen.getByTestId('note-ask-ai'));
    fireEvent.change(screen.getByTestId('note-ask-input'), { target: { value: '先写着' } });
    fireEvent.pointerDown(document.body, { button: 0 });
    expect(screen.queryByTestId('note-ask-composer')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('note-ask-ai'));
    expect(screen.getByTestId('note-ask-input')).toHaveValue('先写着');
  });

  it('编辑卡片时若问 AI 输入框已打开，不会把草稿藏起来', () => {
    const { rerender } = renderNode({
      isEditing: false,
      isSelected: true,
      onAskAiSubmit: vi.fn(),
    });
    fireEvent.click(screen.getByTestId('note-ask-ai'));
    fireEvent.change(screen.getByTestId('note-ask-input'), { target: { value: '草稿' } });
    const nodesRef = createRef<Record<string, HTMLElement | null>>();
    nodesRef.current = {};
    rerender(
      <DraggableNode
        id="n1"
        nodesRef={nodesRef as MutableRefObject<Record<string, HTMLElement | null>>}
        isConnecting={false}
        onLink={vi.fn()}
        onDelete={vi.fn()}
        onCycleLayout={vi.fn()}
        isSelected
        isEditing
        onAskAiSubmit={vi.fn()}
      >
        <div>Note body</div>
      </DraggableNode>,
    );
    expect(screen.getByTestId('note-ask-composer')).toBeInTheDocument();
    expect(screen.getByTestId('note-ask-input')).toHaveValue('草稿');
    const rightChrome = screen.getByTitle('Link').parentElement;
    expect(rightChrome).not.toHaveClass('pointer-events-none');
  });

  it('问 AI 打开时才弹出分析播放按钮，点击后回调并收起', () => {
    const onAskAiSubmit = vi.fn();
    const onAskAiRunAnalysis = vi.fn();
    renderNode({ isEditing: false, isSelected: true, onAskAiSubmit, onAskAiRunAnalysis });
    expect(screen.queryByTestId('agent-run-analysis')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('note-ask-ai'));
    expect(screen.getByTestId('note-ask-menu')).toBeInTheDocument();
    expect(screen.getByTestId('agent-run-analysis')).toBeInTheDocument();
    expect(screen.queryByTestId('note-ask-input')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('agent-run-analysis'));
    expect(onAskAiRunAnalysis).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('note-ask-menu')).not.toBeInTheDocument();
    expect(screen.queryByTestId('note-ask-composer')).not.toBeInTheDocument();
  });

  it('问 AI 菜单可悬停打开；提问后才出现输入框，不与运行并列', () => {
    renderNode({
      isEditing: false,
      isSelected: true,
      onAskAiSubmit: vi.fn(),
      onAskAiRunAnalysis: vi.fn(),
    });
    fireEvent.mouseEnter(screen.getByTestId('note-ask-ai').parentElement as HTMLElement);
    const menu = screen.getByTestId('note-ask-menu');
    const wandRow = screen.getByTestId('note-ask-ai').parentElement;
    expect(wandRow).toContainElement(menu);
    expect(menu.className).toContain('left-full');
    expect(menu).toContainElement(screen.getByTestId('agent-run-analysis'));
    expect(menu).toContainElement(screen.getByTestId('note-ask-open-input'));
    expect(screen.queryByTestId('note-ask-input')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('note-ask-open-input'));
    expect(screen.queryByTestId('note-ask-menu')).not.toBeInTheDocument();
    const composer = screen.getByTestId('note-ask-composer');
    expect(composer).toContainElement(screen.getByTestId('note-ask-input'));
    expect(screen.queryByTestId('agent-run-analysis')).not.toBeInTheDocument();
  });

  it('只有自动执行时点击魔法棒直接运行，不打开提问框', () => {
    const onAskAiRunAnalysis = vi.fn();
    renderNode({ isEditing: false, isSelected: true, onAskAiRunAnalysis });
    fireEvent.click(screen.getByTestId('note-ask-ai'));
    expect(onAskAiRunAnalysis).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('note-ask-menu')).not.toBeInTheDocument();
    expect(screen.queryByTestId('note-ask-composer')).not.toBeInTheDocument();
  });

  it('编辑态不显示选中描边 ring', () => {
    const { container } = renderNode({ isEditing: true, isSelected: true });
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).not.toContain('ring-2');
  });

  it('非编辑且选中时显示 ring', () => {
    const { container } = renderNode({ isEditing: false, isSelected: true });
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('ring-2');
  });

  it('关联高亮显示柔和 ring，且选中样式优先', () => {
    const { container, rerender } = renderNode({
      isEditing: false,
      isSelected: false,
      isRelatedHighlight: true,
    });
    let root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('ring-[#C2410C]/55');
    expect(screen.getByTestId('related-highlight-n1')).toBeInTheDocument();

    const nodesRef = createRef<Record<string, HTMLElement | null>>();
    nodesRef.current = {};
    rerender(
      <DraggableNode
        id="n1"
        nodesRef={nodesRef as MutableRefObject<Record<string, HTMLElement | null>>}
        isConnecting={false}
        onLink={vi.fn()}
        onDelete={vi.fn()}
        onCycleLayout={vi.fn()}
        isSelected
        isRelatedHighlight
      >
        <div>Note body</div>
      </DraggableNode>,
    );
    root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('ring-[#C2410C]');
    expect(root.className).not.toContain('ring-[#C2410C]/55');
  });

  it('单击卡片主体会触发 onEssayActivate（按钮除外）', () => {
    const onEssayActivate = vi.fn();
    renderNode({ isSelected: false, onEssayActivate });
    screen.getByText('Note body').dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0 }),
    );
    expect(onEssayActivate).toHaveBeenCalledWith('n1');
  });

  it('有思考原文时在右侧连线列底部显示脑子，随卡片悬停出现', () => {
    renderNode({
      isSelected: true,
      thinkingTrace: '先看题里的矛盾',
    });
    const brain = screen.getByTestId('ai-thinking-trace');
    const column = brain.closest('.absolute');
    expect(column).toHaveClass('-right-3');
    expect(column?.className).toMatch(/opacity-100/);
    fireEvent.click(brain);
    expect(screen.getByTestId('ai-thinking-trace-panel')).toHaveTextContent('先看题里的矛盾');
  });

  it('leadingRightChrome 和连线按钮排在同一列右侧', () => {
    renderNode({
      isSelected: true,
      leadingRightChrome: <button type="button" data-testid="agent-start-discussion">Talk</button>,
    });
    const rightChrome = screen.getByTitle('Link').closest('.absolute');
    expect(rightChrome).toHaveClass('-right-3');
    expect(rightChrome).toContainElement(screen.getByTestId('agent-start-discussion'));
    expect(rightChrome).toContainElement(screen.getByTitle('Link'));
  });

  it('未连角色卡时问 AI 灰色不可点，悬停提示先连线', () => {
    renderNode({
      isEditing: false,
      isSelected: true,
      onAskAiSubmit: vi.fn(),
      isAskAiDisabled: true,
      askAiHint: 'Connect any AI persona card first',
    });
    const wand = screen.getByTestId('note-ask-ai');
    expect(wand).toHaveAttribute('aria-disabled', 'true');
    expect(wand).toHaveAttribute('title', 'Connect any AI persona card first');
    expect(wand.className).toContain('text-[#C4C2BC]');
    expect(wand.className).toContain('cursor-not-allowed');
    fireEvent.click(wand);
    expect(screen.queryByTestId('note-ask-composer')).not.toBeInTheDocument();
  });

  it('点击连线 + 号时播放 bubblePop，并调用 onLink', () => {
    playUiSfxMock.mockClear();
    const onLink = vi.fn();
    renderNode({ isSelected: true, onLink });
    screen.getByTitle('Link').dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0 }),
    );
    expect(onLink).toHaveBeenCalledWith('n1');
    expect(playUiSfxMock).toHaveBeenCalledWith('bubblePop');
  });

  it('连线模式下点击卡片主体会连线，但不播放 bubblePop', () => {
    playUiSfxMock.mockClear();
    const onLink = vi.fn();
    renderNode({ isConnecting: true, onLink });
    screen.getByText('Note body').dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0 }),
    );
    expect(onLink).toHaveBeenCalledWith('n1');
    expect(playUiSfxMock).not.toHaveBeenCalled();
  });

  it('提供 onArchive 时显示顶部归档按钮，选文件夹后回调', async () => {
    const onArchive = vi.fn();
    renderNode({ isSelected: true, onArchive });
    const btn = screen.getByTestId('archive-node-n1');
    expect(btn).toBeInTheDocument();
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(onArchive).not.toHaveBeenCalled();
    const unfiled = await screen.findByTestId('archive-folder-pick-unfiled');
    unfiled.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(onArchive).toHaveBeenCalledWith(null);
  });

  it('双击打开调色板', () => {
    const { container } = renderNode({ allowPalette: true });
    const root = container.firstElementChild as HTMLElement;
    fireEvent.doubleClick(root);
    expect(root.querySelector('.node-palette')).toBeTruthy();
    expect(screen.getAllByTitle('更改颜色').length).toBeGreaterThan(0);
  });

  it('圈选多卡时单击正文不进入编辑，双击仍打开调色板', () => {
    const onEdit = vi.fn();
    const { container } = renderNode({
      allowPalette: true,
      groupPaletteLocked: true,
      children: (
        <div data-testid="note-view" onClick={onEdit}>
          body
        </div>
      ),
    });
    const root = container.firstElementChild as HTMLElement;
    fireEvent.click(screen.getByTestId('note-view'));
    expect(onEdit).not.toHaveBeenCalled();
    fireEvent.doubleClick(root);
    expect(root.querySelector('.node-palette')).toBeTruthy();
  });

  it('调色回调交给父级，便于圈选批量改色', () => {
    const onPaletteStyleChange = vi.fn();
    const { container } = renderNode({ allowPalette: true, onPaletteStyleChange });
    const root = container.firstElementChild as HTMLElement;
    fireEvent.doubleClick(root);
    fireEvent.click(screen.getAllByTitle('更改颜色')[0]);
    expect(onPaletteStyleChange).toHaveBeenCalledWith(
      'n1',
      expect.objectContaining({ bg: expect.any(String), text: expect.any(String) }),
    );
  });

  it('Shift+单击调用 onToggleSelect，且不拖动、不进入编辑', () => {
    const onToggleSelect = vi.fn();
    const onEdit = vi.fn();
    const { container } = renderNode({
      onToggleSelect,
      children: (
        <div data-testid="note-view" onClick={onEdit}>
          body
        </div>
      ),
    });
    const root = container.firstElementChild as HTMLElement;
    const body = screen.getByTestId('note-view');
    act(() => {
      fireEvent.pointerDown(body, {
        button: 0,
        clientX: 10,
        clientY: 10,
        pointerType: 'mouse',
        pointerId: 1,
        shiftKey: true,
      });
    });
    expect(onToggleSelect).toHaveBeenCalledWith('n1');
    expect(root.style.getPropertyValue('--drag-x')).toBe('');
    fireEvent.click(body, { shiftKey: true });
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('普通单击不调用 onToggleSelect', () => {
    const onToggleSelect = vi.fn();
    const { container } = renderNode({ onToggleSelect });
    const root = container.firstElementChild as HTMLElement;
    fireEvent.pointerDown(root, {
      button: 0,
      clientX: 10,
      clientY: 10,
      pointerType: 'mouse',
      pointerId: 1,
    });
    expect(onToggleSelect).not.toHaveBeenCalled();
  });
});
