import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import Image from '@tiptap/extension-image';
import {
  EditorContent,
  ReactNodeViewRenderer,
  useEditor,
  useEditorState,
  type Editor,
} from '@tiptap/react';
import {
  Bold,
  CheckCheck,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  X,
} from 'lucide-react';
import { isContentBlurPersistenceDisabled } from '../../config/persistence';
import {
  createEssayEditorExtensions,
  ESSAY_IMAGE_HTML_CLASS,
  normalizeEssayMarkdown,
} from '../../utils/essayEditorMarkdown';
import { ESSAY_BODY_PERSIST_MS } from '../../utils/persistEssayEditorBody';
import { EssayImageView } from './EssayImageView';
import { EssayMediaUrlsContext } from './essayMediaUrlsContext';
import { AiTransitionPopover } from './AiTransitionPopover';
import { AiEssayEditView, settleAiEssayEdit } from './AiEssayEditView';
import { AiEssayEditNode } from './AiEssayEditNode';
import { applyEssayChatEdits, type EssayChatEdit } from '../../utils/essayChatEdits';
import { collectMarkRanges } from './aiSuggestionRanges';
import { resolveEssayEditorDrop, type EssayDropCaret } from '../../utils/essayEditorDrop';
import { computeEssayEditorToolbarPos } from '../../utils/textSelectionToolbarPos';
import './essayAiTransition.css';

const ESSAY_FLOATING_TOOLBAR_WIDTH = 220;
const ESSAY_FLOATING_TOOLBAR_HEIGHT = 40;

export interface EssayBodyEditorHandle {
  getMarkdown: () => string;
  getSelectedText: () => string;
  applyChatEdits: (
    edits: EssayChatEdit[],
    options?: { replaceDocument?: boolean },
  ) => { applied: number; missed: string[] };
  /** Insert markdown at the caret, drop point, or after a short break. */
  insertExcerpt: (markdown: string, at?: { clientX: number; clientY: number }) => void;
  /** Show an insertion caret while dragging over the editor. */
  previewDropAt: (clientX: number, clientY: number) => boolean;
  clearDropPreview: () => void;
}

export interface EssayBodyEditorProps {
  articleId: string;
  markdown: string;
  /** Bump when the body changed outside the editor (sidebar section edit/reorder/delete). */
  syncKey: number;
  placeholder: string;
  mediaObjectUrls: Record<string, string>;
  onPersist: (markdown: string) => void;
  /** Skip autosave while the article is still being generated. */
  disablePersist?: boolean;
  /** Called when the user adopts an AI-added transition (mark removed, text retained). */
  onTransitionAdopted?: (text: string) => void;
  /** Called when the user removes an AI-added transition (text deleted). */
  onTransitionRemoved?: (text: string) => void;
  /** Called when the user accepts an AI deletion (text deleted). */
  onDeletionAdopted?: (text: string) => void;
  /** Called when the user rejects an AI deletion (text kept). */
  onDeletionRejected?: (text: string) => void;
  /** Live quote for the chat composer. Empty string when the caret collapses while the editor is focused. */
  onChatSelectionChange?: (text: string) => void;
}

function collectEssayEditNodes(instance: Editor): { pos: number; size: number; original: string; proposed: string }[] {
  const raw: { pos: number; size: number; original: string; proposed: string }[] = [];
  instance.state.doc.descendants((node, pos) => {
    if (node.type.name === 'aiEssayEdit') {
      raw.push({
        pos,
        size: node.nodeSize,
        original: String(node.attrs.original ?? ''),
        proposed: String(node.attrs.proposed ?? ''),
      });
    }
    return true;
  });
  return raw.sort((a, b) => b.pos - a.pos);
}

function applyAllSuggestions(instance: Editor, mode: 'accept' | 'reject') {
  for (const node of collectEssayEditNodes(instance)) {
    const text = mode === 'accept' ? node.proposed : node.original;
    settleAiEssayEdit(instance, node.pos, node.size, text);
  }
  const suggestions = [
    ...collectMarkRanges(instance, 'aiTransition').map((r) => ({ ...r, kind: 'insert' as const })),
    ...collectMarkRanges(instance, 'aiDeletion').map((r) => ({ ...r, kind: 'delete' as const })),
  ].sort((a, b) => b.from - a.from);
  if (suggestions.length === 0) return;
  const chain = instance.chain().focus();
  for (const r of suggestions) {
    if (mode === 'accept') {
      if (r.kind === 'delete') chain.deleteRange({ from: r.from, to: r.to });
      else chain.setTextSelection({ from: r.from, to: r.to }).unsetMark('aiTransition');
    } else if (r.kind === 'insert') {
      chain.deleteRange({ from: r.from, to: r.to });
    } else {
      chain.setTextSelection({ from: r.from, to: r.to }).unsetMark('aiDeletion');
    }
  }
  chain.run();
}

function ToolbarButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-[#5a5a54] transition-colors disabled:opacity-30 ${
        active ? 'bg-[#FFF7ED] text-[#C2410C]' : 'hover:bg-[#EAE7E2] hover:text-[#1a1a1a]'
      }`}
    >
      {children}
    </button>
  );
}

export const EssayBodyEditor = React.forwardRef<EssayBodyEditorHandle, EssayBodyEditorProps>(
  function EssayBodyEditor(
    {
      articleId,
      markdown,
      syncKey,
      placeholder,
      mediaObjectUrls,
      onPersist,
      disablePersist = false,
      onTransitionAdopted,
      onTransitionRemoved,
      onDeletionAdopted,
      onDeletionRejected,
      onChatSelectionChange,
    },
    ref,
  ) {
  const { t } = useTranslation();
  const skipPersistRef = useRef(true);
  const dirtyRef = useRef(false);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPersistRef = useRef(onPersist);
  onPersistRef.current = onPersist;
  const onTransitionAdoptedRef = useRef(onTransitionAdopted);
  onTransitionAdoptedRef.current = onTransitionAdopted;
  const onTransitionRemovedRef = useRef(onTransitionRemoved);
  onTransitionRemovedRef.current = onTransitionRemoved;
  const onDeletionAdoptedRef = useRef(onDeletionAdopted);
  onDeletionAdoptedRef.current = onDeletionAdopted;
  const onDeletionRejectedRef = useRef(onDeletionRejected);
  onDeletionRejectedRef.current = onDeletionRejected;
  const onChatSelectionChangeRef = useRef(onChatSelectionChange);
  onChatSelectionChangeRef.current = onChatSelectionChange;
  const markdownRef = useRef(markdown);
  markdownRef.current = markdown;
  const editorRef = useRef<Editor | null>(null);
  const lastHoverMarkRef = useRef<HTMLElement | null>(null);
  const [activeSuggestion, setActiveSuggestion] =
    useState<{ from: number; to: number; kind: 'insert' | 'delete' } | null>(null);
  const closeTransitionPopoverRef = useRef<(() => void) | null>(null);
  const floatingToolbarRef = useRef<HTMLDivElement>(null);
  const floatingToolbarArmedRef = useRef(false);
  const [selectionToolbarPos, setSelectionToolbarPos] = useState<{ top: number; left: number } | null>(
    null,
  );
  const [dropCaret, setDropCaret] = useState<EssayDropCaret | null>(null);
  const dropPosRef = useRef<number | null>(null);

  const refreshSelectionToolbar = useCallback((instance: Editor) => {
    if (floatingToolbarArmedRef.current || floatingToolbarRef.current?.matches(':hover')) {
      return;
    }
    const pos = computeEssayEditorToolbarPos(
      instance,
      ESSAY_FLOATING_TOOLBAR_WIDTH,
      ESSAY_FLOATING_TOOLBAR_HEIGHT,
    );
    setSelectionToolbarPos(pos);
  }, []);

  const imageExtension = useMemo(
    () =>
      Image.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            width: {
              default: null,
              parseHTML: (element) => {
                const raw =
                  element.getAttribute('width') ||
                  (element as HTMLElement).style.width;
                if (!raw) return null;
                const parsed = parseInt(String(raw).replace(/px$/i, ''), 10);
                return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
              },
              renderHTML: (attributes) =>
                attributes.width ? { width: attributes.width } : {},
            },
            height: {
              default: null,
              parseHTML: (element) => {
                const raw =
                  element.getAttribute('height') ||
                  (element as HTMLElement).style.height;
                if (!raw) return null;
                const parsed = parseInt(String(raw).replace(/px$/i, ''), 10);
                return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
              },
              renderHTML: (attributes) =>
                attributes.height ? { height: attributes.height } : {},
            },
          };
        },
        renderMarkdown(node) {
          const attrs = node.attrs ?? {};
          const src = String(attrs.src ?? '');
          const alt = String(attrs.alt ?? '');
          const title = String(attrs.title ?? '');
          const width = attrs.width;
          const height = attrs.height;
          if (width || height) {
            const parts = [
              `src="${src}"`,
              alt ? `alt="${alt}"` : '',
              width ? `width="${width}"` : '',
              height ? `height="${height}"` : '',
              'class="rounded-md my-4"',
            ].filter(Boolean);
            return `<img ${parts.join(' ')} />`;
          }
          return title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`;
        },
        addNodeView() {
          return ReactNodeViewRenderer(EssayImageView);
        },
      }).configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: { class: ESSAY_IMAGE_HTML_CLASS },
      }),
    [],
  );

  const essayEditExtension = useMemo(
    () =>
      AiEssayEditNode.extend({
        addNodeView() {
          return ReactNodeViewRenderer(AiEssayEditView);
        },
      }),
    [],
  );

  const extensions = useMemo(
    () =>
      createEssayEditorExtensions({
        placeholder,
        imageExtension,
        aiEssayEditExtension: essayEditExtension,
      }),
    [placeholder, imageExtension, essayEditExtension],
  );

  const flushPersist = (editorMarkdown: string) => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    if (!dirtyRef.current) return;
    if (isContentBlurPersistenceDisabled()) return;
    dirtyRef.current = false;
    onPersistRef.current(normalizeEssayMarkdown(editorMarkdown));
  };

  const editor = useEditor(
    {
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      extensions,
      content: markdown,
      contentType: 'markdown',
      editable: !disablePersist,
      editorProps: {
        attributes: {
          class: 'markdown-body essay-body-editor-prose min-h-[8rem] focus:outline-none',
          'data-testid': 'essay-body-editor-prose',
        },
      },
      onCreate: ({ editor: instance }) => {
        skipPersistRef.current = false;
        instance.storage.aiSuggestionActions = {
          applyLabel: t('reference.editor_apply_edit'),
          rejectLabel: t('reference.editor_reject_edit'),
          onInsertAdopt: (text: string) => onTransitionAdoptedRef.current?.(text),
          onInsertRemove: (text: string) => onTransitionRemovedRef.current?.(text),
          onDeleteAdopt: (text: string) => onDeletionAdoptedRef.current?.(text),
          onDeleteReject: (text: string) => onDeletionRejectedRef.current?.(text),
        };
        instance.view.dispatch(instance.state.tr.setMeta('aiSuggestionActions', true));
      },
      onSelectionUpdate: ({ editor: instance }) => {
        const { from, to } = instance.state.selection;
        if (from === to) {
          if (instance.isFocused) onChatSelectionChangeRef.current?.('');
          setSelectionToolbarPos(null);
          return;
        }
        const text = instance.state.doc.textBetween(from, to, '\n', '\n').trim();
        onChatSelectionChangeRef.current?.(text);
        refreshSelectionToolbar(instance);
      },
      onUpdate: ({ editor: instance, transaction }) => {
        if (!transaction.docChanged) return;
        if (skipPersistRef.current) return;
        if (disablePersist) return;
        dirtyRef.current = true;
        if (isContentBlurPersistenceDisabled()) return;
        if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
        persistTimerRef.current = setTimeout(() => {
          persistTimerRef.current = null;
          flushPersist(instance.getMarkdown());
        }, ESSAY_BODY_PERSIST_MS);
      },
      onBlur: ({ editor: instance }) => {
        if (
          !floatingToolbarArmedRef.current &&
          !floatingToolbarRef.current?.matches(':hover')
        ) {
          setSelectionToolbarPos(null);
        }
        if (skipPersistRef.current) return;
        if (disablePersist) return;
        flushPersist(instance.getMarkdown());
      },
    },
    [articleId, extensions, disablePersist, refreshSelectionToolbar],
  );

  editorRef.current = editor;

  useEffect(() => {
    if (!selectionToolbarPos) return;
    const onScroll = () => {
      const instance = editorRef.current;
      if (instance) refreshSelectionToolbar(instance);
    };
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [selectionToolbarPos, refreshSelectionToolbar]);

  useLayoutEffect(() => {
    if (!selectionToolbarPos) return;
    const instance = editorRef.current;
    const bar = floatingToolbarRef.current;
    if (!instance || !bar) return;
    const next = computeEssayEditorToolbarPos(
      instance,
      bar.offsetWidth,
      ESSAY_FLOATING_TOOLBAR_HEIGHT,
    );
    if (!next) return;
    if (next.top !== selectionToolbarPos.top || next.left !== selectionToolbarPos.left) {
      setSelectionToolbarPos(next);
    }
  }, [selectionToolbarPos]);

  const clearDropPreview = useCallback(() => {
    dropPosRef.current = null;
    setDropCaret(null);
  }, []);

  useEffect(() => {
    if (!dropCaret || dropPosRef.current == null) return;
    const refresh = () => {
      const instance = editorRef.current;
      const pos = dropPosRef.current;
      if (!instance || pos == null) return;
      const coords = instance.view.coordsAtPos(pos);
      setDropCaret({
        left: coords.left,
        top: coords.top,
        height: Math.max(16, coords.bottom - coords.top),
      });
    };
    window.addEventListener('scroll', refresh, true);
    return () => window.removeEventListener('scroll', refresh, true);
  }, [dropCaret]);

  React.useImperativeHandle(ref, () => ({
    getMarkdown: () => {
      const instance = editorRef.current;
      if (!instance) return normalizeEssayMarkdown(markdownRef.current);
      return normalizeEssayMarkdown(instance.getMarkdown());
    },
    getSelectedText: () => {
      const instance = editorRef.current;
      if (!instance) return '';
      const { from, to } = instance.state.selection;
      if (from === to) return '';
      return instance.state.doc.textBetween(from, to, '\n', '\n').trim();
    },
    applyChatEdits: (edits, options) => {
      const instance = editorRef.current;
      const current = instance
        ? normalizeEssayMarkdown(instance.getMarkdown())
        : normalizeEssayMarkdown(markdownRef.current);
      const result = applyEssayChatEdits(current, edits, options);
      if (result.applied === 0 || result.markdown === current) return result;
      if (instance) {
        skipPersistRef.current = true;
        instance.commands.setContent(result.markdown, { contentType: 'markdown' });
        skipPersistRef.current = false;
        dirtyRef.current = true;
        flushPersist(result.markdown);
      }
      return result;
    },
    previewDropAt: (clientX, clientY) => {
      const instance = editorRef.current;
      if (!instance) {
        clearDropPreview();
        return false;
      }
      const resolved = resolveEssayEditorDrop(instance, clientX, clientY);
      if (!resolved) {
        clearDropPreview();
        return false;
      }
      dropPosRef.current = resolved.pos;
      setDropCaret(resolved.caret);
      return true;
    },
    clearDropPreview,
    insertExcerpt: (markdown, at) => {
      const chunk = (markdown ?? '').trim();
      if (!chunk) return;
      const instance = editorRef.current;
      if (!instance) return;
      const resolved = at ? resolveEssayEditorDrop(instance, at.clientX, at.clientY) : null;
      const insertPos = resolved?.pos ?? dropPosRef.current ?? null;
      const imageLead = /^!\[([^\]]*)\]\(([^)\s]+)\)/.exec(chunk);
      skipPersistRef.current = true;
      let cmd = instance.chain().focus();
      if (insertPos != null) cmd = cmd.setTextSelection(insertPos);
      if (imageLead) {
        const rest = chunk.slice(imageLead[0].length).trim();
        cmd.insertContent({ type: 'image', attrs: { src: imageLead[2], alt: imageLead[1] } }).run();
        if (rest) {
          instance.chain().focus().insertContent(`\n\n${rest}`, { contentType: 'markdown' }).run();
        }
      } else {
        const atPos = insertPos ?? instance.state.selection.from;
        const prev =
          atPos > 0 ? instance.state.doc.textBetween(Math.max(0, atPos - 1), atPos) : '';
        const needsBreak = atPos > 1 && prev !== '\n';
        const payload = needsBreak ? `\n\n${chunk}` : chunk;
        cmd.insertContent(payload, { contentType: 'markdown' }).run();
      }
      skipPersistRef.current = false;
      dirtyRef.current = true;
      clearDropPreview();
      flushPersist(instance.getMarkdown());
    },
  }));

  useEffect(() => {
    return () => {
      const instance = editorRef.current;
      if (instance && dirtyRef.current) {
        flushPersist(instance.getMarkdown());
      } else if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
    // Flush pending user edits when the editor unmounts (fullscreen close).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount-only
  }, []);

  useEffect(() => {
    if (!editor) return;
    skipPersistRef.current = true;
    dirtyRef.current = false;
    editor.commands.setContent(markdownRef.current, { contentType: 'markdown' });
    skipPersistRef.current = false;
  }, [articleId, syncKey, editor]);

  const toolbar = useEditorState({
    editor,
    selector: ({ editor: instance }) => {
      if (!instance) {
        return {
          bold: false,
          italic: false,
          h1: false,
          h2: false,
          h3: false,
          bullet: false,
          ordered: false,
          hasSuggestions: false,
        };
      }
      return {
        bold: instance.isActive('bold'),
        italic: instance.isActive('italic'),
        h1: instance.isActive('heading', { level: 1 }),
        h2: instance.isActive('heading', { level: 2 }),
        h3: instance.isActive('heading', { level: 3 }),
        bullet: instance.isActive('bulletList'),
        ordered: instance.isActive('orderedList'),
        hasSuggestions:
          collectMarkRanges(instance, 'aiTransition').length > 0 ||
          collectMarkRanges(instance, 'aiDeletion').length > 0 ||
          collectEssayEditNodes(instance).length > 0,
      };
    },
  });

  // Resolve the mark range that wraps `markEl` by walking back/forward through
  // the editor document. Returns null when the mark has been deleted mid-flight
  // (e.g. Adopt already ran on it).
  const resolveMarkRange = (
    instance: Editor,
    markEl: HTMLElement,
    markName: 'aiTransition' | 'aiDeletion',
  ): { from: number; to: number } | null => {
    try {
      const view = instance.view;
      const range = document.createRange();
      range.selectNodeContents(markEl);
      const from = view.posAtDOM(range.startContainer, range.startOffset);
      const to = view.posAtDOM(range.endContainer, range.endOffset);
      if (from == null || to == null || to <= from) return null;
      // Verify the position still has the mark — defensive in case the doc
      // changed between hover-enter and our handler.
      const $from = instance.state.doc.resolve(from);
      const hasMark = $from.marks().some((m) => m.type.name === markName);
      if (!hasMark) return null;
      return { from, to };
    } catch {
      return null;
    }
  };

  // Hover/focus detection on the editor content. Cache the last hovered mark
  // element so we don't re-resolve ranges on every pixel of mousemove.
  const handleEditorHover = (event: React.MouseEvent<HTMLDivElement>) => {
    const instance = editorRef.current;
    if (!instance) return;
    // Suppress while the user has a non-collapsed selection — TextSelectionToolbar
    // owns the floating UI then.
    const { from, to } = instance.state.selection;
    if (from !== to) {
      if (activeSuggestion) setActiveSuggestion(null);
      return;
    }
    const target = event.target as HTMLElement | null;
    const markEl = target?.closest(
      'mark[data-ai-transition], mark[data-ai-deletion]',
    ) as HTMLElement | null;
    if (markEl === lastHoverMarkRef.current) return;
    lastHoverMarkRef.current = markEl;
    if (!markEl) {
      setActiveSuggestion(null);
      return;
    }
    const kind: 'insert' | 'delete' =
      markEl.dataset.aiDeletion !== undefined ? 'delete' : 'insert';
    const range = resolveMarkRange(
      instance,
      markEl,
      kind === 'delete' ? 'aiDeletion' : 'aiTransition',
    );
    setActiveSuggestion(range ? { ...range, kind } : null);
  };

  const handleEditorLeave = () => {
    lastHoverMarkRef.current = null;
    setActiveSuggestion(null);
  };

  const handleEditorFocusIn = (event: React.FocusEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    const markEl = target?.closest(
      'mark[data-ai-transition], mark[data-ai-deletion]',
    ) as HTMLElement | null;
    if (!markEl) return;
    const instance = editorRef.current;
    if (!instance) return;
    const kind: 'insert' | 'delete' =
      markEl.dataset.aiDeletion !== undefined ? 'delete' : 'insert';
    const range = resolveMarkRange(
      instance,
      markEl,
      kind === 'delete' ? 'aiDeletion' : 'aiTransition',
    );
    if (range) setActiveSuggestion({ ...range, kind });
  };

  const handleEditorFocusOut = (event: React.FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as HTMLElement | null;
    // If focus is moving to the popover itself, keep it open.
    if (next && next.closest('[data-ai-transition-popover]')) return;
    if (
      !next ||
      !next.closest('mark[data-ai-transition], mark[data-ai-deletion]')
    ) {
      setActiveSuggestion(null);
    }
  };

  const closeTransitionPopover = () => {
    setActiveSuggestion(null);
    lastHoverMarkRef.current = null;
  };

  // Keep the close-callback ref fresh so AiTransitionPopover's effects see the
  // latest closure.
  closeTransitionPopoverRef.current = closeTransitionPopover;

  const toolbarEl = selectionToolbarPos ? (
        <div
          ref={floatingToolbarRef}
          role="toolbar"
          aria-label={t('reference.editor_toolbar')}
          data-testid="essay-floating-toolbar"
          className="fixed z-[132] inline-flex w-max max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-nowrap items-center gap-0.5 overflow-x-auto rounded-lg border border-[#E6E4DF] bg-white/95 p-1 shadow-md backdrop-blur-sm"
          style={{ top: selectionToolbarPos.top, left: selectionToolbarPos.left }}
          onPointerDown={(e) => {
            e.stopPropagation();
            floatingToolbarArmedRef.current = true;
          }}
          onPointerUp={() => {
            floatingToolbarArmedRef.current = false;
          }}
          onPointerCancel={() => {
            floatingToolbarArmedRef.current = false;
          }}
        >
          <ToolbarButton
            label={t('reference.editor_h1')}
            active={toolbar?.h1}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
          >
            <Heading1 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label={t('reference.editor_h2')}
            active={toolbar?.h2}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            <Heading2 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label={t('reference.editor_h3')}
            active={toolbar?.h3}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
          >
            <Heading3 className="h-4 w-4" />
          </ToolbarButton>
          <span className="mx-1 h-5 w-px bg-[#E6E4DF]" aria-hidden />
          <ToolbarButton
            label={t('reference.editor_bold')}
            active={toolbar?.bold}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            <Bold className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label={t('reference.editor_italic')}
            active={toolbar?.italic}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          >
            <Italic className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label={t('reference.editor_bullet_list')}
            active={toolbar?.bullet}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            <List className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label={t('reference.editor_ordered_list')}
            active={toolbar?.ordered}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered className="h-4 w-4" />
          </ToolbarButton>
          {toolbar?.hasSuggestions ? (
            <>
              <span className="mx-1 h-5 w-px bg-[#E6E4DF]" aria-hidden />
              <button
                type="button"
                title={t('reference.editor_accept_all')}
                aria-label={t('reference.editor_accept_all')}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (!editor) return;
                  applyAllSuggestions(editor, 'accept');
                }}
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-semibold text-[#C2410C] hover:bg-[#FFF7ED]"
              >
                <CheckCheck className="h-4 w-4" />
                {t('reference.editor_accept_all')}
              </button>
              <button
                type="button"
                title={t('reference.editor_reject_all')}
                aria-label={t('reference.editor_reject_all')}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (!editor) return;
                  applyAllSuggestions(editor, 'reject');
                }}
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-semibold text-[#5a5a54] hover:bg-[#EAE7E2]"
              >
                <X className="h-4 w-4" />
                {t('reference.editor_reject_all')}
              </button>
            </>
          ) : null}
        </div>
  ) : null;

  return (
    <EssayMediaUrlsContext.Provider value={mediaObjectUrls}>
      <div data-testid="essay-body-editor" className="essay-body-editor">
        {toolbarEl ? createPortal(toolbarEl, document.body) : null}
        {dropCaret
          ? createPortal(
              <div
                aria-hidden
                data-testid="essay-drop-caret"
                className="pointer-events-none fixed z-[131] w-0.5 rounded-full bg-[#C2410C] shadow-[0_0_0_1px_rgba(255,255,255,0.85)]"
                style={{
                  left: dropCaret.left,
                  top: dropCaret.top,
                  height: dropCaret.height,
                }}
              />,
              document.body,
            )
          : null}
        <div
          onMouseMove={handleEditorHover}
          onMouseLeave={handleEditorLeave}
          onFocus={handleEditorFocusIn}
          onBlur={handleEditorFocusOut}
          className="rounded-md"
        >
          <EditorContent editor={editor} />
        </div>
        {editor && activeSuggestion && (
          <AiTransitionPopover
            editor={editor}
            range={{ from: activeSuggestion.from, to: activeSuggestion.to }}
            kind={activeSuggestion.kind}
            onAdopt={(text) => {
              if (activeSuggestion.kind === 'delete') onDeletionAdoptedRef.current?.(text);
              else onTransitionAdoptedRef.current?.(text);
            }}
            onRemove={(text) => {
              if (activeSuggestion.kind === 'delete') onDeletionRejectedRef.current?.(text);
              else onTransitionRemovedRef.current?.(text);
            }}
            onClose={closeTransitionPopover}
          />
        )}
      </div>
    </EssayMediaUrlsContext.Provider>
  );
});
