export type CanvasTransformLike = { x: number; y: number; scale: number };

export type CanvasRect = { x: number; y: number; width: number; height: number };

export type CanvasObstacle = {
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
};

/** Default shell size for notes / AI cards when width/height are unset. */
export const DEFAULT_NODE_SIZE = { width: 320, height: 200 };

/** Ask card fox illustration is 16:9; persist this so the portrait isn't letterboxed. */
export const ASK_NODE_SIZE = { width: 320, height: 180 };

/** Agent cards with a generated cover match the Ask card 16:9 footprint. */
export const AGENT_NODE_SIZE = { width: 320, height: 180 };

/** Theme card — 2:1 landscape (title + footer tag); users can still resize. */
export const THEME_NODE_SIZE = { width: 320, height: 160 };

/** Matches BOOK_NODE_SIZE in file.ts when book width/height are unset. */
export const BOOK_NODE_FALLBACK_SIZE = { width: 380, height: 520 };

/** Matches essay card default size (same footprint as books). */
export const ESSAY_NODE_FALLBACK_SIZE = { width: 380, height: 520 };

/** Word/document cards share the book footprint so long HTML does not stretch the canvas. */
export const DOCUMENT_CARD_AUTO_MAX_HEIGHT_PX = BOOK_NODE_FALLBACK_SIZE.height;

/**
 * Scrollport cap for document HTML (header / padding sit outside this).
 * Nested overflow-y-auto needs a definite max-height, not only a parent cap.
 */
export const DOCUMENT_CARD_SCROLL_MAX_HEIGHT_PX = 440;

/** Conservative size used when placing a fresh toolbar AI card. */
export const NEW_AI_NODE_SIZE = { width: 320, height: 240 };

/** Synthesize needs two or more source cards — a single card is not an article. */
export const PUBLISH_MIN_SELECTION = 2;

/**
 * Auto-height cap for AI reply cards that the user has not resized yet.
 * Long model output scrolls inside the card instead of stretching the canvas;
 * dragging the corner persists `node.height` and lifts this cap.
 */
export const AI_CARD_AUTO_MAX_HEIGHT_PX = 420;

/**
 * Scrollport cap for the reply body (card padding sits outside this).
 * Must be a definite max-height so overflow-y-auto actually scrolls; a parent
 * that only has max-height does not give nested flex children a used height.
 */
export const AI_CARD_SCROLL_MAX_HEIGHT_PX = 300;

/**
 * Scrollport cap for the streaming “thinking” placeholder before visible
 * reply text arrives. Chain-of-thought can be very long; keep the canvas
 * card compact and pin the view to the latest tokens.
 */
export const AI_THINKING_SCROLL_MAX_HEIGHT_PX = 200;

/**
 * Auto-height cap for ordinary note/text cards the user has not resized yet.
 * Pasting a long excerpt scrolls inside the card instead of stretching the canvas.
 */
export const NOTE_CARD_AUTO_MAX_HEIGHT_PX = 420;

/** Scrollport cap for the note body (padding / chrome sit outside this). */
export const NOTE_CARD_SCROLL_MAX_HEIGHT_PX = 340;

const DEFAULT_GAP = 28;

/**
 * Calculate a position near the center of the viewport in canvas coordinates.
 * Used when creating new nodes so they appear near the visible center.
 */
export function getCanvasCenterPosition(transform: CanvasTransformLike) {
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  return {
    x: (cx - transform.x) / transform.scale - 150 + Math.random() * 50,
    y: (cy - transform.y) / transform.scale - 100 + Math.random() * 50,
  };
}

export function estimateNodeRect(node: CanvasObstacle): CanvasRect {
  const fallback =
    node.type === 'book' || node.type === 'essay' || node.type === 'document'
      ? BOOK_NODE_FALLBACK_SIZE
      : node.type === 'ask'
        ? ASK_NODE_SIZE
        : node.type === 'theme'
          ? THEME_NODE_SIZE
          : DEFAULT_NODE_SIZE;
  return {
    x: node.x,
    y: node.y,
    width: node.width && node.width > 0 ? node.width : fallback.width,
    height: node.height && node.height > 0 ? node.height : fallback.height,
  };
}

export function rectsOverlap(a: CanvasRect, b: CanvasRect, gap = 0): boolean {
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  );
}

/** Intersection area of two axis-aligned rects (0 if they do not overlap). */
export function rectIntersectionArea(a: CanvasRect, b: CanvasRect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return w * h;
}

/**
 * How much of the smaller rect sits inside the other (0–1).
 * Used for magnetic card-on-card stacking so a glancing overlap does not snap.
 */
export function rectOverlapRatio(a: CanvasRect, b: CanvasRect): number {
  const inter = rectIntersectionArea(a, b);
  if (inter <= 0) return 0;
  const smaller = Math.min(Math.max(0, a.width * a.height), Math.max(0, b.width * b.height));
  if (smaller <= 0) return 0;
  return inter / smaller;
}

function isFree(candidate: CanvasRect, obstacles: CanvasRect[], gap: number): boolean {
  return !obstacles.some((o) => rectsOverlap(candidate, o, gap));
}

/** Prefer the open lane to the right of an anchor (same idea as book-expand hub). */
export function positionBesideRect(
  anchor: CanvasRect,
  size: { width: number; height: number },
  gap = DEFAULT_GAP,
): { x: number; y: number } {
  return {
    x: anchor.x + anchor.width + gap,
    y: anchor.y + Math.max(0, anchor.height / 2 - size.height / 2),
  };
}

/** Next row under an anchor, left-aligned — used when the right lane is blocked. */
export function positionBelowRect(
  anchor: CanvasRect,
  _size: { width: number; height: number },
  gap = DEFAULT_GAP,
): { x: number; y: number } {
  return {
    x: anchor.x,
    y: anchor.y + anchor.height + gap,
  };
}

/**
 * Find a non-overlapping canvas position for a new node.
 * Starts beside `preferBeside` (if given) or at viewport center, then walks a square spiral.
 *
 * `size` is the reserved footprint that must be free; `step` controls how far each
 * spiral ring moves. When omitted, step is capped to a normal card size so large
 * footprints (e.g. book-voice hub+lane) still search nearby instead of jumping a
 * full cluster width/height per ring.
 */
export function findOpenCanvasPosition(options: {
  transform: CanvasTransformLike;
  obstacles: CanvasObstacle[];
  size?: { width: number; height: number };
  /** Spiral ring increment; defaults to min(size, DEFAULT_NODE_SIZE) + gap. */
  step?: { width: number; height: number };
  gap?: number;
  preferBeside?: CanvasObstacle | null;
  maxRings?: number;
}): { x: number; y: number } {
  const size = options.size ?? NEW_AI_NODE_SIZE;
  const gap = options.gap ?? DEFAULT_GAP;
  const maxRings = options.maxRings ?? 12;
  const obstacleRects = options.obstacles.map(estimateNodeRect);

  const seeds: { x: number; y: number }[] = [];
  if (options.preferBeside) {
    seeds.push(positionBesideRect(estimateNodeRect(options.preferBeside), size, gap));
  }
  seeds.push(getCanvasCenterPosition(options.transform));

  const stepX =
    options.step?.width ?? Math.min(size.width, DEFAULT_NODE_SIZE.width) + gap;
  const stepY =
    options.step?.height ?? Math.min(size.height, DEFAULT_NODE_SIZE.height) + gap;

  for (const seed of seeds) {
    for (let ring = 0; ring <= maxRings; ring++) {
      if (ring === 0) {
        const candidate = { x: seed.x, y: seed.y, width: size.width, height: size.height };
        if (isFree(candidate, obstacleRects, gap)) {
          return { x: seed.x, y: seed.y };
        }
        continue;
      }

      for (let dx = -ring; dx <= ring; dx++) {
        for (const dy of [-ring, ring] as const) {
          const x = seed.x + dx * stepX;
          const y = seed.y + dy * stepY;
          const candidate = { x, y, width: size.width, height: size.height };
          if (isFree(candidate, obstacleRects, gap)) return { x, y };
        }
      }
      for (let dy = -ring + 1; dy <= ring - 1; dy++) {
        for (const dx of [-ring, ring] as const) {
          const x = seed.x + dx * stepX;
          const y = seed.y + dy * stepY;
          const candidate = { x, y, width: size.width, height: size.height };
          if (isFree(candidate, obstacleRects, gap)) return { x, y };
        }
      }
    }
  }

  const fallback = seeds[0]!;
  return {
    x: fallback.x + stepX * (maxRings + 1),
    y: fallback.y,
  };
}

/**
 * Place a follow-up card next to an existing one (right, then below), without
 * falling back to a jittered viewport center. Voice / Ask threads use this so
 * each round stays beside the previous card even when the right lane is full.
 */
export function findAdjacentCanvasPosition(options: {
  obstacles: CanvasObstacle[];
  anchor: CanvasObstacle;
  size?: { width: number; height: number };
  gap?: number;
  maxRings?: number;
}): { x: number; y: number } {
  const size = options.size ?? NEW_AI_NODE_SIZE;
  const gap = options.gap ?? DEFAULT_GAP;
  const maxRings = options.maxRings ?? 12;
  const obstacleRects = options.obstacles.map(estimateNodeRect);
  const anchorRect = estimateNodeRect(options.anchor);
  const stepX = Math.min(size.width, DEFAULT_NODE_SIZE.width) + gap;
  const stepY = Math.min(size.height, DEFAULT_NODE_SIZE.height) + gap;
  const seeds = [
    positionBesideRect(anchorRect, size, gap),
    positionBelowRect(anchorRect, size, gap),
  ];

  for (const seed of seeds) {
    const candidate = { x: seed.x, y: seed.y, width: size.width, height: size.height };
    if (isFree(candidate, obstacleRects, gap)) {
      return { x: seed.x, y: seed.y };
    }
  }

  const spiralOrigin = seeds[1]!;
  for (let ring = 1; ring <= maxRings; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (const dy of [-ring, ring] as const) {
        const x = spiralOrigin.x + dx * stepX;
        const y = spiralOrigin.y + dy * stepY;
        const candidate = { x, y, width: size.width, height: size.height };
        if (isFree(candidate, obstacleRects, gap)) return { x, y };
      }
    }
    for (let dy = -ring + 1; dy <= ring - 1; dy++) {
      for (const dx of [-ring, ring] as const) {
        const x = spiralOrigin.x + dx * stepX;
        const y = spiralOrigin.y + dy * stepY;
        const candidate = { x, y, width: size.width, height: size.height };
        if (isFree(candidate, obstacleRects, gap)) return { x, y };
      }
    }
  }

  return { x: spiralOrigin.x, y: spiralOrigin.y + stepY * (maxRings + 1) };
}
