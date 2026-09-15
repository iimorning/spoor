import { useState, useEffect, useCallback } from 'react';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'app_theme';

function readStoredMode(): ThemeMode {
  const stored = localStorage.getItem(STORAGE_KEY);
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
  if (localStorage.getItem(STORAGE_KEY) === 'system') {
    localStorage.setItem(STORAGE_KEY, mode);
  }
  applyTheme(mode);
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(() => readStoredMode());

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, mode);
    applyTheme(mode);
  }, [mode]);

  const cycleTheme = useCallback(() => {
    setMode((prev) => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  return { mode, setMode, cycleTheme };
}
