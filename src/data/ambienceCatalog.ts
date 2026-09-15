/**
 * Long-form nature ambience — remote streams (Internet Archive / field recordings).
 * Progressive HTMLAudio playback; tracks loop when they reach the end.
 */

export type AmbienceSceneId =
  | 'midnight-rain'
  | 'soft-ocean'
  | 'evening-storm'
  | 'crackling-fire'
  | 'winter-blizzard'
  | 'train-carriage';

export type AmbienceIconId = 'droplet' | 'waves' | 'audio' | 'flame' | 'snowflake' | 'train';

export interface AmbienceScene {
  id: AmbienceSceneId;
  /** Primary progressive stream URL (mp3/ogg). */
  streamUrl: string;
  /** Optional alternate format if the primary fails to load. */
  streamUrlAlt?: string;
  /** Approximate duration in seconds (for docs; playback still loops). */
  durationSec: number;
  /** Short credit for the recording source. */
  credit: string;
  /** i18n: ambience.scenes.<id>.title */
  titleKey: string;
  /** i18n: ambience.scenes.<id>.subtitle */
  subtitleKey: string;
  icon: AmbienceIconId;
  recommended?: boolean;
  /**
   * Extra linear loudness for quiet field recordings.
   * Applied via Web Audio only after the file is buffered to a same-origin blob
   * (never on CORS-less Archive streams — that path goes silent).
   */
  playbackGain?: number;
}

export const DEFAULT_AMBIENCE_SCENE_ID: AmbienceSceneId = 'midnight-rain';

const IA = 'https://archive.org/download';

export const AMBIENCE_SCENES: AmbienceScene[] = [
  {
    id: 'midnight-rain',
    streamUrl: `${IA}/3hoursofgentlenightrainrainsoundsforrelaxingsleepinsomniameditationstudyptsd.rain/${encodeURIComponent(
      '3 HOURS of Gentle Night RAIN, Rain Sounds for Relaxing Sleep, insomnia, Meditation, Study,PTSD. Rain.mp3',
    )}`,
    durationSec: 3 * 3600,
    credit: 'Internet Archive — Gentle Night Rain (3h)',
    titleKey: 'ambience.scenes.midnight_rain.title',
    subtitleKey: 'ambience.scenes.midnight_rain.subtitle',
    icon: 'droplet',
  },
  {
    id: 'soft-ocean',
    // Lighter beachfront surf (not the heavy La Jolla “crashing” recording).
    streamUrl: `${IA}/beachfront-ocean-waves-relaxing-nature-sounds-3-hours/${encodeURIComponent(
      'Beachfront Ocean Waves - Relaxing Nature Sounds 3 Hours.mp3',
    )}`,
    durationSec: 3 * 3600,
    credit: 'Internet Archive — Beachfront Ocean Waves (3h)',
    titleKey: 'ambience.scenes.soft_ocean.title',
    subtitleKey: 'ambience.scenes.soft_ocean.subtitle',
    icon: 'waves',
    recommended: true,
  },
  {
    id: 'evening-storm',
    streamUrl: `${IA}/evening-thunderstorm-ambience-3-hours/${encodeURIComponent(
      'Evening Thunderstorm Ambience 3 Hours.mp3',
    )}`,
    durationSec: 3 * 3600,
    credit: 'Internet Archive — Evening Thunderstorm Ambience (3h)',
    titleKey: 'ambience.scenes.evening_storm.title',
    subtitleKey: 'ambience.scenes.evening_storm.subtitle',
    icon: 'audio',
    recommended: true,
  },
  {
    id: 'crackling-fire',
    // Cozy indoor fireplace field recording (~12 min, CC0) — loops cleanly.
    streamUrl: 'https://cdn.freesound.org/previews/501/501417_10869493-hq.mp3',
    // Seamless campfire wood crackle (~4.5 min, CC0) as fallback.
    streamUrlAlt: 'https://cdn.freesound.org/previews/729/729396_12863902-hq.mp3',
    durationSec: 11 * 60 + 54,
    credit: 'visionear (CC0) — Aachen Burning Fireplace / HECKFRICKER Campfire 02',
    titleKey: 'ambience.scenes.crackling_fire.title',
    subtitleKey: 'ambience.scenes.crackling_fire.subtitle',
    icon: 'flame',
    recommended: true,
    // No playbackGain — fires the Freesound fetch + decode + amplify path
    // (resolvePlayableSrc, src/services/ambienceMixer.ts:306-356) which
    // breaks on the cdn.freesound.org CORS / decodeAudioData surface and
    // leaves the track silent. Stream the URL directly instead.
  },
  {
    id: 'winter-blizzard',
    // Hilltop wind + snow (~6.5 min, CC0) — loops for long sessions.
    streamUrl: 'https://cdn.freesound.org/previews/849/849302_10711943-hq.mp3',
    // Kentucky road-side snowstorm (~3 min, CC0) as fallback.
    streamUrlAlt: 'https://cdn.freesound.org/previews/754/754256_12863902-hq.mp3',
    durationSec: 6 * 60 + 22,
    credit: 'hidetora (CC0) — WNW Wind and Snow / HECKFRICKER Winter Snowstorm',
    titleKey: 'ambience.scenes.winter_blizzard.title',
    subtitleKey: 'ambience.scenes.winter_blizzard.subtitle',
    icon: 'snowflake',
    recommended: true,
    // Same CORS / decodeAudioData issue as crackling-fire — drop the
    // playbackGain so the URL streams directly.
  },
  {
    id: 'train-carriage',
    // Soft passenger carriage on a heritage steam line (~1.3 min, CC0) — less harsh than loco close-mic.
    streamUrl: 'https://cdn.freesound.org/previews/721/721970_1481531-hq.mp3',
    // Sister take from the same Swanage Railway ride (~1.25 min, CC0).
    streamUrlAlt: 'https://cdn.freesound.org/previews/721/721969_1481531-hq.mp3',
    durationSec: 78,
    credit: 'richwise (CC0) — Inside the carriage of a steam train #2 / #1 (Swanage Railway)',
    titleKey: 'ambience.scenes.train_carriage.title',
    subtitleKey: 'ambience.scenes.train_carriage.subtitle',
    icon: 'train',
    recommended: true,
  },
];

export const AMBIENCE_SCENE_BY_ID: ReadonlyMap<string, AmbienceScene> = new Map(
  AMBIENCE_SCENES.map((s) => [s.id, s]),
);

/** Legacy procedural / Moodist / volcano ids → nearest nature stream. */
const LEGACY_SCENE_ALIASES: Record<string, AmbienceSceneId> = {
  'white-noise': 'midnight-rain',
  'pink-noise': 'midnight-rain',
  'brown-noise': 'midnight-rain',
  'deep-forest': 'midnight-rain',
  'summer-meadow': 'midnight-rain',
  'heavy-rain': 'midnight-rain',
  'rain-on-window': 'midnight-rain',
  thunder: 'evening-storm',
  waves: 'soft-ocean',
  birds: 'midnight-rain',
  seagulls: 'soft-ocean',
  waterfall: 'midnight-rain',
  'howling-wind': 'winter-blizzard',
  blizzard: 'winter-blizzard',
  snowstorm: 'winter-blizzard',
  snow: 'winter-blizzard',
  droplets: 'midnight-rain',
  'lava-lake': 'crackling-fire',
  volcano: 'crackling-fire',
  lava: 'crackling-fire',
  magma: 'crackling-fire',
  fireplace: 'crackling-fire',
  campfire: 'crackling-fire',
  cafe: 'train-carriage',
  coffee: 'train-carriage',
  'coffee-shop': 'train-carriage',
  'cafe-chatter': 'train-carriage',
  train: 'train-carriage',
  subway: 'train-carriage',
  metro: 'train-carriage',
  steam: 'train-carriage',
  'steam-train': 'train-carriage',
};

export function resolveAmbienceSceneId(id: string | undefined | null): AmbienceSceneId {
  if (!id) return DEFAULT_AMBIENCE_SCENE_ID;
  if (AMBIENCE_SCENE_BY_ID.has(id)) return id as AmbienceSceneId;
  return LEGACY_SCENE_ALIASES[id] ?? DEFAULT_AMBIENCE_SCENE_ID;
}

export function getAmbienceScene(id: string | undefined | null): AmbienceScene {
  return AMBIENCE_SCENE_BY_ID.get(resolveAmbienceSceneId(id))!;
}

export function recommendedAmbienceScenes(): AmbienceScene[] {
  return AMBIENCE_SCENES.filter((s) => s.recommended);
}
