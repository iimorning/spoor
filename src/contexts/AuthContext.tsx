import React, { createContext, useContext, type ReactNode } from 'react';

export type SyncStatus = 'idle' | 'syncing' | 'ok' | 'error';
export type SignUpOutcome = 'signed_in' | 'confirm_email' | 'already_registered';

export type Session = { access_token: string } | null;
export type User = { id: string; email?: string } | null;

export type AuthContextValue = {
  configured: boolean;
  session: Session;
  user: User;
  loading: boolean;
  syncStatus: SyncStatus;
  syncMessage: string | null;
  cloudSyncEnabled: boolean;
  setCloudSyncEnabled: (enabled: boolean) => void;
  passwordRecovery: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signUp: (email: string, password: string) => Promise<SignUpOutcome>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
};

const localOnlyAuth: AuthContextValue = {
  configured: false,
  session: null,
  user: null,
  loading: false,
  syncStatus: 'idle',
  syncMessage: null,
  cloudSyncEnabled: false,
  setCloudSyncEnabled: () => {},
  passwordRecovery: false,
  signIn: async () => {
    throw new Error('Cloud sign-in is not available in the open-source build.');
  },
  signInWithGoogle: async () => {
    throw new Error('Cloud sign-in is not available in the open-source build.');
  },
  signUp: async () => {
    throw new Error('Cloud sign-up is not available in the open-source build.');
  },
  signOut: async () => {},
  requestPasswordReset: async () => {
    throw new Error('Cloud accounts are not available in the open-source build.');
  },
  updatePassword: async () => {},
};

const AuthContext = createContext<AuthContextValue>(localOnlyAuth);

export function AuthProvider({ children }: { children: ReactNode }) {
  return <AuthContext.Provider value={localOnlyAuth}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
