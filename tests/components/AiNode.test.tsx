import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { AiNode } from '../../src/components/nodes/AiNode';
import type { CanvasNode } from '../../src/db';
import {
  AI_CARD_AUTO_MAX_HEIGHT_PX,
  AI_CARD_SCROLL_MAX_HEIGHT_PX,
  AI_THINKING_SCROLL_MAX_HEIGHT_PX,
} from '../../src/utils/canvas';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh', changeLanguage: vi.fn() },
  }),
}));

vi.mock('lucide-react', () => {
  const icons = ['Loader2', 'Send', 'StickyNote', 'Sparkles', 'Wand2', 'Square', 'RotateCcw', 'MessagesSquare', 'AlertTriangle', 'RefreshCw'] as const;
  const out: Record<string, React.FC> = {};
  for (const name of icons) {
    out[name] = (props: Record<string, unknown>) => {
      const { createElement } = require('react');
      return createElement('svg', { 'data-testid': `icon-${name}`, ...props });
    };
  }
  return out;
});

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => {
    const { createElement } = require('react');
    return createElement('div', { 'data-testid': 'markdown' }, children);
  },
}));

const baseAi = (overrides?: Partial<CanvasNode>): CanvasNode => ({
  id: 'ai-1',
  canvasId: 'default',
  type: 'ai',
  content: 'AI 回复内容',
  x: 0,
  y: 0,
  ...overrides,
});

describe('AiNode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.getSelection()?.removeAllRanges();
  });

  it('流式且尚无正文时只显示思考占位，不渲染完整卡片', () => {
    render(
      <AiNode
        node={baseAi({ content: '', userTurn: '问什么' })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        isContentStreaming
        streamingThought="先看看问题里的矛盾"
      />,
    );
    expect(screen.getByTestId('ai-thinking-placeholder')).toHaveTextContent('先看看问题里的矛盾');
    expect(screen.getByTestId('ai-thinking-placeholder')).toHaveTextContent('问什么');
    expect(screen.queryByTestId('ai-node-shell')).toBeNull();
    const thought = screen.getByTestId('ai-thinking-scroll');
    expect(thought.className).toContain('overflow-y-auto');
    expect(thought.style.maxHeight).toBe(`${AI_THINKING_SCROLL_MAX_HEIGHT_PX}px`);
  });

  it('正文只读，不可 contentEditable', () => {
    render(
      <AiNode
        node={baseAi({ content: '初始回复' })}
        editingNodeId="ai-1"
        setEditingNodeId={vi.fn()}
      />,
    );
    expect(document.querySelector('[contenteditable="true"]')).toBeNull();
    fireEvent.click(screen.getByTestId('markdown'));
    expect(document.querySelector('[contenteditable="true"]')).toBeNull();
  });

  it('整卡被 markdown 围栏包住时拆开，避免当成不换行的代码块', () => {
    const inner = '**核心病灶**: 边界 / 能量';
    render(
      <AiNode
        node={baseAi({ content: ['```markdown', inner, '```'].join('\n') })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
      />,
    );
    expect(screen.getByTestId('markdown')).toHaveTextContent(inner);
    expect(screen.getByTestId('markdown').textContent).not.toContain('```');
  });

  it('TTS 跟读时仍走 Markdown，不把正文换成源码', () => {
    render(
      <AiNode
        node={baseAi({ content: '第一句。第二句。' })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        ttsHighlightSentence="第一句。"
      />,
    );
    expect(screen.getByTestId('markdown')).toBeInTheDocument();
    expect(document.querySelector('[data-tts-mark]')).toHaveTextContent('第一句。');
    expect(screen.getByTestId('ai-reply-body').querySelector('.whitespace-pre-wrap')).toBeNull();
  });

  it('选中正文后出现摘抄与问 AI，不含思维导图展开', () => {
    const onExtract = vi.fn();
    const onAsk = vi.fn();
    render(
      <AiNode
        node={baseAi({ content: '一段足够长的回复正文' })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        onExtractSelectionToCard={onExtract}
        onAskAboutSelection={onAsk}
      />,
    );

    const md = screen.getByTestId('markdown');
    const range = document.createRange();
    range.selectNodeContents(md);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    fireEvent.mouseUp(screen.getByTestId('ai-reply-body'));

    expect(screen.getByRole('button', { name: 'nodes.book_to_card' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'nodes.book_ask_ai' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'nodes.book_expand' })).toBeNull();

    fireEvent.pointerUp(screen.getByRole('button', { name: 'nodes.book_to_card' }));
    expect(onExtract).toHaveBeenCalledWith('一段足够长的回复正文', 'nodes.ai_refinement', 'ai-1');
  });

  it('摘抄表格时带回 Markdown 源码而不是压扁的单元格文字', () => {
    const onExtract = vi.fn();
    const table = [
      '| 阶段 | 核心动作 |',
      '| --- | --- |',
      '| 前期准备 | 明确目的 |',
    ].join('\n');
    render(
      <AiNode
        node={baseAi({ content: table })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        onExtractSelectionToCard={onExtract}
      />,
    );
    const md = screen.getByTestId('markdown');
    const range = document.createRange();
    range.selectNodeContents(md);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    fireEvent.mouseUp(screen.getByTestId('ai-reply-body'));
    fireEvent.pointerUp(screen.getByRole('button', { name: 'nodes.book_to_card' }));
    expect(onExtract).toHaveBeenCalledWith(table, 'nodes.ai_refinement', 'ai-1');
  });

  it('选中正文后点问 AI 会带上摘录', () => {
    const onAsk = vi.fn();
    render(
      <AiNode
        node={baseAi({ content: '一段足够长的回复正文' })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        onAskAboutSelection={onAsk}
      />,
    );
    const md = screen.getByTestId('markdown');
    const range = document.createRange();
    range.selectNodeContents(md);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    fireEvent.mouseUp(screen.getByTestId('ai-reply-body'));
    fireEvent.pointerUp(screen.getByRole('button', { name: 'nodes.book_ask_ai' }));
    expect(onAsk).toHaveBeenCalledWith('一段足够长的回复正文', 'nodes.ai_refinement', 'ai-1');
  });

  it('有 userTurn 时摘抄来源用用户问题', () => {
    const onExtract = vi.fn();
    render(
      <AiNode
        node={baseAi({ userTurn: '用户这一回合的追问', content: '模型回答内容' })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        onExtractSelectionToCard={onExtract}
      />,
    );

    const md = screen.getByTestId('markdown');
    const range = document.createRange();
    range.selectNodeContents(md);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    fireEvent.mouseUp(screen.getByTestId('ai-reply-body'));
    fireEvent.pointerUp(screen.getByRole('button', { name: 'nodes.book_to_card' }));
    expect(onExtract).toHaveBeenCalledWith('模型回答内容', '用户这一回合的追问', 'ai-1');
  });

  it('流式输出时不出现选区工具栏', () => {
    render(
      <AiNode
        node={baseAi({ content: '正在生成的回复' })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        isContentStreaming
        onExtractSelectionToCard={vi.fn()}
        onAskAboutSelection={vi.fn()}
      />,
    );
    const body = screen.getByTestId('ai-reply-body');
    const range = document.createRange();
    range.selectNodeContents(body);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    fireEvent.mouseUp(body);
    expect(screen.queryByTestId('text-selection-toolbar')).toBeNull();
  });

  it('不渲染卡片内继续追问输入框', () => {
    const { container } = render(
      <AiNode
        node={baseAi()}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
      />,
    );
    expect(container.querySelector('textarea')).toBeNull();
    expect(screen.queryByPlaceholderText('nodes.ai_follow_up_placeholder')).toBeNull();
  });

  it('有 userTurn 时展示上半区用户文案与下半区正文', () => {
    render(
      <AiNode
        node={baseAi({ userTurn: '用户这一回合的追问', content: '模型回答' })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
      />
    );

    expect(screen.getByText('用户这一回合的追问')).toBeInTheDocument();
    const md = screen.getByTestId('markdown');
    expect(md).toHaveTextContent('模型回答');
  });

  it('正文滚动区有明确 maxHeight，长回复在区内滚动', () => {
    render(
      <AiNode
        node={baseAi({ userTurn: '问', content: '答' })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
      />
    );
    const body = screen.getByTestId('ai-reply-body');
    expect(body.className).toContain('overflow-y-auto');
    expect(body.style.maxHeight).toBe(`${AI_CARD_SCROLL_MAX_HEIGHT_PX}px`);
  });

  it('未拖拽高度时外壳有 maxHeight，长回复在卡片内滚动', () => {
    render(
      <AiNode
        node={baseAi({ content: '很长的回复' })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
      />,
    );
    const shell = screen.getByTestId('ai-node-shell');
    expect(shell.style.maxHeight).toBe(`${AI_CARD_AUTO_MAX_HEIGHT_PX}px`);
    expect(shell.className).not.toMatch(/\bh-full\b/);
    expect(shell.className).toMatch(/(?:^|\s)overflow-hidden(?:\s|$)/);
    expect(shell.className).toContain('min-w-0');
  });

  it('用户拖拽过高度后外壳撑满卡片，取消 maxHeight', () => {
    render(
      <AiNode
        node={baseAi({ height: 520, content: '很长的回复' })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
      />,
    );
    const shell = screen.getByTestId('ai-node-shell');
    expect(shell.style.maxHeight).toBe('');
    expect(shell.className).toMatch(/\bh-full\b/);
  });

  describe('多轮对话轮数徽章', () => {
    it('threadRound 为 0 时不显示 #N 徽章(首轮不打扰)', () => {
      render(
        <AiNode
          node={baseAi({ userTurn: 'first question', threadRound: 0 })}
          editingNodeId={null}
          setEditingNodeId={vi.fn()}
        />,
      );
      expect(screen.queryByText(/#\d/)).toBeNull();
    });

    it('threadRound 为 undefined 时不显示徽章(向后兼容老数据)', () => {
      render(
        <AiNode
          node={baseAi({ userTurn: 'old node', threadRound: undefined })}
          editingNodeId={null}
          setEditingNodeId={vi.fn()}
        />,
      );
      expect(screen.queryByText(/#\d/)).toBeNull();
    });

    it('threadRound 为 3 时显示 #4(1-based 展示给用户)', () => {
      render(
        <AiNode
          node={baseAi({ userTurn: 'follow-up', threadRound: 3 })}
          editingNodeId={null}
          setEditingNodeId={vi.fn()}
        />,
      );
      expect(screen.getByText('#4')).toBeInTheDocument();
    });
  });

  it('讨论末卡显示继续下一轮，点击后回调', () => {
    const onContinue = vi.fn();
    render(
      <AiNode
        node={baseAi({ content: '第二轮发言', threadDiscussionId: 'd1' })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        onContinueDiscussion={onContinue}
        canContinueDiscussion
      />,
    );
    fireEvent.click(screen.getByTestId('ai-continue-discussion'));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('非讨论卡或生成中不显示继续下一轮', () => {
    const { rerender } = render(
      <AiNode
        node={baseAi()}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        onContinueDiscussion={vi.fn()}
        canContinueDiscussion={false}
      />,
    );
    expect(screen.queryByTestId('ai-continue-discussion')).toBeNull();

    rerender(
      <AiNode
        node={baseAi({ threadDiscussionId: 'd1' })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        isContentStreaming
        onContinueDiscussion={vi.fn()}
        canContinueDiscussion
      />,
    );
    expect(screen.queryByTestId('ai-continue-discussion')).toBeNull();
  });

  it('生成失败时展示错误原因与重试按钮', () => {
    const onRetry = vi.fn();
    render(
      <AiNode
        node={baseAi({ userTurn: '帮我写一句', aiStatus: 'error', aiError: 'rate limit' })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByTestId('ai-generation-error')).toHaveTextContent('rate limit');
    fireEvent.click(screen.getByTestId('ai-retry'));
    expect(onRetry).toHaveBeenCalledWith('ai-1');
  });

  it('流式结束后仍为 generating 且无正文时按 stale 展示错误', () => {
    render(
      <AiNode
        node={baseAi({ userTurn: '问什么', aiStatus: 'generating', content: '' })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
      />,
    );
    expect(screen.getByTestId('ai-generation-error')).toBeInTheDocument();
  });
});
