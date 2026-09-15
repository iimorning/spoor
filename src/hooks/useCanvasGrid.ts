import { useState, useEffect, useCallback } from 'react';

export type CanvasGridMode = 'on' | 'off';

const STORAGE_KEY = 'canvas_grid';

function readStoredMode(): CanvasGridMode {
  return localStorage.getItem(STORAGE_KEY) === 'off' ? 'off' : 'on';
}

function applyCanvasGrid(mode: CanvasGridMode) {
  document.documentElement.dataset.canvasGrid = mode;
}

/** Call once at startup (before React renders) so the grid does not flash on/off. */
export function initCanvasGrid() {
  applyCanvasGrid(readStoredMode());
}

export function useCanvasGrid() {
  const [enabled, setEnabled] = useState<boolean>(() => readStoredMode() === 'on');

  useEffect(() => {
    const mode: CanvasGridMode = enabled ? 'on' : 'off';
    localStorage.setItem(STORAGE_KEY, mode);
    applyCanvasGrid(mode);
  }, [enabled]);

  const toggle = useCallback(() => {
    setEnabled((prev) => !prev);
  }, []);

  return { enabled, setEnabled, toggle };
}
