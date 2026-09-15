import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '../../src/db';
import { ONBOARDING_MATERIAL_TEMPLATE_KEY } from '../../src/utils/onboardingWorkroomLayout';
import { spawnOnboardingTourCanvas } from '../../src/utils/spawnOnboardingTourCanvas';
import { setCanvasV2Enabled } from '../../src/utils/canvasV2';
import { isNodeInWorkZone } from '../../src/utils/workZoneGeometry';

describe('spawnOnboardingTourCanvas', () => {
  beforeEach(async () => {
    setCanvasV2Enabled(true);
    await db.nodes.clear();
    await db.canvasWorkZones.clear();
    await db.canvases.clear();
  });

  it('creates a fresh canvas with outside tour materials', async () => {
    const canvasId = await spawnOnboardingTourCanvas({
      name: 'Tour',
      viewport: { width: 1280, height: 720 },
    });

    const canvas = await db.canvases.get(canvasId);
    expect(canvas?.name).toBe('Tour');

    const nodes = await db.nodes.filter((n) => n.canvasId === canvasId).toArray();
    const zones = await db.canvasWorkZones.where('canvasId').equals(canvasId).toArray();
    expect(zones).toHaveLength(1);

    const zone = zones[0]!;
    const ask = nodes.find((n) => n.type === 'ask');
    const materials = nodes.filter((n) => n.templateKey === ONBOARDING_MATERIAL_TEMPLATE_KEY);

    expect(ask).toBeDefined();
    expect(materials).toHaveLength(3);
    expect(materials.some((n) => n.type === 'image')).toBe(true);
    expect(ask && isNodeInWorkZone(ask, zone)).toBe(true);
    for (const material of materials) {
      expect(isNodeInWorkZone(material, zone)).toBe(false);
    }
  });
});
