import { describe, expect, it } from 'vitest';
import { TOUR_STEPS } from '../../src/onboarding/tourSteps';

describe('TOUR_STEPS', () => {
  it('walks the canvas-first interactive loop', () => {
    expect(TOUR_STEPS.map((s) => s.id)).toEqual([
      'work-room',
      'move-material',
      'open-chat',
      'excerpt-reply',
      'compose-essay',
    ]);
  });

  it('gates hands-on steps and finishes with Done', () => {
    expect(TOUR_STEPS[0]?.gate).toBe('manual');
    expect(TOUR_STEPS[1]?.gate).toBe('material-moved');
    expect(TOUR_STEPS[2]?.gate).toBe('chat-sent');
    expect(TOUR_STEPS[3]?.gate).toBe('excerpt-created');
    expect(TOUR_STEPS[3]?.nextLabelKey).toBeUndefined();
    expect(TOUR_STEPS[3]?.highlight).toBe('chat-reply-drag-handle');
    expect(TOUR_STEPS[3]?.copy.bodyRich).toBe(true);
    expect(TOUR_STEPS[4]?.gate).toBe('manual');
    expect(TOUR_STEPS[4]?.demo).toBe('marquee');
    expect(TOUR_STEPS[4]?.nextLabelKey).toBe('onboarding.cta_done');
  });

  it('highlights the work room and outside starter cards', () => {
    expect(TOUR_STEPS[0]?.highlight).toBe('work-zone');
    expect(TOUR_STEPS[1]?.highlight).toBe('work-zone-and-outside');
    expect(TOUR_STEPS[1]?.tooltipAnchor).toBe('outside-materials');
    expect(TOUR_STEPS[1]?.placement).toBe('left');
    expect(TOUR_STEPS[1]?.placementAlign).toBe('end');
    expect(TOUR_STEPS[1]?.canvasArrow).toBe('drag-in');
    expect(TOUR_STEPS[1]?.demo).toBeUndefined();
    expect(TOUR_STEPS[2]?.targetTestId).toBe('canvas-chat-panel');
    expect(TOUR_STEPS[3]?.targetTestId).toBe('canvas-chat-panel');
    expect(TOUR_STEPS[4]?.targetTestId).toBe('canvas-workspace-host');
  });
});
