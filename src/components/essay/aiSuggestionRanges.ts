import type { Editor } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';

export type AiMarkKind = 'insert' | 'delete';

export type AiMarkRange = { from: number; to: number; kind: AiMarkKind };

export function collectMarkRangesFromDoc(doc: PmNode, markName: string): { from: number; to: number }[] {
  const raw: { from: number; to: number }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    if (node.marks.some((m) => m.type.name === markName)) {
      raw.push({ from: pos, to: pos + node.nodeSize });
    }
    return true;
  });
  raw.sort((a, b) => a.from - b.from);
  const merged: { from: number; to: number }[] = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && r.from <= last.to) last.to = Math.max(last.to, r.to);
    else merged.push({ ...r });
  }
  return merged;
}

export function collectMarkRanges(instance: Editor, markName: string): { from: number; to: number }[] {
  return collectMarkRangesFromDoc(instance.state.doc, markName);
}

export function collectAiMarkSuggestionsFromDoc(doc: PmNode): AiMarkRange[] {
  return [
    ...collectMarkRangesFromDoc(doc, 'aiTransition').map((r) => ({ ...r, kind: 'insert' as const })),
    ...collectMarkRangesFromDoc(doc, 'aiDeletion').map((r) => ({ ...r, kind: 'delete' as const })),
  ].sort((a, b) => a.from - b.from);
}

export function collectAiMarkSuggestions(instance: Editor): AiMarkRange[] {
  return collectAiMarkSuggestionsFromDoc(instance.state.doc);
}

export function rangeText(instance: Editor, from: number, to: number): string {
  try {
    return instance.state.doc.textBetween(from, to, '\n', '\n');
  } catch {
    return '';
  }
}

export function settleAiMarkSuggestion(
  instance: Editor,
  range: AiMarkRange,
  mode: 'accept' | 'reject',
) {
  if (range.kind === 'delete') {
    if (mode === 'accept') {
      instance.chain().focus().deleteRange({ from: range.from, to: range.to }).run();
    } else {
      instance
        .chain()
        .focus()
        .setTextSelection({ from: range.from, to: range.to })
        .unsetMark('aiDeletion')
        .run();
    }
    return;
  }
  if (mode === 'accept') {
    instance
      .chain()
      .focus()
      .setTextSelection({ from: range.from, to: range.to })
      .unsetMark('aiTransition')
      .run();
  } else {
    instance.chain().focus().deleteRange({ from: range.from, to: range.to }).run();
  }
}
