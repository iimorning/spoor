import {
  DESKTOP_INSTALLER_DOWNLOAD_URL,
  DESKTOP_INSTALLER_FILENAME,
} from '../constants/desktopRelease';
import { isTauriRuntime } from './isTauriRuntime';
import { openExternalUrl } from './openExternal';

/** Trigger a direct download of the latest public Windows installer. */
export async function downloadDesktopInstaller(): Promise<void> {
  const url = DESKTOP_INSTALLER_DOWNLOAD_URL;

  if (isTauriRuntime()) {
    await openExternalUrl(url);
    return;
  }

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = DESKTOP_INSTALLER_FILENAME;
  anchor.rel = 'noopener noreferrer';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
