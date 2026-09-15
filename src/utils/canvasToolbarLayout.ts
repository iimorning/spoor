// v2: toolbar shrank (AI input moved to Ask card on canvas); old x positions
// no longer center the narrower panel, so we discard any saved layout.
export const CANVAS_TOOLBAR_LAYOUT_KEY = 'spoor_canvas_toolbar_layout_v2';

export type CanvasToolbarOrientation = 'horizontal' | 'vertical';

export interface CanvasToolbarLayout {
  x: number;
  y: number;
  orientation: CanvasToolbarOrientation;
  /** Collapsed to a FAB when docked at the bottom-right. */
  collapsed?: boolean;
}

const MARGIN = 8;
/** Distance from viewport right/bottom edges that counts as the dock zone. */
export const CANVAS_TOOLBAR_DOCK_ZONE_PX = 140;
export const CANVAS_TOOLBAR_COLLAPSED_SIZE = 48;

/** Default bottom-center horizontal placement for a given panel size. */
export function defaultCanvasToolbarLayout(
  panelWidth: number,
  panelHeight: number,
  viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280,
  viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800,
): CanvasToolbarLayout {
  return {
    x: Math.max(MARGIN, (viewportWidth - panelWidth) / 2),
    y: Math.max(MARGIN, viewportHeight - panelHeight - 32),
    orientation: 'horizontal',
    collapsed: false,
  };
}

/** Snapped FAB position above the zoom controls (bottom-right). */
export function canvasToolbarDockPosition(
  viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280,
  viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800,
): { x: number; y: number } {
  const size = CANVAS_TOOLBAR_COLLAPSED_SIZE;
  // Leave room for zoom bar (~40px) + gap above it (zoom sits at bottom-3).
  return {
    x: Math.max(MARGIN, viewportWidth - size - 24),
    y: Math.max(MARGIN, viewportHeight - size - 68),
  };
}

/**
 * True when the panel's bottom-right corner sits in the viewport's bottom-right dock zone.
 */
export function isCanvasToolbarInDockZone(
  x: number,
  y: number,
  panelWidth: number,
  panelHeight: number,
  viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280,
  viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800,
): boolean {
  const rightGap = viewportWidth - (x + panelWidth);
  const bottomGap = viewportHeight - (y + panelHeight);
  return rightGap <= CANVAS_TOOLBAR_DOCK_ZONE_PX && bottomGap <= CANVAS_TOOLBAR_DOCK_ZONE_PX;
}

export function clampCanvasToolbarPosition(
  x: number,
  y: number,
  panelWidth: number,
  panelHeight: number,
  viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280,
  viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800,
): { x: number; y: number } {
  const maxX = Math.max(MARGIN, viewportWidth - panelWidth - MARGIN);
  const maxY = Math.max(MARGIN, viewportHeight - panelHeight - MARGIN);
  return {
    x: Math.min(Math.max(MARGIN, x), maxX),
    y: Math.min(Math.max(MARGIN, y), maxY),
  };
}

/**
 * Viewport the toolbar is positioned against. Element fullscreen makes
 * `position: fixed` resolve against the fullscreen element, not the window.
 */
export function canvasToolbarViewportSize(): { width: number; height: number } {
  if (typeof document !== 'undefined') {
    const fs = document.fullscreenElement;
    if (fs instanceof HTMLElement && fs.clientWidth > 0 && fs.clientHeight > 0) {
      return { width: fs.clientWidth, height: fs.clientHeight };
    }
  }
  return {
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  };
}

const CENTER_SLACK_PX = 24;

/**
 * Keep the toolbar glued to the same screen edge(s) when the viewport
 * resizes (browser chrome hiding on fullscreen, exiting fullscreen, etc.).
 * A bottom-centered bar stays bottom-centered instead of floating mid-canvas.
 */
export function reanchorCanvasToolbarPosition(
  x: number,
  y: number,
  panelWidth: number,
  panelHeight: number,
  prevViewport: { width: number; height: number },
  nextViewport: { width: number; height: number },
): { x: number; y: number } {
  const left = x;
  const right = prevViewport.width - (x + panelWidth);
  const top = y;
  const bottom = prevViewport.height - (y + panelHeight);

  const prevCenterX = (prevViewport.width - panelWidth) / 2;
  const nextX =
    Math.abs(x - prevCenterX) <= CENTER_SLACK_PX
      ? (nextViewport.width - panelWidth) / 2
      : left <= right
        ? left
        : nextViewport.width - panelWidth - right;

  const nextY = top <= bottom ? top : nextViewport.height - panelHeight - bottom;

  return clampCanvasToolbarPosition(
    nextX,
    nextY,
    panelWidth,
    panelHeight,
    nextViewport.width,
    nextViewport.height,
  );
}

export function loadCanvasToolbarLayout(): CanvasToolbarLayout | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CANVAS_TOOLBAR_LAYOUT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CanvasToolbarLayout>;
    if (
      typeof parsed.x !== 'number' ||
      typeof parsed.y !== 'number' ||
      (parsed.orientation !== 'horizontal' && parsed.orientation !== 'vertical')
    ) {
      return null;
    }
    return {
      x: parsed.x,
      y: parsed.y,
      orientation: parsed.orientation,
      collapsed: Boolean(parsed.collapsed),
    };
  } catch {
    return null;
  }
}

export function saveCanvasToolbarLayout(layout: CanvasToolbarLayout): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CANVAS_TOOLBAR_LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // ignore quota / private mode
  }
}
