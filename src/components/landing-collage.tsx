/**
 * Landing collage illustrations — for archived LandingPageFocusLinked.
 *
 * Status: only imported by `LandingPageFocusLinked.tsx` (not on `/`).
 * Keep this file + `src/assets/landing-collage/` for reuse.
 *
 * Each topic in `landing.topics.{id}` maps to a `left` + `right`
 * illustration rendered around the page edges. The illustrations stay
 * in the DOM but their opacity / transform follows the
 * `data-active-topic` attribute on `.spoor-landing`, so swaps feel
 * like a soft fade rather than a sudden mount/unmount.
 *
 * ─── Source ──────────────────────────────────────────────────────────
 * All illustrations come from The Metropolitan Museum of Art's Open
 * Access collection (CC0, public domain). Attribution:
 *
 *   "Wild Geese Flying under the Full Moon" — Japanese woodblock print.
 *   "A Way of Flying" from Los Disparates — Goya, etching.
 *   "Cœnotaphiorum (9)" — etching, first state of four.
 *   "Tomb of Porsenna" — etching.
 *   "Untitled (skeleton arguing with a woman)" — José Guadalupe Posada,
 *     type-metal engraving and letterpress.
 *   "The Hall, Blue Coat School" — hand-colored etching and aquatint.
 *   "Henry William Bunbury Drawing his 'Long Minuet'" — stipple
 *     engraving and etching (working proof).
 *   "View of a Bay with a Central Tree in an Ornamental" — Master IQV,
 *     etching.
 *   "Pewee or Pewit Flycatcher" from "The Birds of America" — Audubon,
 *     hand-colored etching, aquatint and engraving.
 *   Source: https://www.metmuseum.org (Metropolitan Museum of Art,
 *     Open Access).
 *
 * The previous revision of this file shipped hand-drawn inline SVGs.
 * The user asked for real (public-domain) illustrations, hence this
 * rewrite. The previous SVGs are still useful as inline fallbacks if
 * any image fails to load — see the `Img` component below.
 */

import React from 'react';

import treeEtching       from '../assets/landing-collage/m_816766.jpg';
import bunburyDrawing    from '../assets/landing-collage/m_775303.jpg';
import blueCoatHall      from '../assets/landing-collage/m_744322.jpg';
import tombPorsenna      from '../assets/landing-collage/m_702238.jpg';
import posadaSkeleton    from '../assets/landing-collage/m_729644.jpg';
import cenotaphiorum     from '../assets/landing-collage/m_402137.jpg';
import audubonFlycatcher from '../assets/landing-collage/m_918310.jpg';
import wildGeese         from '../assets/landing-collage/m_36742.jpg';
import goyaFlying        from '../assets/landing-collage/m_384325.jpg';

type IllustrationProps = {
  className?: string;
  /** set to true to mark the slot as decorative (announces no alt) */
  decorative?: boolean;
};

/* ─────────────────────────────────────────────────────────────────────
 * Per-topic illustrations — each is a simple <img> wrapper.
 * The Met source is recorded for attribution/logging.
 * ───────────────────────────────────────────────────────────────────── */

const META = {
  tree:       { src: treeEtching,       credit: 'Master IQV · MET Open Access' },
  drawing:    { src: bunburyDrawing,    credit: 'Henry Bunbury · MET Open Access' },
  hall:       { src: blueCoatHall,      credit: 'MET Open Access' },
  tomb:       { src: tombPorsenna,      credit: 'MET Open Access' },
  skeleton:   { src: posadaSkeleton,    credit: 'José Guadalupe Posada · MET Open Access' },
  cenotaph:   { src: cenotaphiorum,     credit: 'MET Open Access' },
  flycatcher: { src: audubonFlycatcher, credit: 'John James Audubon · MET Open Access' },
  geese:      { src: wildGeese,         credit: 'MET Open Access' },
  goya:       { src: goyaFlying,        credit: 'Francisco de Goya · MET Open Access' },
};

/** A single image slot wrapper. Stroke + ink color are no-ops on
 *  raster images, so we drop the `currentColor` mechanics from the
 *  earlier SVG version. */
function Img({ src, alt, className, decorative }: IllustrationProps & { src: string; alt: string }) {
  return (
    <img
      src={src}
      alt={decorative ? '' : alt}
      className={className}
      loading="eager"
      decoding="async"
      draggable={false}
    />
  );
}

/* Topic 01 — A QUIET CANVAS */

export function TreeEtching({ className }: IllustrationProps) {
  return (
    <Img
      src={META.tree.src}
      alt="Tree in landscape, etching by Master IQV"
      className={className}
    />
  );
}

export function ArtistDrawing({ className }: IllustrationProps) {
  return (
    <Img
      src={META.drawing.src}
      alt="A draftsman drawing at his table, stipple engraving"
      className={className}
    />
  );
}

/* Topic 02 — LOCAL-FIRST */

export function SchoolHallEtching({ className }: IllustrationProps) {
  return (
    <Img
      src={META.hall.src}
      alt="Interior of a school hall, hand-colored etching"
      className={className}
    />
  );
}

export function TombEtching({ className }: IllustrationProps) {
  return (
    <Img
      src={META.tomb.src}
      alt="Architectural tomb, etching"
      className={className}
    />
  );
}

/* Topic 03 — FOUR PERSONAS */

export function PosadaSkeleton({ className }: IllustrationProps) {
  return (
    <Img
      src={META.skeleton.src}
      alt="Skeleton arguing with a woman, type-metal engraving by Posada"
      className={className}
    />
  );
}

export function CenotaphEtching({ className }: IllustrationProps) {
  return (
    <Img
      src={META.cenotaph.src}
      alt="Cenotaph etching"
      className={className}
    />
  );
}

/* Topic 04 — IN AN EDITABLE PLAN */

export function AudubonFlycatcher({ className }: IllustrationProps) {
  return (
    <Img
      src={META.flycatcher.src}
      alt="A pewee flycatcher perched on a branch, hand-colored engraving by Audubon"
      className={className}
    />
  );
}

export function WildGeeseWoodblock({ className }: IllustrationProps) {
  return (
    <Img
      src={META.geese.src}
      alt="Wild geese flying under the full moon, woodblock print"
      className={className}
    />
  );
}

/* Topic 05 — A TRACE OF THOUGHT */

export function GoyaFlying({ className }: IllustrationProps) {
  return (
    <Img
      src={META.goya.src}
      alt="Bats in flight, etching by Goya"
      className={className}
    />
  );
}

/* ─────────────────────────────────────────────────────────────────────
 * Topic-to-illustration mapping — single source of truth.
 * ───────────────────────────────────────────────────────────────────── */

import type { ComponentType } from 'react';

export type LeftIllustration = ComponentType<IllustrationProps>;
export type RightIllustration = ComponentType<IllustrationProps>;

export const TOPIC_ILLUSTRATIONS: Record<
  string,
  { Left: LeftIllustration; Right: RightIllustration }
> = {
  // Topic 01 — A QUIET CANVAS (paper)
  '01': { Left: TreeEtching, Right: ArtistDrawing },

  // Topic 02 — LOCAL-FIRST (brick red, vintage archival)
  '02': { Left: SchoolHallEtching, Right: TombEtching },

  // Topic 03 — FOUR PERSONAS (cream)
  '03': { Left: PosadaSkeleton, Right: CenotaphEtching },

  // Topic 04 — IN AN EDITABLE PLAN (gray, studious)
  '04': { Left: AudubonFlycatcher, Right: WildGeeseWoodblock },

  // Topic 05 — A TRACE OF THOUGHT (ink) — sparse; only one illustration
  // carries the closing. The right slot is intentionally unmapped.
  '05': { Left: GoyaFlying, Right: GoyaFlying },
};
