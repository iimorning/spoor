import type { TFunction } from 'i18next';
import type { AppConfirmOptions } from '../components/AppDialogProvider';

/** Ask whether to open Settings (sign-in) after an AI API failure. */
export async function promptAiFailureOpenSettings(options: {
  confirm: (opts: AppConfirmOptions) => Promise<boolean>;
  t: TFunction;
  errorMessage: string;
  onOpenSettings?: () => void;
}): Promise<void> {
  const go = await options.confirm({
    title: options.t('nodes.ai_failed_title'),
    message: options.t('nodes.ai_failed_body', { message: options.errorMessage }),
    confirmLabel: options.t('nodes.ai_failed_open_settings'),
    cancelLabel: options.t('dialog.cancel'),
  });
  if (go) options.onOpenSettings?.();
}
