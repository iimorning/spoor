import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { APP_PATH, COMMUNITY_PATH, communityListingId, isAupPath, isCommunityPath, isAppPath, isReportPath, navigateToApp, navigateToLanding } from '../../src/utils/appRoute';

describe('appRoute', () => {
  const original = window.location.pathname;

  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    window.history.replaceState({}, '', original || '/');
  });

  it('recognizes /app paths', () => {
    expect(isAppPath('/')).toBe(false);
    expect(isAppPath(APP_PATH)).toBe(true);
    expect(isAppPath(`${APP_PATH}/`)).toBe(true);
  });

  it('navigateToApp updates history and notifies listeners', () => {
    const spy = vi.fn();
    window.addEventListener('popstate', spy);
    navigateToApp();
    expect(window.location.pathname).toBe(APP_PATH);
    expect(spy).toHaveBeenCalled();
    window.removeEventListener('popstate', spy);
  });

  it('navigateToLanding returns to /', () => {
    window.history.pushState({}, '', APP_PATH);
    navigateToLanding();
    expect(window.location.pathname).toBe('/');
  });

  it('recognizes /community and listing ids', () => {
    expect(isCommunityPath('/')).toBe(false);
    expect(isCommunityPath(COMMUNITY_PATH)).toBe(true);
    expect(isCommunityPath(`${COMMUNITY_PATH}/abc`)).toBe(true);
    expect(communityListingId(`${COMMUNITY_PATH}/abc`)).toBe('abc');
    expect(communityListingId(COMMUNITY_PATH)).toBeNull();
  });

  it('recognizes /aup and /report', () => {
    expect(isAupPath('/aup')).toBe(true);
    expect(isAupPath('/terms')).toBe(false);
    expect(isReportPath('/report')).toBe(true);
    expect(isReportPath('/privacy')).toBe(false);
  });
});
