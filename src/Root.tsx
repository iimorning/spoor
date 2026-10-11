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

  /**
   * 营销页不参与暗色。
   *
   * 暗色由 `documentElement.dataset.theme` 驱动，而 `index.css` 里有一整批"把
   * Tailwind 工具类映射进暗色"的规则，其中一条会改写 `bg-white`。落地页的演示卡
   * 正是拿 `bg-white` 做白底的——页面自身还是亮色（`landing.css` 写死了），里面
   * 那几张卡却黑了。中间那张更彻底：它是真的节点渲染器渲的，整个节点体系都跟着暗。
   *
   * 与其逐个类去跟暗色层掰手腕，不如在场期间把根主题按亮色钉住。
   * 营销页与应用是**互斥路由**（下面只渲染其中一个），所以这样覆盖的是整棵子树，
   * 也不会波及应用。离开时恢复——切进 `/app` 之前就恢复好了，不会闪。
   *
   * 这个副作用在 LandingPage 还在 lazy 加载时就生效了，看到的仍是加载屏，所以
   * 不会出现"先暗后亮"的一下。
   */
  const onMarketingRoute = !isTauriRuntime() && !isAppPath(pathname);
  useEffect(() => {
    if (!onMarketingRoute) return;
    const root = document.documentElement;
    const prevTheme = root.dataset.theme;
    const prevColorScheme = root.style.colorScheme;
    root.dataset.theme = 'light';
    root.style.colorScheme = 'light';
    return () => {
      if (prevTheme) root.dataset.theme = prevTheme;
      else delete root.dataset.theme;
      root.style.colorScheme = prevColorScheme;
    };
  }, [onMarketingRoute]);

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
