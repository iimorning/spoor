import './onboardingCanvasArrow.css';

function arrowGeometry(from: DOMRect, to: DOMRect) {
  const x1 = from.left + 10;
  const y1 = from.top + from.height / 2;
  const x2 = to.right - 14;
  const y2 = to.top + to.height / 2;
  const bend = Math.min(56, Math.max(20, (x1 - x2) * 0.14));
  const cx1 = x1 - bend;
  const cx2 = x2 + bend;
  const path = `M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`;
  const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  return { path, x2, y2, angle };
}

export function OnboardingCanvasArrow({
  from,
  to,
  className = 'ob-canvas-arrow pointer-events-none absolute inset-0 z-[1] h-full w-full',
}: {
  from: DOMRect;
  to: DOMRect;
  className?: string;
}) {
  const { path, x2, y2, angle } = arrowGeometry(from, to);

  return (
    <svg
      data-testid="onboarding-canvas-arrow"
      className={className}
      aria-hidden
    >
      <defs>
        <filter id="ob-canvas-arrow-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor="rgb(194 65 12 / 0.45)" />
        </filter>
      </defs>
      <path d={path} className="ob-canvas-arrow__path" filter="url(#ob-canvas-arrow-glow)" />
      <g transform={`translate(${x2} ${y2}) rotate(${angle})`}>
        <path className="ob-canvas-arrow__head" d="M -16 -7 L 0 0 L -16 7 Z" />
      </g>
    </svg>
  );
}
