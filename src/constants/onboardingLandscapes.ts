import onboardingMaterialUrl from '../assets/onboarding/crooked-house.jpg';

/** Onboarding drag-in material card image (Krzywy Domek, bundled locally). */
export const ONBOARDING_LANDSCAPE_IMAGE = onboardingMaterialUrl;

/** Legacy remote starter images — triggers layout refresh to the bundled material image. */
export const LEGACY_ONBOARDING_LANDSCAPE_IMAGE_IDS = [
  'photo-1506905925346',
  'photo-1503387762',
] as const;

/** @deprecated Use LEGACY_ONBOARDING_LANDSCAPE_IMAGE_IDS */
export const LEGACY_ONBOARDING_LANDSCAPE_IMAGE_ID = LEGACY_ONBOARDING_LANDSCAPE_IMAGE_IDS[0];
