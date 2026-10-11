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
import { __clearRecentOriginals, peekOriginalPhoto, rememberOriginalPhoto } from '../../src/utils/recentOriginalPhotos';

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
        'pocket.ocr_run': '识别这张照片里的文字',
        'pocket.ocr_no_text': '这张照片里没认出文字',
        'pocket.ocr_edit': '改文字',
        'pocket.ocr_done': '完成',
        'pocket.ocr_empty': '没有文字',
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

describe('PocketView 识别文字是按需的', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    __clearRecentOriginals();
    ocr.recognize.mockClear();
    ocr.recognize.mockImplementation(async () => '认出来的第一行\n认出来的第二行');
  });

  afterEach(() => {
    __clearRecentOriginals();
  });

  function jpegFile(name = 'photo.jpg') {
    return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xdb])], name, { type: 'image/jpeg' });
  }

  // 用户存一张图多半根本不是想读字（拍个白板、截个图、留个景）。
  // 替他自动按下 45MB 的识别引擎，是产品替用户做决定。
  it('does not recognise anything just because a photo was added', async () => {
    const user = userEvent.setup();
    renderPocket();
    await user.click(await screen.findByTestId('pocket-new'));
    fireEvent.change(await screen.findByTestId('pocket-photo-input'), {
      target: { files: [jpegFile()] },
    });
    await waitFor(() =>
      expect(document.querySelectorAll('[data-testid^="pocket-block-photo-"]').length).toBe(1),
    );
    await waitFor(async () => {
      expect(await listPocketNotes()).toHaveLength(1);
    });
    expect(ocr.recognize).not.toHaveBeenCalled();
  });

  it('offers the action on a photo that has no text yet', async () => {
    const id = await createPocketImageNote({ dataUrl: 'data:image/webp;base64,AA' });
    renderPocket();
    expect(await screen.findByTestId(`pocket-ocr-run-${id}`)).toBeInTheDocument();
  });

  it('recognises when the user asks, and shows the result', async () => {
    const id = await createPocketImageNote({ dataUrl: 'data:image/webp;base64,AA' });
    const user = userEvent.setup();
    renderPocket();
    await user.click(await screen.findByTestId(`pocket-ocr-run-${id}`));
    await waitFor(async () => {
      expect((await db.nodes.get(id))?.ocrText).toBe('认出来的第一行\n认出来的第二行');
    });
    expect(await screen.findByTestId(`pocket-ocr-${id}`)).toBeInTheDocument();
  });

  // 存进口袋的是压过的 WebP，原始像素上认小字明显更准，所以刚拍的那张优先用原图。
  it('recognises from the original file, not the stored webp', async () => {
    const user = userEvent.setup();
    renderPocket();
    await user.click(await screen.findByTestId('pocket-new'));
    fireEvent.change(await screen.findByTestId('pocket-photo-input'), {
      target: { files: [jpegFile('原文.jpg')] },
    });
    let photoId = '';
    await waitFor(async () => {
      const listed = await listPocketNotes();
      expect(listed).toHaveLength(1);
      const block = listed[0]!.blocks!.find((b) => b.kind === 'image') as { photoId: string };
      photoId = block.photoId;
      expect(photoId).toBeTruthy();
    });
    await user.click(await screen.findByTestId(`pocket-ocr-run-${photoId}`));
    await waitFor(() => expect(ocr.recognize).toHaveBeenCalled());
    const source = ocr.recognize.mock.calls[0]?.[0] as File;
    expect(source.type).toBe('image/jpeg');
  });

  // 原图只在内存里留最近几张；重开应用之后只能拿存下来的压缩图去认。
  it('falls back to the stored copy once the original is gone', async () => {
    const id = await createPocketImageNote({
      dataUrl: 'data:image/webp;base64,QUJD',
      width: 40,
      height: 20,
    });
    const user = userEvent.setup();
    renderPocket();
    await user.click(await screen.findByTestId(`pocket-ocr-run-${id}`));
    await waitFor(() => expect(ocr.recognize).toHaveBeenCalled());
    const source = ocr.recognize.mock.calls[0]?.[0] as Blob;
    expect(source).toBeInstanceOf(Blob);
    expect(source.type).toBe('image/webp');
  });

  it('reports when there is nothing to read, and keeps the photo', async () => {
    ocr.recognize.mockImplementation(async () => null);
    const id = await createPocketImageNote({ dataUrl: 'data:image/webp;base64,AA' });
    const user = userEvent.setup();
    renderPocket();
    await user.click(await screen.findByTestId(`pocket-ocr-run-${id}`));
    await waitFor(() => {
      expect(screen.getByTestId('pocket-photo-status')).toHaveTextContent('没认出文字');
    });
    expect((await db.nodes.get(id))?.type).toBe('image');
  });

  it('offers the action on the full-screen preview too', async () => {
    const id = await createPocketImageNote({ dataUrl: 'data:image/webp;base64,AA' });
    const user = userEvent.setup();
    renderPocket();
    await user.click(await screen.findByTestId(`pocket-item-${id}`));
    await user.click(await screen.findByTestId('pocket-ocr-run-preview'));
    await waitFor(async () => {
      expect((await db.nodes.get(id))?.ocrText).toBe('认出来的第一行\n认出来的第二行');
    });
  });

  it('does not offer the action twice on a photo that already has text', async () => {
    const id = await createPocketImageNote({ dataUrl: 'data:image/webp;base64,AA', ocrText: '已经有了' });
    renderPocket();
    await screen.findByTestId(`pocket-ocr-${id}`);
    expect(screen.queryByTestId(`pocket-ocr-run-${id}`)).toBeNull();
  });
});

/**
 * 回归：第一次识别失败之后原图必须还在，用户再点一次才有机会成功。
 * 早先 takeOriginalPhoto 是"取用即删"，失败一次之后原图就没了，
 * 第二次只能退回用存下来的压缩图——成功率就断在第一次。
 */
describe('识别失败之后还能再试', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    __clearRecentOriginals();
    ocr.recognize.mockClear();
  });

  it('keeps the original when the attempt fails', async () => {
    const original = new File([new Uint8Array([0xff, 0xd8])], '原文.jpg', { type: 'image/jpeg' });
    const id = await createPocketImageNote({ dataUrl: 'data:image/webp;base64,QUJD', width: 40, height: 20 });
    // 模拟刚拍完那张：原图在内存里
    rememberOriginalPhoto(id, original);
    ocr.recognize.mockImplementation(async () => { throw new Error('引擎没起来'); });

    const user = userEvent.setup();
    renderPocket();
    await user.click(await screen.findByTestId(`pocket-ocr-run-${id}`));
    await waitFor(() => {
      expect(screen.getByTestId('pocket-photo-status')).toHaveTextContent('引擎没起来');
    });
    expect(peekOriginalPhoto(id)).toBe(original);
  });

  it('drops the original only after a successful recognition', async () => {
    const original = new File([new Uint8Array([0xff, 0xd8])], '原文.jpg', { type: 'image/jpeg' });
    const id = await createPocketImageNote({ dataUrl: 'data:image/webp;base64,QUJD', width: 40, height: 20 });
    rememberOriginalPhoto(id, original);
    ocr.recognize.mockImplementation(async () => '认出来了');

    const user = userEvent.setup();
    renderPocket();
    await user.click(await screen.findByTestId(`pocket-ocr-run-${id}`));
    await waitFor(async () => {
      expect((await db.nodes.get(id))?.ocrText).toBe('认出来了');
    });
    expect(peekOriginalPhoto(id)).toBeUndefined();
  });
});
