import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PocketView } from '../../src/components/PocketView';
import { db } from '../../src/db';
import {
  createPocketImageNote,
  createPocketNote,
  listPocketNotes,
  POCKET_CANVAS_ID,
} from '../../src/utils/pocketNotes';
import { AppDialogProvider } from '../../src/components/AppDialogProvider';
import { __clearRecentOriginals } from '../../src/utils/recentOriginalPhotos';

// 端侧 OCR 在这里换成假的：真引擎会去下 30MB 模型。vi.mock 会被提升到文件顶部，
// 所以桩要放进 vi.hoisted 一起提升，否则 mock 工厂拿到的是还没初始化的变量。
const ocr = vi.hoisted(() => ({
  recognize: vi.fn(async (_file: File, _onStage?: (s: string) => void) => '第一行\n第二行'),
}));
vi.mock('../../src/services/pocketOcr', () => ({
  recognizeImageText: ocr.recognize,
  OCR_MIN_SCORE: 0.5,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'pocket.title': '备忘',
        'pocket.placeholder': '想到什么就写。',
        'pocket.new': '新记一条',
        'pocket.empty': '备忘还是空的。',
        'pocket.place': '放到画布',
        'pocket.placed_on': `已放到「${opts?.name ?? ''}」`,
        'pocket.delete': '删除',
        'pocket.delete_confirm': `删除「${opts?.title ?? ''}」？`,
        'pocket.delete_n_confirm': `删除这 ${opts?.count ?? ''} 条备忘？`,
        'pocket.cancel_select': '取消',
        'pocket.untitled': '未命名备忘',
        'pocket.back': '返回',
        'pocket.add_photo': '加一张照片',
        'pocket.photo': '照片',
        'pocket.photo_working': '正在存照片…',
        'pocket.ocr_loading_engine': '正在准备本机文字识别（首次约 45MB 下载，之后走缓存）…',
        'pocket.ocr_working': '正在识别文字… {{done}}/{{total}}',
        'pocket.ocr_empty': '没有文字',
        'pocket.ocr_edit_hint': '识别出的文字，点一下可以改',
        'pocket.ocr_run': '识别这张照片里的文字',
        'pocket.photo_failed': '这张照片没存上，换一张试试。',
        'cloud.signIn': '登录',
        'cloud.title': '云同步',
        'cloud.blurb': '登录后可将画布、便签与助手备份到云端。',
        'dialog.confirm': '确定',
        'dialog.cancel': '取消',
      };
      return translations[key] ?? key;
    },
    i18n: { language: 'zh' },
  }),
}));

function renderPocket(onOpenLogin = vi.fn()) {
  return {
    onOpenLogin,
    ...render(
      <AppDialogProvider>
        <PocketView onOpenLogin={onOpenLogin} />
      </AppDialogProvider>,
    ),
  };
}

describe('PocketView 改识别出来的文字', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    ocr.recognize.mockClear();
    ocr.recognize.mockImplementation(async () => 'x');
  });

  async function openPreview(ocrText = '我也喝不了雪花啤酒\n三') {
    const id = await createPocketImageNote({ dataUrl: 'data:image/webp;base64,AA', ocrText });
    const user = userEvent.setup();
    renderPocket();
    await user.click(await screen.findByTestId(`pocket-item-${id}`));
    await screen.findByTestId('pocket-photo-text');
    return { id, user };
  }

  it('opens the editor straight from the text — no extra button', async () => {
    // 没有独立的"改文字"按钮：点文字本身就是入口。
    const { user } = await openPreview();
    expect(screen.queryByTestId('pocket-ocr-edit')).toBeNull();
    expect(screen.queryByTestId('pocket-ocr-done')).toBeNull();
    await user.click(screen.getByTestId('pocket-photo-text'));
    expect(await screen.findByTestId('pocket-photo-text-edit')).toBeInTheDocument();
  });

  it('saves a correction when the field loses focus', async () => {
    const { id, user } = await openPreview();
    await user.click(screen.getByTestId('pocket-photo-text'));
    const editor = await screen.findByTestId('pocket-photo-text-edit');
    await user.clear(editor);
    await user.type(editor, '我也喝不了雪花啤酒，酒精过敏。');
    fireEvent.blur(editor);
    await waitFor(async () => {
      expect((await db.nodes.get(id))?.ocrText).toBe('我也喝不了雪花啤酒，酒精过敏。');
    });
  });

  // 认错的多半在尾部，所以进编辑态时光标要落在末尾。
  it('puts the cursor at the end of the recognised text', async () => {
    const { user } = await openPreview('前半段是对的\n末尾多出来的字');
    await user.click(screen.getByTestId('pocket-photo-text'));
    const editor = (await screen.findByTestId('pocket-photo-text-edit')) as HTMLTextAreaElement;
    // 光标落位是在 requestAnimationFrame 里做的，机器挤的时候 rAF 会晚一拍，等一下。
    await waitFor(() => {
      expect(editor.selectionStart).toBe(editor.value.length);
    });
  });

  // 全删了＝这段识别没用，摆上画布时就不该再长出一张空便签。
  it('can clear the text entirely', async () => {
    const { id, user } = await openPreview('全是错的');
    await user.click(screen.getByTestId('pocket-photo-text'));
    const editor = await screen.findByTestId('pocket-photo-text-edit');
    await user.clear(editor);
    fireEvent.blur(editor);
    await waitFor(async () => {
      expect((await db.nodes.get(id))?.ocrText).toBe('');
    });
  });

  it('leaves the text untouched when nothing was changed', async () => {
    const { id, user } = await openPreview('原样');
    await user.click(screen.getByTestId('pocket-photo-text'));
    fireEvent.blur(await screen.findByTestId('pocket-photo-text-edit'));
    await waitFor(() => {
      expect(screen.queryByTestId('pocket-photo-text-edit')).toBeNull();
    });
    expect((await db.nodes.get(id))?.ocrText).toBe('原样');
  });

  // 正在改字时 Esc 只该退出编辑；直接关掉整屏会把刚敲的丢掉。
  it('leaves edit mode on Escape without closing the preview', async () => {
    const { user } = await openPreview('原文');
    await user.click(screen.getByTestId('pocket-photo-text'));
    await screen.findByTestId('pocket-photo-text-edit');
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByTestId('pocket-photo-text-edit')).toBeNull();
    });
    expect(screen.getByTestId('pocket-photo-preview')).toBeInTheDocument();
  });

  // 安卓的硬件返回键走 popstate → closePreview，那是用户最顺手的"改完了"手势。
  it('keeps the edit when the browser back button is pressed mid-edit', async () => {
    vi.spyOn(window.history, 'pushState').mockImplementation(() => {});
    vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const id = await createPocketImageNote({ dataUrl: 'data:image/webp;base64,AA', ocrText: '原文' });
    const user = userEvent.setup();
    renderPocket();
    await user.click(await screen.findByTestId(`pocket-item-${id}`));
    await user.click(await screen.findByTestId('pocket-photo-text'));
    const editor = await screen.findByTestId('pocket-photo-text-edit');
    await user.clear(editor);
    await user.type(editor, '改完再退出的内容');

    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() => {
      expect(screen.queryByTestId('pocket-photo-preview')).toBeNull();
    });
    expect((await db.nodes.get(id))?.ocrText).toBe('改完再退出的内容');
    vi.restoreAllMocks();
  });

  it('shows the correction in the pocket list too', async () => {
    const { user } = await openPreview('认错了');
    await user.click(screen.getByTestId('pocket-photo-text'));
    const editor = await screen.findByTestId('pocket-photo-text-edit');
    await user.clear(editor);
    await user.type(editor, '改对了');
    fireEvent.blur(editor);
    await waitFor(() => {
      expect(screen.queryByTestId('pocket-photo-text-edit')).toBeNull();
    });
    await user.click(screen.getByTestId('pocket-photo-back'));
    expect(await screen.findByText('改对了')).toBeInTheDocument();
  });

  // 上限只能加在面板上。之前面板和里面的滚动盒都写了 max-h-[45%]，而百分比对
  // 高度不定的父容器无效：里面的盒子撑到内容全高、溢出面板，文字被拦腰截断，
  // 看起来就是"只显示一半"。
  it('constrains the scroll box inside the panel instead of overflowing it', async () => {
    const { user } = await openPreview('很长的一段文字。\n第二行。\n第三行。\n第四行。\n第五行。');
    const readBox = screen.getByTestId('pocket-photo-text');
    expect(readBox.className).toContain('flex-1');
    expect(readBox.className).toContain('min-h-0');
    expect(readBox.className).not.toMatch(/max-h-\[\d+%\]/);
    expect(readBox.className).toContain('overflow-y-auto');

    await user.click(readBox);
    const editor = await screen.findByTestId('pocket-photo-text-edit');
    expect(editor.className).toContain('flex-1');
    expect(editor.className).toContain('min-h-0');
    expect(editor.className).not.toMatch(/max-h-\[\d+(vh|%)\]/);
  });
});
