import { useTranslation } from 'react-i18next';

export function ChatSuggestedFollowUps({
  questions,
  disabled = false,
  onSelect,
}: {
  questions: string[];
  disabled?: boolean;
  onSelect: (question: string) => void;
}) {
  const { t } = useTranslation();
  const items = questions.map((q) => q.trim()).filter(Boolean);
  if (items.length === 0) return null;

  return (
    <div
      className="mt-1.5 flex w-full min-w-0 flex-col items-start gap-1 self-stretch"
      data-testid="chat-suggested-follow-ups"
      aria-label={t('canvas.v2.suggested_follow_ups', { defaultValue: 'Related questions' })}
    >
      {items.map((question) => (
        <button
          key={question}
          type="button"
          data-testid="chat-suggested-follow-up"
          disabled={disabled}
          className="max-w-full rounded-lg px-2.5 py-1.5 text-left text-sm leading-relaxed tracking-[0.02em] text-[#5a5a54] transition-colors hover:bg-[#FFF7ED] hover:text-[#C2410C] disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => onSelect(question)}
        >
          {question}
        </button>
      ))}
    </div>
  );
}
