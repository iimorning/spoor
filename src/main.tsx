import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import './i18n';
import Root from './Root.tsx';
import { AppDialogProvider } from './components/AppDialogProvider';
import { AuthProvider } from './contexts/AuthContext';
import { AppEntryGateProvider } from './contexts/AppEntryGateContext';
import { BillingProvider } from './contexts/BillingContext';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import './index.css';
import { registerDevBuiltinAgentReset } from './dev/resetBuiltinAgents';
import { initTheme } from './hooks/useTheme';
import { initNoteCjkAfterFirstPaint } from './hooks/useNoteCjk';
import { initCanvasGrid } from './hooks/useCanvasGrid';
import { isTauriRuntime } from './utils/isTauriRuntime';
import { registerPwaServiceWorker } from './utils/pwaInstall';
import { registerVitePreloadRecovery } from './utils/vitePreloadRecovery';

registerDevBuiltinAgentReset();
registerVitePreloadRecovery();
initTheme();
initNoteCjkAfterFirstPaint();
initCanvasGrid();
if (!isTauriRuntime()) registerPwaServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <AuthProvider>
        <AppEntryGateProvider>
          <BillingProvider>
            <AppDialogProvider>
              <Root />
            </AppDialogProvider>
          </BillingProvider>
        </AppEntryGateProvider>
      </AuthProvider>
    </AppErrorBoundary>
  </StrictMode>,
);
