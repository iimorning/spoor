/** Web landing vs app shell. Desktop (Tauri) always opens the canvas. */

import { AUP_PATH, PRIVACY_PATH, REPORT_PATH, TERMS_PATH } from '../constants/siteLegal';

export const APP_PATH = '/app';
export const PRICING_PATH = '/pricing';
export const COMMUNITY_PATH = '/community';
export const GUIDES_PATH = '/guides';
export { AUP_PATH, PRIVACY_PATH, REPORT_PATH, TERMS_PATH };

export function isAppPath(pathname: string = window.location.pathname): boolean {
  return pathname === APP_PATH || pathname.startsWith(`${APP_PATH}/`);
}

/** Strict equality (prefix match would also include /pricing-foo etc.). */
export function isPricingPath(pathname: string = window.location.pathname): boolean {
  return pathname === PRICING_PATH;
}

export function isCommunityPath(pathname: string = window.location.pathname): boolean {
  return pathname === COMMUNITY_PATH || pathname.startsWith(`${COMMUNITY_PATH}/`);
}

export function isPrivacyPath(pathname: string = window.location.pathname): boolean {
  return pathname === PRIVACY_PATH;
}

export function isTermsPath(pathname: string = window.location.pathname): boolean {
  return pathname === TERMS_PATH;
}

export function isAupPath(pathname: string = window.location.pathname): boolean {
  return pathname === AUP_PATH;
}

export function isReportPath(pathname: string = window.location.pathname): boolean {
  return pathname === REPORT_PATH;
}

export function communityListingId(pathname: string = window.location.pathname): string | null {
  if (!pathname.startsWith(`${COMMUNITY_PATH}/`)) return null;
  const id = pathname.slice(COMMUNITY_PATH.length + 1).split('/')[0]?.trim();
  return id || null;
}

export function navigateToApp(): void {
  if (window.location.pathname !== APP_PATH) {
    window.history.pushState({}, '', APP_PATH);
  }
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function navigateToLanding(): void {
  if (window.location.pathname !== '/' && window.location.pathname !== '') {
    window.history.pushState({}, '', '/');
  }
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function navigateToPricing(): void {
  if (window.location.pathname !== PRICING_PATH) {
    window.history.pushState({}, '', PRICING_PATH);
  }
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function isGuidesPath(pathname: string = window.location.pathname): boolean {
  return pathname === GUIDES_PATH || pathname.startsWith(`${GUIDES_PATH}/`);
}

export function guideSlug(pathname: string = window.location.pathname): string | null {
  if (!pathname.startsWith(`${GUIDES_PATH}/`)) return null;
  const id = pathname.slice(GUIDES_PATH.length + 1).split('/')[0]?.trim();
  return id || null;
}

export function navigateToGuides(slug?: string): void {
  const next = slug ? `${GUIDES_PATH}/${slug}` : GUIDES_PATH;
  if (window.location.pathname !== next) {
    window.history.pushState({}, '', next);
  }
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function navigateToCommunity(listingId?: string): void {
  const next = listingId ? `${COMMUNITY_PATH}/${listingId}` : COMMUNITY_PATH;
  if (window.location.pathname !== next) {
    window.history.pushState({}, '', next);
  }
  window.dispatchEvent(new PopStateEvent('popstate'));
}
