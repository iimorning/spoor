import turtleSoupHostCover from '../assets/agent-icons/turtle-soup-host.png';
import intuitionPumpExpertCover from '../assets/agent-icons/intuition-pump-expert.png';
import turtleSoupHostThumb from '../assets/agent-icons/turtle-soup-host-thumb.webp';
import intuitionPumpExpertThumb from '../assets/agent-icons/intuition-pump-expert-thumb.webp';
import cosmosWeaverCover from '../assets/agent-icons/weaving.png';
import characterAtelierCover from '../assets/agent-icons/compass.png';

/** Bundled literary covers for official community personas (stable persona ids). */
export const OFFICIAL_PERSONA_COVER_URLS: Readonly<Record<string, string>> = {
  turtle_soup_host: turtleSoupHostCover,
  intuition_pump_expert: intuitionPumpExpertCover,
  cosmos_weaver: cosmosWeaverCover,
  character_atelier: characterAtelierCover,
};

/** Smaller webp variants (~800×450, ~50KB) for use in landing-page and
 *  community gallery thumbnails where the 3-4MB originals are overkill and
 *  leave a visible loading gap. Canvas-side persona cards keep using the
 *  full-resolution `officialPersonaCoverUrl`. */
export const OFFICIAL_PERSONA_THUMB_URLS: Readonly<Record<string, string>> = {
  turtle_soup_host: turtleSoupHostThumb,
  intuition_pump_expert: intuitionPumpExpertThumb,
};

export function officialPersonaCoverUrl(personaId: string): string | undefined {
  return OFFICIAL_PERSONA_COVER_URLS[personaId];
}

export function officialPersonaThumbUrl(personaId: string): string | undefined {
  return OFFICIAL_PERSONA_THUMB_URLS[personaId];
}
