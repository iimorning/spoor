import { useEffect, type MouseEvent } from 'react';

/** Close an overlay on Escape or a mousedown on the dimmed backdrop. */
export function useOverlayDismiss(active: boolean, onDismiss: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onDismiss();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, onDismiss]);

  const onBackdropMouseDown = (e: MouseEvent<HTMLElement>) => {
    if (e.target === e.currentTarget) onDismiss();
  };

  return { onBackdropMouseDown };
}
