import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { AiDeletionMark } from '../components/essay/AiDeletionMark';
import { AiEssayEditNode } from '../components/essay/AiEssayEditNode';
import { AiSuggestionActions } from '../components/essay/AiSuggestionActions';
import { AiTransitionMark } from '../components/essay/AiTransitionMark';

export const ESSAY_IMAGE_HTML_CLASS = 'max-w-full h-auto rounded-md my-4';

export function normalizeEssayMarkdown(markdown: string): string {
  return (markdown ?? '').replace(/ /g, ' ').trim();
}

export function createEssayEditorExtensions(options?: {
  placeholder?: string;
  imageExtension?: ReturnType<typeof Image.extend> | typeof Image;
  aiEssayEditExtension?: ReturnType<typeof AiEssayEditNode.extend> | typeof AiEssayEditNode;
  /**
   * Whether to register AI suggestion marks (transitions + deletions).
   * Defaults to true. Set false in tests or for essays that pre-date the feature.
   */
  aiTransition?: boolean;
}) {
  const includeAiTransition = options?.aiTransition ?? true;
  const essayEdit = options?.aiEssayEditExtension ?? AiEssayEditNode;
  return [
    // Suggestion marks must come first so `priority: 50` registers ahead of
    // StarterKit's defaults (which sit at 1000); this lets them wrap other marks
    // when serialized.
    ...(includeAiTransition
      ? [essayEdit, AiTransitionMark, AiDeletionMark, AiSuggestionActions]
      : []),
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https',
      },
    }),
    Markdown.configure({
      markedOptions: {
        gfm: true,
        breaks: true,
      },
    }),
    options?.imageExtension ??
      Image.configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: { class: ESSAY_IMAGE_HTML_CLASS },
      }),
    Placeholder.configure({
      placeholder: options?.placeholder ?? '',
    }),
  ];
}

export function createHeadlessEssayEditor(markdown: string, placeholder = ''): Editor {
  return new Editor({
    extensions: createEssayEditorExtensions({ placeholder }),
    content: markdown,
    contentType: 'markdown',
  });
}
