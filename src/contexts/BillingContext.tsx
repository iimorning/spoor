import React, { createContext, useContext, useMemo, type ReactNode } from 'react';
import { EMPTY_USAGE, type UsageSnapshot } from '../constants/hostedQuota';
import type { BillingPlan } from '../utils/billingAccess';

type SubscriptionRow = {
  user_id: string;
  status: string;
  plan: BillingPlan | null;
  waffo_order_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
};

export type BillingState = {
  loading: boolean;
  isPro: boolean;
  row: SubscriptionRow | null;
  usage: UsageSnapshot | null;
  refresh: () => Promise<void>;
  startCheckout: (plan: BillingPlan, language?: 'zh' | 'en') => Promise<void>;
  cancel: () => Promise<void>;
};

const BillingContext = createContext<BillingState | null>(null);

async function unavailable(): Promise<void> {
  throw new Error('Hosted billing is not part of the open-source build.');
}

export function BillingProvider({ children }: { children: ReactNode }) {
  const value = useMemo<BillingState>(
    () => ({
      loading: false,
      isPro: false,
      row: null,
      usage: { ...EMPTY_USAGE },
      refresh: async () => {},
      startCheckout: async () => unavailable(),
      cancel: async () => {},
    }),
    [],
  );
  return <BillingContext.Provider value={value}>{children}</BillingContext.Provider>;
}

export function useBilling(): BillingState {
  const ctx = useContext(BillingContext);
  if (!ctx) throw new Error('useBilling must be used within BillingProvider');
  return ctx;
}

export function useBillingOptional(): BillingState | null {
  return useContext(BillingContext);
}

export function EnsureBillingProvider({ children }: { children: ReactNode }) {
  const existing = useContext(BillingContext);
  if (existing) return children;
  return <BillingProvider>{children}</BillingProvider>;
}
