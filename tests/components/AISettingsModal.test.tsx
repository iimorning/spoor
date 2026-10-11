import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { AISettingsModal } from '../../src/components/AISettingsModal';
import {
  DOUBAO_ARK_BASE_URL,
  DOUBAO_DEFAULT_MODEL,
} from '../../src/constants/doubao';
import { DEEPSEEK_BASE_URL, DEEPSEEK_DEFAULT_MODEL } from '../../src/constants/deepseek';
import { MINIMAX_BASE_URL, MINIMAX_DEFAULT_MODEL } from '../../src/constants/minimax';
import { MIMO_TOKEN_PLAN_BASE_URL } from '../../src/constants/mimo';
import { MINIMAX_ENGLISH_VOICE_ID } from '../../src/constants/voiceWriting';
import type { AIConfig } from '../../src/components/AISettingsModal';

const openExternalUrlMock = vi.hoisted(() => vi.fn());
const downloadDesktopInstallerMock = vi.hoisted(() => vi.fn(async () => {}));
const isTauriRuntimeMock = vi.hoisted(() => vi.fn(() => false));
const copyTextToClipboardMock = vi.hoisted(() => vi.fn(async () => {}));
const hasBuiltinMimoMock = vi.hoisted(() => vi.fn(() => true));
const hasBuiltinDoubaoMock = vi.hoisted(() => vi.fn(() => false));
const themeMock = vi.hoisted(() => ({ mode: 'light' as 'light' | 'dark', setMode: vi.fn() }));
const canvasGridMock = vi.hoisted(() => ({ enabled: true, setEnabled: vi.fn(), toggle: vi.fn() }));
const i18nMock = vi.hoisted(() => ({
  language: 'en',
  changeLanguage: vi.fn(),
}));

vi.mock('../../src/utils/openExternal', () => ({ openExternalUrl: openExternalUrlMock }));
vi.mock('../../src/utils/downloadDesktopInstaller', () => ({
  downloadDesktopInstaller: downloadDesktopInstallerMock,
}));
vi.mock('../../src/utils/copyTextToClipboard', () => ({ copyTextToClipboard: copyTextToClipboardMock }));
vi.mock('../../src/utils/isTauriRuntime', () => ({ isTauriRuntime: isTauriRuntimeMock }));
vi.mock('../../src/constants/mimo', async () => {
  const actual = await vi.importActual<typeof import('../../src/constants/mimo')>('../../src/constants/mimo');
  return { ...actual, hasBuiltinMimoApiKey: hasBuiltinMimoMock };
});
vi.mock('../../src/constants/doubao', async () => {
  const actual = await vi.importActual<typeof import('../../src/constants/doubao')>('../../src/constants/doubao');
  return { ...actual, hasBuiltinDoubaoApiKey: hasBuiltinDoubaoMock };
});
vi.mock('../../src/hooks/useTheme', () => ({ useTheme: () => themeMock }));
vi.mock('../../src/hooks/useCanvasGrid', () => ({ useCanvasGrid: () => canvasGridMock }));

const layoutMock = vi.hoisted(() => ({ phone: false, compact: false, touchChrome: false }));
vi.mock('../../src/hooks/useAdaptiveLayout', () => ({
  useAdaptiveLayout: () => layoutMock,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      // Mirror the special-case in the component for the mimo expiry
      if (key === 'settings.builtin_mimo_expiry' && opts?.date) return `米莫到期：${opts.date}`;
      return key;
    },
    i18n: i18nMock,
  }),
}));

vi.mock('lucide-react', () => {
  const make = (name: string) => (props: Record<string, unknown>) =>
    React.createElement('svg', { 'data-testid': `icon-${name}`, ...props });
  return {
    Download: make('Download'),
    Grid3x3: make('Grid3x3'),
    Monitor: make('Monitor'),
    Moon: make('Moon'),
    ShieldCheck: make('ShieldCheck'),
    Sparkles: make('Sparkles'),
    Sun: make('Sun'),
    Headphones: make('Headphones'),
    Mail: make('Mail'),
    Copy: make('Copy'),
    Check: make('Check'),
    X: make('X'),
  };
});

vi.mock('../../src/components/AISettingsDocsPanel', () => ({
  AISettingsDocsPanel: ({ provider }: { provider: string }) =>
    React.createElement('div', { 'data-testid': 'docs-panel', 'data-provider': provider }),
}));

vi.mock('../../src/components/AddToHomeScreenPanel', () => ({
  AddToHomeScreenPanel: () => React.createElement('div', { 'data-testid': 'add-to-home-panel' }),
}));

const authMock = vi.hoisted(() => ({
  user: null as { id: string; email?: string } | null,
  session: null as unknown,
}));

vi.mock('../../src/contexts/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/contexts/AuthContext')>();
  return {
    ...actual,
    useAuth: () => ({
      configured: false,
      session: authMock.session,
      user: authMock.user,
      loading: false,
      syncStatus: 'idle',
      syncMessage: null,
      cloudSyncEnabled: true,
      setCloudSyncEnabled: vi.fn(),
      passwordRecovery: false,
      signIn: vi.fn(),
      signInWithGoogle: vi.fn(),
      signUp: vi.fn(async () => 'signed_in' as const),
      signOut: vi.fn(),
      requestPasswordReset: vi.fn(),
      updatePassword: vi.fn(),
    }),
  };
});

const baseConfig: AIConfig = {
  provider: 'gemini',
  apiKey: '',
  baseUrl: '',
  model: 'gemini-1.5-flash',
};

function renderModal(props: Partial<React.ComponentProps<typeof AISettingsModal>> = {}) {
  // Local fallback uses vi.fn() which is a Mock<Procedure>; the AISettingsModal
  // prop type is Dispatch<SetStateAction<AIConfig>>. Cast to a Mock so the
  // returned value carries the .mock.* assertion surface across the union.
  const localSetConfig = vi.fn() as unknown as Mock<(value: AIConfig) => void>;
  const onClose = vi.fn();
  const result = render(
    <AISettingsModal
      isOpen
      onClose={props.onClose ?? onClose}
      config={{ ...baseConfig, ...(props.config ?? {}) }}
      setConfig={props.setConfig ?? (localSetConfig as unknown as React.Dispatch<React.SetStateAction<AIConfig>>)}
      onRestartTour={props.onRestartTour}
    />,
  );
  return {
    ...result,
    setConfig: (props.setConfig ?? localSetConfig) as Mock<(value: AIConfig) => void>,
    onClose: props.onClose ?? onClose,
  };
}

async function openApiConfigPanel() {
  const user = userEvent.setup();
  const toggle = screen.queryByRole('button', { name: 'settings.show_api_config' });
  if (toggle) await user.click(toggle);
  return user;
}

describe('AISettingsModal', () => {
  beforeEach(async () => {
    openExternalUrlMock.mockClear();
    copyTextToClipboardMock.mockClear();
    copyTextToClipboardMock.mockResolvedValue(undefined);
    isTauriRuntimeMock.mockReturnValue(false);
    hasBuiltinMimoMock.mockReturnValue(true);
    hasBuiltinDoubaoMock.mockReturnValue(false);
    themeMock.mode = 'light';
    themeMock.setMode.mockClear();
    canvasGridMock.enabled = true;
    canvasGridMock.toggle.mockClear();
    i18nMock.language = 'en';
    i18nMock.changeLanguage.mockClear();
    authMock.user = null;
    authMock.session = null;
    layoutMock.phone = false;
    layoutMock.compact = false;
    layoutMock.touchChrome = false;
    // Reset serverConfig snapshot so server-managed state from previous tests
    // doesn't bleed into this one.
    const { setServerConfig } = await import('../../src/lib/serverConfig');
    setServerConfig({ session: null, useServerKeys: false, isPro: false });
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('local-only settings', () => {
    it('shows the local API form and desktop download, not cloud account chrome', () => {
      renderModal({ config: { provider: 'openai', model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1', apiKey: '' } });
      expect(screen.queryByTestId('cloud-panel')).not.toBeInTheDocument();
      expect(screen.queryByTestId('billing-panel')).not.toBeInTheDocument();
      expect(screen.getByText('settings.provider')).toBeInTheDocument();
      expect(screen.getByText('settings.save')).toBeInTheDocument();
    });
  });

  describe('open/close', () => {
    it('returns null when isOpen is false', () => {
      const { container } = render(
        <AISettingsModal isOpen={false} onClose={vi.fn()} config={baseConfig} setConfig={vi.fn()} />,
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders the modal when isOpen is true', () => {
      renderModal();
      expect(screen.getByLabelText('settings.close')).toBeInTheDocument();
    });

    it('clicking the close (X) button calls onClose', async () => {
      const user = userEvent.setup();
      const { onClose } = renderModal();
      await user.click(screen.getByLabelText('settings.close'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('clicking the Save button at the bottom calls onClose', async () => {
      const user = userEvent.setup();
      const { onClose } = renderModal();
      await openApiConfigPanel();
      await user.click(screen.getByText('settings.save'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('Escape closes the modal', async () => {
      const user = userEvent.setup();
      const { onClose } = renderModal();
      await user.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('clicking the backdrop closes the modal', () => {
      const { onClose } = renderModal();
      fireEvent.mouseDown(screen.getByTestId('settings-backdrop'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('language switch', () => {
    it('English button calls i18n.changeLanguage("en") and writes "en" to localStorage', async () => {
      const user = userEvent.setup();
      renderModal();
      await user.click(screen.getByRole('button', { name: 'English' }));
      expect(i18nMock.changeLanguage).toHaveBeenCalledWith('en');
      expect(localStorage.getItem('app_language')).toBe('en');
    });

    it('Chinese button calls i18n.changeLanguage("zh") and writes "zh" to localStorage', async () => {
      const user = userEvent.setup();
      renderModal();
      await user.click(screen.getByRole('button', { name: '中文' }));
      expect(i18nMock.changeLanguage).toHaveBeenCalledWith('zh');
      expect(localStorage.getItem('app_language')).toBe('zh');
    });

    it('English button is marked active when i18n.language === "en"', () => {
      i18nMock.language = 'en';
      renderModal();
      const enBtn = screen.getByRole('button', { name: 'English' });
      expect(enBtn.className).toContain('text-[#C2410C]');
    });

    it('Chinese button is marked active when i18n.language === "zh"', () => {
      i18nMock.language = 'zh';
      renderModal();
      const zhBtn = screen.getByRole('button', { name: '中文' });
      expect(zhBtn.className).toContain('text-[#C2410C]');
    });

    it('hides the note CJK picker in English', () => {
      i18nMock.language = 'en';
      renderModal();
      expect(screen.queryByTestId('settings-note-cjk')).not.toBeInTheDocument();
    });

    it('shows the note CJK picker in Chinese', () => {
      i18nMock.language = 'zh';
      renderModal();
      expect(screen.getByTestId('settings-note-cjk')).toBeInTheDocument();
      expect(screen.getByTestId('settings-note-cjk-preview')).toBeInTheDocument();
    });

    it('marks the current note face and has no focus ring on options', async () => {
      const user = userEvent.setup();
      i18nMock.language = 'zh';
      renderModal();
      const group = screen.getByTestId('settings-note-cjk');
      expect(group.tagName).not.toBe('SELECT');
      const wenkai = screen.getByRole('button', { name: 'settings.note_cjk_wenkai' });
      expect(wenkai.className).not.toContain('ring-1');
      expect(wenkai.className).not.toContain('border-[#C2410C]');
      expect(wenkai.className).not.toContain('focus:ring-1');
      await user.click(wenkai);
      expect(wenkai).toHaveAttribute('aria-pressed', 'true');
    });
  });

  describe('theme switch', () => {
    it.each(['light', 'dark'] as const)('clicking %s calls setMode(%s)', async (m) => {
      const user = userEvent.setup();
      renderModal();
      await user.click(screen.getByRole('button', { name: `settings.theme_${m}` }));
      expect(themeMock.setMode).toHaveBeenCalledWith(m);
    });

    it('highlights the current theme mode button', () => {
      themeMock.mode = 'dark';
      renderModal();
      const darkBtn = screen.getByRole('button', { name: 'settings.theme_dark' });
      expect(darkBtn.className).toContain('text-[#C2410C]');
    });
  });

  describe('canvas grid toggle', () => {
    it('clicking the grid chip calls toggle', async () => {
      const user = userEvent.setup();
      renderModal();
      await user.click(screen.getByRole('button', { name: 'settings.canvas_grid' }));
      expect(canvasGridMock.toggle).toHaveBeenCalledTimes(1);
    });

    it('highlights the chip and marks it pressed when the grid is on', () => {
      canvasGridMock.enabled = true;
      renderModal();
      const gridBtn = screen.getByRole('button', { name: 'settings.canvas_grid' });
      expect(gridBtn.className).toContain('text-[#C2410C]');
      expect(gridBtn).toHaveAttribute('aria-pressed', 'true');
    });

    it('dims the chip and marks it unpressed when the grid is off', () => {
      canvasGridMock.enabled = false;
      renderModal();
      const gridBtn = screen.getByRole('button', { name: 'settings.canvas_grid' });
      expect(gridBtn.className).not.toContain('text-[#C2410C]');
      expect(gridBtn).toHaveAttribute('aria-pressed', 'false');
    });
  });

  describe('API config panel', () => {
    it('shows the local API form by default', () => {
      renderModal();
      expect(screen.queryByTestId('cloud-panel')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'settings.show_api_config' })).not.toBeInTheDocument();
      expect(screen.getByText('settings.provider')).toBeInTheDocument();
      expect(screen.getByText('settings.save')).toBeInTheDocument();
    });
  });

  describe('provider select', () => {
    const expectedDefaults: Record<string, { model: string; baseUrl: string }> = {
      gemini: { model: 'gemini-1.5-flash', baseUrl: '' },
      openai: { model: 'gpt-4o', baseUrl: '' },
      anthropic: { model: 'claude-3-5-sonnet-20240620', baseUrl: '' },
      mimo: { model: 'mimo-v2.5-pro', baseUrl: MIMO_TOKEN_PLAN_BASE_URL },
      doubao: { model: DOUBAO_DEFAULT_MODEL, baseUrl: DOUBAO_ARK_BASE_URL },
      deepseek: { model: DEEPSEEK_DEFAULT_MODEL, baseUrl: DEEPSEEK_BASE_URL },
      minimax: { model: MINIMAX_DEFAULT_MODEL, baseUrl: MINIMAX_BASE_URL },
      custom: { model: 'gpt-4o', baseUrl: '' },
      local_llama: { model: 'gemma-4-e4b-it', baseUrl: '' },
    };

    it.each(Object.keys(expectedDefaults))('selecting %s writes the correct defaults to setConfig', async (provider) => {
      const { setConfig } = renderModal({ config: { ...baseConfig, provider: 'openai' } });
      const user = await openApiConfigPanel();
      const select = screen.getByRole('combobox');
      await user.selectOptions(select, provider);
      expect(setConfig).toHaveBeenCalled();
      const lastCallArg = setConfig.mock.calls[setConfig.mock.calls.length - 1][0];
      const d = expectedDefaults[provider];
      if (provider === 'local_llama') {
        // local_llama also resets apiKey to '' and preserves localGgufPath
        expect(lastCallArg.provider).toBe('local_llama');
        expect(lastCallArg.model).toBe(d.model);
        expect(lastCallArg.baseUrl).toBe(d.baseUrl);
        expect(lastCallArg.apiKey).toBe('');
      } else {
        expect(lastCallArg.provider).toBe(provider);
        expect(lastCallArg.model).toBe(d.model);
        expect(lastCallArg.baseUrl).toBe(d.baseUrl);
      }
    });

    it('switching to local_llama preserves any existing localGgufPath', async () => {
      const { setConfig } = renderModal({
        config: { ...baseConfig, provider: 'openai', localGgufPath: '/old/path.gguf' },
      });
      const user = await openApiConfigPanel();
      await user.selectOptions(screen.getByRole('combobox'), 'local_llama');
      const arg = setConfig.mock.calls.at(-1)![0];
      expect(arg.localGgufPath).toBe('/old/path.gguf');
    });

    it('switching to minimax reuses minimaxApiKey as apiKey when apiKey is empty', async () => {
      const { setConfig } = renderModal({
        config: { ...baseConfig, provider: 'openai', apiKey: '', minimaxApiKey: 'mm-key' },
      });
      const user = await openApiConfigPanel();
      await user.selectOptions(screen.getByRole('combobox'), 'minimax');
      const arg = setConfig.mock.calls.at(-1)![0];
      expect(arg.apiKey).toBe('mm-key');
    });

    it('switching to minimax does NOT overwrite apiKey when apiKey is already set', async () => {
      const { setConfig } = renderModal({
        config: { ...baseConfig, provider: 'openai', apiKey: 'existing', minimaxApiKey: 'mm-key' },
      });
      const user = await openApiConfigPanel();
      await user.selectOptions(screen.getByRole('combobox'), 'minimax');
      const arg = setConfig.mock.calls.at(-1)![0];
      // apiKey should be preserved as 'existing' (the source config's apiKey is
      // not in the override list, so setConfig receives ...config which includes it)
      expect(arg.apiKey).toBe('existing');
    });
  });

  describe('local_llama fields', () => {
    it('renders the localGgufPath input + thinking checkbox when provider is local_llama', async () => {
      renderModal({ config: { ...baseConfig, provider: 'local_llama' } });
      await openApiConfigPanel();
      expect(screen.getByText('settings.local_gguf_path')).toBeInTheDocument();
      expect(screen.getByText('settings.local_enable_thinking')).toBeInTheDocument();
    });

    it('hides the local_llama fields for non-local_llama providers', async () => {
      renderModal({ config: { ...baseConfig, provider: 'gemini' } });
      await openApiConfigPanel();
      expect(screen.queryByText('settings.local_gguf_path')).not.toBeInTheDocument();
    });

    it('typing in the gguf path input calls setConfig with localGgufPath', async () => {
      const { setConfig } = renderModal({ config: { ...baseConfig, provider: 'local_llama' } });
      const user = await openApiConfigPanel();
      const ggufInput = screen.getByPlaceholderText('settings.local_gguf_placeholder');
      await user.type(ggufInput, '/');
      const arg = setConfig.mock.calls.at(-1)![0];
      expect(arg.localGgufPath).toBe('/');
    });

    it('toggling the thinking checkbox calls setConfig with localEnableThinking', async () => {
      const { setConfig } = renderModal({
        config: { ...baseConfig, provider: 'local_llama', localEnableThinking: false },
      });
      const user = await openApiConfigPanel();
      const checkbox = screen.getByRole('checkbox');
      await user.click(checkbox);
      const arg = setConfig.mock.calls.at(-1)![0];
      expect(arg.localEnableThinking).toBe(true);
    });
  });

  describe('API key field', () => {
    it('shows the apiKey password input for non-local_llama providers', async () => {
      renderModal({ config: { ...baseConfig, provider: 'gemini' } });
      await openApiConfigPanel();
      const inputs = document.querySelectorAll('input[type="password"]');
      expect(inputs.length).toBeGreaterThan(0);
    });

    it('hides the apiKey input for local_llama', async () => {
      const { container } = renderModal({ config: { ...baseConfig, provider: 'local_llama' } });
      await openApiConfigPanel();
      // The metaso + 302.AI fields are also password, so check that none of them is bound to config.apiKey
      // The easiest check is: no password input has the apiKey placeholder
      const inputs = container.querySelectorAll('input[type="password"]');
      const apiKeyInput = Array.from(inputs).find(
        (el) => (el as HTMLInputElement).placeholder === 'tp-...',
      );
      expect(apiKeyInput).toBeUndefined();
    });

    it('shows the hosted mimo expiry alert when provider=mimo and built-in key is present', async () => {
      hasBuiltinMimoMock.mockReturnValue(true);
      renderModal({ config: { ...baseConfig, provider: 'mimo' } });
      await openApiConfigPanel();
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toMatch(/米莫到期|2026/);
    });

    it('does NOT show the hosted mimo alert when built-in key is missing', async () => {
      hasBuiltinMimoMock.mockReturnValue(false);
      renderModal({ config: { ...baseConfig, provider: 'mimo' } });
      await openApiConfigPanel();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('shows the hosted doubao hint when provider=doubao and built-in key is present', async () => {
      hasBuiltinDoubaoMock.mockReturnValue(true);
      renderModal({ config: { ...baseConfig, provider: 'doubao' } });
      await openApiConfigPanel();
      expect(screen.getByText('settings.builtin_doubao_hint')).toBeInTheDocument();
    });

    it('typing in the apiKey input calls setConfig with apiKey', async () => {
      const { setConfig } = renderModal({ config: { ...baseConfig, provider: 'openai' } });
      const user = await openApiConfigPanel();
      // The first password input (visible) is the apiKey field
      const apiKeyInput = document.querySelector('input[type="password"]') as HTMLInputElement;
      await user.type(apiKeyInput, 'k');
      // userEvent.type fires one onChange per char; each call has the latest apiKey
      const lastArg = setConfig.mock.calls.at(-1)![0];
      expect(lastArg.apiKey).toBe('k');
    });
  });

  describe('base URL field', () => {
    it.each(['custom', 'openai', 'mimo', 'doubao', 'deepseek', 'minimax'])(
      'shows the base URL field for provider=%s',
      async (provider) => {
        renderModal({ config: { ...baseConfig, provider: provider as AIConfig['provider'] } });
        await openApiConfigPanel();
        expect(screen.getByText('settings.base_url')).toBeInTheDocument();
      },
    );

    it.each(['gemini', 'anthropic', 'local_llama'])(
      'hides the base URL field for provider=%s',
      async (provider) => {
        renderModal({ config: { ...baseConfig, provider: provider as AIConfig['provider'] } });
        await openApiConfigPanel();
        expect(screen.queryByText('settings.base_url')).not.toBeInTheDocument();
      },
    );
  });

  describe('voice writing section', () => {
    it('typing in Volc ASR api key calls setConfig with volcAsrApiKey', async () => {
      const { setConfig } = renderModal();
      const user = await openApiConfigPanel();
      // The Volc api key input has a specific placeholder
      const input = screen.getByPlaceholderText('settings.volc_asr_api_key_placeholder');
      await user.type(input, 'v');
      const arg = setConfig.mock.calls.at(-1)![0];
      expect(arg.volcAsrApiKey).toBe('v');
    });

    it('typing in Volc app id calls setConfig with volcAsrAppId', async () => {
      const { setConfig } = renderModal();
      const user = await openApiConfigPanel();
      // The label is not htmlFor-linked to the input; query by label text
      const appIdInput = screen.getByText('settings.volc_asr_app_id')
        .closest('div')!
        .querySelector('input') as HTMLInputElement;
      await user.type(appIdInput, 'a');
      const arg = setConfig.mock.calls.at(-1)![0];
      expect(arg.volcAsrAppId).toBe('a');
    });

    it('Volc resource id has the documented placeholder', async () => {
      renderModal();
      await openApiConfigPanel();
      const resource = Array.from(document.querySelectorAll('input')).find(
        (el) => (el as HTMLInputElement).placeholder === 'volc.seedasr.sauc.duration',
      );
      expect(resource).toBeDefined();
    });

    it('typing in MiniMax voice id calls setConfig with minimaxVoiceId', async () => {
      const { setConfig } = renderModal();
      const user = await openApiConfigPanel();
      const voiceInput = Array.from(document.querySelectorAll('input')).find(
        (el) => (el as HTMLInputElement).placeholder === MINIMAX_ENGLISH_VOICE_ID,
      )!;
      await user.type(voiceInput, 'm');
      const arg = setConfig.mock.calls.at(-1)![0];
      expect(arg.minimaxVoiceId).toBe('m');
    });

    it('MiniMax tts model has the documented placeholder', async () => {
      renderModal();
      await openApiConfigPanel();
      const ttsModel = Array.from(document.querySelectorAll('input')).find(
        (el) => (el as HTMLInputElement).placeholder === 'speech-2.6-turbo',
      );
      expect(ttsModel).toBeDefined();
    });
  });

  describe('metaso + 302.AI keys', () => {
    it('typing in metaso input calls setConfig with metasoApiKey', async () => {
      const { setConfig } = renderModal();
      const user = await openApiConfigPanel();
      const metaso = screen.getByPlaceholderText('sk-metaso-...');
      await user.type(metaso, 'm');
      const arg = setConfig.mock.calls.at(-1)![0];
      expect(arg.metasoApiKey).toBe('m');
    });

    it('typing in 302.AI input calls setConfig with api302Key', async () => {
      const { setConfig } = renderModal();
      const user = await openApiConfigPanel();
      const api302 = screen.getByPlaceholderText('sk-...');
      await user.type(api302, 'a');
      const arg = setConfig.mock.calls.at(-1)![0];
      expect(arg.api302Key).toBe('a');
    });
  });

  describe('desktop install panel', () => {
    it('shows the download title when not running in Tauri', () => {
      isTauriRuntimeMock.mockReturnValue(false);
      renderModal();
      expect(screen.getByText('settings.desktop_download_button')).toBeInTheDocument();
    });

    it('shows the installed title when running in Tauri', () => {
      isTauriRuntimeMock.mockReturnValue(true);
      renderModal();
      expect(screen.getByText('settings.desktop_releases_button')).toBeInTheDocument();
    });

    it('clicking the desktop button triggers a direct installer download', async () => {
      const user = userEvent.setup();
      renderModal();
      await user.click(screen.getByText('settings.desktop_download_button'));
      expect(downloadDesktopInstallerMock).toHaveBeenCalledTimes(1);
    });

    it('restarts the onboarding tour from the account view', () => {
      const onRestartTour = vi.fn();
      const onClose = vi.fn();
      renderModal({ onRestartTour, onClose });
      fireEvent.click(screen.getByTestId('restart-tour-button'));
      expect(onRestartTour).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('docs panel', () => {
    it('passes the current provider to AISettingsDocsPanel', async () => {
      renderModal({ config: { ...baseConfig, provider: 'deepseek' } });
      await openApiConfigPanel();
      const panel = screen.getByTestId('docs-panel');
      expect(panel).toHaveAttribute('data-provider', 'deepseek');
    });

    it('keeps restart tour in the API config footer', async () => {
      const onRestartTour = vi.fn();
      const onClose = vi.fn();
      renderModal({ onRestartTour, onClose });
      await openApiConfigPanel();
      fireEvent.click(screen.getByTestId('restart-tour-button'));
      expect(onRestartTour).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('support contact', () => {
    it('shows a support icon that opens email and WeChat copy actions', async () => {
      const user = userEvent.setup();
      renderModal();
      expect(screen.queryByTestId('settings-support-panel')).not.toBeInTheDocument();
      await user.click(screen.getByTestId('settings-support-button'));
      expect(screen.getByTestId('settings-support-panel')).toBeInTheDocument();
      expect(screen.getByText('w978109720@gmail.com')).toBeInTheDocument();
      expect(screen.getByText('pincopark')).toBeInTheDocument();

      await user.click(screen.getByTestId('settings-support-copy-email'));
      expect(copyTextToClipboardMock).toHaveBeenCalledWith('w978109720@gmail.com');

      await user.click(screen.getByTestId('settings-support-copy-wechat'));
      expect(copyTextToClipboardMock).toHaveBeenCalledWith('pincopark');
    });
  });

  describe('phone layout', () => {
    it('uses the regular settings chrome rather than a sign-in page', () => {
      layoutMock.phone = true;
      renderModal();
      expect(screen.getByTestId('settings-backdrop')).toBeInTheDocument();
      expect(screen.queryByTestId('settings-modal-phone')).not.toBeInTheDocument();
      expect(screen.queryByTestId('cloud-panel')).not.toBeInTheDocument();
      expect(screen.getByText('settings.provider')).toBeInTheDocument();
    });
  });
});
