export type NodePaletteStyle = {
  bg: string;
  text: string;
  font: string;
  border: string;
};

export type NodePalettePatch = Partial<NodePaletteStyle>;

export type NodePaletteApplier = (patch: NodePalettePatch) => void;

/** When a marquee selection is active, palette edits apply to every selected card. */
export function paletteTargetIds(originId: string, selected: ReadonlySet<string>): string[] {
  if (selected.size > 1 && selected.has(originId)) {
    return [...selected];
  }
  return [originId];
}

export function applyPalettePatchToAppliers(
  ids: readonly string[],
  appliers: ReadonlyMap<string, NodePaletteApplier>,
  patch: NodePalettePatch,
): void {
  for (const id of ids) {
    appliers.get(id)?.(patch);
  }
}
