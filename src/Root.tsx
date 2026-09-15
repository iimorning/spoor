import React, { lazy, Suspense, useEffect, useState } from 'react';
import AppEntry from './AppEntry';
import { CjkFontProgressBar } from './components/CjkFontProgressBar';
import { AppLoadingScreen } from './components/AppLoadingScreen';
import { isTauriRuntime } from './utils/isTauriRuntime';
import { useDocumentSeo } from './hooks/useDocumentSeo';
import { useAppEntryGate } from './contexts/AppEntryGateContext';
import {
  isAppPath,
  isAupPath,
  isCommunityPath,
  isGuidesPath,
  isPrivacyPath,
  isReportPath,
  isTermsPath,
} from './utils/appRoute';

const LandingPage = lazy(() =>
  import('./components/LandingPage').then((module) => ({ default: module.LandingPage })),
);
const CommunityPage = lazy(() =>
  import('./components/CommunityPage').then((module) => ({ default: module.CommunityPage })),
);
const PolicyPage = lazy(() =>
  import('./components/PolicyPage').then((module) => ({ default: module.PolicyPage })),
);
const ReportPage = lazy(() =>
  import('./components/ReportPage').then((module) => ({ default: module.ReportPage })),
);
const GuidesPage = lazy(() =>
  import('./components/GuidesPage').then((module) => ({ default: module.GuidesPage })),
);

function usePathname(): string {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  useEffect(() => {
    const sync = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  return pathname;
}

/**
 * Web routes: `/` = marketing landing,
 * `/community` = bundled gallery, `/guides` = evergreen GEO guides,
 * `/terms` `/privacy` `/aup` `/report` = legal, `/app` = canvas.
 * Desktop (Tauri): always open the canvas.
 */
export default function Root() {
  const pathname = usePathname();
  const { enterApp } = useAppEntryGate();
  useDocumentSeo(pathname, { disabled: isCommunityPath(pathname) });

  let page: React.ReactNode;
  if (isTauriRuntime() || isAppPath(pathname)) {
    page = <AppEntry />;
  } else if (isPrivacyPath(pathname)) {
    page = <PolicyPage kind="privacy" />;
  } else if (isTermsPath(pathname)) {
    page = <PolicyPage kind="tos" />;
  } else if (isAupPath(pathname)) {
    page = <PolicyPage kind="aup" />;
  } else if (isReportPath(pathname)) {
    page = <ReportPage />;
  } else if (isCommunityPath(pathname)) {
    page = <CommunityPage pathname={pathname} />;
  } else if (isGuidesPath(pathname)) {
    page = <GuidesPage pathname={pathname} />;
  } else {
    page = <LandingPage onEnterApp={enterApp} />;
  }

  return (
    <>
      <CjkFontProgressBar />
      <Suspense fallback={<AppLoadingScreen />}>{page}</Suspense>
    </>
  );
}
