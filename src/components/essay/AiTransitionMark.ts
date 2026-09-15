import { Mark } from '@tiptap/core';

/**
 * Custom TipTap Mark for AI-added transition sentences in the essay editor.
 *
 * Round-trip:
 * - Generator wraps transitions as `<mark data-ai-transition="true">...</mark>` in the
 *   article body markdown (see parsePublishArticleResponse.assemblePublishBody).
 * - This mark recognizes that HTML via `parseHTML`, serializes back to it via
 *   `renderMarkdown`, and survives `editor.getMarkdown()` round-trips.
 * - On "采用" the editor removes the mark (text becomes plain body); on "删掉" the
 *   editor deletes the range.
 *
 * Invariants:
 * - `inclusive: false` so typing at the boundary doesn't extend the mark.
 * - `exitable: true` so copy/paste drops the mark (no hidden markers leak via clipboard).
 * - `priority: 50` so this mark wraps around StarterKit's defaults (which sit at 1000)
 *   in the serialized output.
 */
export const AiTransitionMark = Mark.create({
  name: 'aiTransition',
  priority: 50,
  inclusive: false,
  exitable: true,
  spanning: false,

  addAttributes() {
    return {
      /** Original `from` position at mark creation time. Lets hover lookup be O(1)
       *  and survive DOM splits if the text gets re-tokenized. Optional — newer
       *  marks may have null here if loaded from legacy articles. */
      fid: { default: null },
      /** Original `to` position at mark creation time. */
      tid: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'mark[data-ai-transition]' }];
  },

  renderHTML() {
    return [
      'mark',
      {
        'data-ai-transition': 'true',
        class: 'ai-transition',
        tabindex: '0',
      },
      0,
    ];
  },

  /**
   * Output the mark as inline HTML so it round-trips cleanly through markdown.
   * v3 MarkdownManager slices this at the sentinel placeholder to derive the
   * opening and closing delimiters — we must NOT include literal <mark>...</mark>
   * inside helpers.renderChildren's output.
   */
  renderMarkdown(node, helpers) {
    return `<mark data-ai-transition="true">${helpers.renderChildren(node.content ?? [])}</mark>`;
  },

  /**
   * Ensure the mark reopens across node boundaries (inline image, hard break) when
   * serialized as HTML rather than markdown syntax. Without this, an image inside
   * a transition would close and reopen the mark in awkward places.
   */
  markdownOptions: {
    htmlReopen: {
      open: '<mark data-ai-transition="true">',
      close: '</mark>',
    },
  },
});
