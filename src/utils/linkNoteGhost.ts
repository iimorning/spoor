/** Compositor-friendly link-mode ghost: CSS transform only (no left/top, no React). */

export function placeLinkNoteGhost(el: HTMLElement, worldX: number, worldY: number) {
  el.style.transform = `translate3d(${worldX}px, ${worldY}px, 0px) translate(-50%, -50%)`;
}
