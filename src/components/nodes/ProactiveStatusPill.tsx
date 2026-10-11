import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ProactiveStatus } from '../../hooks/useRoomProactiveChat';

/**
 * 角色卡上的主动发言提示态。
 *
 * 只在"读"的那几十秒里出现，之后自己消失——不做常驻开关。开关在侧边栏
 * 右上角，那是它该待的地方：卡上放一个能点的东西会和卡片本身的拖拽、
 * 连线手柄打架。
 */
export function ProactiveStatusPill({ status }: { status?: ProactiveStatus }) {
  const { t } = useTranslation();
  if (!status) return null;
  const label =
    status.phase === 'thinking'
      ? t('canvas.v2.proactive_thinking')
      : t('canvas.v2.proactive_pending', { count: status.cardCount });
  return (
    <div
      data-testid="proactive-status-pill"
      data-phase={status.phase}
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center pb-2"
    >
      <span className="flex items-center gap-1.5 rounded-full border border-[#C2410C]/25 bg-white/85 px-2.5 py-1 text-[12px] leading-none text-[#8c8a84] shadow-sm backdrop-blur-md">
        {status.phase === 'thinking' ? (
          <span
            className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[#C2410C]"
            aria-hidden
          />
        ) : (
          <span className="shrink-0 font-mono text-[11px] text-[#C2410C]" aria-hidden>
            {status.cardCount}
          </span>
        )}
        {label}
      </span>
    </div>
  );
}
