import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Headphones, Mail } from 'lucide-react';
import { copyTextToClipboard } from '../utils/copyTextToClipboard';

export const SUPPORT_EMAIL = 'w978109720@gmail.com';
export const SUPPORT_WECHAT = 'pincopark';

type SupportChannel = 'email' | 'wechat';

function WeChatGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="currentColor"
        d="M9.5 4.2c-3.9 0-7 2.7-7 6.1 0 1.9 1 3.6 2.6 4.8l-.6 2.3 2.5-1.4c.7.2 1.5.3 2.3.3.3 0 .5 0 .8 0A5.3 5.3 0 0 1 9.2 14c0-3.1 2.9-5.6 6.5-5.6.2 0 .4 0 .6 0C15.6 5.8 12.9 4.2 9.5 4.2Zm-2.2 4.4a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8Zm4.4 0a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8ZM15.7 8.8c-3.3 0-6 2.3-6 5.2s2.7 5.2 6 5.2c.7 0 1.3-.1 1.9-.3l2 .1-.5-1.8c1.3-1 2.1-2.4 2.1-4.1 0-2.9-2.7-5.2-5.5-5.2Zm-1.8 4.6a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Zm3.6 0a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z"
      />
    </svg>
  );
}

export function SettingsSupportButton() {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<SupportChannel | null>(null);

  useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const copyChannel = async (channel: SupportChannel, value: string) => {
    try {
      await copyTextToClipboard(value);
      setCopied(channel);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(null), 1600);
    } catch (error) {
      console.error('[Spoor] support contact copy failed', error);
      setCopied(null);
    }
  };

  const rowClass =
    'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left hover:bg-[#F4F1ED] transition-colors';

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        data-testid="settings-support-button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t('settings.support')}
        title={t('settings.support')}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center justify-center w-8 h-8 rounded-md text-[#8c8a84] hover:text-[#C2410C] hover:bg-[#C2410C]/5 transition-colors"
      >
        <Headphones className="w-4 h-4" />
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label={t('settings.support')}
          data-testid="settings-support-panel"
          className="absolute right-0 top-full z-20 mt-1.5 w-[min(18.5rem,calc(100vw-3rem))] rounded-xl border border-[#E6E4DF] bg-white p-2 shadow-lg"
        >
          <p className="px-3 pt-1.5 pb-2 text-[11px] font-bold uppercase tracking-wider text-[#8c8a84]">
            {t('settings.support')}
          </p>
          <button
            type="button"
            data-testid="settings-support-copy-email"
            className={rowClass}
            onClick={() => void copyChannel('email', SUPPORT_EMAIL)}
          >
            <Mail className="w-3.5 h-3.5 shrink-0 text-[#C2410C]" />
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] font-bold uppercase tracking-wide text-[#8c8a84]">
                {t('settings.support_email')}
              </span>
              <span className="block truncate text-xs font-medium text-[#1a1a1a]">{SUPPORT_EMAIL}</span>
            </span>
            {copied === 'email' ? (
              <Check className="w-3.5 h-3.5 shrink-0 text-[#C2410C]" />
            ) : (
              <Copy className="w-3.5 h-3.5 shrink-0 text-[#8c8a84]" />
            )}
            <span className="sr-only">
              {copied === 'email' ? t('settings.support_copied') : t('settings.support_copy')}
            </span>
          </button>
          <button
            type="button"
            data-testid="settings-support-copy-wechat"
            className={rowClass}
            onClick={() => void copyChannel('wechat', SUPPORT_WECHAT)}
          >
            <WeChatGlyph className="w-3.5 h-3.5 shrink-0 text-[#C2410C]" />
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] font-bold uppercase tracking-wide text-[#8c8a84]">
                {t('settings.support_wechat')}
              </span>
              <span className="block truncate text-xs font-medium text-[#1a1a1a]">{SUPPORT_WECHAT}</span>
            </span>
            {copied === 'wechat' ? (
              <Check className="w-3.5 h-3.5 shrink-0 text-[#C2410C]" />
            ) : (
              <Copy className="w-3.5 h-3.5 shrink-0 text-[#8c8a84]" />
            )}
            <span className="sr-only">
              {copied === 'wechat' ? t('settings.support_copied') : t('settings.support_copy')}
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
