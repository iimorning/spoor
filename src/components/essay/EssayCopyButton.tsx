import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Loader2 } from 'lucide-react';
import { useAppDialog } from '../AppDialogProvider';
import { copyTextToClipboard } from '../../utils/copyTextToClipboard';
import { formatEssayCopyText } from '../../utils/formatEssayCopyText';
import type { EssayExportDoc } from '../../utils/essayExport';

export interface EssayCopyButtonProps {
  disabled?: boolean;
  getDoc: () => EssayExportDoc;
}

export function EssayCopyButton({ disabled, getDoc }: EssayCopyButtonProps) {
  const { t } = useTranslation();
  const { alert: appAlert } = useAppDialog();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    },
    [],
  );

  const onCopy = async () => {
    if (disabled || busy) return;
    setBusy(true);
    try {
      const doc = getDoc();
      await copyTextToClipboard(formatEssayCopyText(doc));
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 1600);
    } catch (error) {
      console.error('[Spoor] essay copy failed', error);
      await appAlert({ message: t('nodes.essay_copy_failed') });
    } finally {
      setBusy(false);
    }
  };

  const label = copied ? t('nodes.essay_copy_done') : t('nodes.essay_copy');

  return (
    <button
      type="button"
      data-testid="essay-copy-all"
      disabled={disabled || busy}
      onClick={() => void onCopy()}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[#EAE7E2] hover:text-[#C2410C] disabled:opacity-40 ${
        copied ? 'bg-[#FFF7ED] text-[#C2410C]' : 'text-[#8c8a84]'
      }`}
      title={label}
      aria-label={label}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : copied ? (
        <Check className="h-4 w-4" />
      ) : (
        <Copy className="h-4 w-4" />
      )}
    </button>
  );
}
