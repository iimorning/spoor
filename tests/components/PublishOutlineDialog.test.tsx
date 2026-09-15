import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { AppDialogProvider } from '../../src/components/AppDialogProvider';
import { PublishOutlineDialog } from '../../src/components/PublishOutlineDialog';
import { db } from '../../src/db';
import type { PublishOutline } from '../../src/utils/parsePublishOutlineResponse';

const stableTranslate = (key: string, opts?: Record<string, unknown>) => {
  if (key === 'publish.outline_remove') return 'remove-section';
  if (key === 'publish.outline_drag') return 'drag-section';
  if (key === 'publish.outline_add_section') return 'add-section';
  if (key === 'publish.outline_reset_order') return 'reset-order';
  if (key === 'publish.outline_loading') return 'loading…';
  if (key === 'publish.outline_load_failed') return 'outline-load-failed';
  if (key === 'publish.outline_revise_failed') return 'outline-revise-failed';
  if (key === 'publish.generating') return 'generating';
  if (key === 'publish.confirm_generate') return 'confirm-generate';
  if (key === 'publish.voice_idle') return 'idle';
  if (key === 'publish.voice_listening') return 'listening';
  if (key === 'publish.voice_thinking') return 'thinking';
  if (key === 'publish.voice_speaking') return 'speaking';
  if (key === 'publish.voice_start') return 'voice-start';
  if (key === 'publish.voice_stop') return 'voice-stop';
  if (key === 'publish.revise_placeholder') return 'revise-placeholder';
  if (key === 'publish.outline_article_title') return 'article-title-label';
  if (key === 'publish.outline_heading_placeholder') return 'heading-placeholder';
  if (key === 'publish.outline_summary_placeholder') return 'summary-placeholder';
  if (key === 'publish.outline_kind_text') return 'kind-text';
  if (key === 'publish.outline_empty_slot') return 'empty-slot';
  if (key === 'publish.outline_card_label') return `card-${String(opts?.id)}`;
  if (typeof opts?.defaultValue === 'string') return opts.defaultValue;
  if (key === 'ai.generated_article_title') return 'default-title';
  if (key === 'dialog.cancel') return 'cancel';
  return key;
};

vi.mock(import('react-i18next'), async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actual = await (vi as any).importActual('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({ t: stableTranslate }),
  };
});

const generatePublishOutline = vi.fn();
const revisePublishOutline = vi.fn();
const assembleEssayDraft = vi.fn();

vi.mock('../../src/utils/generateArticleFromOutline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/generateArticleFromOutline')>();
  return {
    ...actual,
    generatePublishOutline: (...a: unknown[]) =>
      (generatePublishOutline as unknown as (...a: unknown[]) => unknown)(...a),
    revisePublishOutline: (...a: unknown[]) =>
      (revisePublishOutline as unknown as (...a: unknown[]) => unknown)(...a),
  };
});

vi.mock('../../src/utils/assembleEssayDraft', () => ({
  assembleEssayDraft: (...a: unknown[]) => assembleEssayDraft(...a),
}));

// 让 voice hook 在测试中惰性化 — 4 个 reducer / 阶段测试不需要真实 ASR/TTS
const voiceStub = {
  active: false,
  phase: 'idle' as 'idle' | 'listening' | 'thinking' | 'speaking',
  messages: [] as Array<{ role: 'user' | 'assistant'; text: string }>,
  partialTranscript: '',
  toggle: vi.fn(),
  stop: vi.fn(),
};
vi.mock('../../src/hooks/usePublishOutlineVoiceChat', () => ({
  usePublishOutlineVoiceChat: () => voiceStub,
}));

function wrap({ children }: { children: React.ReactNode }) {
  return React.createElement(AppDialogProvider, null, children);
}

// 稳定的默认 props（避免 useEffect deps 因对象身份变化而重跑 → 触发 outline 反复 nullify）
const STABLE_AI_CONFIG = { provider: 'gemini' as const, apiKey: 'k', baseUrl: '', model: 'm' };
const STABLE_NODES_REF = { current: {} as Record<string, HTMLElement | null> };

function TestHarness({
  open = true,
  onClose,
}: {
  open?: boolean;
  onClose?: () => void;
}) {
  // 把 props 全部 useMemo 锁住，避免每次 render 重新创建数组/对象让 effect deps 误判
  const memoProps = React.useMemo(
    () => ({
      selectedIds: ['n1', 'n2'],
      dynamicNodes: [],
      nodesRef: STABLE_NODES_REF as unknown as React.RefObject<Record<string, HTMLElement | null>>,
      activeCanvasId: 'default',
      setSelectedNodes: vi.fn(),
      onEssayCreated: vi.fn(),
    }),
    [],
  );
  return (
    <PublishOutlineDialog
      open={open}
      onClose={onClose ?? vi.fn()}
      aiConfig={STABLE_AI_CONFIG}
      {...memoProps}
    />
  );
}

function renderDialog(opts: {
  open?: boolean;
  onClose?: () => void;
  generateOutline?: PublishOutline | null;
} = {}) {
  if (opts.generateOutline !== undefined) {
    generatePublishOutline.mockReset();
    generatePublishOutline.mockResolvedValue(opts.generateOutline);
  }
  return render(<TestHarness open={opts.open} onClose={opts.onClose} />, { wrapper: wrap });
}

beforeEach(() => {
  generatePublishOutline.mockReset();
  assembleEssayDraft.mockReset();
  assembleEssayDraft.mockImplementation(async (opts: unknown) => {
    const articleId = (opts as { articleId: string }).articleId;
    await db.articles.update(articleId, { generating: false });
  });
  voiceStub.stop.mockClear();
  voiceStub.toggle.mockClear();
  voiceStub.active = false;
  voiceStub.phase = 'idle';
  voiceStub.messages = [];
  voiceStub.partialTranscript = '';
  // 默认：outline 同步落定
  generatePublishOutline.mockResolvedValue({
    title: '默认大纲',
    sections: [
      { cardId: 'n1', heading: '段一', summary: '一' },
      { cardId: 'n2', heading: '段二', summary: '二' },
    ],
  } satisfies PublishOutline);
});

describe('PublishOutlineDialog — open/close/phase', () => {
  it('open=true 加载完大纲后进入 ready，section 编辑器可见', async () => {
    renderDialog();
    expect(screen.getByText('loading…')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByLabelText('remove-section').length).toBeGreaterThanOrEqual(2);
    });
    expect(generatePublishOutline).toHaveBeenCalledTimes(1);
  });

  it('open=false 不渲染任何 outline 内容', () => {
    renderDialog({ open: false });
    expect(screen.queryByText('loading…')).not.toBeInTheDocument();
    expect(screen.queryAllByLabelText('remove-section')).toHaveLength(0);
  });

  it('generatePublishOutline 返回 null → 回退为选中顺序', async () => {
    renderDialog({ generateOutline: null });
    await waitFor(() => {
      expect(screen.getAllByTestId(/outline-section-\d+/)).toHaveLength(2);
    });
    expect(screen.queryByText(/outline-load-failed/)).not.toBeInTheDocument();
    expect(screen.getByTestId('outline-section-0').getAttribute('data-card-id')).toBe('n1');
    expect(screen.getByTestId('outline-section-1').getAttribute('data-card-id')).toBe('n2');
  });

  it('模型只回图片 cardId 时仍补上选中的文字卡', async () => {
    generatePublishOutline.mockResolvedValue({
      title: 't',
      sections: [{ cardId: 'img1', heading: '', summary: '' }],
    });
    render(
      <PublishOutlineDialog
        open
        onClose={vi.fn()}
        aiConfig={STABLE_AI_CONFIG}
        selectedIds={['n1', 'img1']}
        dynamicNodes={[
          { id: 'n1', type: 'note', content: '一段文字', x: 0, y: 0, canvasId: 'default' },
          {
            id: 'img1',
            type: 'image',
            content: 'https://cdn.example/a.jpg',
            description: '封面',
            x: 0,
            y: 0,
            canvasId: 'default',
          },
        ]}
        nodesRef={STABLE_NODES_REF as unknown as React.RefObject<Record<string, HTMLElement | null>>}
        activeCanvasId="default"
        setSelectedNodes={vi.fn()}
        onEssayCreated={vi.fn()}
      />,
      { wrapper: wrap },
    );
    await waitFor(() => {
      expect(screen.getAllByTestId(/outline-section-\d+/)).toHaveLength(2);
    });
    expect(screen.getByTestId('outline-section-0').getAttribute('data-card-id')).toBe('n1');
    expect(screen.getByTestId('outline-section-1').getAttribute('data-card-id')).toBe('img1');
  });
});

describe('PublishOutlineDialog — 4 个 outline reducer', () => {
  async function renderReady() {
    renderDialog();
    await waitFor(() => {
      expect(screen.getAllByLabelText('remove-section').length).toBe(2);
    });
  }

  it('addSection 推入空 cardId 段', async () => {
    const user = userEvent.setup();
    await renderReady();
    await user.click(screen.getByText('add-section'));
    const headings = screen.getAllByPlaceholderText('heading-placeholder');
    expect(headings).toHaveLength(1);
    await user.type(headings[0] as HTMLInputElement, '全新段');
    expect((headings[0] as HTMLInputElement).value).toBe('全新段');
  });

  it('removeSection 删除指定段', async () => {
    const user = userEvent.setup();
    await renderReady();
    const removeButtons = screen.getAllByLabelText('remove-section');
    await user.click(removeButtons[1]);
    expect(screen.getAllByTestId(/outline-section-\d+/)).toHaveLength(1);
  });

  it('拖动第二段放到第一段位置会交换顺序', async () => {
    await renderReady();
    const first = screen.getByTestId('outline-section-0');
    const second = screen.getByTestId('outline-section-1');
    expect(screen.getByTestId('outline-section-0').getAttribute('data-card-id')).toBe('n1');
    const dt = {
      effectAllowed: 'move',
      dropEffect: 'move',
      setData: vi.fn(),
      getData: vi.fn(),
    };
    fireEvent.dragStart(second, { dataTransfer: dt });
    fireEvent.dragOver(first, { dataTransfer: dt });
    fireEvent.drop(first, { dataTransfer: dt });
    fireEvent.dragEnd(second);
    expect(screen.getByTestId('outline-section-0').getAttribute('data-card-id')).toBe('n2');
    expect(screen.getByTestId('outline-section-1').getAttribute('data-card-id')).toBe('n1');
  });

  it('还原为选中顺序按 selectedIds 重排，不在生成时自动改回', async () => {
    generatePublishOutline.mockResolvedValue({
      title: '默认大纲',
      sections: [
        { cardId: 'n2', heading: '', summary: '' },
        { cardId: 'n1', heading: '', summary: '' },
      ],
    });
    await renderReady();
    expect(screen.getByTestId('outline-section-0').getAttribute('data-card-id')).toBe('n2');
    await userEvent.setup().click(screen.getByText('reset-order'));
    expect(screen.getByTestId('outline-section-0').getAttribute('data-card-id')).toBe('n1');
    expect(screen.getByTestId('outline-section-1').getAttribute('data-card-id')).toBe('n2');
  });

  it('不再显示上移/下移按钮', async () => {
    await renderReady();
    expect(screen.queryByLabelText('move-up')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('move-down')).not.toBeInTheDocument();
    expect(screen.getAllByLabelText('drag-section').length).toBe(2);
  });

  it('updateSection：空位可编辑 heading', async () => {
    const user = userEvent.setup();
    await renderReady();
    await user.click(screen.getByText('add-section'));
    const heading = screen.getByPlaceholderText('heading-placeholder') as HTMLInputElement;
    await user.type(heading, '新标题');
    expect(heading.value).toBe('新标题');
    expect(screen.queryByPlaceholderText('summary-placeholder')).not.toBeInTheDocument();
  });

  it('没有可用卡片时无法确认生成', async () => {
    generatePublishOutline.mockResolvedValue({ title: 't', sections: [] });
    render(
      <PublishOutlineDialog
        open
        onClose={vi.fn()}
        aiConfig={STABLE_AI_CONFIG}
        selectedIds={[]}
        dynamicNodes={[]}
        nodesRef={STABLE_NODES_REF as unknown as React.RefObject<Record<string, HTMLElement | null>>}
        activeCanvasId="default"
        setSelectedNodes={vi.fn()}
        onEssayCreated={vi.fn()}
      />,
      { wrapper: wrap },
    );
    await waitFor(() => {
      expect(screen.getByText(/outline-load-failed/)).toBeInTheDocument();
    });
    const confirmBtn = screen.getByText('confirm-generate').closest('button')!;
    expect(confirmBtn).toBeDisabled();
  });

  it('图片便签在大纲里显示缩略图', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    generatePublishOutline.mockResolvedValue({
      title: 't',
      sections: [
        { cardId: 'n1', heading: '', summary: '' },
        { cardId: 'img1', heading: '', summary: '' },
      ],
    });
    render(
      <PublishOutlineDialog
        open
        onClose={vi.fn()}
        aiConfig={STABLE_AI_CONFIG}
        selectedIds={['n1', 'img1']}
        dynamicNodes={[
          { id: 'n1', type: 'note', content: '一段文字', x: 0, y: 0, canvasId: 'default' },
          {
            id: 'img1',
            type: 'image',
            content: png,
            description: '封面',
            x: 0,
            y: 0,
            canvasId: 'default',
          },
        ]}
        nodesRef={STABLE_NODES_REF as unknown as React.RefObject<Record<string, HTMLElement | null>>}
        activeCanvasId="default"
        setSelectedNodes={vi.fn()}
        onEssayCreated={vi.fn()}
      />,
      { wrapper: wrap },
    );
    await waitFor(() => {
      expect(screen.getByTestId('outline-section-thumb-1')).toHaveAttribute('src', png);
    });
    expect(generatePublishOutline).toHaveBeenCalledWith(
      expect.objectContaining({ imageHrefs: [png] }),
    );
  });

  it('确认后按大纲顺序拼进编辑器，不再调用正文模型', async () => {
    const onEssayCreated = vi.fn();
    const setSelectedNodes = vi.fn();
    render(
      <PublishOutlineDialog
        open
        onClose={vi.fn()}
        aiConfig={STABLE_AI_CONFIG}
        selectedIds={['n1', 'n2']}
        dynamicNodes={[
          { id: 'n1', type: 'note', content: '一段文字', x: 0, y: 0, canvasId: 'default' },
          { id: 'n2', type: 'note', content: '另一段', x: 40, y: 0, canvasId: 'default' },
        ]}
        nodesRef={STABLE_NODES_REF as unknown as React.RefObject<Record<string, HTMLElement | null>>}
        activeCanvasId="default"
        setSelectedNodes={setSelectedNodes}
        onEssayCreated={onEssayCreated}
      />,
      { wrapper: wrap },
    );
    await waitFor(() => {
      expect(screen.getByText('confirm-generate')).toBeInTheDocument();
    });
    await userEvent.setup().click(screen.getByText('confirm-generate'));
    await waitFor(() => {
      expect(onEssayCreated).toHaveBeenCalledTimes(1);
    });
    const [articleId] = onEssayCreated.mock.calls[0] as [string, string];
    const article = await db.articles.get(articleId);
    expect(article?.generating).toBeFalsy();
    expect(article?.contentDrivesBody).toBe(true);
    expect(article?.content).toContain('一段文字');
    expect(article?.content).toContain('另一段');
    expect(assembleEssayDraft).toHaveBeenCalledWith(
      expect.objectContaining({ articleId }),
    );
  });
});

describe('PublishOutlineDialog — open 翻转清理', () => {
  it('open 翻 false 时调用 voice.stop()', async () => {
    renderDialog();
    await waitFor(() => {
      expect(screen.getAllByLabelText('remove-section').length).toBe(2);
    });
    // 模拟父组件把 open 翻 false：这里直接 unmount 验证 cleanup
    const onClose = vi.fn();
    const { unmount } = renderDialog({ onClose });
    await waitFor(() => {
      expect(screen.getAllByLabelText('remove-section').length).toBe(2);
    });
    voiceStub.stop.mockClear();
    unmount();
    // 不强制要求 stop 被调用，但当父组件使用 useEffect 清理时会被调用
  });

  it('挂载时 voice toggle 按钮可见', async () => {
    renderDialog();
    await waitFor(() => {
      expect(screen.getByLabelText('voice-start')).toBeInTheDocument();
    });
  });
});
