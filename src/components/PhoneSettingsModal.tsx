import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NOTE_CJK_IDS, noteCjkPreviewFamily, useNoteCjk } from '../hooks/useNoteCjk';
import { AddToHomeScreenPanel } from './AddToHomeScreenPanel';

export function PhoneSettingsModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { id: noteCjk, setNoteCjk } = useNoteCjk();
  if (!isOpen) return null;

  const chipIdle = 'text-[#8c8a84] hover:text-[#5a5a54]';
  const chipActive = 'text-[#C2410C]';

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-[#FAF9F6] paper-texture"
      data-testid="settings-modal-phone"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-phone-title"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#E6E4DF]/80 bg-[#FAF9F6] px-7 pb-3 pt-[calc(1.25rem+env(safe-area-inset-top))]">
        <h2
          id="settings-phone-title"
          className="min-w-0 truncate text-2xl font-serif text-[#1a1a1a]"
        >
          {t('settings.title')}
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label="English"
            title="English"
            onClick={() => {
              void i18n.changeLanguage('en');
              localStorage.setItem('app_language', 'en');
            }}
            className={`flex h-8 w-8 items-center justify-center rounded-md text-[11px] font-bold tracking-wide transition-colors ${
              i18n.language === 'en' ? chipActive : chipIdle
            }`}
          >
            EN
          </button>
          <button
            type="button"
            aria-label="中文"
            title="中文"
            onClick={() => {
              void i18n.changeLanguage('zh');
              localStorage.setItem('app_language', 'zh');
            }}
            className={`flex h-8 w-8 items-center justify-center rounded-md text-sm font-bold transition-colors ${
              i18n.language === 'zh' ? chipActive : chipIdle
            }`}
          >
            中
          </button>
          <button
            type="button"
            aria-label={t('settings.close')}
            onClick={onClose}
            className="rounded-full p-2 transition-colors hover:bg-[#EAE7E2]"
          >
            <X className="h-5 w-5 text-[#8c8a84]" />
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        <div className="mt-8 space-y-2 border-t border-[#F4F1ED] pt-6">
          <p
            id="phone-settings-note-cjk-label"
            className="text-sm font-mono font-bold uppercase tracking-wider text-[#5a5a54]"
          >
            {t('settings.note_cjk')}
          </p>
          <div
            data-testid="phone-settings-note-cjk"
            aria-labelledby="phone-settings-note-cjk-label"
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
                  className={`h-8 rounded-md px-2.5 text-sm outline-none ring-0 shadow-none focus:outline-none focus:ring-0 focus-visible:outline-none ${
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
            data-testid="phone-settings-note-cjk-preview"
            className="text-[15px] leading-relaxed text-[#4a4a44]"
            style={{ fontFamily: noteCjkPreviewFamily(noteCjk) }}
          >
            随手记下灵感 · The quick brown fox
          </p>
        </div>
        <div className="mt-8 border-t border-[#F4F1ED] pt-6">
          <AddToHomeScreenPanel variant="phone" />
        </div>
      </div>
    </div>
  );
}
