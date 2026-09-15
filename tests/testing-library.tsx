import * as RTL from '@testing-library/react-impl';
import React from 'react';
import { AppDialogProvider } from '../src/components/AppDialogProvider';
import { AuthProvider } from '../src/contexts/AuthContext';
import { AppEntryGateProvider } from '../src/contexts/AppEntryGateContext';
import { BillingProvider } from '../src/contexts/BillingContext';

export * from '@testing-library/react-impl';

/**
 * Default auth state for tests: Supabase env vars are absent in jsdom, so
 * `AuthProvider` returns the unauthenticated, unconfigured defaults without
 * attempting a real `getSession()` / network call. Components that need to
 * override auth state (e.g. AISettingsModal tests) keep using `vi.mock` on
 * `../../src/contexts/AuthContext`, which Vitest applies before this wrapper
 * resolves its imports.
 */
function TestProviders({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AppEntryGateProvider>
        <BillingProvider>
          <AppDialogProvider>{children}</AppDialogProvider>
        </BillingProvider>
      </AppEntryGateProvider>
    </AuthProvider>
  );
}

function mergeWrapper(
  Outer: React.ComponentType<{ children: React.ReactNode }>,
  Inner?: RTL.RenderOptions['wrapper'],
) {
  if (!Inner) return Outer;
  return function MergedWrapper({ children }: { children: React.ReactNode }) {
    return (
      <Outer>
        <Inner>{children}</Inner>
      </Outer>
    );
  };
}

export function render(
  ui: React.ReactElement,
  options?: RTL.RenderOptions,
) {
  const { wrapper: inner, ...rest } = options ?? {};
  return RTL.render(ui, {
    ...rest,
    wrapper: mergeWrapper(TestProviders, inner),
  });
}

export function renderHook<TResult, TProps>(
  hook: (props: TProps) => TResult,
  options?: RTL.RenderHookOptions<TProps>,
) {
  const { wrapper: inner, ...rest } = options ?? {};
  return RTL.renderHook(hook, {
    ...rest,
    wrapper: mergeWrapper(TestProviders, inner),
  });
}
