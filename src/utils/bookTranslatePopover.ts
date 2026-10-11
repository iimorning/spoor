/**
 * 划词翻译浮层挂在选区上方还是下方。
 *
 * 抽成纯函数是因为这件事**量的是真实布局**：浮层多高、视口多高，都在
 * useLayoutEffect 里现量，jsdom 里 offsetHeight 恒为 0，挂在组件上根本测不出来
 * （试过——把翻转关掉，单测照样全绿）。判断本身没有副作用，单独拿出来测才对。
 */

export type TranslatePopoverSide = 'below' | 'above';

export function pickTranslatePopoverSide({
  selectionTop,
  selectionBottom,
  popoverHeight,
  viewportHeight,
  margin = 12,
  gap = 10,
}: {
  selectionTop: number;
  selectionBottom: number;
  popoverHeight: number;
  viewportHeight: number;
  margin?: number;
  gap?: number;
}): TranslatePopoverSide {
  const fitsBelow = selectionBottom + gap + popoverHeight <= viewportHeight - margin;
  if (fitsBelow) return 'below';
  // 下方放不下，再看上方是不是**真的**塞得下——不是"上方坐标小不小"，
  // 是"上方那条缝装不装得下这块面板"。
  const fitsAbove = selectionTop - gap - popoverHeight >= margin;
  return fitsAbove ? 'above' : 'below';
}
