import React from 'react';
import type { NoteNodeProps } from './types';
import { NoteLayoutReceipt } from './note/layouts/NoteLayoutReceipt';
import { NoteLayoutStandard, type NoteChromeLayout } from './note/layouts/NoteLayoutStandard';

export function NoteNode({
  node,
  editingNodeId,
  setEditingNodeId,
  webSearchSourceCount,
  webSearchSourcesCollapsed,
  onToggleWebSearchSources,
  notePileCount,
  notePileCollapsed,
  onToggleNotePile,
}: NoteNodeProps) {
  const layout = node.layout ?? 0;
  const stackProps = {
    webSearchSourceCount,
    webSearchSourcesCollapsed,
    onToggleWebSearchSources,
    notePileCount,
    notePileCollapsed,
    onToggleNotePile,
  };

  const body =
    layout === 4 ? (
      <NoteLayoutReceipt
        node={node}
        editingNodeId={editingNodeId}
        setEditingNodeId={setEditingNodeId}
        {...stackProps}
      />
    ) : (
      <NoteLayoutStandard
        node={node}
        editingNodeId={editingNodeId}
        setEditingNodeId={setEditingNodeId}
        layout={layout as NoteChromeLayout}
        {...stackProps}
      />
    );

  return body;
}
