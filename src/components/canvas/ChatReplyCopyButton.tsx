import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Square, Volume2 } from 'lucide-react';
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
  trailingControls,
  children,
}: {
  text: string;
  showCopy: boolean;
  /** 复制按钮后面的附加控件（例如朗读/停止朗读）。 */
  trailingControls?: ReactNode;
  children: ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!showCopy) return;
    const host = hostRef.current;
    if (host) inlineLastTextBlock(host);
  });

  if (!showCopy) {
    return (
      <>
        {children}
        {trailingControls}
      </>
    );
  }
  return (
    <div ref={hostRef}>
      {children}
      <ChatReplyCopyButton text={text} />
      {trailingControls}
    </div>
  );
}

/**
 * 朗读 / 停止朗读一条回复。读完再点就是重播（每次都从头念）。
 * 只有配了 MiniMax TTS 才显示。
 */
export function ChatReplySpeakButton({
  speaking,
  spokenBefore,
  onSpeak,
  onStop,
}: {
  /** 正在读这一条。 */
  speaking: boolean;
  /** 这一条刚被读过，再点就是重播。 */
  spokenBefore: boolean;
  /** 开始读（缺省时只读模式不可用，但"停止"仍然要能点）。 */
  onSpeak?: () => void;
  onStop?: () => void;
}) {
  const { t } = useTranslation();
  const label = speaking
    ? t('voice.stop_tts')
    : t(spokenBefore ? 'canvas.v2.replay_reply' : 'canvas.v2.read_reply');

  return (
    <button
      type="button"
      data-testid={speaking ? 'chat-reply-tts-stop' : 'chat-reply-tts-speak'}
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (speaking) onStop?.();
        else onSpeak?.();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className={`ml-1 inline-flex h-5 w-5 shrink-0 align-middle items-center justify-center rounded-md transition-colors hover:bg-[#F4F1ED] hover:text-[#C2410C] ${
        speaking ? 'text-[#C2410C]' : 'text-[#b8b5ae]'
      }`}
    >
      {speaking ? (
        <Square className="h-3 w-3 fill-current" aria-hidden />
      ) : (
        <Volume2 className="h-3 w-3" aria-hidden />
      )}
    </button>
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
