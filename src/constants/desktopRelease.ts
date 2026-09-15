import { SITE_PUBLIC_ORIGIN } from './siteLegal';

/** Public GitHub repository (source + issues). */
export const SOURCE_REPO_URL = 'https://github.com/iimorning/spoor';

/** Stable filename served from the marketing site (overwrite on each desktop release). */
export const DESKTOP_INSTALLER_FILENAME = 'Spoor-latest-x64-setup.exe';

/**
 * Direct download URL for the latest Windows NSIS installer.
 * Hosted on the public marketing site — not the private GitHub Releases repo.
 */
export const DESKTOP_INSTALLER_DOWNLOAD_URL = `${SITE_PUBLIC_ORIGIN}/downloads/${DESKTOP_INSTALLER_FILENAME}`;

/** @deprecated Use DESKTOP_INSTALLER_DOWNLOAD_URL — private repo releases are not public. */
export const DESKTOP_RELEASE_URL = DESKTOP_INSTALLER_DOWNLOAD_URL;
