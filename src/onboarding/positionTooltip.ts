/**
 * Pure positioning math for the onboarding tour tooltip.
 *
 * Given a target DOMRect, the tooltip's measured size, the viewport, and the
 * preferred placement, returns the absolute screen-space (top, left) where
 * the tooltip should render. Clamps to the viewport with an 8px margin; if no
 * placement fits, uses the preferred one (clamped) and shrinks/centers when
 * the tooltip is larger than the viewport.
 */

export type Placement = 'top' | 'bottom' | 'left' | 'right';
export type PlacementAlign = 'start' | 'center' | 'end';

export interface ViewportBox {
  width: number;
  height: number;
}

export interface SizeBox {
  width: number;
  height: number;
}

export interface PositionedTooltip {
  top: number;
  left: number;
  placement: Placement;
}

const VIEWPORT_MARGIN = 8;
const GAP = 12;

/** Fallback order when the preferred placement doesn't fit. */
const FALLBACK_ORDER: Placement[] = ['bottom', 'top', 'right', 'left'];

function fits(
  top: number,
  left: number,
  size: SizeBox,
  viewport: ViewportBox,
): boolean {
  return (
    top >= VIEWPORT_MARGIN &&
    left >= VIEWPORT_MARGIN &&
    top + size.height <= viewport.height - VIEWPORT_MARGIN &&
    left + size.width <= viewport.width - VIEWPORT_MARGIN
  );
}

function crossAxisOffset(
  target: DOMRect,
  tooltipSize: number,
  align: PlacementAlign,
): number {
  switch (align) {
    case 'start':
      return target.top;
    case 'end':
      return target.bottom - tooltipSize;
    default:
      return target.top + target.height / 2 - tooltipSize / 2;
  }
}

function anchorFor(
  target: DOMRect,
  placement: Placement,
  tooltipSize: SizeBox,
  align: PlacementAlign = 'center',
): { top: number; left: number } {
  switch (placement) {
    case 'top':
      return {
        top: target.top - tooltipSize.height - GAP,
        left: target.left + target.width / 2 - tooltipSize.width / 2,
      };
    case 'bottom':
      return {
        top: target.bottom + GAP,
        left: target.left + target.width / 2 - tooltipSize.width / 2,
      };
    case 'left':
      return {
        top: crossAxisOffset(target, tooltipSize.height, align),
        left: target.left - tooltipSize.width - GAP,
      };
    case 'right':
      return {
        top: crossAxisOffset(target, tooltipSize.height, align),
        left: target.right + GAP,
      };
  }
}

function clampToViewport(
  top: number,
  left: number,
  size: SizeBox,
  viewport: ViewportBox,
): { top: number; left: number; size: SizeBox } {
  let nextSize = size;
  let nextTop = top;
  let nextLeft = left;

  // Shrink if the tooltip is larger than the viewport (minus margin).
  if (nextSize.width > viewport.width - VIEWPORT_MARGIN * 2) {
    nextSize = { ...nextSize, width: viewport.width - VIEWPORT_MARGIN * 2 };
  }
  if (nextSize.height > viewport.height - VIEWPORT_MARGIN * 2) {
    nextSize = { ...nextSize, height: viewport.height - VIEWPORT_MARGIN * 2 };
  }

  // Clamp so the tooltip stays inside the viewport.
  const minLeft = VIEWPORT_MARGIN;
  const maxLeft = viewport.width - nextSize.width - VIEWPORT_MARGIN;
  const minTop = VIEWPORT_MARGIN;
  const maxTop = viewport.height - nextSize.height - VIEWPORT_MARGIN;
  nextLeft = Math.max(minLeft, Math.min(maxLeft, nextLeft));
  nextTop = Math.max(minTop, Math.min(maxTop, nextTop));

  return { top: nextTop, left: nextLeft, size: nextSize };
}

export function positionTooltip(
  target: DOMRect,
  tooltipSize: SizeBox,
  viewport: ViewportBox,
  preferred: Placement,
  align: PlacementAlign = 'center',
): PositionedTooltip {
  // Try preferred first.
  const preferredAnchor = anchorFor(target, preferred, tooltipSize, align);
  if (fits(preferredAnchor.top, preferredAnchor.left, tooltipSize, viewport)) {
    return { top: preferredAnchor.top, left: preferredAnchor.left, placement: preferred };
  }

  // Try the others in fallback order, skipping the one we already tried.
  for (const fallback of FALLBACK_ORDER) {
    if (fallback === preferred) continue;
    const anchor = anchorFor(target, fallback, tooltipSize, align);
    if (fits(anchor.top, anchor.left, tooltipSize, viewport)) {
      return { top: anchor.top, left: anchor.left, placement: fallback };
    }
  }

  // None fit — fall back to preferred, clamp, and (if oversized) shrink.
  const clamped = clampToViewport(
    preferredAnchor.top,
    preferredAnchor.left,
    tooltipSize,
    viewport,
  );
  return {
    top: clamped.top,
    left: clamped.left,
    placement: preferred,
  };
}