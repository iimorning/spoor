export type LandingAmbiance = 'default' | 'sea' | 'forest' | 'volcano';

type AmbianceTheme = Exclude<LandingAmbiance, 'default'>;

/** ZH/EN tokens that unlock each ambience on the landing cover. */
export const AMBIANCE_KEYWORDS: Record<AmbianceTheme, readonly string[]> = {
  sea: [
    '海',
    '浪',
    '潮',
    '海边',
    '海岸',
    '海洋',
    '海水',
    '沙滩',
    '海风',
    'ocean',
    'sea',
    'seaside',
    'seashore',
    'wave',
    'waves',
    'beach',
    'shore',
    'tide',
    'coast',
  ],
  forest: [
    '森林',
    '树林',
    '林间',
    '林中',
    '丛林',
    '密林',
    '树叶',
    '鸟鸣',
    'forest',
    'woods',
    'woodland',
    'jungle',
    'grove',
    'trees',
  ],
  volcano: [
    '火山',
    '岩浆',
    '熔岩',
    '喷发',
    '火山口',
    'volcano',
    'volcanic',
    'lava',
    'magma',
    'eruption',
    'crater',
  ],
};

export const SEA_KEYWORDS = AMBIANCE_KEYWORDS.sea;

const THEME_ORDER: AmbianceTheme[] = ['sea', 'forest', 'volcano'];

function findTokenIndex(text: string, lower: string, token: string): number {
  if (/[a-z]/i.test(token)) {
    return lower.indexOf(token.toLowerCase());
  }
  return text.indexOf(token);
}

/**
 * Detect landing ambiance from freeform note text.
 * Matching is case-insensitive for Latin tokens; CJK matches as substrings.
 * When several themes match, the rightmost keyword wins (latest writing intent).
 */
export function detectLandingAmbiance(text: string): LandingAmbiance {
  const raw = text ?? '';
  if (!raw.trim()) return 'default';

  const lower = raw.toLowerCase();
  let best: { theme: AmbianceTheme; index: number } | null = null;

  for (const theme of THEME_ORDER) {
    for (const token of AMBIANCE_KEYWORDS[theme]) {
      const index = findTokenIndex(raw, lower, token);
      if (index < 0) continue;
      // Prefer later keyword; on ties keep the later theme in THEME_ORDER.
      if (!best || index >= best.index) {
        best = { theme, index };
      }
    }
  }

  return best?.theme ?? 'default';
}

export function isActiveAmbiance(ambiance: LandingAmbiance): ambiance is AmbianceTheme {
  return ambiance !== 'default';
}

export const AMBIANCE_AUDIO: Record<AmbianceTheme, string> = {
  sea: '/landing/sea-waves.mp3',
  forest: '/landing/forest.mp3',
  volcano: '/landing/volcano.mp3',
};

/** Per-theme gain — forest/volcano recordings sit quieter than the sea bed. */
export const AMBIANCE_VOLUME: Record<AmbianceTheme, number> = {
  sea: 0.35,
  forest: 0.62,
  volcano: 0.6,
};

/** Shared visual/audio crossfade length for landing ambience switches. */
export const AMBIANCE_CROSSFADE_MS = 1400;
