import { useState, useEffect, useCallback } from 'react';
import { readLocalStorage, writeLocalStorage } from '../utils/safeStorage';

export type CanvasGridMode = 'on' | 'off';

const STORAGE_KEY = 'canvas_grid';

function readStoredMode(): CanvasGridMode {
  return readLocalStorage(STORAGE_KEY) === 'off' ? 'off' : 'on';
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
    writeLocalStorage(STORAGE_KEY, mode);
    applyCanvasGrid(mode);
  }, [enabled]);

  const toggle = useCallback(() => {
    setEnabled((prev) => !prev);
  }, []);

  return { enabled, setEnabled, toggle };
}
