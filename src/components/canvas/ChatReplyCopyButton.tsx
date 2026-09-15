import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy } from 'lucide-react';
import { useAppDialog } from '../AppDialogProvider';
import { copyTextToClipboard } from '../../utils/copyTextToClipboard';

const INLINE_LAST_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE']);

function inlineLastTextBlock(host: HTMLElement) {
  let last: Element | undefined;
  for (let i = host.children.length - 1; i >= 0; i -= 1) {
    const node = host.children[i];
    if (node.getAttribute('data-testid') !== 'chat-reply-copy') {
      last = node;
      break;
    }
  }
  if (!(last instanceof HTMLElement)) return;
  if (!INLINE_LAST_TAGS.has(last.tagName) && !last.hasAttribute('data-chat-reply-prose')) return;
  last.style.display = 'inline';
  last.style.margin = '0';
}

/** Sit the copy control on the last text line instead of wrapping to a new row. */
export function ChatReplyCopyHost({
  text,
  showCopy,
  children,
}: {
  text: string;
  showCopy: boolean;
  children: ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!showCopy) return;
    const host = hostRef.current;
    if (host) inlineLastTextBlock(host);
  });

  if (!showCopy) return children;
  return (
    <div ref={hostRef}>
      {children}
      <ChatReplyCopyButton text={text} />
    </div>
  );
}

export function ChatReplyCopyButton({ text }: { text: string }) {
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
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      await copyTextToClipboard(value);
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 1600);
    } catch (error) {
      console.error('[Spoor] chat reply copy failed', error);
      await appAlert({ message: t('canvas.v2.copy_reply_failed') });
    } finally {
      setBusy(false);
    }
  };

  const label = copied ? t('canvas.v2.copy_reply_done') : t('canvas.v2.copy_reply');

  return (
    <button
      type="button"
      data-testid="chat-reply-copy"
      disabled={busy}
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void onCopy();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className={`ml-1 inline-flex h-5 w-5 shrink-0 align-middle items-center justify-center rounded-md transition-colors hover:bg-[#F4F1ED] hover:text-[#C2410C] disabled:opacity-40 ${
        copied ? 'text-[#C2410C]' : 'text-[#b8b5ae]'
      }`}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}
