import { lazy, Suspense } from 'react';
import PhonePocketApp from './PhonePocketApp';
import { AppLoadingScreen } from './components/AppLoadingScreen';
import { useAdaptiveLayout } from './hooks/useAdaptiveLayout';
import { isTauriRuntime } from './utils/isTauriRuntime';

const DesktopAppEntry = lazy(() => import('./DesktopAppEntry'));

export default function AppEntry() {
  const { phone } = useAdaptiveLayout();
  const Entry = !isTauriRuntime() && phone ? PhonePocketApp : DesktopAppEntry;

  return (
    <Suspense fallback={<AppLoadingScreen />}>
      <Entry />
    </Suspense>
  );
}
