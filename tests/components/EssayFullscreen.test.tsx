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
    expect(screen.getByTestId('essay-chat-panel')).toBeInTheDocument();
    expect(screen.getByTestId('essay-chat-input')).toBeInTheDocument();

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

  it('copies title and body from the top bar', async () => {
    const user = userEvent.setup();
    render(withAppDialogProvider(<EssayFullscreen articleId="a-alpha" onClose={() => {}} />));
    await waitFor(() => {
      expect(screen.getByTestId('essay-copy-all')).toBeEnabled();
    });
    await user.click(screen.getByTestId('essay-copy-all'));
    await waitFor(() => {
      expect(copyTextToClipboard).toHaveBeenCalledWith('Alpha Unique Title\n\nSome body for alpha');
    });
    expect(screen.getByTestId('essay-copy-all')).toHaveAttribute('aria-label', 'nodes.essay_copy_done');
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

  it('collapses and expands side rails from the header fold control', async () => {
    const user = userEvent.setup();
    render(withAppDialogProvider(<EssayFullscreen articleId="a-alpha" onClose={() => {}} />));
    await waitFor(() => {
      expect(screen.getByTestId('essay-chat-panel')).toBeInTheDocument();
    });

    const toggle = screen.getByTestId('essay-fullscreen-toggle-rails');
    const chatPanel = screen.getByTestId('essay-chat-panel');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(chatPanel.closest('[aria-hidden="true"]')).toBeNull();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(chatPanel.closest('[aria-hidden="true"]')).not.toBeNull();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(chatPanel.closest('[aria-hidden="true"]')).toBeNull();
  });

  it('disables export while the article is missing', async () => {
    render(withAppDialogProvider(<EssayFullscreen articleId="no-such-article" onClose={() => {}} />));
    await waitFor(() => {
      expect(screen.getByText('nodes.essay_missing')).toBeInTheDocument();
    });
    expect(screen.getByTestId('essay-export-menu')).toBeDisabled();
    expect(screen.getByTestId('essay-copy-all')).toBeDisabled();
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
