import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/db';
import { DEFAULT_NODE_IDS } from '../../src/constants/defaultWorkspace';
import {
  DEFAULT_SEED_VIEWPORT,
  ensureDefaultAskWorkZone,
  viewportWorldRect,
} from '../../src/utils/seedDefaultAskWorkZone';
import { computeDefaultAskWorkZoneRect } from '../../src/utils/onboardingWorkroomLayout';
import { setCanvasV2Enabled } from '../../src/utils/canvasV2';

describe('seedDefaultAskWorkZone', () => {
  beforeEach(async () => {
    setCanvasV2Enabled(true);
    await db.nodes.clear();
    await db.canvasWorkZones.clear();
    await db.canvases.clear();
  });

  it('maps the default viewport transform to a screen-sized world rect', () => {
    const rect = viewportWorldRect({ x: 0, y: 0, scale: 1 }, { width: 1200, height: 800 });
    expect(rect).toEqual({ x: 0, y: 0, width: 1200, height: 800 });
  });

  it('seeds a persona-bound zone for the default ask card', async () => {
    await db.canvases.add({
      id: 'default',
      name: 'Main',
      createdAt: 1,
      updatedAt: 1,
    });
    await db.nodes.add({
      id: DEFAULT_NODE_IDS.ask,
      canvasId: 'default',
      type: 'ask',
      content: '',
      x: 100,
      y: 140,
      width: 320,
      height: 180,
      createdAt: 1,
    });
    await db.nodes.add({
      id: DEFAULT_NODE_IDS.note,
      canvasId: 'default',
      type: 'note',
      content: 'note',
      x: 1400,
      y: 140,
      width: 320,
      height: 200,
      createdAt: 1,
    });

    const zone = await ensureDefaultAskWorkZone({
      canvasId: 'default',
      askNodeId: DEFAULT_NODE_IDS.ask,
      viewport: { ...DEFAULT_SEED_VIEWPORT },
    });

    expect(zone?.personaNodeId).toBe(DEFAULT_NODE_IDS.ask);
    const expectedRoom = computeDefaultAskWorkZoneRect(
      { x: 0, y: 0, scale: 1 },
      { ...DEFAULT_SEED_VIEWPORT },
    );
    expect(zone?.width).toBeCloseTo(expectedRoom.width, 0);
    expect(zone?.height).toBeCloseTo(expectedRoom.height, 0);
    expect(await db.canvasWorkZones.toArray()).toHaveLength(1);

    const note = await db.nodes.get(DEFAULT_NODE_IDS.note);
    expect(note?.contextScopeAgentId).toBeUndefined();
  });

  it('does not replace an existing work zone', async () => {
    await db.canvases.add({
      id: 'default',
      name: 'Main',
      createdAt: 1,
      updatedAt: 1,
    });
    await db.nodes.add({
      id: DEFAULT_NODE_IDS.ask,
      canvasId: 'default',
      type: 'ask',
      content: '',
      x: 0,
      y: 0,
      width: 320,
      height: 180,
      createdAt: 1,
    });
    await db.canvasWorkZones.add({
      id: 'zone-user',
      canvasId: 'default',
      personaNodeId: DEFAULT_NODE_IDS.ask,
      x: 10,
      y: 10,
      width: 200,
      height: 200,
      createdAt: 1,
    });

    const zone = await ensureDefaultAskWorkZone({
      canvasId: 'default',
      askNodeId: DEFAULT_NODE_IDS.ask,
    });

    expect(zone).toBeNull();
    expect((await db.canvasWorkZones.get('zone-user'))?.width).toBe(200);
  });
});
