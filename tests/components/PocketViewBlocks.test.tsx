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
        'pocket.ocr_run': '识别这张照片里的文字',
        'pocket.ocr_redo': '再识别一次',
        'pocket.title_placeholder': '标题',
        'pocket.ocr_view': '查看并修改',
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

function jpegFile(name = "photo.jpg") {
  return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xdb])], name, { type: "image/jpeg" });
}

describe('PocketView 图文混排', () => {
  beforeEach(async () => {
    await db.nodes.clear();
  });

  /**
   * 图文混排：写文字的时候拍照，图要落进**这一条**里，不另起一条。
   * 早先的行为是插一张图就多出一条记录，用户看到的是"写完字一拍照凭空多一条"，
   * 那不是他要的。
   */
  it('files a photo taken mid-writing into the memo itself', async () => {
    const user = userEvent.setup();
    renderPocket();
    await user.click(await screen.findByTestId('pocket-new'));
    const editor = await screen.findByTestId('pocket-editor');
    await user.type(editor, '今天拍了张白板');
    const memo = (await listPocketNotes())[0]!;
    expect(memo.type).toBe('note');

    fireEvent.change(screen.getByTestId('pocket-photo-input'), {
      target: { files: [jpegFile()] },
    });

    await waitFor(async () => {
      // 编辑器没被关掉，图插在了正在写的那一段之后
      // 插完图下面多了一段能继续打字的地方，所以这里是多个
      expect(screen.getAllByTestId('pocket-editor').length).toBe(2);
      const photos = document.querySelectorAll('[data-testid^="pocket-block-photo-"]');
      expect(photos.length).toBe(1);
    });
    // 列表里仍然只有那一条备忘：图片不再是独立的一条
    await waitFor(async () => {
      const listed = await listPocketNotes();
      expect(listed).toHaveLength(1);
      expect(listed[0]!.id).toBe(memo.id);
      expect(listed[0]!.blocks?.filter((b) => b.kind === 'image')).toHaveLength(1);
    });
  });

  it('puts every photo of a batch into the memo, in order', async () => {
    const user = userEvent.setup();
    renderPocket();
    await user.click(await screen.findByTestId('pocket-new'));
    await user.type(await screen.findByTestId('pocket-editor'), '一次拍三张');
    const memo = (await listPocketNotes())[0]!;

    fireEvent.change(screen.getByTestId('pocket-photo-input'), {
      target: { files: [jpegFile('a.jpg'), jpegFile('b.jpg'), jpegFile('c.jpg')] },
    });

    await waitFor(async () => {
      const listed = await listPocketNotes();
      expect(listed).toHaveLength(1);
      expect(listed[0]!.blocks?.filter((b) => b.kind === 'image')).toHaveLength(3);
    });
    // 文字仍然是第一段，图片都排在它后面
    const blocks = (await listPocketNotes())[0]!.blocks!;
    expect(blocks[0]!.kind).toBe('text');
    expect(blocks[0]!.kind === 'text' ? blocks[0]!.text : '').toContain('一次拍三张');
  });

  it('keeps the text a user typed below an inserted photo', async () => {
    // 上头文字、中间图、底下文字——这是用户描述的那个形状。
    const user = userEvent.setup();
    renderPocket();
    await user.click(await screen.findByTestId('pocket-new'));
    await user.type(await screen.findByTestId('pocket-editor'), '上面这段');
    fireEvent.change(screen.getByTestId('pocket-photo-input'), {
      target: { files: [jpegFile()] },
    });
    await waitFor(() =>
      expect(document.querySelectorAll('[data-testid^="pocket-block-photo-"]').length).toBe(1),
    );

    // 图后面应该还有能继续打字的地方
    const areas = screen.getAllByTestId('pocket-editor');
    expect(areas.length).toBeGreaterThan(1);
    await user.type(areas[areas.length - 1]!, '下面这段');
    await user.click(screen.getByTestId('pocket-back'));

    await waitFor(async () => {
      const listed = await listPocketNotes();
      expect(listed).toHaveLength(1);
      const text = listed[0]!.blocks
        ?.filter((b) => b.kind === 'text')
        .map((b) => (b.kind === 'text' ? b.text : ''))
        .join('\n');
      expect(text).toContain('上面这段');
      expect(text).toContain('下面这段');
    });
  });

  // 只有图、没有字：关掉编辑器不能把它当空稿删掉——用户可能就只想存一张照片。
  // 早先只看文字摘要，这条会被连图一起清掉。
  it('keeps a photo-only memo when leaving the editor', async () => {
    const user = userEvent.setup();
    renderPocket();
    await user.click(await screen.findByTestId('pocket-new'));
    fireEvent.change(screen.getByTestId('pocket-photo-input'), {
      target: { files: [jpegFile()] },
    });
    await waitFor(() =>
      expect(document.querySelectorAll('[data-testid^="pocket-block-photo-"]').length).toBe(1),
    );
    await user.click(screen.getByTestId('pocket-back'));

    await waitFor(async () => {
      const rows = await db.nodes.toArray();
      expect(rows).toHaveLength(2);
      expect(rows.some((n) => n.type === 'image')).toBe(true);
    });
  });

  // closeEditor 走 setEditingId + history.back()，React 会先摘掉 popstate 监听，
  // popstate 落地时没人接，skip 标志就留成脏的。上一轮残留会白白吞掉下一次返回键。
  it('does not let a stale history-skip flag swallow the next back press', async () => {
    vi.spyOn(window.history, 'pushState').mockImplementation(() => {});
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const first = await createPocketNote('第一条');

    const user = userEvent.setup();
    renderPocket();
    // 用返回按钮关掉编辑器：走的正是 setEditingId + history.back()，标志可能留脏
    await user.click(await screen.findByTestId(`pocket-item-${first}`));
    expect(await screen.findByTestId('pocket-editor')).toBeInTheDocument();
    await user.click(screen.getByTestId('pocket-back'));
    await waitFor(() => expect(screen.queryByTestId('pocket-editor')).toBeNull());

    // 再开一次，这次按硬件返回键：应该一步就关掉
    await user.click(screen.getByTestId(`pocket-item-${first}`));
    expect(await screen.findByTestId('pocket-editor')).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() => {
      expect(screen.queryByTestId('pocket-editor')).not.toBeInTheDocument();
    });
    vi.restoreAllMocks();
  });
});

/**
 * 回归：这条曾经是整轮改动里最难查的一个问题。
 * 写完字→插图→退回列表，列表里必须还是**那一条**备忘（带着它的图），
 * 不能凭空少一条，也不能多出一条。少的那条来自组件自己的 liveQuery，
 * 直接读 db 的 listPocketNotes 看不出来，只有真的渲染列表才会暴露。
 */
describe('混排备忘回到列表后仍然在', () => {
  beforeEach(async () => {
    await db.nodes.clear();
  });

  it('shows one item carrying the text and the photo', async () => {
    const user = userEvent.setup();
    renderPocket();
    await user.click(await screen.findByTestId('pocket-new'));
    await user.type(await screen.findByTestId('pocket-editor'), '白板上写的');
    fireEvent.change(screen.getByTestId('pocket-photo-input'), {
      target: { files: [jpegFile()] },
    });
    await waitFor(() =>
      expect(document.querySelectorAll('[data-testid^="pocket-block-photo-"]').length).toBe(1),
    );
    await user.click(screen.getByTestId('pocket-back'));

    const memo = (await listPocketNotes())[0]!;
    // 列表里是那一条备忘
    expect(await screen.findByTestId(`pocket-item-${memo.id}`)).toBeInTheDocument();
    // 只有一条（图片不算独立一条）
    expect(screen.getAllByTestId(/^pocket-item-/).length).toBe(1);
    // 文字在
    expect(screen.getByText(/白板上写的/)).toBeInTheDocument();
    // 图作为内嵌缩略图跟着这条备忘显示
    expect(screen.getByTestId(`pocket-inline-photos-${memo.id}`)).toBeInTheDocument();
  });

  it('does not re-appear as a second item after leaving and re-entering the editor', async () => {
    const user = userEvent.setup();
    renderPocket();
    await user.click(await screen.findByTestId('pocket-new'));
    await user.type(await screen.findByTestId('pocket-editor'), '来回进出');
    fireEvent.change(screen.getByTestId('pocket-photo-input'), {
      target: { files: [jpegFile()] },
    });
    await waitFor(() =>
      expect(document.querySelectorAll('[data-testid^="pocket-block-photo-"]').length).toBe(1),
    );
    const memo = (await listPocketNotes())[0]!;
    await user.click(screen.getByTestId('pocket-back'));
    await screen.findByTestId(`pocket-item-${memo.id}`);

    await user.click(screen.getByTestId(`pocket-item-${memo.id}`));
    // 混排备忘有多个文字段，用 findAll
    await screen.findAllByTestId('pocket-editor');
    await user.click(screen.getByTestId('pocket-back'));

    // 关掉编辑器到列表重新渲染之间有一步异步，等一下再断言。
    await waitFor(() => {
      expect(screen.getAllByTestId(/^pocket-item-/)).toHaveLength(1);
    });
  });
});

describe('混排编辑器的高度与落笔处', () => {
  beforeEach(async () => {
    await db.nodes.clear();
  });

  it('sizes a text block to its content instead of a fixed tall box', async () => {
    // 用户反馈过：只写一行字时，文字和图之间会有一大片空白。
    // 原因是给输入框写死了 min-h-[7rem] 之类的固定高度。
    const user = userEvent.setup();
    renderPocket();
    await user.click(await screen.findByTestId('pocket-new'));
    const editor = await screen.findByTestId('pocket-editor');
    await user.type(editor, '123');

    expect(editor.className).toContain('min-h-[2.75rem]');
    expect(editor.className).not.toMatch(/min-h-\[(7|4\.5)rem\]/);
    expect(editor.className).toContain('overflow-hidden');
  });

  it('offers a place to keep typing below a photo, even after reopening', async () => {
    // 空段是编辑器里才有的落笔处，不入库（存的时候会被 trim 掉），
    // 所以每次打开都必须补一次——否则图下面就没法再写字。
    const user = userEvent.setup();
    renderPocket();
    await user.click(await screen.findByTestId('pocket-new'));
    await user.type(await screen.findByTestId('pocket-editor'), '上面');
    fireEvent.change(screen.getByTestId('pocket-photo-input'), {
      target: { files: [jpegFile()] },
    });
    await waitFor(() =>
      expect(document.querySelectorAll('[data-testid^="pocket-block-photo-"]').length).toBe(1),
    );
    const memo = (await listPocketNotes())[0]!;
    await user.click(screen.getByTestId('pocket-back'));
    await screen.findByTestId(`pocket-item-${memo.id}`);

    // 重新打开：图下面仍然有一段可以打字
    await user.click(screen.getByTestId(`pocket-item-${memo.id}`));
    const areas = await screen.findAllByTestId('pocket-editor');
    expect(areas.length).toBeGreaterThan(1);
    await user.type(areas[areas.length - 1]!, '下面这段');
    await user.click(screen.getByTestId('pocket-back'));

    await waitFor(async () => {
      const node = (await listPocketNotes())[0]!;
      const text = node.blocks
        ?.filter((b) => b.kind === 'text')
        .map((b) => (b.kind === 'text' ? b.text : ''))
        .join('\n');
      expect(text).toContain('上面');
      expect(text).toContain('下面这段');
    });
  });

  it('does not store the empty trailing slot', async () => {
    const user = userEvent.setup();
    renderPocket();
    await user.click(await screen.findByTestId('pocket-new'));
    await user.type(await screen.findByTestId('pocket-editor'), '上面');
    fireEvent.change(screen.getByTestId('pocket-photo-input'), {
      target: { files: [jpegFile()] },
    });
    await waitFor(() =>
      expect(document.querySelectorAll('[data-testid^="pocket-block-photo-"]').length).toBe(1),
    );
    await user.click(screen.getByTestId('pocket-back'));

    await waitFor(async () => {
      const node = (await listPocketNotes())[0]!;
      const stored = node.blocks ?? [];
      expect(stored[stored.length - 1]?.kind).toBe('image');
    });
  });
});

/**
 * 回归：编辑器里那个 280ms 的自动保存曾经把 draft（纯文字）写回 content。
 * 图文混排的备忘正文在 blocks 里，content 被覆盖成文字之后，这条记录既不是合法图片
 * 也不是合法备忘——OCR 那头再去 atob 这串文字就抛 InvalidCharacterError。
 * 这里钉住"打字时存的是段落，不是 content"。
 */
describe('打字时的自动保存', () => {
  beforeEach(async () => {
    await db.nodes.clear();
  });

  it('writes blocks, never the memo content field', async () => {
    const user = userEvent.setup();
    renderPocket();
    await user.click(await screen.findByTestId('pocket-new'));
    await user.type(await screen.findByTestId('pocket-editor'), '上面这段');
    fireEvent.change(screen.getByTestId('pocket-photo-input'), {
      target: { files: [jpegFile()] },
    });
    await waitFor(() =>
      expect(document.querySelectorAll('[data-testid^="pocket-block-photo-"]').length).toBe(1),
    );
    const memoId = (await listPocketNotes())[0]!.id;

    // 用 fireEvent.change 而不是 user.type：后者每个字符都有延时，会在打字途中
    // 反复触发 280ms 防抖，这条测试测的是"存什么"不是"打字快慢"。
    const firstArea = screen.getAllByTestId('pocket-editor')[0]!;
    fireEvent.change(firstArea, { target: { value: '上面这段接着写' } });

    await waitFor(
      async () => {
        const n = await db.nodes.get(memoId);
        const first = n?.blocks?.[0];
        expect(first?.kind === 'text' && first.text).toContain('接着写');
      },
      { timeout: 4000 },
    );
    const node = await db.nodes.get(memoId);
    // content 必须还是空的：混排备忘的正文不在 content 里
    expect(node?.content).toBe('');
    expect(node?.blocks).toBeTruthy();
  });
});

/**
 * 识别出来的文字要**直接进编辑面**：它是照片后面的一段普通文字，跟别的文字一样能改，
 * 而不是贴一个只读的框在照片下面——那样和"图文同一个编辑态"是矛盾的。
 */
describe('识别出的文字直接进编辑面', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    ocr.recognize.mockClear();
    ocr.recognize.mockImplementation(async () => '认出来的第一行\n认出来的第二行');
  });

  async function memoWithPhoto() {
    const user = userEvent.setup();
    renderPocket();
    await user.click(await screen.findByTestId('pocket-new'));
    await user.type(await screen.findByTestId('pocket-editor'), '上面');
    fireEvent.change(screen.getByTestId('pocket-photo-input'), {
      target: { files: [jpegFile()] },
    });
    await waitFor(() =>
      expect(document.querySelectorAll('[data-testid^="pocket-block-photo-"]').length).toBe(1),
    );
    const blocks = (await listPocketNotes())[0]!.blocks!;
    const photoId = (blocks.find((b) => b.kind === 'image') as { photoId: string }).photoId;
    return { user, photoId, memoId: (await listPocketNotes())[0]!.id };
  }

  it('turns the recognised text into an editable text block after the photo', async () => {
    const { user, photoId } = await memoWithPhoto();
    await user.click(screen.getByTestId(`pocket-ocr-run-${photoId}`));

    await waitFor(async () => {
      const node = (await listPocketNotes())[0]!;
      const adopted = node.blocks?.find((b) => b.kind === 'text' && b.fromOcr === photoId);
      expect(adopted?.kind === 'text' && adopted.text).toContain('认出来的第一行');
    });
    // 照片上不再留一份：否则画布上会同时长出文字卡和关联便签，同一句话出现两次
    expect((await listPocketNotes())[0]!.blocks!.find((b) => b.kind === 'image')).toBeTruthy();
    expect((await db.nodes.get(photoId))?.ocrText).toBe('');
  });

  it('does not leave a separate read-only box for the text', async () => {
    const { user, photoId } = await memoWithPhoto();
    await user.click(screen.getByTestId(`pocket-ocr-run-${photoId}`));
    await waitFor(() => {
      const areas = screen.getAllByTestId('pocket-editor');
      expect(areas.some((a) => (a as HTMLTextAreaElement).value.includes('认出来的第一行'))).toBe(true);
    });
    expect(screen.queryByTestId(`pocket-block-ocr-${photoId}`)).toBeNull();
  });

  it('lets the user edit the recognised text like any other text', async () => {
    const { user, photoId } = await memoWithPhoto();
    await user.click(screen.getByTestId(`pocket-ocr-run-${photoId}`));
    const areas = await screen.findAllByTestId('pocket-editor');
    const adopted = areas.find((a) =>
      (a as HTMLTextAreaElement).value.includes('认出来的第一行'),
    )!;
    await user.clear(adopted);
    await user.type(adopted, '这是我改过的');

    await waitFor(async () => {
      const node = (await listPocketNotes())[0]!;
      const text = node.blocks
        ?.filter((b) => b.kind === 'text')
        .map((b) => (b.kind === 'text' ? b.text : ''))
        .join('\n');
      expect(text).toContain('这是我改过的');
    });
  });

  it('rewrites the same block on a second recognition instead of stacking duplicates', async () => {
    const { user, photoId } = await memoWithPhoto();
    await user.click(screen.getByTestId(`pocket-ocr-run-${photoId}`));
    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid^="pocket-block-photo-"]').length).toBe(1);
    });
    ocr.recognize.mockImplementation(async () => '第二次的结果');
    // 上一次识别结束时按钮才解除禁用；不等就会点在一个 disabled 按钮上，什么都不会发生。
    await waitFor(() => {
      expect(screen.getByTestId(`pocket-ocr-run-${photoId}`)).not.toBeDisabled();
    });
    await user.click(screen.getByTestId(`pocket-ocr-run-${photoId}`));

    await waitFor(async () => {
      const node = (await listPocketNotes())[0]!;
      const adopted = node.blocks?.filter((b) => b.kind === 'text' && b.fromOcr === photoId);
      expect(adopted).toHaveLength(1);
      expect(adopted![0]!.kind === 'text' && adopted![0]!.text).toBe('第二次的结果');
    });
  });

  it('offers "read again" once the text has been taken in', async () => {
    const { user, photoId } = await memoWithPhoto();
    await user.click(screen.getByTestId(`pocket-ocr-run-${photoId}`));
    await waitFor(() => {
      expect(screen.getByTestId(`pocket-ocr-run-${photoId}`)).toHaveTextContent('再识别一次');
    });
  });
});

/**
 * 标题区：备忘录的常规操作是"先起个名，再写正文"，所以标题单独一行、排在正文上面。
 * 而且它必须独立存（CanvasNode.title），不能只是正文第一行——
 * 否则列表里没法把标题和摘要分开显示。
 */
describe('备忘标题', () => {
  beforeEach(async () => {
    await db.nodes.clear();
  });

  it('shows a title field above the body', async () => {
    const user = userEvent.setup();
    renderPocket();
    await user.click(await screen.findByTestId('pocket-new'));
    const titleInput = await screen.findByTestId('pocket-title');
    // 用 fireEvent.change 而不是 user.type：user.type 逐字符触发、每次都带延时，
    // 而这条测试要验的是'标题存没存进去'，不是打字快慢。
    fireEvent.change(titleInput, { target: { value: '白板上的三件事' } });
    fireEvent.change(screen.getByTestId('pocket-editor'), { target: { value: '正文写这里' } });

    await user.click(screen.getByTestId('pocket-back'));
    // 先等**界面上**出现标题：那是保存真的落地的信号，
    // 直接查库会在保存还在路上时读到中间状态。
    await screen.findByText('白板上的三件事');
    await waitFor(async () => {
      const node = (await listPocketNotes())[0]!;
      expect(node.title).toBe('白板上的三件事');
      expect(node.content).toContain('正文写这里');
    });
  });

  it('keeps a title-only memo instead of discarding it as empty', async () => {
    const user = userEvent.setup();
    renderPocket();
    await user.click(await screen.findByTestId('pocket-new'));
    fireEvent.change(await screen.findByTestId('pocket-title'), {
      target: { value: '只想记个名字' },
    });
    await user.click(screen.getByTestId('pocket-back'));

    await waitFor(async () => {
      const listed = await listPocketNotes();
      expect(listed).toHaveLength(1);
      expect(listed[0]?.title).toBe('只想记个名字');
    });
  });

  it('uses the title in the pocket list, not the first body line', async () => {
    const id = await createPocketNote('正文第一行');
    await db.nodes.update(id, { title: '真正的标题' });
    renderPocket();
    expect(await screen.findByText('真正的标题')).toBeInTheDocument();
  });

  it('puts the cursor in the body when Enter is pressed in the title', async () => {
    const user = userEvent.setup();
    renderPocket();
    await user.click(await screen.findByTestId('pocket-new'));
    const titleInput = await screen.findByTestId('pocket-title');
    await user.type(titleInput, '标题{Enter}');
    expect(document.activeElement?.getAttribute('data-testid')).toBe('pocket-editor');
  });
});
