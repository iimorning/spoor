import React, { createContext, useCallback, useContext, type ReactNode } from 'react';
import { navigateToApp } from '../utils/appRoute';

type AppEntryGateContextValue = {
  enterApp: () => void;
};

const AppEntryGateContext = createContext<AppEntryGateContextValue | null>(null);

export function AppEntryGateProvider({ children }: { children: ReactNode }) {
  const enterApp = useCallback(() => {
    navigateToApp();
  }, []);

  return (
    <AppEntryGateContext.Provider value={{ enterApp }}>{children}</AppEntryGateContext.Provider>
  );
}

export function useAppEntryGate(): AppEntryGateContextValue {
  const ctx = useContext(AppEntryGateContext);
  if (!ctx) {
    throw new Error('useAppEntryGate must be used within AppEntryGateProvider');
  }
  return ctx;
}
