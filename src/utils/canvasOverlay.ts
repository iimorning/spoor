/** Marks floating UI inside the canvas viewport that must not scroll-chain to pan/zoom. */
export const CANVAS_OVERLAY_ATTR = 'data-canvas-overlay';

export const canvasOverlayProps = {
  [CANVAS_OVERLAY_ATTR]: '',
} as const;

export const canvasOverlayScrollClassName = 'overscroll-contain';

/**
 * Marks a scroll container whose own scroll (e.g. an actively-edited note body)
 * must always win over canvas panning. The wheel handler in
 * useCanvasInteraction early-returns when this attribute is found on any
 * ancestor of the wheel target, so boundary touches never leak into canvas
 * pan/zoom.
 */
export const CANVAS_EDIT_LOCK_ATTR = 'data-canvas-edit-lock';

export const canvasEditLockProps = (locked: boolean) =>
  ({
    [CANVAS_EDIT_LOCK_ATTR]: locked ? '' : undefined,
  }) as const;
