import { useCallback, useEffect, useState } from 'react';
import {
  type BeforeInstallPromptEvent,
  isIosWeb,
  isStandaloneDisplay,
} from '../utils/pwaInstall';

export function usePwaInstall() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(isStandaloneDisplay);

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setIsInstalled(true);
    };
    const onDisplayMode = () => setIsInstalled(isStandaloneDisplay());

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    window.matchMedia('(display-mode: standalone)').addEventListener('change', onDisplayMode);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      window.matchMedia('(display-mode: standalone)').removeEventListener('change', onDisplayMode);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<boolean> => {
    if (!deferred) return false;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null);
    if (outcome === 'accepted') setIsInstalled(true);
    return outcome === 'accepted';
  }, [deferred]);

  return {
    canNativePrompt: deferred != null,
    isInstalled,
    isIos: isIosWeb(),
    promptInstall,
  };
}
