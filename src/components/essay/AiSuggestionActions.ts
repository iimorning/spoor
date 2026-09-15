import type { Editor } from '@tiptap/core';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { essayEditorActionLabels } from '../../utils/essayEditorActionLabels';
import {
  collectAiMarkSuggestionsFromDoc,
  rangeText,
  settleAiMarkSuggestion,
  type AiMarkRange,
} from './aiSuggestionRanges';

const pluginKey = new PluginKey('aiSuggestionActions');

export type AiSuggestionActionHandlers = {
  applyLabel?: string;
  rejectLabel?: string;
  onInsertAdopt?: (text: string) => void;
  onInsertRemove?: (text: string) => void;
  onDeleteAdopt?: (text: string) => void;
  onDeleteReject?: (text: string) => void;
};

function labels(editor: Editor): { apply: string; reject: string } {
  const stored = editor.storage.aiSuggestionActions as AiSuggestionActionHandlers | undefined;
  const fallback = essayEditorActionLabels();
  return {
    apply: stored?.applyLabel || fallback.apply,
    reject: stored?.rejectLabel || fallback.reject,
  };
}

function createActionEl(editor: Editor, range: AiMarkRange): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'ai-suggestion-actions';
  wrap.setAttribute('contenteditable', 'false');
  wrap.setAttribute('data-testid', 'essay-suggestion-actions');
  wrap.setAttribute('data-kind', range.kind);

  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'ai-essay-edit-apply';
  apply.setAttribute('data-testid', 'essay-suggestion-apply');
  apply.textContent = labels(editor).apply;

  const reject = document.createElement('button');
  reject.type = 'button';
  reject.className = 'ai-essay-edit-reject';
  reject.setAttribute('data-testid', 'essay-suggestion-reject');
  reject.textContent = labels(editor).reject;

  const run = (mode: 'accept' | 'reject') => {
    const text = rangeText(editor, range.from, range.to);
    settleAiMarkSuggestion(editor, range, mode);
    const handlers = editor.storage.aiSuggestionActions as AiSuggestionActionHandlers | undefined;
    if (range.kind === 'delete') {
      if (mode === 'accept') handlers?.onDeleteAdopt?.(text);
      else handlers?.onDeleteReject?.(text);
    } else if (mode === 'accept') {
      handlers?.onInsertAdopt?.(text);
    } else {
      handlers?.onInsertRemove?.(text);
    }
  };

  const arm = (btn: HTMLButtonElement, mode: 'accept' | 'reject') => {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      run(mode);
    });
  };
  arm(apply, 'accept');
  arm(reject, 'reject');

  wrap.append(apply, reject);
  return wrap;
}

/**
 * Always-visible Apply / Reject chips immediately after each AI
 * transition or deletion mark — not in the editor toolbar.
 */
export const AiSuggestionActions = Extension.create({
  name: 'aiSuggestionActions',

  addStorage() {
    return {} as AiSuggestionActionHandlers;
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: pluginKey,
        props: {
          decorations: (state) => {
            const suggestions = collectAiMarkSuggestionsFromDoc(state.doc);
            if (suggestions.length === 0) return DecorationSet.empty;
            const tag = labels(editor).apply;
            const widgets = suggestions.map((range) =>
              Decoration.widget(
                range.to,
                () => createActionEl(editor, range),
                {
                  side: 1,
                  ignoreSelection: true,
                  key: `ai-sug-${range.kind}-${range.from}-${range.to}-${tag}`,
                },
              ),
            );
            return DecorationSet.create(state.doc, widgets);
          },
        },
      }),
    ];
  },
});
