/**
 * Inline-SVG illustration rendered in the AI-generation preview card on
 * the landing page. The prompt is "a quiet reading room at sunset, oil
 * paint", and this drawing tries to match it: a wall of bookshelves,
 * a tall window on the right letting in warm ochre sunset light, an
 * armchair in the foreground. Painterly feel comes from soft gradient
 * washes and a hand-drawn texture overlay — no external asset needed.
 */

import React from 'react';

export function LandingAiGeneratedImage({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 480 360"
      className={className}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      role="img"
    >
      <defs>
        {/* Warm sunset sky behind the window */}
        <linearGradient id="ai-room-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f8d39a" />
          <stop offset="55%" stopColor="#e89a5e" />
          <stop offset="100%" stopColor="#a64a2e" />
        </linearGradient>

        {/* Sun glow inside the window */}
        <radialGradient id="ai-room-sun" cx="0.62" cy="0.42" r="0.45">
          <stop offset="0%" stopColor="#fff2c5" />
          <stop offset="35%" stopColor="#f9c46b" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#e89a5e" stopOpacity="0" />
        </radialGradient>

        {/* Warm wash on the back wall */}
        <linearGradient id="ai-room-wall" x1="1" y1="0.2" x2="0" y2="1">
          <stop offset="0%" stopColor="#f8e3c2" />
          <stop offset="100%" stopColor="#d6b18a" />
        </linearGradient>

        {/* Floor — deep ochre gradient */}
        <linearGradient id="ai-room-floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a66a3d" />
          <stop offset="100%" stopColor="#5e3a20" />
        </linearGradient>

        {/* Armchair — burnt sienna */}
        <linearGradient id="ai-room-chair" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8a3a18" />
          <stop offset="100%" stopColor="#4d1f0c" />
        </linearGradient>

        {/* Bookshelf wood */}
        <linearGradient id="ai-room-wood" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6b3a1d" />
          <stop offset="100%" stopColor="#3d1f0c" />
        </linearGradient>

        {/* Paint texture overlay — light noise to break up the gradients */}
        <filter id="ai-room-grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" />
          <feColorMatrix values="0 0 0 0 0
                                 0 0 0 0 0
                                 0 0 0 0 0
                                 0 0 0 0.08 0" />
        </filter>
      </defs>

      {/* Back wall (warm wash) */}
      <rect x="0" y="0" width="480" height="260" fill="url(#ai-room-wall)" />

      {/* Tall window on the right — frame + sunset sky */}
      <g>
        <rect x="288" y="32" width="160" height="200" fill="url(#ai-room-sky)" />
        {/* Sun bloom */}
        <rect x="288" y="32" width="160" height="200" fill="url(#ai-room-sun)" />
        {/* Mullions */}
        <rect x="287" y="32" width="162" height="6" fill="#3d1f0c" />
        <rect x="287" y="226" width="162" height="8" fill="#3d1f0c" />
        <rect x="287" y="32" width="6" height="202" fill="#3d1f0c" />
        <rect x="365" y="32" width="4" height="202" fill="#3d1f0c" opacity="0.6" />
        <rect x="287" y="125" width="162" height="4" fill="#3d1f0c" opacity="0.5" />
        {/* Distant tree silhouette — gives the window a horizon */}
        <path
          d="M 290 220 L 300 200 L 308 215 L 316 195 L 326 218 L 334 205 L 342 220 L 350 200 L 358 215 L 366 195 L 376 220 L 384 205 L 392 218 L 400 200 L 410 220 L 418 210 L 426 220 L 434 200 L 444 220 Z"
          fill="#3d1f0c"
          opacity="0.4"
        />
      </g>

      {/* Sunlight wash spilling onto the floor from the window */}
      <path
        d="M 270 232 L 470 232 L 470 360 L 270 360 Z"
        fill="#f6c97e"
        opacity="0.55"
      />

      {/* Floor */}
      <rect x="0" y="232" width="480" height="128" fill="url(#ai-room-floor)" />
      {/* Floor horizon line */}
      <line x1="0" y1="232" x2="480" y2="232" stroke="#3d1f0c" strokeOpacity="0.4" strokeWidth="1" />

      {/* Bookshelf on the left — two shelves of books */}
      <g>
        <rect x="20" y="40" width="220" height="220" fill="url(#ai-room-wood)" />
        {/* Shelf planks */}
        <rect x="14" y="148" width="232" height="6" fill="#2d160a" />
        {/* Books — top shelf (warm tones) */}
        {[
          [26, 50, 18, 90, '#7e2500'],
          [46, 56, 14, 86, '#3d1f0c'],
          [62, 50, 22, 92, '#a64a2e'],
          [86, 56, 16, 86, '#5a2c14'],
          [104, 50, 20, 92, '#8a3a18'],
          [126, 54, 14, 88, '#2d160a'],
          [142, 50, 18, 92, '#a63400'],
          [162, 56, 16, 86, '#5e3a20'],
          [180, 50, 22, 92, '#7e2500'],
          [204, 54, 14, 88, '#3d1f0c'],
          [220, 56, 16, 86, '#8a3a18'],
        ].map(([x, y, w, h, c], i) => (
          <rect
            key={`top-${i}`}
            x={x as number}
            y={y as number}
            width={w as number}
            height={h as number}
            fill={c as string}
          />
        ))}
        {/* Books — bottom shelf */}
        {[
          [26, 158, 18, 78, '#5e3a20'],
          [46, 162, 14, 74, '#a63400'],
          [62, 158, 22, 78, '#3d1f0c'],
          [86, 162, 16, 74, '#8a3a18'],
          [104, 158, 20, 78, '#7e2500'],
          [126, 164, 14, 72, '#a64a2e'],
          [142, 158, 18, 78, '#2d160a'],
          [162, 162, 16, 74, '#5e3a20'],
          [180, 158, 22, 78, '#7e2500'],
          [204, 164, 14, 72, '#3d1f0c'],
        ].map(([x, y, w, h, c], i) => (
          <rect
            key={`bot-${i}`}
            x={x as number}
            y={y as number}
            width={w as number}
            height={h as number}
            fill={c as string}
          />
        ))}
        {/* A few books leaning, a leaning book adds visual rhythm */}
        <rect x="190" y="155" width="12" height="80" fill="#5a2c14" transform="rotate(-8 196 195)" />
      </g>

      {/* Armchair (right of bookshelf, foreground left) */}
      <g>
        {/* Back rest */}
        <path
          d="M 230 180 Q 230 150 260 150 L 312 150 Q 332 150 332 180 L 332 232 L 230 232 Z"
          fill="url(#ai-room-chair)"
        />
        {/* Seat cushion */}
        <path
          d="M 224 232 L 338 232 L 332 264 L 230 264 Z"
          fill="#6e2a12"
        />
        {/* Armrests */}
        <path d="M 222 232 L 222 264 L 232 264 L 232 232 Z" fill="#5a2a14" />
        <path d="M 340 232 L 340 264 L 330 264 L 330 232 Z" fill="#5a2a14" />
        {/* Legs */}
        <rect x="232" y="264" width="6" height="14" fill="#2d160a" />
        <rect x="322" y="264" width="6" height="14" fill="#2d160a" />
      </g>

      {/* Small side table with a glass + open book on the floor near chair */}
      <g transform="translate(360 250)">
        <rect x="0" y="0" width="60" height="6" fill="#3d1f0c" />
        <rect x="4" y="6" width="3" height="30" fill="#2d160a" />
        <rect x="53" y="6" width="3" height="30" fill="#2d160a" />
        {/* Book on table */}
        <rect x="12" y="-3" width="32" height="6" fill="#7e2500" />
        <rect x="12" y="-3" width="32" height="2" fill="#fff" opacity="0.6" />
      </g>

      {/* Subtle painterly grain over everything */}
      <rect x="0" y="0" width="480" height="360" filter="url(#ai-room-grain)" />
    </svg>
  );
}