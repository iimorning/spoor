/** Compositor-friendly card gestures: offset/rotate via CSS vars during the drag. */

export function setNodeDragOffset(el: HTMLElement, dx: number, dy: number) {
  el.style.setProperty('--drag-x', `${dx}px`);
  el.style.setProperty('--drag-y', `${dy}px`);
  el.dataset.dragX = String(dx);
  el.dataset.dragY = String(dy);
  el.dataset.dragging = '';
}

export function clearNodeDragOffset(
  el: HTMLElement,
  commit?: { x: number; y: number },
) {
  if (commit) {
    el.style.left = `${commit.x}px`;
    el.style.top = `${commit.y}px`;
  }
  el.style.setProperty('--drag-x', '0px');
  el.style.setProperty('--drag-y', '0px');
  delete el.dataset.dragX;
  delete el.dataset.dragY;
  delete el.dataset.dragging;
}

export function readNodeDragOffset(el: HTMLElement): { x: number; y: number } {
  return {
    x: Number(el.dataset.dragX || 0) || 0,
    y: Number(el.dataset.dragY || 0) || 0,
  };
}

/** Idle / React-owned transform: drag and rotate both read CSS vars. */
export function cardGestureTransform(rotateFallback = '0deg'): string {
  return `translate(var(--drag-x, 0px), var(--drag-y, 0px)) rotate(var(--node-rotate, ${rotateFallback}))`;
}

export function setNodeRotateDeg(el: HTMLElement, deg: number) {
  el.style.setProperty('--node-rotate', `${deg}deg`);
}

/** During a rotate gesture: write a concrete transform so the compositor can spin the layer. */
export function applyLiveNodeRotate(el: HTMLElement, deg: number) {
  setNodeRotateDeg(el, deg);
  const x = el.style.getPropertyValue('--drag-x') || '0px';
  const y = el.style.getPropertyValue('--drag-y') || '0px';
  el.style.transform = `translate(${x}, ${y}) rotate(${deg}deg)`;
}

export function beginNodeRotate(el: HTMLElement) {
  el.dataset.rotating = '';
}

/** Drop the live transform so drag can keep using `--drag-x/y` in the React-owned string. */
export function endNodeRotate(el: HTMLElement) {
  delete el.dataset.rotating;
  el.style.transform = cardGestureTransform();
}
