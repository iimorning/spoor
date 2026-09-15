import React from 'react';
import { useTranslation } from 'react-i18next';
import { useCjkFontProgress } from '../hooks/useNoteCjk';

/** Top bar while a self-hosted CJK face is downloading (Zhuque or a selected trial face). */
export function CjkFontProgressBar() {
  const { t } = useTranslation();
  const { active, percent, indeterminate } = useCjkFontProgress();
  if (!active) return null;

  const label = indeterminate
    ? t('settings.font_loading')
    : `${t('settings.font_loading')} ${percent}%`;

  return (
    <div
      data-testid="cjk-font-progress"
      className="pointer-events-none fixed top-0 right-0 left-0 z-[300]"
      role="progressbar"
      aria-busy="true"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : percent}
      aria-label={label}
    >
      <div className="h-0.5 w-full bg-black/10">
        <div
          className={`h-full bg-[#C2410C] transition-[width] duration-150 ease-out ${
            indeterminate ? 'w-2/5 animate-pulse' : ''
          }`}
          style={indeterminate ? undefined : { width: `${percent}%` }}
        />
      </div>
      <p className="absolute top-1.5 right-3 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-sans font-medium tracking-wide text-[#5a5a54] shadow-sm">
        {label}
      </p>
    </div>
  );
}
