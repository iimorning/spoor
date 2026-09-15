import { Node, mergeAttributes } from '@tiptap/core';
import { escapeEssayChatHtml } from '../../utils/essayChatEdits';

export type AiEssayEditAttrs = {
  original: string;
  proposed: string;
};

/**
 * Inline atom so it can sit inside a paragraph. Round-trips as
 * `<span data-ai-essay-edit>…</span>`. Apply / Reject live in the React node view.
 */
export const AiEssayEditNode = Node.create({
  name: 'aiEssayEdit',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      original: { default: '' },
      proposed: { default: '' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-ai-essay-edit]',
        getAttrs: (el) => parseEditEl(el),
      },
      {
        tag: 'div[data-ai-essay-edit]',
        getAttrs: (el) => parseEditEl(el),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const original = String(node.attrs.original ?? '');
    const proposed = String(node.attrs.proposed ?? '');
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-ai-essay-edit': 'true',
        class: 'ai-essay-edit',
      }),
      ['del', { 'data-original': 'true', class: 'ai-essay-edit-original' }, original],
      ['span', { 'data-proposed': 'true', class: 'ai-essay-edit-proposed' }, proposed],
    ];
  },

  renderMarkdown(node) {
    const original = escapeEssayChatHtml(String(node.attrs.original ?? ''));
    const proposed = escapeEssayChatHtml(String(node.attrs.proposed ?? ''));
    return (
      `<span data-ai-essay-edit="true">` +
      `<del data-original="true">${original}</del>` +
      `<span data-proposed="true">${proposed}</span>` +
      `</span>`
    );
  },
});

function parseEditEl(el: unknown): { original: string; proposed: string } | false {
  if (!(el instanceof HTMLElement)) return false;
  const original =
    el.querySelector('[data-original]')?.textContent ?? el.getAttribute('data-original') ?? '';
  const proposed =
    el.querySelector('[data-proposed]')?.textContent ?? el.getAttribute('data-proposed') ?? '';
  return { original, proposed };
}
