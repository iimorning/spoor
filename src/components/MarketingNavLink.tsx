import type { MouseEvent, ReactNode } from 'react';

/** Same-origin marketing links: real hrefs for crawlers, pushState for the SPA. */
export function MarketingNavLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (window.location.pathname !== href) {
      window.history.pushState({}, '', href);
    }
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  return (
    <a href={href} className={className} onClick={onClick}>
      {children}
    </a>
  );
}
