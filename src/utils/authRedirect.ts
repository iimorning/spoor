import { SITE_PUBLIC_ORIGIN } from '../constants/siteLegal';
import { APP_PATH } from './appRoute';

function hostnameOf(origin: string): string | null {
  try {
    return new URL(origin).hostname;
  } catch {
    return null;
  }
}

/** Origins that only exist on the developer's machine or in the desktop webview. */
export function isPrivateAuthOrigin(origin: string): boolean {
  if (!origin) return true;
  const lower = origin.toLowerCase();
  if (lower.startsWith('file:') || lower.startsWith('tauri:') || lower.startsWith('asset:')) {
    return true;
  }
  const host = hostnameOf(origin);
  if (!host) return true;
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === 'tauri.localhost'
  );
}

/**
 * Redirect after email confirm / password reset.
 * Never send those links to localhost or Tauri — users open mail on other devices.
 * Override with VITE_AUTH_REDIRECT_ORIGIN (e.g. http://localhost:3000) to test locally.
 */
export function authRedirectTo(
  location: { origin: string; pathname: string } = window.location,
): string {
  const override = (import.meta.env.VITE_AUTH_REDIRECT_ORIGIN as string | undefined)?.trim();
  const origin =
    override ||
    (isPrivateAuthOrigin(location.origin) ? SITE_PUBLIC_ORIGIN : location.origin.replace(/\/$/, ''));
  const path = location.pathname.startsWith(APP_PATH) ? APP_PATH : location.pathname || '/';
  return `${origin}${path === '/' ? APP_PATH : path}`;
}

/**
 * Redirect after Google OAuth. Stay on the current origin (including localhost)
 * so a local session is not bounced to production. Email links still use
 * {@link authRedirectTo}.
 */
export function oauthRedirectTo(
  location: { origin: string; pathname: string } = window.location,
): string {
  const origin = location.origin.replace(/\/$/, '');
  const path = location.pathname.startsWith(APP_PATH)
    ? APP_PATH
    : location.pathname && location.pathname !== '/'
      ? location.pathname
      : APP_PATH;
  return `${origin}${path}`;
}
