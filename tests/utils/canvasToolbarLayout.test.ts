import { describe, it, expect, beforeEach } from 'vitest';
import {
  CANVAS_TOOLBAR_LAYOUT_KEY,
  canvasToolbarDockPosition,
  clampCanvasToolbarPosition,
  defaultCanvasToolbarLayout,
  isCanvasToolbarInDockZone,
  loadCanvasToolbarLayout,
  saveCanvasToolbarLayout,
  reanchorCanvasToolbarPosition,
  canvasToolbarViewportSize,
} from '../../src/utils/canvasToolbarLayout';

describe('canvasToolbarLayout', () => {
  beforeEach(() => {
    localStorage.removeItem(CANVAS_TOOLBAR_LAYOUT_KEY);
  });

  it('defaults to bottom-center horizontal', () => {
    const layout = defaultCanvasToolbarLayout(600, 64, 1200, 800);
    expect(layout.orientation).toBe('horizontal');
    expect(layout.collapsed).toBe(false);
    expect(layout.x).toBe(300);
    expect(layout.y).toBe(800 - 64 - 32);
  });

  it('clamps position inside the viewport', () => {
    expect(clampCanvasToolbarPosition(-100, 9999, 200, 80, 1000, 600)).toEqual({
      x: 8,
      y: 600 - 80 - 8,
    });
  });

  it('round-trips layout through localStorage including collapsed', () => {
    saveCanvasToolbarLayout({ x: 40, y: 50, orientation: 'vertical', collapsed: true });
    expect(loadCanvasToolbarLayout()).toEqual({
      x: 40,
      y: 50,
      orientation: 'vertical',
      collapsed: true,
    });
  });

  it('detects bottom-right dock zone', () => {
    expect(isCanvasToolbarInDockZone(900, 700, 200, 80, 1200, 800)).toBe(true);
    expect(isCanvasToolbarInDockZone(300, 700, 600, 64, 1200, 800)).toBe(false);
    expect(isCanvasToolbarInDockZone(1000, 200, 180, 80, 1200, 800)).toBe(false);
  });

  it('docks collapsed FAB above zoom controls', () => {
    expect(canvasToolbarDockPosition(1200, 800)).toEqual({
      x: 1200 - 48 - 24,
      y: 800 - 48 - 68,
    });
  });

  it('reanchors a bottom-centered bar to the new bottom when the viewport grows', () => {
    const prev = { width: 1200, height: 800 };
    const next = { width: 1200, height: 1080 };
    const pos = reanchorCanvasToolbarPosition(300, 704, 600, 64, prev, next);
    expect(pos.x).toBe(300);
    expect(pos.y).toBe(1080 - 64 - (800 - 704 - 64));
    expect(pos.y).toBe(984);
  });

  it('keeps a top-left bar put when the viewport grows', () => {
    const pos = reanchorCanvasToolbarPosition(
      16,
      20,
      200,
      56,
      { width: 1200, height: 800 },
      { width: 1400, height: 1080 },
    );
    expect(pos).toEqual({ x: 16, y: 20 });
  });

  it('keeps a bottom-right dock glued to the bottom-right', () => {
    const prev = { width: 1200, height: 800 };
    const next = { width: 1600, height: 1000 };
    const pos = reanchorCanvasToolbarPosition(1128, 664, 48, 48, prev, next);
    expect(pos.x).toBe(1600 - 48 - (1200 - 1128 - 48));
    expect(pos.y).toBe(1000 - 48 - (800 - 664 - 48));
  });

  it('uses the fullscreen element size when present', () => {
    const host = document.createElement('div');
    Object.defineProperty(host, 'clientWidth', { value: 1920, configurable: true });
    Object.defineProperty(host, 'clientHeight', { value: 1080, configurable: true });
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => host,
    });
    expect(canvasToolbarViewportSize()).toEqual({ width: 1920, height: 1080 });
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => null,
    });
  });
});
