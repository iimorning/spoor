import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { EssayFullscreen } from '../../src/components/EssayFullscreen';
import { essayUrlTransform } from '../../src/utils/essayUrlTransform';
import { db } from '../../src/db';
import type { Article } from '../../src/db';
import { persistEssayEditorBody } from '../../src/utils/persistEssayEditorBody';
import { withAppDialogProvider } from '../testUtils';

const { exportEssayAsDocx, exportEssayAsPdf, downloadBlob, copyTextToClipboard } = vi.hoisted(() => ({
  exportEssayAsDocx: vi.fn(async () => new Blob(['PK'], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })),
  exportEssayAsPdf: vi.fn(async () => {}),
  downloadBlob: vi.fn(),
  copyTextToClipboard: vi.fn(async () => {}),
}));

vi.mock('../../src/utils/essayExport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/essayExport')>();
  return { ...actual, exportEssayAsDocx, exportEssayAsPdf };
});

vi.mock('../../src/utils/downloadBlob', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/downloadBlob')>();
  return { ...actual, downloadBlob };
});

vi.mock('../../src/utils/copyTextToClipboard', () => ({ copyTextToClipboard }));

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => (
    <div data-testid="reference-markdown">{String(children ?? '')}</div>
  ),
}));

vi.mock('remark-breaks', () => ({ default: () => null }));

const article: Article = {
  id: 'a-alpha',
  title: 'Alpha Unique Title',
  content: 'Some body for alpha',
  date: '2024',
  type: 'REF-A',
  tags: ['memo'],
};

describe('EssayFullscreen', () => {
  beforeAll(() => {
    const emptyRect = {
      x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, bottom: 0, right: 0,
      toJSON: () => ({}),
    };
    const rangeProto = Range.prototype as unknown as {
      getClientRects?: () => DOMRectList;
      getBoundingClientRect?: () => DOMRect;
    };
    if (typeof rangeProto.getClientRects !== 'function') {
      rangeProto.getClientRects = () => [] as unknown as DOMRectList;
    }
    if (typeof rangeProto.getBoundingClientRect !== 'function') {
      rangeProto.getBoundingClientRect = () => emptyRect as DOMRect;
    }

    // fake-indexeddb 存回来的 blob 是结构化克隆的普通对象，jsdom 原生的
    // createObjectURL 一收到就抛 "must be an instance of Blob"。真浏览器里 Dexie
    // 克隆回来的就是货真价实的 Blob，所以这是环境的毛病，得在这个文件里统一直掉。
    URL.createObjectURL = () => 'blob:essay-fullscreen-test';
  });

  beforeEach(async () => {
    localStorage.removeItem('SCRIBE_DISABLE_CONTENT_AUTOSAVE');
    await db.articles.clear();
    await db.canvases.clear();
    await db.articles.add(article);
  });

  afterEach(() => {
    localStorage.removeItem('SCRIBE_DISABLE_CONTENT_AUTOSAVE');
    exportEssayAsDocx.mockClear();
    exportEssayAsPdf.mockClear();
    downloadBlob.mockClear();
    copyTextToClipboard.mockClear();
  });

  it('shows generating banner while the article is still streaming', async () => {
    await db.articles.put({
      ...article,
      generating: true,
      contentDrivesBody: true,
    });
    render(withAppDialogProvider(<EssayFullscreen articleId="a-alpha" onClose={() => {}} />));
    await waitFor(() => {
      expect(screen.getByTestId('essay-generating')).toHaveTextContent('reference.generating_body');
    });
  });

  it('renders article title and closes on Esc', async () => {
    const onClose = vi.fn();
    render(
      withAppDialogProvider(
        <EssayFullscreen articleId="a-alpha" onClose={onClose} />,
      ),
    );

    await waitFor(() => {
      expect(screen.getByText('Alpha Unique Title')).toBeInTheDocument();
    });
    expect(screen.getByTestId('essay-fullscreen')).toBeInTheDocument();
    expect(screen.getByTestId('essay-word-count')).toHaveTextContent('16');
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
    expect(screen.getByTestId('chat-panel-input')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('close button calls onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      withAppDialogProvider(
        <EssayFullscreen articleId="a-alpha" onClose={onClose} />,
      ),
    );
    await waitFor(() => {
      expect(screen.getByTestId('essay-fullscreen-close')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('essay-fullscreen-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows total 字数 from sourceCards, not the leftover content field', async () => {
    await db.articles.put({
      ...article,
      content: 'this leftover should not count toward the total',
      sourceCards: [
        { nodeId: 'n1', canvasId: 'c1', kind: 'note', title: '一', segmentText: '第一段正文' },
        { nodeId: 'n2', canvasId: 'c1', kind: 'note', title: '二', segmentText: '第二段' },
      ],
    });
    render(withAppDialogProvider(<EssayFullscreen articleId="a-alpha" onClose={() => {}} />));
    await waitFor(() => {
      expect(screen.getByTestId('essay-word-count')).toHaveTextContent('8');
    });
  });

  it('shows loading then missing for an unknown article id', async () => {
    render(withAppDialogProvider(<EssayFullscreen articleId="no-such-article" onClose={() => {}} />));
    expect(screen.getByTestId('essay-fullscreen-loading')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('nodes.essay_missing')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('essay-fullscreen-loading')).not.toBeInTheDocument();
  });

  it('cleans an old unresolved media placeholder once and finishes loading', async () => {
    await db.articles.put({
      ...article,
      content: '正文\n\n![Image](media://image/deleted-node)',
    });
    render(withAppDialogProvider(<EssayFullscreen articleId="a-alpha" onClose={() => {}} />));

    await waitFor(() => {
      expect(screen.queryByTestId('essay-fullscreen-loading')).not.toBeInTheDocument();
    });
    const migrated = await db.articles.get('a-alpha');
    expect(migrated?.content).toBe('正文');
  });

  it('renders one body editor instead of per-card segments', async () => {
    await db.articles.put({
      ...article,
      content: 'leftover ignored',
      sourceCards: [
        { nodeId: 'n1', canvasId: 'c1', kind: 'note', title: '一', segmentText: '第一段正文' },
        { nodeId: 'n2', canvasId: 'c1', kind: 'note', title: '二', segmentText: '第二段' },
      ],
    });
    render(withAppDialogProvider(<EssayFullscreen articleId="a-alpha" onClose={() => {}} />));
    await waitFor(() => {
      expect(screen.getByTestId('essay-body-editor')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('essay-floating-toolbar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('reference-segment-1')).not.toBeInTheDocument();
  });

  it('does not rewrite leftover content if the user never edits', async () => {
    await db.articles.put({
      ...article,
      content: 'this leftover should not count toward the total',
      sourceCards: [
        { nodeId: 'n1', canvasId: 'c1', kind: 'note', title: '一', segmentText: '第一段正文' },
        { nodeId: 'n2', canvasId: 'c1', kind: 'note', title: '二', segmentText: '第二段' },
      ],
    });
    render(withAppDialogProvider(<EssayFullscreen articleId="a-alpha" onClose={() => {}} />));
    await waitFor(() => {
      expect(screen.getByTestId('essay-body-editor')).toBeInTheDocument();
    });
    await new Promise((r) => setTimeout(r, 600));
    const row = await db.articles.get('a-alpha');
    expect(row?.content).toBe('this leftover should not count toward the total');
    expect(row?.contentDrivesBody).toBeFalsy();
    expect(row?.sourceCards).toHaveLength(2);
  });

  it('keeps edited body when a source card is unlinked', async () => {
    const user = userEvent.setup();
    await db.articles.put({
      ...article,
      content: 'this leftover should not count toward the total',
      sourceCards: [
        { nodeId: 'n1', canvasId: 'c1', kind: 'note', title: '一', segmentText: '第一段正文' },
        { nodeId: 'n2', canvasId: 'c1', kind: 'note', title: '二', segmentText: '第二段' },
      ],
    });
    render(withAppDialogProvider(<EssayFullscreen articleId="a-alpha" onClose={() => {}} />));
    await waitFor(() => {
      expect(screen.getByTestId('essay-body-editor')).toBeInTheDocument();
    });
    await persistEssayEditorBody('a-alpha', '手改后的完整正文');
    await waitFor(() => {
      expect(screen.getByTestId('essay-word-count')).toHaveTextContent('8');
    });
    await user.click(screen.getByTestId('reference-source-card-delete-0'));
    await user.click(screen.getByRole('button', { name: 'dialog.confirm' }));
    await waitFor(async () => {
      const row = await db.articles.get('a-alpha');
      expect(row?.content).toBe('手改后的完整正文');
      expect(row?.contentDrivesBody).toBe(true);
      expect(row?.sourceCards?.map((s) => s.nodeId)).toEqual(['n2']);
    });
  });

  it('still removes the matching body section when deleting a card before any editor save', async () => {
    const user = userEvent.setup();
    await db.articles.put({
      ...article,
      content: 'ignored leftover',
      sourceCards: [
        { nodeId: 'n1', canvasId: 'c1', kind: 'note', title: '一', segmentText: '第一段正文' },
        { nodeId: 'n2', canvasId: 'c1', kind: 'note', title: '二', segmentText: '第二段' },
      ],
    });
    render(withAppDialogProvider(<EssayFullscreen articleId="a-alpha" onClose={() => {}} />));
    await waitFor(() => {
      expect(screen.getByTestId('reference-source-card-delete-0')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('reference-source-card-delete-0'));
    await user.click(screen.getByRole('button', { name: 'dialog.confirm' }));
    await waitFor(async () => {
      const row = await db.articles.get('a-alpha');
      expect(row?.sourceCards).toHaveLength(1);
      expect(row?.sourceCards?.[0].nodeId).toBe('n2');
      expect(row?.content).toBe('第二段');
      expect(row?.contentDrivesBody).toBeFalsy();
    });
    await waitFor(() => {
      expect(screen.getByTestId('essay-word-count')).toHaveTextContent('3');
    });
  });

  it('does not mark contentDrivesBody when autosave is disabled', async () => {
    localStorage.setItem('SCRIBE_DISABLE_CONTENT_AUTOSAVE', '1');
    await db.articles.put({
      ...article,
      content: 'plain body only',
    });
    render(withAppDialogProvider(<EssayFullscreen articleId="a-alpha" onClose={() => {}} />));
    await waitFor(() => {
      expect(screen.getByTestId('essay-body-editor')).toBeInTheDocument();
    });
    await new Promise((r) => setTimeout(r, 600));
    const row = await db.articles.get('a-alpha');
    expect(row?.content).toBe('plain body only');
    expect(row?.contentDrivesBody).toBeFalsy();
  });

  it('can persist a legacy article that has no sourceCards', async () => {
    render(withAppDialogProvider(<EssayFullscreen articleId="a-alpha" onClose={() => {}} />));
    await waitFor(() => {
      expect(screen.getByTestId('essay-body-editor')).toBeInTheDocument();
    });
    await persistEssayEditorBody('a-alpha', 'hello body');
    await waitFor(async () => {
      const row = await db.articles.get('a-alpha');
      expect(row?.content).toBe('hello body');
      expect(row?.contentDrivesBody).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByTestId('essay-word-count')).toHaveTextContent('9');
    });
  });

  it('hides the per-card edit pencil once contentDrivesBody is set', async () => {
    await db.articles.put({
      ...article,
      content: '手改正文',
      contentDrivesBody: true,
      sourceCards: [
        { nodeId: 'n1', canvasId: 'c1', kind: 'note', title: '一', segmentText: '第一段' },
      ],
    });
    render(withAppDialogProvider(<EssayFullscreen articleId="a-alpha" onClose={() => {}} />));
    await waitFor(() => {
      expect(screen.getByTestId('reference-source-card-0')).toBeInTheDocument();
    });
    // When content is canonical, the per-card edit pencil is suppressed so the
    // user only edits the unified body. The delete control stays accessible.
    expect(screen.queryByTestId('reference-source-card-edit-0')).not.toBeInTheDocument();
    expect(screen.getByTestId('reference-source-card-delete-0')).toBeInTheDocument();
  });

  it('uses the unlink confirmation copy when deleting a card after contentDrivesBody', async () => {
    const user = userEvent.setup();
    await db.articles.put({
      ...article,
      content: '手改正文',
      contentDrivesBody: true,
      sourceCards: [
        { nodeId: 'n1', canvasId: 'c1', kind: 'note', title: '一', segmentText: '第一段' },
      ],
    });
    render(withAppDialogProvider(<EssayFullscreen articleId="a-alpha" onClose={() => {}} />));
    await waitFor(() => {
      expect(screen.getByTestId('reference-source-card-delete-0')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('reference-source-card-delete-0'));
    // Dialog message uses the "unlink" wording once content is canonical —
    // the source card no longer drives the body, so removing it is safe.
    await waitFor(() => {
      expect(screen.getByText('reference.delete_card_unlink_confirm')).toBeInTheDocument();
    });
  });

  it('exports Word from the top bar using the current body', async () => {
    const user = userEvent.setup();
    render(withAppDialogProvider(<EssayFullscreen articleId="a-alpha" onClose={() => {}} />));
    await waitFor(() => {
      expect(screen.getByTestId('essay-export-menu')).toBeEnabled();
    });
    await user.click(screen.getByTestId('essay-export-menu'));
    await user.click(screen.getByTestId('essay-export-word'));
    await waitFor(() => {
      expect(exportEssayAsDocx).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Alpha Unique Title',
          markdown: 'Some body for alpha',
        }),
        expect.anything(),
      );
    });
    expect(downloadBlob).toHaveBeenCalled();
  });

  it('copies title and body from the export menu', async () => {
    const user = userEvent.setup();
    render(withAppDialogProvider(<EssayFullscreen articleId="a-alpha" onClose={() => {}} />));
    await waitFor(() => {
      expect(screen.getByTestId('essay-export-menu')).toBeEnabled();
    });

    // 「复制全文」收在导出菜单里，不是顶栏单独一颗按钮。
    expect(screen.queryByTestId('essay-copy-all')).toBeNull();

    await user.click(screen.getByTestId('essay-export-menu'));
    const menuItem = await screen.findByTestId('essay-copy-all');
    await user.click(menuItem);

    await waitFor(() => {
      // 两份一起写：纯文本给记事本/聊天框，富文本给 Word/Google Docs。
      expect(copyTextToClipboard).toHaveBeenCalledWith(
        'Alpha Unique Title\n\nSome body for alpha',
        { html: '<h1>Alpha Unique Title</h1>\n<p>Some body for alpha</p>' },
      );
    });
    // 菜单点完就关，没地方显示成功——确认态落在触发按钮上。
    expect(screen.queryByTestId('essay-export-menu-panel')).toBeNull();
    expect(screen.getByTestId('essay-export-menu')).toHaveAttribute(
      'aria-label',
      'nodes.essay_copy_done',
    );
  });

  it('opens a lightbox when double-clicking a sidebar image thumbnail', async () => {
    await db.articles.put({
      ...article,
      content: '',
      sourceCards: [
        {
          nodeId: 'img-node',
          canvasId: 'c1',
          kind: 'image',
          title: 'Cover shot',
          segmentText: '![cover](https://example.com/cover.jpg)',
          inBody: false,
        },
      ],
    });
    render(withAppDialogProvider(<EssayFullscreen articleId="a-alpha" onClose={() => {}} />));
    await waitFor(() => {
      expect(screen.getByTestId('reference-source-card-image-0')).toBeInTheDocument();
    });
    fireEvent.doubleClick(screen.getByTestId('reference-source-card-image-0'));
    expect(screen.getByTestId('essay-source-image-lightbox')).toBeInTheDocument();
    expect(screen.getByAltText('Cover shot')).toHaveAttribute('src', 'https://example.com/cover.jpg');
    fireEvent.click(screen.getByTestId('essay-source-image-lightbox-close'));
    expect(screen.queryByTestId('essay-source-image-lightbox')).not.toBeInTheDocument();
  });

  it('inserts a collected image card into the body after drop', async () => {
    const imageSegment = '![cover](spoor-article-media:img-1)';
    await db.articles.put({
      ...article,
      content: '',
      sourceCards: [
        {
          nodeId: 'img-node',
          canvasId: 'c1',
          kind: 'image',
          title: 'Cover',
          segmentText: imageSegment,
          inBody: false,
        },
      ],
    });
    render(withAppDialogProvider(<EssayFullscreen articleId="a-alpha" onClose={() => {}} />));
    await waitFor(() => {
      expect(screen.getByTestId('reference-source-card-status-0')).toHaveTextContent(
        'reference.source_unlinked',
      );
    });
    fireEvent.drop(screen.getByTestId('essay-body-drop-target'), {
      dataTransfer: {
        types: ['application/x-spoor-essay-source'],
        getData: (type: string) =>
          type === 'application/x-spoor-essay-source' ? 'img-node' : '',
      },
    });
    await waitFor(async () => {
      const row = await db.articles.get('a-alpha');
      expect(row?.sourceCards?.[0].inBody).toBe(true);
      expect(row?.content).toContain('spoor-article-media:img-1');
    });
    await waitFor(() => {
      expect(screen.getByTestId('reference-source-card-status-0')).toHaveTextContent(
        'reference.source_linked',
      );
    });
  });

  it('marks an inbox card linked after dropping it on the body', async () => {
    await db.articles.put({
      ...article,
      content: '',
      sourceCards: [
        {
          nodeId: 'n1',
          canvasId: 'c1',
          kind: 'note',
          title: '草稿',
          segmentText: '未入库的一段',
          inBody: false,
        },
      ],
    });
    render(withAppDialogProvider(<EssayFullscreen articleId="a-alpha" onClose={() => {}} />));
    await waitFor(() => {
      expect(screen.getByTestId('reference-source-card-status-0')).toHaveTextContent(
        'reference.source_unlinked',
      );
    });
    fireEvent.drop(screen.getByTestId('essay-body-drop-target'), {
      dataTransfer: {
        types: ['application/x-spoor-essay-source'],
        getData: (type: string) =>
          type === 'application/x-spoor-essay-source' ? 'n1' : '',
      },
    });
    await waitFor(async () => {
      const row = await db.articles.get('a-alpha');
      expect(row?.sourceCards?.[0].inBody).toBe(true);
    });
  });

  it('collapses the linked-notes rail and the chat rail independently', async () => {
    const user = userEvent.setup();
    render(withAppDialogProvider(<EssayFullscreen articleId="a-alpha" onClose={() => {}} />));
    await waitFor(() => {
      expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
    });

    const notesToggle = screen.getByTestId('essay-fullscreen-toggle-rails');
    const chatToggle = screen.getByTestId('essay-fullscreen-toggle-chat');
    const chatPanel = screen.getByTestId('chat-panel');
    expect(notesToggle).toHaveAttribute('aria-expanded', 'true');
    expect(chatToggle).toHaveAttribute('aria-expanded', 'true');
    expect(chatPanel.closest('[aria-hidden="true"]')).toBeNull();

    // 收左栏不该顺手动到对话栏。
    await user.click(notesToggle);
    expect(notesToggle).toHaveAttribute('aria-expanded', 'false');
    expect(chatToggle).toHaveAttribute('aria-expanded', 'true');
    expect(chatPanel.closest('[aria-hidden="true"]')).toBeNull();

    await user.click(notesToggle);
    expect(notesToggle).toHaveAttribute('aria-expanded', 'true');

    // 反过来也一样：收对话栏时便签还开着。
    await user.click(chatToggle);
    expect(chatToggle).toHaveAttribute('aria-expanded', 'false');
    expect(notesToggle).toHaveAttribute('aria-expanded', 'true');
    expect(chatPanel.closest('[aria-hidden="true"]')).not.toBeNull();

    await user.click(chatToggle);
    expect(chatToggle).toHaveAttribute('aria-expanded', 'true');
    expect(chatPanel.closest('[aria-hidden="true"]')).toBeNull();
  });

  it('角色条不会把对话栏的输入框顶出可视区', async () => {
    // ChatPanel 的根是 h-full（按父容器满高算）。它直接和角色条并排的话，满高加上
    // 顶框那一行就溢出了，外层 overflow-hidden 会把底部的输入框裁掉。
    //
    // 修法是给两者之间加一个占剩余高度的壳——但那只在**栏本身是列容器**时成立。
    // 书籍那一栏本来不是：它是外层行里的一个 flex item，靠行拉伸拿到高度，
    // `flex-1` 在里面完全不生效，壳会缩成内容高度，面板就贴到顶上去了。
    // jsdom 量不出高度，所以这里钉的是两条结构不变式。
        render(withAppDialogProvider(<EssayFullscreen articleId="a-alpha" onClose={() => {}} />));
    await screen.findByTestId('surface-persona-controls');
    const rail = screen.getByTestId('surface-persona-strip').parentElement as HTMLElement;
    expect(rail.className).toContain('flex-col');

    const shell = screen.getByTestId('chat-panel').parentElement as HTMLElement;
    expect(shell.className).toContain('flex-1');
    expect(shell.className).toContain('min-h-0');
    expect(shell.parentElement).toBe(rail);
  });


  it('「历史 / 新建」常驻在对话栏顶部那一行的右边，和房间里的人同层', async () => {
    // 它们曾经在顶栏对话按钮的悬停弹层里。现在和对象并排放在同一行，
    // 按钮本身仍由 ChatPanel 拥有，这里只借一个空位。
    render(withAppDialogProvider(<EssayFullscreen articleId="a-alpha" onClose={() => {}} />));
    // 等那一行本身：角色条要等角色库查完才渲染，等对话面板不算数。
    const slot = await screen.findByTestId('surface-persona-controls');

    // 对话栏自己的标题行仍然不留。
    expect(screen.queryByText('reference.essay_chat_title')).toBeNull();
    expect(slot.querySelector('[data-testid="chat-panel-history"]')).not.toBeNull();
    expect(slot.querySelector('[data-testid="chat-panel-new"]')).not.toBeNull();
    // 按钮只有一个去处：既在角色条的空位里，就不能同时留在对话栏自己身上。
    expect(screen.getByTestId('chat-panel').contains(slot)).toBe(false);
    // 顶栏那颗按钮回归成纯粹的开关，弹层整个没了。
    expect(screen.queryByTestId('essay-fullscreen-chat-menu')).toBeNull();
  });

  it('收起的对话栏把角色条和历史/新建一起带出 tab 序', async () => {
    const user = userEvent.setup();
    render(withAppDialogProvider(<EssayFullscreen articleId="a-alpha" onClose={() => {}} />));
    // 等角色条那一行本身：它要等角色库查完才渲染。
    await screen.findByTestId('surface-persona-controls');

    // 角色条是对话栏的直接子元素，所以它的父元素就是那一栏本身。
    const chatRail = screen.getByTestId('surface-persona-strip')
      .parentElement as HTMLElement;
    await user.click(screen.getByTestId('essay-fullscreen-toggle-chat'));
    expect(chatRail).toHaveAttribute('inert');
  });

  it('takes a collapsed rail out of the tab order', async () => {
    const user = userEvent.setup();
    render(withAppDialogProvider(<EssayFullscreen articleId="a-alpha" onClose={() => {}} />));
    // 等角色条那一行本身：它要等角色库查完才渲染。
    await screen.findByTestId('surface-persona-controls');

    const chatToggle = screen.getByTestId('essay-fullscreen-toggle-chat');
    // 角色条是对话栏的直接子元素，所以它的父元素就是那一栏本身。
    const chatRail = screen.getByTestId('surface-persona-strip').parentElement as HTMLElement;
    expect(chatRail).not.toHaveAttribute('inert');

    // aria-hidden 只挡读屏，Tab 照样能走进一条看不见的栏。
    await user.click(chatToggle);
    expect(chatRail).toHaveAttribute('inert');

    await user.click(chatToggle);
    expect(chatRail).not.toHaveAttribute('inert');
  });

  it('names the notes rail in the top bar only, not twice', async () => {
    render(withAppDialogProvider(<EssayFullscreen articleId="a-alpha" onClose={() => {}} />));
    await waitFor(() => {
      expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
    });

    // 「长文」不再是抬头可见的标题；左栏的名字顶到了顶栏上。
    expect(screen.queryByText('nodes.essay')).toBeNull();
    // 只剩顶栏那一处——左栏自己那行标题已经删掉，便签区多出一屏。
    expect(screen.getAllByText('reference.linked_drafts')).toHaveLength(1);
  });

  it('inviting a persona writes the room onto the article, not into panel state', async () => {
    // 名单要跟着这篇文章走：换一篇就该换一个说话的人，关掉全屏再打开也还在。
    const user = userEvent.setup();
    await db.agents.clear();
    await db.agents.add({ id: 'astr', name: '问镜', role: '记者', prompt: 'P' });
    render(withAppDialogProvider(<EssayFullscreen articleId="a-alpha" onClose={() => {}} />));

    await waitFor(() => {
      expect(screen.getByTestId('surface-persona-strip')).toBeInTheDocument();
    });
    await user.click(await screen.findByTestId('canvas-chat-room-add'));
    await user.click(await screen.findByTestId('canvas-chat-room-library-astr'));

    await waitFor(async () => {
      const row = await db.articles.get('a-alpha');
      expect(row?.chatPersonaIds).toEqual(['astr']);
    });
  });

  it('pasting an image stores it as media and never drops the body into the loading state', async () => {
    // 这条是端到端守那条 bug 的：Base64 一旦写进 article.content，
    // articleHasLegacyMedia 就把正文判成待迁移，正文整棵子树被卸载重挂——用户看到
    // 的就是「闪一下重新加载」，而且之后每敲一个字都重来一遍。
    // fake-indexeddb 存回来的 blob 由文件级的 beforeAll 统一处理了。
    render(withAppDialogProvider(<EssayFullscreen articleId="a-alpha" onClose={() => {}} />));
    const prose = await screen.findByTestId('essay-body-editor-prose');
    const before = await db.articles.get('a-alpha');

    const png = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'shot.png', {
      type: 'image/png',
    });
    const items = [{ kind: 'file', type: png.type, getAsFile: () => png }];
    const clipboardData = {
      items,
      files: [png],
      types: ['Files'],
      getData: () => '',
    };
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: clipboardData });
    prose.dispatchEvent(event);

    await waitFor(async () => {
      const row = await db.articles.get('a-alpha');
      expect(row?.media?.length ?? 0).toBe((before?.media?.length ?? 0) + 1);
    });

    const row = await db.articles.get('a-alpha');
    // 存进去的是真字节，不是一段 Base64 文本。（fake-indexeddb 存回来的是结构化克隆的
    // 普通对象，不是真正的 Blob 实例，所以断形状而不是断 instanceof。）
    const stored = row?.media?.[0];
    expect(stored?.mimeType).toBe('image/png');
    expect(stored?.blob).toBeTruthy();
    expect(JSON.stringify(row?.content)).not.toMatch(/data:image\//);
    // 正文从头到尾没进过「迁移中」那一支。
    expect(screen.queryByTestId('essay-fullscreen-loading')).toBeNull();
    expect(screen.getByTestId('essay-body-editor')).toBeInTheDocument();
  });

  it('dropping an image file from the desktop stores it as media like a paste does', async () => {
    // 从桌面/微信拖进来的图必须走和粘贴同一条路：存字节，正文只留 spoor-article-media: 引用。
    render(withAppDialogProvider(<EssayFullscreen articleId="a-alpha" onClose={() => {}} />));
    await screen.findByTestId('essay-body-editor-prose');
    const before = await db.articles.get('a-alpha');

    const png = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'from-desktop.png', {
      type: 'image/png',
    });
    fireEvent.drop(screen.getByTestId('essay-body-drop-target'), {
      dataTransfer: { files: [png], items: [], types: ['Files'], getData: () => '' },
    });

    await waitFor(async () => {
      const row = await db.articles.get('a-alpha');
      expect(row?.media?.length ?? 0).toBe((before?.media?.length ?? 0) + 1);
    });

    const row = await db.articles.get('a-alpha');
    const stored = row?.media?.at(-1);
    expect(stored?.mimeType).toBe('image/png');
    expect(stored?.blob).toBeTruthy();
    expect(row?.content).toContain(`spoor-article-media:${stored?.id}`);
    // 拖放最容易出的岔：Base64 直接进了正文，把整块正文打成待迁移并卸载重挂。
    expect(JSON.stringify(row?.content)).not.toMatch(/data:image\//);
    expect(screen.queryByTestId('essay-fullscreen-loading')).toBeNull();
  });

  it('accepts a file drag over the body so the browser never navigates away', async () => {
    // 不接住这次 dragover，浏览器会把拖进来的文件当页面导航处理——那一屏正文直接没了。
    // fireEvent 在事件被 preventDefault 时返回 false。
    render(withAppDialogProvider(<EssayFullscreen articleId="a-alpha" onClose={() => {}} />));
    await screen.findByTestId('essay-body-editor-prose');
    const notCancelled = fireEvent.dragOver(screen.getByTestId('essay-body-drop-target'), {
      dataTransfer: { files: [], items: [], types: ['Files'], getData: () => '' },
    });
    expect(notCancelled).toBe(false);
  });

  it('disables export while the article is missing', async () => {
    render(withAppDialogProvider(<EssayFullscreen articleId="no-such-article" onClose={() => {}} />));
    await waitFor(() => {
      expect(screen.getByText('nodes.essay_missing')).toBeInTheDocument();
    });
    const menu = screen.getByTestId('essay-export-menu');
    expect(menu).toBeDisabled();
    // 菜单都开不了，里面的「复制全文」自然也够不着。
    expect(screen.queryByTestId('essay-copy-all')).toBeNull();
  });
});

describe('essayUrlTransform', () => {
  it('allows locally uploaded raster data images', () => {
    const data = 'data:image/png;base64,iVBORw0KGgoAAA';
    expect(essayUrlTransform(data)).toBe(data);
  });

  it('rejects executable data and javascript URLs', () => {
    expect(essayUrlTransform('data:text/html;base64,PHNjcmlwdD4=')).toBe('');
    expect(essayUrlTransform('javascript:alert(1)')).toBe('');
  });
});
