import { useTranslation } from 'react-i18next';
import { Smartphone } from 'lucide-react';
import { useAppDialog } from './AppDialogProvider';
import { useAdaptiveLayout } from '../hooks/useAdaptiveLayout';
import { usePwaInstall } from '../hooks/usePwaInstall';
import { isTauriRuntime } from '../utils/isTauriRuntime';

export function AddToHomeScreenPanel({ variant = 'default' }: { variant?: 'default' | 'phone' }) {
  const { t } = useTranslation();
  const { alert } = useAppDialog();
  const { phone, touchChrome } = useAdaptiveLayout();
  const { canNativePrompt, isInstalled, isIos, promptInstall } = usePwaInstall();

  if (isTauriRuntime() || isInstalled) return null;
  if (variant !== 'phone' && !phone && !touchChrome) return null;

  const onAdd = async () => {
    if (canNativePrompt) {
      await promptInstall();
      return;
    }
    await alert({
      title: t('settings.add_to_home_title'),
      message: isIos ? t('settings.add_to_home_ios') : t('settings.add_to_home_manual'),
    });
  };

  const buttonClass =
    variant === 'phone'
      ? 'w-full h-12 rounded-xl bg-[#C2410C]/5 text-[#C2410C] text-base font-bold hover:bg-[#C2410C]/10 transition-colors inline-flex items-center justify-center gap-2'
      : 'min-w-0 flex-1 flex items-center justify-center gap-1.5 h-9 px-2 rounded-lg bg-[#C2410C]/5 text-[#C2410C] text-xs font-bold hover:bg-[#C2410C]/10 transition-colors';

  return (
    <div className={variant === 'phone' ? 'space-y-3' : 'flex flex-col gap-2 min-w-0 flex-1'}>
      {variant === 'phone' ? (
        <p className="text-sm text-[#5a5a54] leading-relaxed">{t('settings.add_to_home_blurb')}</p>
      ) : null}
      <button
        type="button"
        data-testid="settings-add-to-home"
        onClick={() => void onAdd()}
        className={buttonClass}
      >
        <Smartphone className={variant === 'phone' ? 'w-5 h-5 shrink-0' : 'w-3.5 h-3.5 shrink-0'} />
        <span className="truncate">{t('settings.add_to_home_button')}</span>
      </button>
    </div>
  );
}
