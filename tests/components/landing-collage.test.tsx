/**
 * Smoke tests for landing-collage.tsx (archived illustration set).
 *
 * This file is currently only consumed by the archived LandingPageFocusLinked
 * experiment. These tests are intentionally lightweight — they lock down the
 * public surface so a future activation can't accidentally ship missing/broken
 * illustrations without a test failing first.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import {
  TOPIC_ILLUSTRATIONS,
  TreeEtching,
  ArtistDrawing,
  SchoolHallEtching,
  TombEtching,
  PosadaSkeleton,
  CenotaphEtching,
  AudubonFlycatcher,
  WildGeeseWoodblock,
  GoyaFlying,
} from '../../src/components/landing-collage';

describe('landing-collage (archived illustrations)', () => {
  it('exports the expected illustration components', () => {
    expect(TreeEtching).toBeDefined();
    expect(ArtistDrawing).toBeDefined();
    expect(SchoolHallEtching).toBeDefined();
    expect(TombEtching).toBeDefined();
    expect(PosadaSkeleton).toBeDefined();
    expect(CenotaphEtching).toBeDefined();
    expect(AudubonFlycatcher).toBeDefined();
    expect(WildGeeseWoodblock).toBeDefined();
    expect(GoyaFlying).toBeDefined();
  });

  it('exposes a TOPIC_ILLUSTRATIONS record covering all 5 topics', () => {
    // 01 = tree / drawing; 02 = school hall / tomb; 03 = skeleton / cenotaph;
    // 04 = flycatcher / geese; 05 = goya (only one slot).
    expect(typeof TOPIC_ILLUSTRATIONS).toBe('object');
    expect(Object.keys(TOPIC_ILLUSTRATIONS).sort()).toEqual(['01', '02', '03', '04', '05']);
  });

  it('every topic slot has a non-empty illustration component', () => {
    for (const topic of Object.values(TOPIC_ILLUSTRATIONS)) {
      // Topic 05 deliberately reuses GoyaFlying on both sides (see the file
      // header note in landing-collage.tsx); the other four topics have
      // distinct left + right illustrations.
      expect(topic.Left).toBeDefined();
      expect(topic.Right).toBeDefined();
    }
  });

  it('first four topics use distinct left/right illustrations', () => {
    for (const id of ['01', '02', '03', '04'] as const) {
      const slot = TOPIC_ILLUSTRATIONS[id]!;
      expect(slot.Left).not.toBe(slot.Right);
    }
  });

  it('TreeEtching renders an <img> pointing at the Met etching asset', () => {
    const { container } = render(<TreeEtching />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    // The Met ID 816766 is part of the asset filename; checking the leaf
    // filename is enough — we don't want to assert the full hash string.
    expect(img?.getAttribute('src') ?? '').toMatch(/816766\.jpg$/);
    // Alt text is descriptive (not decorative), so screen readers get context.
    expect(img?.getAttribute('alt') ?? '').not.toBe('');
  });

  it('GoyaFlying (single-slot topic 05) renders without throwing', () => {
    const { container } = render(<GoyaFlying />);
    expect(container.querySelector('img')).not.toBeNull();
  });
});