import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { History, SquarePen } from 'lucide-react';

export type ChatSessionListItem = {
  id: string;
  preview: string;
  endedAt: number;
};

export function ChatSidebarSessionControls({
  testIdPrefix,
  disabled,
  busy,
  canNewChat,
  archivedSessions,
  historyOpen,
  onHistoryOpenChange,
  onNewChat,
  onViewSession,
}: {
  testIdPrefix: string;
  disabled?: boolean;
  busy?: boolean;
  canNewChat: boolean;
  archivedSessions: ChatSessionListItem[];
  historyOpen: boolean;
  onHistoryOpenChange: (open: boolean) => void;
  onNewChat: () => void | Promise<void>;
  onViewSession: (sessionId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const historyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!historyOpen) return;
    const onDocPointerDown = (e: PointerEvent) => {
      if (historyRef.current?.contains(e.target as Node)) return;
      onHistoryOpenChange(false);
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => document.removeEventListener('pointerdown', onDocPointerDown);
  }, [historyOpen, onHistoryOpenChange]);

  return (
    <div ref={historyRef} className="relative flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        data-testid={`${testIdPrefix}-history`}
        disabled={disabled || busy || archivedSessions.length === 0}
        className="flex h-8 w-8 items-center justify-center rounded-full text-[#5a5a54] transition-colors hover:bg-[#F4F1ED] hover:text-[#C2410C] disabled:opacity-30"
        title={t('reference.essay_chat_history')}
        aria-label={t('reference.essay_chat_history')}
        aria-expanded={historyOpen}
        onClick={() => onHistoryOpenChange(!historyOpen)}
      >
        <History className="h-4 w-4" />
      </button>
      <button
        type="button"
        data-testid={`${testIdPrefix}-new`}
        disabled={disabled || busy || !canNewChat}
        className="flex h-8 w-8 items-center justify-center rounded-full text-[#5a5a54] transition-colors hover:bg-[#F4F1ED] hover:text-[#C2410C] disabled:opacity-30"
        title={t('reference.essay_chat_new')}
        aria-label={t('reference.essay_chat_new')}
        onClick={() => {
          onHistoryOpenChange(false);
          void onNewChat();
        }}
      >
        <SquarePen className="h-4 w-4" />
      </button>
      {historyOpen ? (
        <div
          data-testid={`${testIdPrefix}-history-menu`}
          className="absolute right-0 top-full z-20 mt-1 max-h-64 w-[min(18rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-[#E6E4DF] bg-white py-1 shadow-lg"
        >
          {archivedSessions.length === 0 ? (
            <p className="px-3 py-2 text-xs tracking-[0.04em] text-[#8c8a84]">
              {t('reference.essay_chat_history_empty')}
            </p>
          ) : (
            archivedSessions.map((session) => (
              <button
                key={session.id}
                type="button"
                data-testid={`${testIdPrefix}-history-item-${session.id}`}
                className="flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors hover:bg-[#FAF9F6]"
                onClick={() => {
                  onViewSession(session.id);
                  onHistoryOpenChange(false);
                }}
              >
                <span className="line-clamp-2 text-[13px] leading-snug tracking-[0.02em] text-[#2c2c28]">
                  {session.preview || t('reference.essay_chat_history_untitled')}
                </span>
                <span className="text-[11px] tracking-[0.02em] text-[#8a8a82]">
                  {new Date(session.endedAt).toLocaleString(i18n.language, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
