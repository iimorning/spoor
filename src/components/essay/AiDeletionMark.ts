import { Mark } from '@tiptap/core';

/**
 * TipTap mark for AI-suggested deletions (redundant symbols / duplicate fragments).
 * Round-trips as `<mark data-ai-deletion="true">…</mark>`.
 * Accept deletes the range; reject unsets the mark and keeps the original text.
 */
export const AiDeletionMark = Mark.create({
  name: 'aiDeletion',
  priority: 50,
  inclusive: false,
  exitable: true,
  spanning: false,

  addAttributes() {
    return {
      fid: { default: null },
      tid: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'mark[data-ai-deletion]' }];
  },

  renderHTML() {
    return [
      'mark',
      {
        'data-ai-deletion': 'true',
        class: 'ai-deletion',
        tabindex: '0',
      },
      0,
    ];
  },

  renderMarkdown(node, helpers) {
    return `<mark data-ai-deletion="true">${helpers.renderChildren(node.content ?? [])}</mark>`;
  },

  markdownOptions: {
    htmlReopen: {
      open: '<mark data-ai-deletion="true">',
      close: '</mark>',
    },
  },
});
