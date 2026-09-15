/**
 * Inline-SVG thumbnails for the AI web-search preview on the landing page.
 *
 * Each result row needs a small thumbnail that visually matches the source
 * site so the card doesn't look like it's recycling random project assets.
 * Real search engines usually render a favicon-sized mark here, so we draw
 *   - a globe-like Wikipedia wordmark for the en.wikipedia.org result,
 *   - a vintage book / journal mark for the Aeon essay,
 *   - a brain silhouette for the Trends in Cognitive Sciences paper.
 */

import React from 'react';

export function LandingAiSearchResultThumb({
  kind,
  className,
}: {
  kind: 'wikipedia' | 'aeon' | 'journal';
  className?: string;
}) {
  if (kind === 'wikipedia') {
    return (
      <svg
        viewBox="0 0 56 40"
        className={className}
        aria-hidden
        role="img"
      >
        <defs>
          <radialGradient id="ai-wiki-globe" cx="0.35" cy="0.35" r="0.85">
            <stop offset="0%" stopColor="#bfbfbf" />
            <stop offset="60%" stopColor="#7d7d7d" />
            <stop offset="100%" stopColor="#3a3a3a" />
          </radialGradient>
        </defs>
        <rect width="56" height="40" fill="#ffffff" />
        {/* Globe */}
        <circle cx="28" cy="20" r="14" fill="url(#ai-wiki-globe)" />
        {/* Meridian + equator lines — light strokes hint at the wiki globe */}
        <ellipse cx="28" cy="20" rx="14" ry="6" fill="none" stroke="#1a1a1a" strokeOpacity="0.25" strokeWidth="1" />
        <ellipse cx="28" cy="20" rx="6" ry="14" fill="none" stroke="#1a1a1a" strokeOpacity="0.25" strokeWidth="1" />
        <line x1="14" y1="20" x2="42" y2="20" stroke="#1a1a1a" strokeOpacity="0.25" strokeWidth="1" />
        {/* The "W" wordmark sits below the globe in classic Wikipedia style */}
        <text
          x="28"
          y="38"
          textAnchor="middle"
          fontFamily="Helvetica, Arial, sans-serif"
          fontSize="5"
          fontWeight="700"
          fill="#1a1a1a"
          letterSpacing="0.5"
        >
          WIKIPEDIA
        </text>
      </svg>
    );
  }

  if (kind === 'aeon') {
    return (
      <svg viewBox="0 0 56 40" className={className} aria-hidden role="img">
        <rect width="56" height="40" fill="#fbf6ee" />
        {/* Open book / journal — drawn at a slight tilt for a literary feel */}
        <g transform="translate(28 20) rotate(-3)">
          <path
            d="M -16 -8 L 0 -10 L 16 -8 L 16 8 L 0 6 L -16 8 Z"
            fill="#fff"
            stroke="#7e2500"
            strokeWidth="1.2"
          />
          <line x1="0" y1="-10" x2="0" y2="6" stroke="#7e2500" strokeWidth="1" />
          {/* Text lines */}
          <line x1="-12" y1="-4" x2="-3" y2="-4.6" stroke="#7e2500" strokeOpacity="0.5" strokeWidth="0.8" />
          <line x1="-12" y1="0" x2="-3" y2="-0.5" stroke="#7e2500" strokeOpacity="0.5" strokeWidth="0.8" />
          <line x1="-12" y1="4" x2="-3" y2="3.6" stroke="#7e2500" strokeOpacity="0.5" strokeWidth="0.8" />
          <line x1="3" y1="-4.6" x2="12" y2="-4" stroke="#7e2500" strokeOpacity="0.5" strokeWidth="0.8" />
          <line x1="3" y1="-0.5" x2="12" y2="0" stroke="#7e2500" strokeOpacity="0.5" strokeWidth="0.8" />
          <line x1="3" y1="3.6" x2="12" y2="4" stroke="#7e2500" strokeOpacity="0.5" strokeWidth="0.8" />
        </g>
        {/* Aeon wordmark */}
        <text
          x="28"
          y="38"
          textAnchor="middle"
          fontFamily="Georgia, 'Times New Roman', serif"
          fontSize="5"
          fontStyle="italic"
          fill="#7e2500"
          letterSpacing="0.6"
        >
          Æ Aeon
        </text>
      </svg>
    );
  }

  // 'journal' — neuroscience paper, Trends in Cognitive Sciences
  return (
    <svg viewBox="0 0 56 40" className={className} aria-hidden role="img">
      <rect width="56" height="40" fill="#fff7ed" />
      {/* Brain silhouette in profile — left hemisphere outline */}
      <g transform="translate(15 22)">
        <path
          d="M 0 0 C -4 -8, -2 -14, 4 -14 C 8 -14, 12 -10, 12 -4 C 14 -2, 14 2, 12 4 C 12 10, 8 14, 4 14 C -2 14, -4 8, 0 0 Z"
          fill="#7e2500"
          opacity="0.85"
        />
        {/* Sulci lines */}
        <path d="M 4 -8 C 6 -6, 6 -2, 4 0" stroke="#fff7ed" strokeWidth="0.8" fill="none" />
        <path d="M 8 -4 C 6 -2, 6 2, 8 4" stroke="#fff7ed" strokeWidth="0.8" fill="none" />
        <path d="M 2 4 C 4 6, 4 10, 2 12" stroke="#fff7ed" strokeWidth="0.8" fill="none" />
      </g>
      {/* Small journal wordmark */}
      <text
        x="32"
        y="22"
        textAnchor="middle"
        fontFamily="Helvetica, Arial, sans-serif"
        fontSize="3.6"
        fontWeight="700"
        fill="#7e2500"
        letterSpacing="0.4"
      >
        CELL PRESS
      </text>
      <text
        x="32"
        y="28"
        textAnchor="middle"
        fontFamily="Georgia, serif"
        fontSize="3"
        fontStyle="italic"
        fill="#5a5a54"
      >
        Trends · Cog. Sci.
      </text>
    </svg>
  );
}