import { useState, useEffect, useCallback } from 'react';
import { readLocalStorage, writeLocalStorage } from '../utils/safeStorage';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'app_theme';

function readStoredMode(): ThemeMode {
  const stored = readLocalStorage(STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  // Legacy "system": snap once to the current OS preference, then stay explicit.
  if (stored === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

function applyTheme(theme: ThemeMode) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

/** Call once at startup (before React renders) to prevent flash of wrong theme. */
export function initTheme() {
  const mode = readStoredMode();
  if (readLocalStorage(STORAGE_KEY) === 'system') {
    writeLocalStorage(STORAGE_KEY, mode);
  }
  applyTheme(mode);
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(() => readStoredMode());

  useEffect(() => {
    writeLocalStorage(STORAGE_KEY, mode);
    applyTheme(mode);
  }, [mode]);

  const cycleTheme = useCallback(() => {
    setMode((prev) => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  return { mode, setMode, cycleTheme };
}
