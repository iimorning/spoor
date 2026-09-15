/**
 * Painterly covers for the landing-page persona cards.
 * Unique gradient ids so both SVGs can sit on the same page.
 */

import React from 'react';

export function CautiousCover({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 240 320"
      className={className}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      role="img"
    >
      <defs>
        <linearGradient id="lp-caut-wall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f3e0c4" />
          <stop offset="100%" stopColor="#d9b896" />
        </linearGradient>
        <linearGradient id="lp-caut-floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a86b3a" />
          <stop offset="100%" stopColor="#6a3d1e" />
        </linearGradient>
        <radialGradient id="lp-caut-lamp" cx="0.42" cy="0.38" r="0.55">
          <stop offset="0%" stopColor="#ffe7b0" />
          <stop offset="55%" stopColor="#e8a45a" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#c47a32" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="lp-caut-wood" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7a3e1c" />
          <stop offset="100%" stopColor="#4a2110" />
        </linearGradient>
      </defs>
      <rect width="240" height="320" fill="url(#lp-caut-wall)" />
      <rect x="0" y="230" width="240" height="90" fill="url(#lp-caut-floor)" />
      {/* closed door */}
      <rect x="150" y="88" width="62" height="142" fill="url(#lp-caut-wood)" />
      <rect x="156" y="96" width="50" height="126" fill="none" stroke="#c9a07a" strokeWidth="1.2" opacity="0.5" />
      <circle cx="200" cy="160" r="3.2" fill="#e8c99a" />
      {/* lamp glow */}
      <ellipse cx="88" cy="150" rx="78" ry="90" fill="url(#lp-caut-lamp)" />
      {/* table */}
      <rect x="38" y="188" width="86" height="10" rx="1" fill="#5c3016" />
      <rect x="48" y="198" width="8" height="38" fill="#4a2410" />
      <rect x="106" y="198" width="8" height="38" fill="#4a2410" />
      {/* lamp */}
      <rect x="74" y="168" width="8" height="22" fill="#3d1f0c" />
      <path d="M64 168h28l-6-22H70z" fill="#f4d7a0" />
      <ellipse cx="78" cy="146" rx="16" ry="5" fill="#fff1c8" opacity="0.85" />
      {/* drawn curtain suggestion */}
      <path d="M18 48h52v110H18z" fill="#c45a2e" opacity="0.35" />
      <rect x="18" y="48" width="52" height="8" fill="#7e2500" opacity="0.45" />
    </svg>
  );
}

export function LeapCover({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 240 320"
      className={className}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      role="img"
    >
      <defs>
        <linearGradient id="lp-leap-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f7c98a" />
          <stop offset="45%" stopColor="#e07a45" />
          <stop offset="100%" stopColor="#8a3a22" />
        </linearGradient>
        <linearGradient id="lp-leap-path" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c4a07a" />
          <stop offset="100%" stopColor="#7a5230" />
        </linearGradient>
        <linearGradient id="lp-leap-frame" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#5a2e16" />
          <stop offset="100%" stopColor="#2e160c" />
        </linearGradient>
        <radialGradient id="lp-leap-sun" cx="0.62" cy="0.32" r="0.4">
          <stop offset="0%" stopColor="#fff3c4" />
          <stop offset="40%" stopColor="#f0b45a" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#e07a45" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="240" height="320" fill="url(#lp-leap-frame)" />
      {/* doorway looking out */}
      <rect x="28" y="28" width="184" height="264" fill="url(#lp-leap-sky)" />
      <ellipse cx="148" cy="108" rx="70" ry="58" fill="url(#lp-leap-sun)" />
      {/* hills */}
      <path d="M28 188c28-22 54-18 78-6 26-16 52-20 106-8v110H28z" fill="#6b3a22" />
      <path d="M28 214c40-14 72-8 112 10 22-12 48-16 72-6v74H28z" fill="#4a2414" />
      {/* path out */}
      <path d="M96 292c8-38 18-70 28-98 12 28 24 62 36 98z" fill="url(#lp-leap-path)" />
      {/* door frame inner */}
      <rect x="28" y="28" width="184" height="264" fill="none" stroke="#2e160c" strokeWidth="10" />
      <rect x="22" y="22" width="196" height="276" fill="none" stroke="#8a5a32" strokeWidth="3" opacity="0.5" />
    </svg>
  );
}
