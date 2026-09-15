import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DESKTOP_INSTALLER_DOWNLOAD_URL,
  DESKTOP_INSTALLER_FILENAME,
} from '../../src/constants/desktopRelease';

const isTauriRuntimeMock = vi.hoisted(() => vi.fn(() => false));
const openExternalUrlMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('../../src/utils/isTauriRuntime', () => ({ isTauriRuntime: isTauriRuntimeMock }));
vi.mock('../../src/utils/openExternal', () => ({ openExternalUrl: openExternalUrlMock }));

describe('downloadDesktopInstaller', () => {
  beforeEach(() => {
    isTauriRuntimeMock.mockReturnValue(false);
    openExternalUrlMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses a public spoor.ink downloads URL', () => {
    expect(DESKTOP_INSTALLER_DOWNLOAD_URL).toBe(
      'https://spoor.ink/downloads/Spoor-latest-x64-setup.exe',
    );
    expect(DESKTOP_INSTALLER_FILENAME).toBe('Spoor-latest-x64-setup.exe');
  });

  it('clicks a hidden anchor in the browser', async () => {
    const click = vi.fn();
    const remove = vi.fn();
    const appendChild = vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
      Object.assign(node as HTMLAnchorElement, { click, remove });
      return node;
    });

    const { downloadDesktopInstaller } = await import('../../src/utils/downloadDesktopInstaller');
    await downloadDesktopInstaller();

    expect(appendChild).toHaveBeenCalled();
    const anchor = appendChild.mock.calls[0]?.[0] as HTMLAnchorElement;
    expect(anchor.href).toBe(DESKTOP_INSTALLER_DOWNLOAD_URL);
    expect(anchor.download).toBe(DESKTOP_INSTALLER_FILENAME);
    expect(click).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
    appendChild.mockRestore();
  });

  it('opens the download URL in the system browser on desktop', async () => {
    isTauriRuntimeMock.mockReturnValue(true);
    const { downloadDesktopInstaller } = await import('../../src/utils/downloadDesktopInstaller');
    await downloadDesktopInstaller();
    expect(openExternalUrlMock).toHaveBeenCalledWith(DESKTOP_INSTALLER_DOWNLOAD_URL);
  });
});
