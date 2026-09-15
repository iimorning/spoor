import i18n from '../i18n';
import { db, type CanvasNode } from '../db';
import { stampNewCards } from './stampNewCard';
import { nextCanvasSortOrder } from './canvasHistoryFolders';
import { ensureAmbienceNodeForCanvas } from './ensureAmbienceNode';
import { ensureDefaultAskWorkZone, readSeedViewportSize } from './seedDefaultAskWorkZone';
import { loadCanvasViewport } from './canvasViewport';
import { isCanvasV2Enabled } from './canvasV2';
import { reconcileNodeScopesFromZones } from './syncWorkZoneScopes';
import {
  computeDefaultAskWorkZoneRect,
  layoutOnboardingStarterNodes,
  ONBOARDING_MATERIAL_GAP,
  ONBOARDING_MATERIAL_TEMPLATE_KEY,
} from './onboardingWorkroomLayout';

/** Fresh canvas with the guided-tour room + outside materials already laid out. */
export async function spawnOnboardingTourCanvas(opts?: {
  name?: string;
  viewport?: { width: number; height: number };
}): Promise<string> {
  if (!isCanvasV2Enabled()) {
    throw new Error('Canvas V2 is required for the onboarding tour canvas.');
  }

  const canvasId = crypto.randomUUID();
  const ids = {
    ask: crypto.randomUUID(),
    image1: crypto.randomUUID(),
    theme: crypto.randomUUID(),
    note: crypto.randomUUID(),
  };
  const viewport = opts?.viewport ?? readSeedViewportSize();
  const transform = loadCanvasViewport(canvasId);
  const targetRoom = computeDefaultAskWorkZoneRect(transform, viewport);
  const patches = layoutOnboardingStarterNodes(targetRoom, ids);
  const sortOrder = await nextCanvasSortOrder();
  const canvasCount = await db.canvases.count();

  const nodes: Omit<CanvasNode, 'createdAt'>[] = patches.map((patch) => ({
    ...patch,
    canvasId,
    templateKey: patch.type === 'ask' ? undefined : ONBOARDING_MATERIAL_TEMPLATE_KEY,
  }));

  await db.canvases.add({
    id: canvasId,
    name:
      opts?.name
      ?? i18n.t('onboarding.tour_canvas_name', { number: canvasCount + 1 }),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    template: 'blank',
    sortOrder,
  });

  await db.nodes.bulkPut(stampNewCards(nodes as CanvasNode[]));

  const zone = await ensureDefaultAskWorkZone({
    canvasId,
    askNodeId: ids.ask,
    viewport,
  });
  if (zone) {
    await db.canvasWorkZones.update(zone.id, targetRoom);
  }

  const nextNodes = await db.nodes.filter((n) => n.canvasId === canvasId).toArray();
  const zones = await db.canvasWorkZones.where('canvasId').equals(canvasId).toArray();
  await reconcileNodeScopesFromZones(nextNodes, zones);

  await ensureAmbienceNodeForCanvas({
    canvasId,
    position: { x: targetRoom.x, y: targetRoom.y + targetRoom.height + ONBOARDING_MATERIAL_GAP },
  });

  return canvasId;
}
