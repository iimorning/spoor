import React from 'react';
import { AppDialogProvider } from '../src/components/AppDialogProvider';
import { AuthProvider } from '../src/contexts/AuthContext';
import { AppEntryGateProvider } from '../src/contexts/AppEntryGateContext';
import { BillingProvider } from '../src/contexts/BillingContext';

export function withAppDialogProvider(children: React.ReactNode) {
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
