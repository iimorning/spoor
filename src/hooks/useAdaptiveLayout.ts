import { useEffect, useState } from 'react';

/**
 * Independent layout signals — do not OR them into one "tablet" flag.
 *
 * compact: viewport narrower than Tailwind `xl` (1280px). Drawers, narrower
 *   side panels, fewer grid columns. A 1366×768 laptop stays desktop-shaped.
 * touchChrome: any coarse pointer (touchscreen, including 2-in-1 with a mouse).
 *   Larger hit targets and thumb-reachable chrome. Gestures still use
 *   pointerType, not this hook.
 * phone: a real handset — narrow *and* coarse. Pocket capture is the default
 *   home here; a resized desktop window stays on the canvas.
 *
 * CSS variants in `index.css` (`compact:` / `coarse:` / `phone:`) must stay
 * in lockstep with these media queries.
 */
export const COMPACT_MQ = '(max-width: 1279px)';
export const TOUCH_CHROME_MQ = '(any-pointer: coarse)';
export const PHONE_MQ = '(max-width: 767px) and (any-pointer: coarse)';

export type AdaptiveLayout = {
  compact: boolean;
  touchChrome: boolean;
  phone: boolean;
};

export function detectAdaptiveLayout(
  win: Pick<Window, 'matchMedia'> | undefined = typeof window === 'undefined' ? undefined : window,
): AdaptiveLayout {
  if (!win || typeof win.matchMedia !== 'function') {
    return { compact: false, touchChrome: false, phone: false };
  }
  return {
    compact: win.matchMedia(COMPACT_MQ).matches,
    touchChrome: win.matchMedia(TOUCH_CHROME_MQ).matches,
    phone: win.matchMedia(PHONE_MQ).matches,
  };
}

function listenMedia(query: MediaQueryList, onChange: () => void): () => void {
  if (query.addEventListener) {
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }
  query.addListener(onChange);
  return () => query.removeListener(onChange);
}

export function useAdaptiveLayout(): AdaptiveLayout {
  const [layout, setLayout] = useState<AdaptiveLayout>(detectAdaptiveLayout);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const compactQuery = window.matchMedia(COMPACT_MQ);
    const touchQuery = window.matchMedia(TOUCH_CHROME_MQ);
    const phoneQuery = window.matchMedia(PHONE_MQ);
    const update = () =>
      setLayout({
        compact: compactQuery.matches,
        touchChrome: touchQuery.matches,
        phone: phoneQuery.matches,
      });
    const unsubCompact = listenMedia(compactQuery, update);
    const unsubTouch = listenMedia(touchQuery, update);
    const unsubPhone = listenMedia(phoneQuery, update);
    update();
    return () => {
      unsubCompact();
      unsubTouch();
      unsubPhone();
    };
  }, []);

  return layout;
}
