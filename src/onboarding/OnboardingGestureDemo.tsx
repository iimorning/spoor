/**
 * Looping gesture cartoons for the onboarding tooltip.
 * Decorative — the adjacent copy is the accessible explanation.
 */
import './onboardingGestureDemo.css';

export type OnboardingGestureDemoKind = 'marquee' | 'pan' | 'drag-in';

function Cursor({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#1a1a1a"
        stroke="#fff"
        strokeWidth="1.25"
        d="M5.2 3.1 18.6 14.2l-6.1.4 3.6 6.7-2.7 1.4-3.6-6.8-4.1 4.2z"
      />
    </svg>
  );
}

function MarqueeDemo() {
  return (
    <div className="ob-demo" data-testid="onboarding-demo-marquee">
      <div className="ob-demo-stage">
        <div className="ob-demo-card ob-demo-card--a" />
        <div className="ob-demo-card ob-demo-card--b" />
        <div className="ob-demo-card ob-demo-card--c" />
        <div className="ob-demo-marquee" />
        <Cursor className="ob-demo-cursor ob-demo-cursor--marquee" />
      </div>
    </div>
  );
}

function PanDemo() {
  return (
    <div className="ob-demo" data-testid="onboarding-demo-pan">
      <div className="ob-demo-stage ob-demo-stage--pan">
        <div className="ob-demo-pan-world">
          <div className="ob-demo-card ob-demo-card--p1" />
          <div className="ob-demo-card ob-demo-card--p2" />
          <div className="ob-demo-card ob-demo-card--p3" />
        </div>
        <div className="ob-demo-mouse" aria-hidden>
          <span className="ob-demo-mouse-wheel" />
        </div>
        <Cursor className="ob-demo-cursor ob-demo-cursor--pan" />
      </div>
    </div>
  );
}

function DragInDemo() {
  return (
    <div className="ob-demo" data-testid="onboarding-demo-drag-in">
      <div className="ob-demo-stage ob-demo-stage--drag-in">
        <div className="ob-demo-room" aria-hidden />
        <div className="ob-demo-card ob-demo-card--outside" aria-hidden>
          <span className="ob-demo-drag-handle" aria-hidden />
        </div>
        <div className="ob-demo-card ob-demo-card--inside" aria-hidden />
        <Cursor className="ob-demo-cursor ob-demo-cursor--drag-in" />
      </div>
    </div>
  );
}

export function OnboardingGestureDemo({ kind }: { kind: OnboardingGestureDemoKind }) {
  if (kind === 'marquee') return <MarqueeDemo />;
  if (kind === 'drag-in') return <DragInDemo />;
  return <PanDemo />;
}
