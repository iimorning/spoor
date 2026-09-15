const drafts = new Map<string, string>();

export function getAskComposerDraft(nodeId: string): string {
  return drafts.get(nodeId) ?? '';
}

export function setAskComposerDraft(nodeId: string, text: string): void {
  if (text.length === 0) drafts.delete(nodeId);
  else drafts.set(nodeId, text);
}

export function clearAskComposerDraft(nodeId: string): void {
  drafts.delete(nodeId);
}

export function clearAllAskComposerDrafts(): void {
  drafts.clear();
}
