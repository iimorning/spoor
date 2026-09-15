import { describe, it, expect, beforeEach, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { EssayBodyEditor, type EssayBodyEditorHandle } from '../../../src/components/essay/EssayBodyEditor';
import { persistEssayEditorBody } from '../../../src/utils/persistEssayEditorBody';
import { db } from '../../../src/db';

// TipTap's prosemirror-view calls getClientRects / getBoundingClientRect on
// Element nodes AND on Range objects for selection-aware scroll/focus paths.
// jsdom returns no layout and Range doesn't expose these at all, so we stub
// them globally to keep the editor interactive in tests.
beforeAll(() => {
  const emptyRect = {
    x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, bottom: 0, right: 0,
    toJSON: () => ({}),
  };

  if (typeof Element.prototype.getClientRects !== 'function') {
    Element.prototype.getClientRects = function () {
      return [] as unknown as DOMRectList;
    };
  }
  if (typeof Element.prototype.getBoundingClientRect !== 'function') {
    Element.prototype.getBoundingClientRect = function () {
      return emptyRect;
    };
  }
  const rangeProto = Range.prototype as unknown as {
    getClientRects?: () => DOMRectList;
    getBoundingClientRect?: () => DOMRect;
  };
  if (typeof rangeProto.getClientRects !== 'function') {
    rangeProto.getClientRects = function () {
      return [] as unknown as DOMRectList;
    };
  }
  if (typeof rangeProto.getBoundingClientRect !== 'function') {
    rangeProto.getBoundingClientRect = function () {
      return emptyRect;
    };
  }

  // prosemirror uses elementFromPoint / caretRangeFromPoint to translate DOM
  // click coordinates into editor positions. jsdom doesn't implement these, so
  // we return nulls: prosemirror will fall back to using the click target
  // element it already knows about.
  if (typeof Document.prototype.elementFromPoint !== 'function') {
    Document.prototype.elementFromPoint = function () {
      return null;
    };
  }
  if (typeof (document as unknown as { caretRangeFromPoint?: unknown }).caretRangeFromPoint !== 'function') {
    (document as unknown as { caretRangeFromPoint: () => unknown }).caretRangeFromPoint = function () {
      return null;
    };
  }
  // Selection.modify / extend / collapse are typical prosemirror requirements.
  if (typeof (Selection.prototype as unknown as { modify?: unknown }).modify !== 'function') {
    (Selection.prototype as unknown as { modify: (...args: unknown[]) => void }).modify = function () {
      return undefined;
    };
  }
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

describe('EssayBodyEditor', () => {
  afterEach(() => {
    localStorage.removeItem('SCRIBE_DISABLE_CONTENT_AUTOSAVE');
  });
  it('does not persist merely because the editor mounted', async () => {
    const onPersist = vi.fn();
    render(
      <EssayBodyEditor
        articleId="a1"
        markdown="## Hello"
        syncKey={0}
        placeholder="reference.empty_body"
        mediaObjectUrls={{}}
        onPersist={onPersist}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('essay-body-editor')).toBeInTheDocument();
    });
    await new Promise((r) => setTimeout(r, 600));
    expect(onPersist).not.toHaveBeenCalled();
  });

  it('typing calls onPersist after the debounce window', async () => {
    const onPersist = vi.fn();
    const user = userEvent.setup();
    render(
      <EssayBodyEditor
        articleId="a1"
        markdown="init"
        syncKey={0}
        placeholder="reference.empty_body"
        mediaObjectUrls={{}}
        onPersist={onPersist}
      />,
    );
    const prose = await screen.findByTestId('essay-body-editor-prose');
    await user.click(prose);
    await user.keyboard('tail');

    await waitFor(() => {
      expect(onPersist).toHaveBeenCalled();
    });
    const lastArg = onPersist.mock.calls.at(-1)?.[0] as string;
    expect(lastArg).toContain('tail');
  });

  it('toolbar bold toggle makes text bold and getMarkdown returns markdown with ** **', async () => {
    const editorRef = React.createRef<EssayBodyEditorHandle>();
    const onPersist = vi.fn();
    const user = userEvent.setup();
    render(
      <EssayBodyEditor
        ref={editorRef}
        articleId="a1"
        markdown=""
        syncKey={0}
        placeholder="reference.empty_body"
        mediaObjectUrls={{}}
        onPersist={onPersist}
      />,
    );
    const prose = await screen.findByTestId('essay-body-editor-prose');
    await user.click(prose);
    await user.keyboard('hello');

    await user.keyboard('{Control>}a{/Control}');
    await waitFor(() => {
      expect(screen.getByTestId('essay-floating-toolbar')).toBeInTheDocument();
    });
    await user.click(screen.getByLabelText('reference.editor_bold'));

    await waitFor(() => {
      const md = editorRef.current?.getMarkdown() ?? '';
      expect(md).toContain('**hello**');
    });
  });

  it('loads and serializes html img tags with explicit dimensions', async () => {
    const editorRef = React.createRef<EssayBodyEditorHandle>();
    render(
      <EssayBodyEditor
        ref={editorRef}
        articleId="a1"
        markdown='<img src="https://example.com/a.png" alt="cover" width="240" height="180" class="rounded-md my-4" />'
        syncKey={0}
        placeholder="reference.empty_body"
        mediaObjectUrls={{}}
        onPersist={vi.fn()}
      />,
    );
    await screen.findByRole('img');
    await waitFor(() => {
      const md = editorRef.current?.getMarkdown() ?? '';
      expect(md).toContain('width="240"');
      expect(md).toContain('height="180"');
      expect(md).toContain('https://example.com/a.png');
    });
  });

  it('insertExcerpt inserts image nodes for markdown image excerpts', async () => {
    const editorRef = React.createRef<EssayBodyEditorHandle>();
    render(
      <EssayBodyEditor
        ref={editorRef}
        articleId="a1"
        markdown="seed paragraph"
        syncKey={0}
        placeholder="reference.empty_body"
        mediaObjectUrls={{}}
        onPersist={vi.fn()}
      />,
    );
    await screen.findByTestId('essay-body-editor-prose');
    editorRef.current?.insertExcerpt('![cover](spoor-article-media:img-1)');
    await waitFor(() => {
      const md = editorRef.current?.getMarkdown() ?? '';
      expect(md).toContain('spoor-article-media:img-1');
      expect(md).toContain('seed paragraph');
    });
  });

  it('insertExcerpt appends markdown into the body', async () => {
    const editorRef = React.createRef<EssayBodyEditorHandle>();
    render(
      <EssayBodyEditor
        ref={editorRef}
        articleId="a1"
        markdown="seed paragraph"
        syncKey={0}
        placeholder="reference.empty_body"
        mediaObjectUrls={{}}
        onPersist={vi.fn()}
      />,
    );
    await screen.findByTestId('essay-body-editor-prose');
    await waitFor(() => {
      expect(editorRef.current?.getMarkdown()).toContain('seed paragraph');
    });
    editorRef.current?.insertExcerpt('### Source\n\nA cited note');
    await waitFor(() => {
      const md = editorRef.current?.getMarkdown() ?? '';
      expect(md).toContain('seed paragraph');
      expect(md).toContain('Source');
      expect(md).toContain('A cited note');
    });
  });

  it('getMarkdown handle returns current content from imperative handle', async () => {
    const editorRef = React.createRef<EssayBodyEditorHandle>();
    const onPersist = vi.fn();
    const user = userEvent.setup();
    render(
      <EssayBodyEditor
        ref={editorRef}
        articleId="a1"
        markdown="seed"
        syncKey={0}
        placeholder="reference.empty_body"
        mediaObjectUrls={{}}
        onPersist={onPersist}
      />,
    );
    await screen.findByTestId('essay-body-editor-prose');
    // Initial markdown propagates to the editor and the handle reflects it.
    expect(editorRef.current?.getMarkdown()).toContain('seed');

    await user.click(screen.getByTestId('essay-body-editor-prose'));
    await user.keyboard(' patch');
    await waitFor(() => {
      expect(editorRef.current?.getMarkdown()).toContain('patch');
    });
  });

  it('syncKey change reloads editor content from the new markdown prop', async () => {
    const editorRef = React.createRef<EssayBodyEditorHandle>();
    const onPersist = vi.fn();
    const { rerender } = render(
      <EssayBodyEditor
        ref={editorRef}
        articleId="a1"
        markdown="old"
        syncKey={0}
        placeholder="reference.empty_body"
        mediaObjectUrls={{}}
        onPersist={onPersist}
      />,
    );
    await screen.findByTestId('essay-body-editor-prose');
    await waitFor(() => {
      expect(editorRef.current?.getMarkdown()).toContain('old');
    });

    rerender(
      <EssayBodyEditor
        ref={editorRef}
        articleId="a1"
        markdown="new-from-sidebar"
        syncKey={1}
        placeholder="reference.empty_body"
        mediaObjectUrls={{}}
        onPersist={onPersist}
      />,
    );
    await waitFor(() => {
      // syncKey bump triggers editor.commands.setContent, which should swap
      // the body back to the latest canonical markdown.
      expect(editorRef.current?.getMarkdown()).toContain('new-from-sidebar');
    });
  });

  it('unmount flushes any pending persisted edits', async () => {
    const onPersist = vi.fn();
    const user = userEvent.setup();
    const { unmount } = render(
      <EssayBodyEditor
        articleId="a1"
        markdown="seed"
        syncKey={0}
        placeholder="reference.empty_body"
        mediaObjectUrls={{}}
        onPersist={onPersist}
      />,
    );
    const prose = await screen.findByTestId('essay-body-editor-prose');
    await user.click(prose);
    await user.keyboard(' +append');
    // Tear down before the 450ms debounce can fire; flushPersist runs on unmount.
    unmount();
    expect(onPersist).toHaveBeenCalled();
    const lastArg = onPersist.mock.calls.at(-1)?.[0] as string;
    expect(lastArg).toContain('append');
  });

  it('shows original and proposed placeholders and Apply keeps the new text', async () => {
    const editorRef = React.createRef<EssayBodyEditorHandle>();
    const onPersist = vi.fn();
    const wrapped =
      'Lead <span data-ai-essay-edit="true"><del data-original="true">old phrase</del><span data-proposed="true">new phrase</span></span> tail';
    const user = userEvent.setup();
    render(
      <EssayBodyEditor
        ref={editorRef}
        articleId="a1"
        markdown={wrapped}
        syncKey={0}
        placeholder="reference.empty_body"
        mediaObjectUrls={{}}
        onPersist={onPersist}
      />,
    );
    const apply = await screen.findByTestId('essay-ai-edit-apply');
    expect(screen.getByTestId('essay-ai-edit')).toHaveTextContent('old phrase');
    expect(screen.getByTestId('essay-ai-edit')).toHaveTextContent('new phrase');
    await user.click(apply);
    await waitFor(() => {
      const md = editorRef.current?.getMarkdown() ?? '';
      expect(md).toContain('new phrase');
      expect(md).not.toContain('old phrase');
      expect(md).not.toContain('data-ai-essay-edit');
    });
  });

  it('Reject on a placeholder restores the original text', async () => {
    const editorRef = React.createRef<EssayBodyEditorHandle>();
    const wrapped =
      'Lead <span data-ai-essay-edit="true"><del data-original="true">old phrase</del><span data-proposed="true">new phrase</span></span> tail';
    const user = userEvent.setup();
    render(
      <EssayBodyEditor
        ref={editorRef}
        articleId="a1"
        markdown={wrapped}
        syncKey={0}
        placeholder="reference.empty_body"
        mediaObjectUrls={{}}
        onPersist={vi.fn()}
      />,
    );
    await user.click(await screen.findByTestId('essay-ai-edit-reject'));
    await waitFor(() => {
      const md = editorRef.current?.getMarkdown() ?? '';
      expect(md).toContain('old phrase');
      expect(md).not.toContain('new phrase');
    });
  });

  it('puts Apply / Reject beside an AI deletion mark, not only in the toolbar', async () => {
    const editorRef = React.createRef<EssayBodyEditorHandle>();
    const user = userEvent.setup();
    render(
      <EssayBodyEditor
        ref={editorRef}
        articleId="a1"
        markdown={'keep <mark data-ai-deletion="true">struck</mark> after'}
        syncKey={0}
        placeholder="reference.empty_body"
        mediaObjectUrls={{}}
        onPersist={vi.fn()}
      />,
    );
    const apply = await screen.findByTestId('essay-suggestion-apply');
    expect(apply.closest('[data-testid="essay-suggestion-actions"]')).toBeTruthy();
    await user.click(apply);
    await waitFor(() => {
      const md = editorRef.current?.getMarkdown() ?? '';
      expect(md).not.toContain('struck');
      expect(md).toContain('keep');
      expect(md).toContain('after');
    });
  });
});

describe('persistEssayEditorBody', () => {
  beforeEach(async () => {
    await db.articles.clear();
    await db.articles.add({
      id: 'a1',
      title: 'T',
      content: 'leftover',
      date: '2026',
      type: 'GEN',
      tags: [],
      sourceCards: [{ nodeId: 'n1', canvasId: 'c1', kind: 'note', title: 'A', segmentText: '段正文' }],
    });
  });

  it('marks content as canonical', async () => {
    await persistEssayEditorBody('a1', '手改正文');
    const row = await db.articles.get('a1');
    expect(row?.content).toBe('手改正文');
    expect(row?.contentDrivesBody).toBe(true);
    expect(row?.sourceCards?.[0].segmentText).toBe('段正文');
  });
});
