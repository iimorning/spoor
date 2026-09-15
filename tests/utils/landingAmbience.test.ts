import { describe, it, expect } from 'vitest';
import { detectLandingAmbiance } from '../../src/utils/landingAmbience';

describe('detectLandingAmbiance', () => {
  it('returns default for empty or unrelated text', () => {
    expect(detectLandingAmbiance('')).toBe('default');
    expect(detectLandingAmbiance('   ')).toBe('default');
    expect(detectLandingAmbiance('关于形式的冥想')).toBe('default');
    expect(detectLandingAmbiance('Meditations on Form')).toBe('default');
  });

  it('detects Chinese sea-related tokens', () => {
    expect(detectLandingAmbiance('我想去海边走走')).toBe('sea');
    expect(detectLandingAmbiance('听着浪声写作')).toBe('sea');
    expect(detectLandingAmbiance('潮水退去')).toBe('sea');
  });

  it('detects English sea-related tokens case-insensitively', () => {
    expect(detectLandingAmbiance('The Ocean at dusk')).toBe('sea');
    expect(detectLandingAmbiance('SEA breeze')).toBe('sea');
    expect(detectLandingAmbiance('soft waves')).toBe('sea');
    expect(detectLandingAmbiance('on the beach')).toBe('sea');
  });

  it('detects forest tokens', () => {
    expect(detectLandingAmbiance('走进森林深处')).toBe('forest');
    expect(detectLandingAmbiance('Birdsong in the forest')).toBe('forest');
    expect(detectLandingAmbiance('quiet woodland')).toBe('forest');
  });

  it('detects volcano tokens', () => {
    expect(detectLandingAmbiance('火山开始喷发')).toBe('volcano');
    expect(detectLandingAmbiance('rivers of lava')).toBe('volcano');
    expect(detectLandingAmbiance('the volcano rumbles')).toBe('volcano');
  });

  it('prefers the rightmost matching theme when several appear', () => {
    expect(detectLandingAmbiance('海与森林')).toBe('forest');
    expect(detectLandingAmbiance('forest by the sea')).toBe('sea');
    expect(detectLandingAmbiance('火山旁的海')).toBe('sea');
  });
});
