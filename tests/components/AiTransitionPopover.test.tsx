import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EditorContent, useEditor } from '@tiptap/react';
import { AiTransitionPopover } from '../../src/components/essay/AiTransitionPopover';
import { createEssayEditorExtensions } from '../../src/utils/essayEditorMarkdown';
import type { Editor } from '@tiptap/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        'reference.editor_adopt': 'Adopt',
        'reference.editor_remove': 'Remove',
        'reference.editor_transition_label': 'AI-added transition',
        'reference.editor_transition_hint': 'AI-added transition',
      };
      return labels[key] ?? key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// Stub getBoundingClientRect — jsdom returns zeros otherwise and our popover's
// positioning logic depends on a non-zero rect.
const REAL_GET_BOUNDING_CLIENT_RECT = Element.prototype.getBoundingClientRect;
beforeEach(() => {
  Element.prototype.getBoundingClientRect = function () {
    return {
      top: 100,
      bottom: 130,
      left: 50,
      right: 200,
      width: 150,
      height: 30,
      x: 50,
      y: 100,
      toJSON: () => ({}),
    } as DOMRect;
  };
});

afterEach(() => {
  Element.prototype.getBoundingClientRect = REAL_GET_BOUNDING_CLIENT_RECT;
  cleanup();
});

/**
 * Mounts a real TipTap editor (with `EditorContent` rendering its DOM into the
 * document) so the popover's positioning logic can find the mark via
 * `view.nodeDOM` and `getBoundingClientRect`.
 */
function HarnessEditor({
  markdown,
  rangeToCapture,
  onReady,
}: {
  markdown: string;
  rangeToCapture: { from: number; to: number };
  onReady: (editor: Editor) => void;
}) {
  const editor = useEditor({
    extensions: createEssayEditorExtensions({ placeholder: '' }),
    content: markdown,
    contentType: 'markdown',
    immediatelyRender: true,
  });
  useEffect(() => {
    if (editor) onReady(editor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);
  return <EditorContent editor={editor} />;
}

function setupEditor(): Promise<{ editor: Editor; range: { from: number; to: number } }> {
  return new Promise((resolve) => {
    const md = 'before <mark data-ai-transition="true">bridge sentence</mark> after';
    let captured: { from: number; to: number } | null = null;
    const handleReady = (editor: Editor) => {
      // Walk the doc once and capture the first aiTransition range.
      const seen: { from: number; to: number } = { from: 0, to: 0 };
      editor.state.doc.descendants((node, pos) => {
        if (captured) return false;
        for (const m of node.marks) {
          if (m.type.name === 'aiTransition') {
            seen.from = pos;
            seen.to = pos + node.nodeSize;
            captured = seen;
            return false;
          }
        }
        return true;
      });
      // Defer to next macrotask so the editor's DOM has rendered.
      setTimeout(() => resolve({ editor, range: captured ?? seen }), 0);
    };
    render(<HarnessEditor markdown={md} rangeToCapture={{ from: 0, to: 0 }} onReady={handleReady} />);
  });
}

describe('AiTransitionPopover', () => {
  it('renders Adopt / Remove buttons once the editor is mounted', async () => {
    const { editor, range } = await setupEditor();
    render(
      <AiTransitionPopover
        editor={editor}
        range={range}
        onAdopt={() => {}}
        onRemove={() => {}}
        onClose={() => {}}
      />,
    );

    expect(await screen.findByRole('button', { name: /adopt/i })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /remove/i })).toBeInTheDocument();

    editor.destroy();
  });

  it('Adopt unsets the mark and invokes onAdopt with the text', async () => {
    const { editor, range } = await setupEditor();
    const onAdopt = vi.fn();
    const onRemove = vi.fn();
    const onClose = vi.fn();

    render(
      <AiTransitionPopover
        editor={editor}
        range={range}
        onAdopt={onAdopt}
        onRemove={onRemove}
        onClose={onClose}
      />,
    );

    const adoptBtn = await screen.findByRole('button', { name: /adopt/i });
    fireEvent.click(adoptBtn);

    expect(onAdopt).toHaveBeenCalledTimes(1);
    expect(onAdopt).toHaveBeenCalledWith('bridge sentence');
    expect(onRemove).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);

    const $pos = editor.state.doc.resolve(range.from);
    expect($pos.marks().some((m) => m.type.name === 'aiTransition')).toBe(false);
    const retained = editor.state.doc.textBetween(range.from, range.to, '\n', '\n');
    expect(retained).toBe('bridge sentence');

    editor.destroy();
  });

  it('Remove deletes the range and invokes onRemove with the text', async () => {
    const { editor, range } = await setupEditor();
    const onAdopt = vi.fn();
    const onRemove = vi.fn();
    const onClose = vi.fn();

    render(
      <AiTransitionPopover
        editor={editor}
        range={range}
        onAdopt={onAdopt}
        onRemove={onRemove}
        onClose={onClose}
      />,
    );

    const removeBtn = await screen.findByRole('button', { name: /remove/i });
    fireEvent.click(removeBtn);

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith('bridge sentence');
    expect(onAdopt).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);

    const fullText = editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n', '\n');
    expect(fullText).not.toContain('bridge');

    editor.destroy();
  });

  it('Escape key closes the popover', async () => {
    const { editor, range } = await setupEditor();
    const onClose = vi.fn();

    render(
      <AiTransitionPopover
        editor={editor}
        range={range}
        onAdopt={() => {}}
        onRemove={() => {}}
        onClose={onClose}
      />,
    );

    await screen.findByRole('dialog');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    editor.destroy();
  });

  it('outside click closes the popover', async () => {
    const { editor, range } = await setupEditor();
    const onClose = vi.fn();

    render(
      <div>
        <button data-testid="outside">outside</button>
        <AiTransitionPopover
          editor={editor}
          range={range}
          onAdopt={() => {}}
          onRemove={() => {}}
          onClose={onClose}
        />
      </div>,
    );

    await screen.findByRole('dialog');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    fireEvent.pointerDown(screen.getByTestId('outside'));
    expect(onClose).toHaveBeenCalledTimes(1);

    editor.destroy();
  });

  it('root has data-ai-transition-popover so EssayBodyEditor focusOut can detect it', async () => {
    const { editor, range } = await setupEditor();
    render(
      <AiTransitionPopover
        editor={editor}
        range={range}
        onAdopt={() => {}}
        onRemove={() => {}}
        onClose={() => {}}
      />,
    );

    const dialog = await screen.findByRole('dialog');
    // React renders the boolean data attribute as "true". EssayBodyEditor's
    // focusOut handler matches via the [data-ai-transition-popover] selector,
    // which matches any present value.
    expect(dialog.hasAttribute('data-ai-transition-popover')).toBe(true);

    editor.destroy();
  });
});
