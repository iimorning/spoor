import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useOverlayDismiss } from '../hooks/useOverlayDismiss';

export interface AppConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 危险操作（删除等）时主按钮用强调色 */
  variant?: 'default' | 'danger';
}

export interface AppAlertOptions {
  title?: string;
  message: string;
  okLabel?: string;
}

interface AppDialogContextValue {
  confirm: (options: AppConfirmOptions) => Promise<boolean>;
  alert: (options: AppAlertOptions) => Promise<void>;
}

const AppDialogContext = createContext<AppDialogContextValue | null>(null);

type DialogState =
  | { kind: 'confirm'; options: AppConfirmOptions }
  | { kind: 'alert'; options: AppAlertOptions }
  | null;

export function AppDialogProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<DialogState>(null);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const close = useCallback((result: boolean) => {
    resolveRef.current?.(result);
    resolveRef.current = null;
    setDialog(null);
  }, []);

  const confirm = useCallback(
    (options: AppConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        resolveRef.current = resolve;
        setDialog({ kind: 'confirm', options });
      }),
    [],
  );

  const alert = useCallback(
    (options: AppAlertOptions) =>
      new Promise<void>((resolve) => {
        resolveRef.current = (ok) => {
          if (ok) resolve();
        };
        setDialog({ kind: 'alert', options });
      }),
    [],
  );

  const dismissOverlay = useCallback(() => {
    if (!dialog) return;
    close(dialog.kind === 'confirm' ? false : true);
  }, [dialog, close]);
  const { onBackdropMouseDown } = useOverlayDismiss(Boolean(dialog), dismissOverlay);

  const title =
    dialog?.kind === 'confirm'
      ? dialog.options.title ?? t('dialog.confirm_title')
      : dialog?.kind === 'alert'
        ? dialog.options.title ?? t('dialog.alert_title')
        : '';

  const message = dialog?.options.message ?? '';
  const isDanger = dialog?.kind === 'confirm' && dialog.options.variant === 'danger';

  return (
    <AppDialogContext.Provider value={{ confirm, alert }}>
      {children}
      {dialog ? (
        <div
          className="fixed inset-0 z-[128] flex items-center justify-center p-4 bg-black/20 backdrop-blur-[2px]"
          role="presentation"
          data-testid="app-dialog-backdrop"
          onMouseDown={onBackdropMouseDown}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="app-dialog-title"
            aria-describedby="app-dialog-message"
            className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-[#E6E4DF] overflow-hidden animate-in zoom-in-95 duration-200"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="px-6 pt-6 pb-4 border-b border-[#F4F1ED] bg-[#FAF9F6]">
              <h2
                id="app-dialog-title"
                className="font-serif text-lg font-bold text-[#1a1a1a] leading-snug"
              >
                {title}
              </h2>
            </div>
            <p
              id="app-dialog-message"
              className="px-6 py-5 text-sm font-sans text-[#4a4a44] leading-relaxed whitespace-pre-wrap"
            >
              {message}
            </p>
            <div className="px-6 pb-6 flex flex-row-reverse flex-wrap gap-2 justify-start">
              {dialog.kind === 'confirm' ? (
                <>
                  <button
                    type="button"
                    autoFocus
                    onClick={() => close(true)}
                    className={`px-4 py-2 rounded-xl text-sm font-sans font-bold shadow-sm transition-colors ${
                      isDanger
                        ? 'bg-[#C2410C] text-white hover:bg-[#a0350a]'
                        : 'bg-[#1a1a1a] text-white hover:bg-[#333]'
                    }`}
                  >
                    {dialog.options.confirmLabel ?? t('dialog.confirm')}
                  </button>
                  <button
                    type="button"
                    onClick={() => close(false)}
                    className="px-4 py-2 rounded-xl text-sm font-sans font-medium border border-[#E6E4DF] text-[#5a5a54] bg-white hover:bg-[#F4F1ED] transition-colors"
                  >
                    {dialog.options.cancelLabel ?? t('dialog.cancel')}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  autoFocus
                  onClick={() => close(true)}
                  className="px-4 py-2 rounded-xl text-sm font-sans font-bold bg-[#1a1a1a] text-white hover:bg-[#333] shadow-sm transition-colors"
                >
                  {dialog.options.okLabel ?? t('dialog.ok')}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </AppDialogContext.Provider>
  );
}

export function useAppDialog(): AppDialogContextValue {
  const ctx = useContext(AppDialogContext);
  if (!ctx) {
    throw new Error('useAppDialog must be used within AppDialogProvider');
  }
  return ctx;
}
