import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, FileDown, FileText, Loader2 } from 'lucide-react';
import { useAppDialog } from '../AppDialogProvider';
import { downloadBlob, essayExportFilename } from '../../utils/downloadBlob';
import { copyTextToClipboard } from '../../utils/copyTextToClipboard';
import { formatEssayCopyText } from '../../utils/formatEssayCopyText';
import { formatEssayCopyHtml } from '../../utils/formatEssayCopyHtml';
import {
  exportEssayAsDocx,
  exportEssayAsPdf,
  type EssayExportDoc,
} from '../../utils/essayExport';

export interface EssayExportMenuProps {
  disabled?: boolean;
  getDoc: () => EssayExportDoc;
}

export function EssayExportMenu({ disabled, getDoc }: EssayExportMenuProps) {
  const { t } = useTranslation();
  const { alert: appAlert } = useAppDialog();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'docx' | 'pdf' | 'copy' | null>(null);
  /**
   * 「复制全文」也住在这个菜单里，但菜单点完就关，没有地方显示成功。
   * 所以确认态挂在这颗触发按钮上——它本来就会为导出转圈，是现成的反馈位。
   */
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    },
    [],
  );

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, close]);

  const runExport = async (kind: 'docx' | 'pdf') => {
    if (disabled || busy) return;
    setBusy(kind);
    close();
    try {
      const doc = getDoc();
      const labels = {
        author: t('reference.author_label'),
        published: t('reference.published_label'),
      };
      if (kind === 'docx') {
        const blob = await exportEssayAsDocx(doc, labels);
        downloadBlob(blob, essayExportFilename(doc.title, 'docx'));
      } else {
        await exportEssayAsPdf(doc, labels);
      }
    } catch (error) {
      console.error('[Spoor] essay export failed', error);
      await appAlert({ message: t('nodes.essay_export_failed') });
    } finally {
      setBusy(null);
    }
  };

  const runCopy = async () => {
    if (disabled || busy) return;
    setBusy('copy');
    close();
    try {
      const doc = getDoc();
      // 两份都写：纯文本给记事本/聊天框，富文本给 Word/飞书/Google Docs。
      await copyTextToClipboard(formatEssayCopyText(doc), { html: formatEssayCopyHtml(doc) });
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 1600);
    } catch (error) {
      console.error('[Spoor] essay copy failed', error);
      await appAlert({ message: t('nodes.essay_copy_failed') });
    } finally {
      setBusy(null);
    }
  };

  const triggerLabel = copied
    ? t('nodes.essay_copy_done')
    : busy
      ? t('nodes.essay_exporting')
      : t('nodes.essay_export');

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        data-testid="essay-export-menu"
        disabled={disabled || Boolean(busy)}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[#EAE7E2] hover:text-[#C2410C] disabled:opacity-40 ${
          open ? 'bg-[#FFF7ED] text-[#C2410C]' : 'text-[#8c8a84]'
        }`}
        title={triggerLabel}
        aria-label={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : copied ? (
          <Check className="h-4 w-4 text-[#C2410C]" />
        ) : (
          <FileDown className="h-4 w-4" />
        )}
      </button>
      {open ? (
        <div
          role="menu"
          data-testid="essay-export-menu-panel"
          className="absolute right-0 top-[calc(100%+6px)] z-20 min-w-[11rem] rounded-lg border border-[#E6E4DF] bg-white py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            data-testid="essay-copy-all"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-sans font-semibold text-[#5a5a54] hover:bg-[#FFF7ED] hover:text-[#C2410C]"
            onClick={() => void runCopy()}
          >
            <Copy className="w-4 h-4" />
            {t('nodes.essay_copy')}
          </button>
          {/* 复制不是"格式"，和下面两条隔一道，免得读成同一组。 */}
          <div className="my-1 border-t border-[#E6E4DF]" role="separator" />
          <button
            type="button"
            role="menuitem"
            data-testid="essay-export-word"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-sans font-semibold text-[#5a5a54] hover:bg-[#FFF7ED] hover:text-[#C2410C]"
            onClick={() => void runExport('docx')}
          >
            <FileText className="w-4 h-4" />
            {t('nodes.essay_export_word')}
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="essay-export-pdf"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-sans font-semibold text-[#5a5a54] hover:bg-[#FFF7ED] hover:text-[#C2410C]"
            onClick={() => void runExport('pdf')}
          >
            <FileText className="w-4 h-4" />
            {t('nodes.essay_export_pdf')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
