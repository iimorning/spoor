import React from 'react';
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { essayEditorActionLabels } from '../../utils/essayEditorActionLabels';

export function settleAiEssayEdit(
  editor: ReactNodeViewProps['editor'],
  pos: number,
  nodeSize: number,
  text: string,
) {
  editor.chain().focus().deleteRange({ from: pos, to: pos + nodeSize }).run();
  if (text) {
    editor.chain().focus().insertContentAt(pos, text, { contentType: 'markdown' }).run();
  }
}

export function AiEssayEditView(props: ReactNodeViewProps) {
  const { apply, reject, deleteLabel } = essayEditorActionLabels();
  const original = String(props.node.attrs.original ?? '');
  const proposed = String(props.node.attrs.proposed ?? '');

  const run = (mode: 'apply' | 'reject') => {
    const pos = props.getPos();
    if (typeof pos !== 'number') return;
    const text = mode === 'apply' ? proposed : original;
    settleAiEssayEdit(props.editor, pos, props.node.nodeSize, text);
  };

  return (
    <NodeViewWrapper
      as="span"
      className="ai-essay-edit"
      data-ai-essay-edit="true"
      data-testid="essay-ai-edit"
      contentEditable={false}
    >
      <span className="ai-essay-edit-actions">
        <button
          type="button"
          data-testid="essay-ai-edit-apply"
          className="ai-essay-edit-apply"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run('apply')}
        >
          {apply}
        </button>
        <button
          type="button"
          data-testid="essay-ai-edit-reject"
          className="ai-essay-edit-reject"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run('reject')}
        >
          {reject}
        </button>
      </span>
      <span className="ai-essay-edit-body">
        {original ? (
          <del className="ai-essay-edit-original" data-original="true">
            {original}
          </del>
        ) : null}
        {original && proposed ? <span className="ai-essay-edit-arrow" aria-hidden>→</span> : null}
        {proposed ? (
          <span className="ai-essay-edit-proposed" data-proposed="true">
            {proposed}
          </span>
        ) : (
          <span className="ai-essay-edit-proposed ai-essay-edit-proposed-empty">
            {deleteLabel}
          </span>
        )}
      </span>
    </NodeViewWrapper>
  );
}
