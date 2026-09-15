import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/db';
import { DEFAULT_NODE_IDS } from '../../src/constants/defaultWorkspace';
import {
  applyOnboardingWorkroomLayout,
  computeDefaultAskWorkZoneRect,
  layoutOnboardingStarterNodes,
  needsOnboardingWorkroomLayout,
} from '../../src/utils/onboardingWorkroomLayout';
import { setCanvasV2Enabled } from '../../src/utils/canvasV2';
import { isNodeInWorkZone } from '../../src/utils/workZoneGeometry';

describe('onboardingWorkroomLayout', () => {
  beforeEach(async () => {
    setCanvasV2Enabled(true);
    await db.nodes.clear();
    await db.canvasWorkZones.clear();
    await db.canvases.clear();
    await db.canvases.add({
      id: 'default',
      name: 'Main',
      createdAt: 1,
      updatedAt: 1,
    });
  });

  it('places image and opinion cards outside the work room', () => {
    const room = computeDefaultAskWorkZoneRect({ x: 0, y: 0, scale: 1 }, { width: 1280, height: 720 });
    const patches = layoutOnboardingStarterNodes(room);
    const outside = patches.filter((p) => p.id !== DEFAULT_NODE_IDS.ask);
    for (const patch of outside) {
      expect(patch.x).toBeGreaterThan(room.x + room.width);
    }
    expect(patches.filter((p) => p.type === 'image')).toHaveLength(1);
    expect(patches.some((p) => p.type === 'theme')).toBe(true);
    expect(patches.some((p) => p.type === 'note')).toBe(true);
  });

  it('adds missing tour materials even when the canvas has user cards', async () => {
    const room = computeDefaultAskWorkZoneRect({ x: 0, y: 0, scale: 1 }, { width: 1280, height: 720 });
    await db.canvasWorkZones.add({
      id: 'zone-1',
      canvasId: 'default',
      personaNodeId: DEFAULT_NODE_IDS.ask,
      ...room,
      createdAt: 1,
    });
    await db.nodes.bulkPut([
      {
        id: DEFAULT_NODE_IDS.ask,
        canvasId: 'default',
        type: 'ask',
        content: '',
        x: room.x + 20,
        y: room.y + 20,
        width: 320,
        height: 180,
        createdAt: 1,
      },
      {
        id: DEFAULT_NODE_IDS.theme,
        canvasId: 'default',
        type: 'theme',
        content: '核心主题',
        x: room.x + 40,
        y: room.y + 40,
        width: 320,
        height: 200,
        createdAt: 1,
      },
      {
        id: 'user-note',
        canvasId: 'default',
        type: 'note',
        content: 'my idea',
        x: 50,
        y: 50,
        width: 320,
        height: 200,
        createdAt: 1,
      },
    ]);

    expect(needsOnboardingWorkroomLayout(
      (await db.canvasWorkZones.get('zone-1'))!,
      await db.nodes.toArray(),
    )).toBe(true);

    await applyOnboardingWorkroomLayout('default');

    const zone = (await db.canvasWorkZones.get('zone-1'))!;
    const theme = await db.nodes.get(DEFAULT_NODE_IDS.theme);
    const img1 = await db.nodes.get(DEFAULT_NODE_IDS.image1);
    const note = await db.nodes.get(DEFAULT_NODE_IDS.note);
    const user = await db.nodes.get('user-note');

    expect(img1?.type).toBe('image');
    expect(await db.nodes.get(DEFAULT_NODE_IDS.image2)).toBeUndefined();
    expect(note).toBeDefined();
    expect(theme && !isNodeInWorkZone(theme, zone)).toBe(true);
    expect(note && !isNodeInWorkZone(note, zone)).toBe(true);
    expect(img1 && !isNodeInWorkZone(img1, zone)).toBe(true);
    expect(img1?.content).toContain('crooked-house');
    expect(user?.content).toBe('my idea');
  });
});
