import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Grid3x3, Monitor, Moon, Sparkles, Sun, X } from 'lucide-react';
import { useOverlayDismiss } from '../hooks/useOverlayDismiss';
import {
  BUILTIN_MIMO_API_EXPIRES_AT,
  hasBuiltinMimoApiKey,
  MIMO_TOKEN_PLAN_BASE_URL,
} from '../constants/mimo';
import {
  DOUBAO_ARK_BASE_URL,
  DOUBAO_DEFAULT_MODEL,
  hasBuiltinDoubaoApiKey,
} from '../constants/doubao';
import { DEEPSEEK_BASE_URL, DEEPSEEK_DEFAULT_MODEL } from '../constants/deepseek';
import { type ReasoningMode } from '../constants/openrouter';
import { MINIMAX_BASE_URL, MINIMAX_DEFAULT_MODEL } from '../constants/minimax';
import {
  MINIMAX_DEFAULT_VOICE_ID,
  MINIMAX_ENGLISH_VOICE_ID,
  type VoiceInputMode,
} from '../constants/voiceWriting';
import { downloadDesktopInstaller } from '../utils/downloadDesktopInstaller';
import { isTauriRuntime } from '../utils/isTauriRuntime';
import { AISettingsDocsPanel } from './AISettingsDocsPanel';
import { AddToHomeScreenPanel } from './AddToHomeScreenPanel';
import { SettingsSupportButton } from './SettingsSupportButton';
import { isServerManaged } from '../lib/serverConfig';
import { useTheme } from '../hooks/useTheme';
import { NOTE_CJK_IDS, noteCjkPreviewFamily, useNoteCjk } from '../hooks/useNoteCjk';
import { useCanvasGrid } from '../hooks/useCanvasGrid';
import { useAdaptiveLayout } from '../hooks/useAdaptiveLayout';
import { useAuth } from '../contexts/AuthContext';

export interface AIConfig {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Tauri 本地 GGUF 绝对路径；provider 为 local_llama 时使用 */
  localGgufPath?: string;
  /** 可选：Thinking 变体需套用带思考块的模板时设为 true */
  localEnableThinking?: boolean;
  metasoApiKey?: string;
  /** 302.AI API Key — GPT-Image-2 文生图（问卡 / Agent / 书页语音 / 对话语音配图） */
  api302Key?: string;
  /** 火山 ASR：新版控制台 API Key（优先） */
  volcAsrApiKey?: string;
  /** 火山 ASR：旧版 APP ID */
  volcAsrAppId?: string;
  /** 火山 ASR：旧版 Access Token */
  volcAsrAccessToken?: string;
  /** 火山 ASR resource id，默认小时版 */
  volcAsrResourceId?: string;
  /** MiniMax TTS API Key */
  minimaxApiKey?: string;
  /** MiniMax 音色 ID */
  minimaxVoiceId?: string;
  /** MiniMax TTS 模型 */
  minimaxTtsModel?: string;
  /**
   * 已登录且开通 Pro 时，是否使用 Supabase Edge Function 代理（开发者预置的密钥）。
   * Pro 用户登录后 App.tsx 自动置为 true；免费用户走自带 Key。
   */
  useServerKeys?: boolean;
  /**
   * Canvas voice input: auto-send after a pause, or keep text in the composer
   * until the user clicks send. AI reply + TTS stay the same either way.
   */
  voiceInputMode?: VoiceInputMode;
  /**
   * 深度思考（OpenRouter 的统一 reasoning 参数）：'default' 不传、跟随模型；
   * 'off' 关掉；'low'/'medium'/'high' 调档。见 constants/openrouter.ts。
   */
  reasoningMode?: ReasoningMode;
}

export interface AISettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: AIConfig;
  setConfig: React.Dispatch<React.SetStateAction<AIConfig>>;
  /** Replay the onboarding tour. Wired from App's `useOnboarding.restart`. */
  onRestartTour?: () => void;
}

function RestartTourButton({
  onRestart,
  className,
}: {
  onRestart: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      data-testid="restart-tour-button"
      title={t('onboarding.restart_hint')}
      onClick={onRestart}
      className={
        className ??
        'min-w-0 flex-1 flex items-center justify-center gap-1.5 h-9 px-2 rounded-lg bg-[#C2410C]/5 text-[#C2410C] text-xs font-bold hover:bg-[#C2410C]/10 transition-colors'
      }
    >
      <Sparkles className="w-3.5 h-3.5 shrink-0" />
      <span className="truncate">{t('onboarding.restart_button')}</span>
    </button>
  );
}

export function AISettingsModal({ isOpen, onClose, config, setConfig, onRestartTour }: AISettingsModalProps) {
  const { t, i18n } = useTranslation();
  const { phone, touchChrome } = useAdaptiveLayout();
  const { configured } = useAuth();
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const { id: noteCjk, setNoteCjk } = useNoteCjk();
  const { enabled: canvasGridEnabled, toggle: toggleCanvasGrid } = useCanvasGrid();
  const { onBackdropMouseDown } = useOverlayDismiss(isOpen, onClose);
  const [showApiConfig, setShowApiConfig] = useState(false);
  // Server-managed: Edge Function holds secrets + model; hide the local AI form.
  const serverManaged = isServerManaged();
  const inDesktopApp = isTauriRuntime();
  const hostedMimo = config.provider === 'mimo' && hasBuiltinMimoApiKey();
  const hostedDoubao = config.provider === 'doubao' && hasBuiltinDoubaoApiKey();
  const hostedMimoExpiryLabel =
    i18n.language === 'zh'
      ? '2026年6月1日'
      : new Date(BUILTIN_MIMO_API_EXPIRES_AT).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
  useEffect(() => {
    if (!isOpen) setShowApiConfig(false);
  }, [isOpen]);
  if (!isOpen) return null;

  const chipIdle = 'text-[#8c8a84] hover:text-[#5a5a54]';
  const chipActive = 'text-[#C2410C]';
  const accountView = configured && (serverManaged || !showApiConfig);
  const showLocalAiForm = !serverManaged && (!configured || showApiConfig);

  const languageControls = (
    <>
      <button
        type="button"
        aria-label="English"
        title="English"
        onClick={() => { i18n.changeLanguage('en'); localStorage.setItem('app_language', 'en'); }}
        className={`flex items-center justify-center w-8 h-8 rounded-md text-[11px] font-bold tracking-wide transition-colors ${i18n.language === 'en' ? chipActive : chipIdle}`}
      >
        EN
      </button>
      <button
        type="button"
        aria-label="中文"
        title="中文"
        onClick={() => { i18n.changeLanguage('zh'); localStorage.setItem('app_language', 'zh'); }}
        className={`flex items-center justify-center w-8 h-8 rounded-md text-sm font-bold transition-colors ${i18n.language === 'zh' ? chipActive : chipIdle}`}
      >
        中
      </button>
    </>
  );

  if (phone && configured) {
    return (
      <div
        className="fixed inset-0 z-[100] bg-[#FAF9F6] paper-texture flex flex-col"
        data-testid="settings-modal-phone"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-phone-title"
      >
        <header className="shrink-0 px-7 pt-[calc(1.25rem+env(safe-area-inset-top))] pb-3 flex items-center justify-between gap-3 border-b border-[#E6E4DF]/80 bg-[#FAF9F6]">
          <h2 id="settings-phone-title" className="text-2xl font-serif text-[#1a1a1a] min-w-0 truncate">
            {t('settings.title')}
          </h2>
          <div className="flex items-center gap-1 shrink-0">
            {languageControls}
            <button
              type="button"
              aria-label={t('settings.close')}
              onClick={onClose}
              className="p-2 rounded-full hover:bg-[#EAE7E2] transition-colors"
            >
              <X className="w-5 h-5 text-[#8c8a84]" />
            </button>
          </div>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto px-7 py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          <div className="mt-8 pt-6 border-t border-[#F4F1ED]">
            <AddToHomeScreenPanel variant="phone" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 bg-black/20 backdrop-blur-[2px] z-[100] flex items-center justify-center p-4"
      role="presentation"
      data-testid="settings-backdrop"
      onMouseDown={onBackdropMouseDown}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-lg overflow-hidden flex flex-col shadow-2xl animate-in zoom-in-95 duration-200"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-4 pt-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1 min-w-0">
            {languageControls}
            <span className="mx-1 h-4 w-px bg-[#E6E4DF]" aria-hidden />
            <button
              type="button"
              aria-label={t('settings.theme_light')}
              title={t('settings.theme_light')}
              onClick={() => setThemeMode('light')}
              className={`flex items-center justify-center w-8 h-8 rounded-md transition-colors ${themeMode === 'light' ? chipActive : chipIdle}`}
            >
              <Sun className="w-4 h-4" />
            </button>
            <button
              type="button"
              aria-label={t('settings.theme_dark')}
              title={t('settings.theme_dark')}
              onClick={() => setThemeMode('dark')}
              className={`flex items-center justify-center w-8 h-8 rounded-md transition-colors ${themeMode === 'dark' ? chipActive : chipIdle}`}
            >
              <Moon className="w-4 h-4" />
            </button>
            <span className="mx-1 h-4 w-px bg-[#E6E4DF]" aria-hidden />
            <button
              type="button"
              aria-label={t('settings.canvas_grid')}
              title={t('settings.canvas_grid')}
              aria-pressed={canvasGridEnabled}
              onClick={toggleCanvasGrid}
              className={`flex items-center justify-center w-8 h-8 rounded-md transition-colors ${canvasGridEnabled ? chipActive : chipIdle}`}
            >
              <Grid3x3 className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!serverManaged && configured ? (
              <button
                type="button"
                aria-pressed={showApiConfig}
                data-testid="settings-show-api-config"
                onClick={() => setShowApiConfig((open) => !open)}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold tracking-wide transition-colors ${
                  showApiConfig
                    ? 'bg-[#C2410C]/10 text-[#C2410C]'
                    : 'text-[#5a5a54] hover:bg-[#EAE7E2] hover:text-[#1a1a1a]'
                }`}
              >
                {showApiConfig ? t('settings.hide_api_config') : t('settings.show_api_config')}
              </button>
            ) : null}
            <SettingsSupportButton />
            <button
              type="button"
              aria-label={t('settings.close')}
              onClick={onClose}
              className="p-2 coarse:p-2.5 hover:bg-[#EAE7E2] rounded-full transition-colors shrink-0"
            >
              <X className="w-5 h-5 text-[#8c8a84]" />
            </button>
          </div>
        </div>

        <div
          className={
            accountView
              ? 'p-8 space-y-6'
              : 'p-8 space-y-6 overflow-y-auto max-h-[70vh]'
          }
        >
          {accountView || showLocalAiForm ? (
            <>
              <div className="h-px bg-[#F4F1ED]" />
              {i18n.language.startsWith('zh') ? (
                <div className="space-y-2">
                  <p
                    id="settings-note-cjk-label"
                    className="text-sm font-mono font-bold text-[#5a5a54] uppercase tracking-wider"
                  >
                    {t('settings.note_cjk')}
                  </p>
                  <div
                    data-testid="settings-note-cjk"
                    aria-labelledby="settings-note-cjk-label"
                    className="flex flex-wrap gap-1"
                  >
                    {NOTE_CJK_IDS.map((id) => {
                      const selected = id === noteCjk;
                      return (
                        <button
                          key={id}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setNoteCjk(id)}
                          className={`h-8 px-2.5 rounded-md text-sm outline-none ring-0 shadow-none focus:outline-none focus:ring-0 focus-visible:outline-none ${
                            selected
                              ? 'bg-[#C2410C]/5 text-[#C2410C]'
                              : 'text-[#8c8a84] hover:bg-[#EAE7E2] hover:text-[#5a5a54]'
                          }`}
                        >
                          {t(`settings.note_cjk_${id}`)}
                        </button>
                      );
                    })}
                  </div>
                  <p
                    data-testid="settings-note-cjk-preview"
                    className="text-[15px] leading-relaxed text-[#4a4a44]"
                    style={{ fontFamily: noteCjkPreviewFamily(noteCjk) }}
                  >
                    随手写在画布上 · The quick brown fox
                  </p>
                </div>
              ) : null}
              {phone || touchChrome ? <AddToHomeScreenPanel /> : null}
              <div className="flex gap-2">
                <button
                  type="button"
                  title={inDesktopApp ? t('settings.desktop_installed_blurb') : t('settings.desktop_download_blurb')}
                  onClick={() => void downloadDesktopInstaller()}
                  className="min-w-0 flex-1 flex items-center justify-center gap-1.5 h-9 px-2 rounded-lg bg-[#C2410C]/5 text-[#C2410C] text-xs font-bold hover:bg-[#C2410C]/10 transition-colors"
                >
                  {inDesktopApp ? <Monitor className="w-3.5 h-3.5 shrink-0" /> : <Download className="w-3.5 h-3.5 shrink-0" />}
                  <span className="truncate">
                    {inDesktopApp ? t('settings.desktop_releases_button') : t('settings.desktop_download_button')}
                  </span>
                </button>
                {onRestartTour && !showLocalAiForm ? (
                  <RestartTourButton
                    onRestart={() => {
                      onRestartTour();
                      onClose();
                    }}
                  />
                ) : null}
              </div>
            </>
          ) : null}

          {/* Self-hosted keys: full local AI form — mutually exclusive with account view. */}
          {!showLocalAiForm ? null : (
          <>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
               <div className="space-y-2">
                 <label className="text-sm font-mono font-bold text-[#5a5a54] uppercase tracking-wider">{t('settings.provider')}</label>
                 <select
                   className="w-full h-10 px-3 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg text-sm outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C] transition-all"
                   value={config.provider}
                   onChange={e => {
                     const newProvider = e.target.value;
                     const defaults: Record<string, { model: string; baseUrl: string }> = {
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
                     const d = defaults[newProvider] || { model: '', baseUrl: '' };
                     // Local convenience: reuse TTS MiniMax key when switching chat provider to MiniMax.
                     const reuseMinimaxKey =
                       newProvider === 'minimax' &&
                       !(config.apiKey ?? '').trim() &&
                       !!(config.minimaxApiKey ?? '').trim();
                     setConfig({
                       ...config,
                       provider: newProvider,
                       model: d.model,
                       baseUrl: d.baseUrl,
                       ...(newProvider === 'local_llama'
                         ? { apiKey: '', localGgufPath: config.localGgufPath ?? '' }
                         : reuseMinimaxKey
                           ? { apiKey: (config.minimaxApiKey ?? '').trim() }
                           : {}),
                     });
                   }}
                 >
                   <option value="gemini">{t('settings.provider_gemini')}</option>
                   <option value="openai">{t('settings.provider_openai')}</option>
                   <option value="anthropic">{t('settings.provider_anthropic')}</option>
                   <option value="mimo">{t('settings.provider_mimo')}</option>
                   <option value="doubao">{t('settings.provider_doubao')}</option>
                   <option value="deepseek">{t('settings.provider_deepseek')}</option>
                   <option value="minimax">{t('settings.provider_minimax')}</option>
                   <option value="custom">{t('settings.provider_custom')}</option>
                   <option value="local_llama">{t('settings.provider_local_llama')}</option>
                 </select>
               </div>
               <div className="space-y-2">
                 <label className="text-sm font-mono font-bold text-[#5a5a54] uppercase tracking-wider">{t('settings.model')}</label>
                 <input 
                   type="text"
                   className="w-full h-10 px-3 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg text-sm outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C] transition-all"
                   placeholder={
                     config.provider === 'local_llama'
                       ? t('settings.model_local_placeholder')
                       : config.provider === 'gemini'
                         ? 'gemini-1.5-flash'
                         : config.provider === 'mimo'
                           ? 'mimo-v2.5-pro'
                           : config.provider === 'doubao'
                             ? DOUBAO_DEFAULT_MODEL
                             : config.provider === 'deepseek'
                               ? DEEPSEEK_DEFAULT_MODEL
                               : config.provider === 'minimax'
                                 ? MINIMAX_DEFAULT_MODEL
                                 : 'gpt-4o'
                   }
                   value={config.model}
                   onChange={e => setConfig({ ...config, model: e.target.value })}
                 />
               </div>
            </div>

            {config.provider === 'local_llama' ? (
              <div className="space-y-2">
                <label className="text-sm font-mono font-bold text-[#5a5a54] uppercase tracking-wider">{t('settings.local_gguf_path')}</label>
                <input
                  type="text"
                  className="w-full h-10 px-3 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg text-sm outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C] transition-all font-mono"
                  placeholder={t('settings.local_gguf_placeholder')}
                  value={config.localGgufPath ?? ''}
                  onChange={e => setConfig({ ...config, localGgufPath: e.target.value })}
                />
                <label className="flex items-center gap-2 text-sm text-[#5a5a54] cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded border-[#E6E4DF]"
                    checked={config.localEnableThinking ?? false}
                    onChange={e => setConfig({ ...config, localEnableThinking: e.target.checked })}
                  />
                  {t('settings.local_enable_thinking')}
                </label>
                <p className="text-sm text-[#5a5a54] leading-relaxed">{t('settings.local_llama_hint')}</p>
              </div>
            ) : (
                <div className="space-y-2">
                  <label className="text-sm font-mono font-bold text-[#5a5a54] uppercase tracking-wider">{t('settings.api_key')}</label>
                  {hostedMimo && (
                    <div className="space-y-2">
                      <p
                        role="alert"
                        className="text-sm leading-relaxed px-3 py-2 rounded-lg border border-amber-300/80 bg-amber-50 text-amber-950"
                      >
                        {t('settings.builtin_mimo_expiry', { date: hostedMimoExpiryLabel })}
                      </p>
                      <p className="text-sm text-[#5a5a54] leading-relaxed">{t('settings.builtin_mimo_hint')}</p>
                    </div>
                  )}
                  {hostedDoubao && (
                    <p className="text-sm text-[#5a5a54] leading-relaxed">{t('settings.builtin_doubao_hint')}</p>
                  )}
                  <input
                    type="password"
                    className="w-full h-10 px-3 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg text-sm outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C] transition-all"
                    placeholder={
                      hostedDoubao
                        ? t('settings.api_key_optional_doubao')
                        : hostedMimo
                          ? t('settings.api_key_optional_mimo')
                          : config.provider === 'doubao'
                            ? 'ark-...'
                            : config.provider === 'minimax'
                              ? 'sk-cp-...'
                              : 'tp-...'
                    }
                    value={config.apiKey}
                    onChange={e => setConfig({ ...config, apiKey: e.target.value })}
                  />
                </div>
            )}

            {(config.provider === 'custom' || config.provider === 'openai' || config.provider === 'mimo' || config.provider === 'doubao' || config.provider === 'deepseek' || config.provider === 'minimax') && (
              <div className="space-y-2">
                <label className="text-sm font-mono font-bold text-[#5a5a54] uppercase tracking-wider">{t('settings.base_url')}</label>
                <input
                  type="text"
                  className="w-full h-10 px-3 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg text-sm outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C] transition-all"
                  placeholder={
                    config.provider === 'mimo'
                      ? MIMO_TOKEN_PLAN_BASE_URL
                      : config.provider === 'doubao'
                        ? DOUBAO_ARK_BASE_URL
                        : config.provider === 'deepseek'
                          ? DEEPSEEK_BASE_URL
                          : config.provider === 'minimax'
                            ? MINIMAX_BASE_URL
                            : 'https://api.openai.com/v1'
                  }
                  value={config.baseUrl}
                  onChange={e => setConfig({ ...config, baseUrl: e.target.value })}
                />
              </div>
            )}
          </div>

          <div className="h-px bg-[#F4F1ED]"></div>

          {/* Metaso Search API Key (optional) */}
          <div className="space-y-2">
            <label className="text-sm font-mono font-bold text-[#5a5a54] uppercase tracking-wider">{t('settings.metaso_key')}</label>
            <input
              type="password"
              className="w-full h-10 px-3 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg text-sm outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C] transition-all"
              placeholder="sk-metaso-..."
              value={config.metasoApiKey ?? ''}
              onChange={e => setConfig({ ...config, metasoApiKey: e.target.value })}
            />
            <p className="text-sm text-[#5a5a54] leading-relaxed">{t('settings.metaso_key_hint')}</p>
          </div>

          <div className="h-px bg-[#F4F1ED]" />

          {/* 302.AI GPT-Image-2 (optional) */}
          <div className="space-y-2">
            <label className="text-sm font-mono font-bold text-[#5a5a54] uppercase tracking-wider">{t('settings.api302_key')}</label>
            <input
              type="password"
              className="w-full h-10 px-3 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg text-sm outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C] transition-all"
              placeholder="sk-..."
              value={config.api302Key ?? ''}
              onChange={e => setConfig({ ...config, api302Key: e.target.value })}
            />
            <p className="text-sm text-[#5a5a54] leading-relaxed">{t('settings.api302_key_hint')}</p>
          </div>

          <div className="h-px bg-[#F4F1ED]" />

          {/* Voice writing: Volc ASR + MiniMax TTS */}
          <div className="space-y-4">
            <div>
              <label className="text-sm font-mono font-bold text-[#5a5a54] uppercase tracking-wider">{t('settings.voice_section')}</label>
              <p className="text-sm text-[#5a5a54] leading-relaxed mt-1">{t('settings.voice_section_hint')}</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-mono font-bold text-[#5a5a54] uppercase tracking-wider">{t('settings.volc_asr_api_key')}</label>
              <input
                type="password"
                className="w-full h-10 px-3 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg text-sm outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C] transition-all"
                placeholder={t('settings.volc_asr_api_key_placeholder')}
                value={config.volcAsrApiKey ?? ''}
                onChange={e => setConfig({ ...config, volcAsrApiKey: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-sm font-mono font-bold text-[#5a5a54] uppercase tracking-wider">{t('settings.volc_asr_app_id')}</label>
                <input
                  type="text"
                  className="w-full h-10 px-3 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg text-sm outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C] transition-all"
                  value={config.volcAsrAppId ?? ''}
                  onChange={e => setConfig({ ...config, volcAsrAppId: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-mono font-bold text-[#5a5a54] uppercase tracking-wider">{t('settings.volc_asr_access_token')}</label>
                <input
                  type="password"
                  className="w-full h-10 px-3 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg text-sm outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C] transition-all"
                  value={config.volcAsrAccessToken ?? ''}
                  onChange={e => setConfig({ ...config, volcAsrAccessToken: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-mono font-bold text-[#5a5a54] uppercase tracking-wider">{t('settings.volc_asr_resource_id')}</label>
              <input
                type="text"
                className="w-full h-10 px-3 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg text-sm outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C] transition-all font-mono text-xs"
                placeholder="volc.seedasr.sauc.duration"
                value={config.volcAsrResourceId ?? ''}
                onChange={e => setConfig({ ...config, volcAsrResourceId: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-mono font-bold text-[#5a5a54] uppercase tracking-wider">{t('settings.minimax_api_key')}</label>
              <input
                type="password"
                className="w-full h-10 px-3 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg text-sm outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C] transition-all"
                value={config.minimaxApiKey ?? ''}
                onChange={e => setConfig({ ...config, minimaxApiKey: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-sm font-mono font-bold text-[#5a5a54] uppercase tracking-wider">{t('settings.minimax_voice_id')}</label>
                <input
                  type="text"
                  className="w-full h-10 px-3 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg text-sm outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C] transition-all font-mono text-xs"
                  placeholder={
                    i18n.language.startsWith('zh') ? MINIMAX_DEFAULT_VOICE_ID : MINIMAX_ENGLISH_VOICE_ID
                  }
                  value={config.minimaxVoiceId ?? ''}
                  onChange={e => setConfig({ ...config, minimaxVoiceId: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-mono font-bold text-[#5a5a54] uppercase tracking-wider">{t('settings.minimax_tts_model')}</label>
                <input
                  type="text"
                  className="w-full h-10 px-3 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg text-sm outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C] transition-all font-mono text-xs"
                  placeholder="speech-2.6-turbo"
                  value={config.minimaxTtsModel ?? ''}
                  onChange={e => setConfig({ ...config, minimaxTtsModel: e.target.value })}
                />
              </div>
            </div>
          </div>

          <AISettingsDocsPanel provider={config.provider} />
          </>
          )}
        </div>

        {showLocalAiForm ? (
        <div className="p-6 border-t border-[#E6E4DF] bg-white flex items-center justify-between gap-3">
          {onRestartTour ? (
            <RestartTourButton
              onRestart={() => {
                onRestartTour();
                onClose();
              }}
              className="min-w-0 flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg bg-[#C2410C]/5 text-[#C2410C] text-xs font-bold hover:bg-[#C2410C]/10 transition-colors"
            />
          ) : (
            <span />
          )}
          <button
            onClick={onClose}
            className="px-8 py-2.5 bg-[#C2410C] text-white rounded-xl font-sans font-bold hover:bg-[#9A3412] transition-all text-sm shadow-sm shadow-[#C2410C]/20"
          >
            {t('settings.save')}
          </button>
        </div>
        ) : null}
      </div>
    </div>
  );
}
