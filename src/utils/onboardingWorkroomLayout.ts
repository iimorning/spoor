import i18n from '../i18n';
import { db, type CanvasNode, type CanvasWorkZone } from '../db';
import {
  DEFAULT_NODE_IDS,
  OFFICIAL_DEFAULT_STARTER_NODE_IDS,
} from '../constants/defaultWorkspace';
import { LEGACY_ONBOARDING_LANDSCAPE_IMAGE_IDS, ONBOARDING_LANDSCAPE_IMAGE } from '../constants/onboardingLandscapes';
import type { CanvasTransformLike } from './canvas';
import { ASK_NODE_SIZE, DEFAULT_NODE_SIZE } from './canvas';
import { isCanvasV2Enabled } from './canvasV2';
import { loadCanvasViewport } from './canvasViewport';
import {
  DEFAULT_SEED_VIEWPORT,
  readSeedViewportSize,
  viewportWorldRect,
} from './seedDefaultAskWorkZone';
import { ensureAmbienceNodeForCanvas } from './ensureAmbienceNode';
import { reconcileNodeScopesFromZones } from './syncWorkZoneScopes';
import { isNodeInWorkZone, MIN_WORK_ZONE_SIZE_PX } from './workZoneGeometry';
import { FLUX_IMAGE_CARD_HEIGHT, FLUX_IMAGE_CARD_WIDTH } from '../services/spawnFluxImageCards';

export const ONBOARDING_MATERIAL_GAP = 48;
export const ONBOARDING_OUTSIDE_COL_GAP = 72;
export const ONBOARDING_ROOM_INSET = 28;
export const ONBOARDING_MATERIAL_TEMPLATE_KEY = 'onboarding-material';

export type OnboardingStarterIds = {
  ask: string;
  image1: string;
  theme: string;
  note: string;
};

/** Centered work room — most of the visible canvas, with a margin for outside materials. */
export function computeDefaultAskWorkZoneRect(
  transform: CanvasTransformLike,
  viewport: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const visible = viewportWorldRect(transform, viewport, 32);
  const roomWidth = Math.max(MIN_WORK_ZONE_SIZE_PX, visible.width * 0.9);
  const roomHeight = Math.max(MIN_WORK_ZONE_SIZE_PX, visible.height * 0.84);
  return {
    x: visible.x + (visible.width - roomWidth) / 2,
    y: visible.y + (visible.height - roomHeight) / 2,
    width: roomWidth,
    height: roomHeight,
  };
}

function isOfficialStarter(node: { id: string }): boolean {
  return OFFICIAL_DEFAULT_STARTER_NODE_IDS.has(node.id);
}

function approxEqual(a: number, b: number, eps = 2): boolean {
  return Math.abs(a - b) <= eps;
}

/** Auto-seeded full-viewport zones from older builds. */
export function isViewportSizedWorkZone(
  zone: CanvasWorkZone,
  viewport: { width: number; height: number } = readSeedViewportSize(),
): boolean {
  const full = viewportWorldRect({ x: 0, y: 0, scale: 1 }, viewport, 0);
  return (
    approxEqual(zone.x, full.x)
    && approxEqual(zone.y, full.y)
    && approxEqual(zone.width, full.width, 4)
    && approxEqual(zone.height, full.height, 4)
  );
}

type LayoutPatch = Pick<CanvasNode, 'id' | 'x' | 'y' | 'width' | 'height' | 'content' | 'type'>;

export function layoutOnboardingStarterNodes(
  zone: { x: number; y: number; width: number; height: number },
  ids: OnboardingStarterIds = DEFAULT_NODE_IDS,
): LayoutPatch[] {
  const askX = zone.x + ONBOARDING_ROOM_INSET;
  const askY = zone.y + ONBOARDING_ROOM_INSET + 8;
  const outsideX = zone.x + zone.width + ONBOARDING_OUTSIDE_COL_GAP;
  let outsideY = zone.y;

  const stack = (height: number) => {
    const pos = { x: outsideX, y: outsideY };
    outsideY += height + ONBOARDING_MATERIAL_GAP;
    return pos;
  };

  const img1 = stack(FLUX_IMAGE_CARD_HEIGHT);
  const theme = stack(DEFAULT_NODE_SIZE.height);
  const note = stack(DEFAULT_NODE_SIZE.height);

  return [
    {
      id: ids.ask,
      type: 'ask',
      content: '',
      x: askX,
      y: askY,
      width: ASK_NODE_SIZE.width,
      height: ASK_NODE_SIZE.height,
    },
    {
      id: ids.image1,
      type: 'image',
      content: ONBOARDING_LANDSCAPE_IMAGE,
      ...img1,
      width: FLUX_IMAGE_CARD_WIDTH,
      height: FLUX_IMAGE_CARD_HEIGHT,
    },
    {
      id: ids.theme,
      type: 'theme',
      content: i18n.t('canvas.starter.onboarding_theme'),
      ...theme,
      width: DEFAULT_NODE_SIZE.width,
      height: DEFAULT_NODE_SIZE.height,
    },
    {
      id: ids.note,
      type: 'note',
      content: i18n.t('canvas.starter.onboarding_note'),
      ...note,
      width: DEFAULT_NODE_SIZE.width,
      height: DEFAULT_NODE_SIZE.height,
    },
  ];
}

export function onboardingOutsideMaterialNodes(nodes: CanvasNode[]): CanvasNode[] {
  return nodes.filter(
    (n) =>
      n.type !== 'ask'
      && n.type !== 'ambience'
      && n.type !== 'agent'
      && (
        OFFICIAL_DEFAULT_STARTER_NODE_IDS.has(n.id)
        || n.templateKey === ONBOARDING_MATERIAL_TEMPLATE_KEY
      ),
  );
}

export function needsOnboardingWorkroomLayout(
  zone: CanvasWorkZone,
  nodes: CanvasNode[],
  viewport = readSeedViewportSize(),
): boolean {
  if (!nodes.some((n) => n.id === DEFAULT_NODE_IDS.ask)) return false;
  if (!nodes.some((n) => n.id === DEFAULT_NODE_IDS.image1)) return true;
  if (nodes.some((n) => n.id === DEFAULT_NODE_IDS.image2)) return true;
  const image1 = nodes.find((n) => n.id === DEFAULT_NODE_IDS.image1);
  if (
    image1?.content
    && LEGACY_ONBOARDING_LANDSCAPE_IMAGE_IDS.some((id) => image1.content!.includes(id))
  ) {
    return true;
  }
  if (isViewportSizedWorkZone(zone, viewport)) return true;
  const transform = loadCanvasViewport(zone.canvasId);
  const target = computeDefaultAskWorkZoneRect(transform, viewport);
  if (zone.width < target.width * 0.92 || zone.height < target.height * 0.92) return true;
  const note = nodes.find((n) => n.id === DEFAULT_NODE_IDS.note);
  if (note?.content?.includes('写下这周你反复想起')) return true;
  if (note?.content?.includes('Write the thought you keep returning')) return true;
  return onboardingOutsideMaterialNodes(nodes).some((node) => isNodeInWorkZone(node, zone));
}

/** Reposition official starters + resize auto-seeded room for the onboarding loop. */
export async function applyOnboardingWorkroomLayout(canvasId: string): Promise<void> {
  if (!isCanvasV2Enabled()) return;

  const zones = await db.canvasWorkZones.where('canvasId').equals(canvasId).toArray();
  const askZone = zones.find((z) => z.personaNodeId === DEFAULT_NODE_IDS.ask) ?? zones[0];
  if (!askZone) return;

  const nodes = await db.nodes.filter((n) => n.canvasId === canvasId).toArray();
  if (!nodes.some((n) => n.id === DEFAULT_NODE_IDS.ask)) return;
  if (!needsOnboardingWorkroomLayout(askZone, nodes)) return;

  const viewport = readSeedViewportSize();
  const transform = loadCanvasViewport(canvasId);
  const targetRoom = computeDefaultAskWorkZoneRect(transform, viewport);
  const patches = layoutOnboardingStarterNodes(targetRoom);

  const blankNote = i18n.t('canvas.starter.blank_note');
  const blankTheme = i18n.t('canvas.starter.blank_theme');
  const replaceableNoteContent = new Set([
    '',
    blankNote,
    'Record thought fragments, inspiration, or notes here…',
    '在此记录想法碎片、灵感或素材…',
    i18n.t('canvas.starter.onboarding_note'),
    'Walking without a destination often clears the best ideas.\n\nWrite the thought you keep returning to this week.',
    '没有目的地的散步，常常能理清最好的想法。\n\n写下这周你反复想起的那句话。',
  ]);
  const replaceableThemeContent = new Set([
    '',
    blankTheme,
    'Core Theme',
    '核心主题',
    i18n.t('canvas.starter.onboarding_theme'),
  ]);

  await db.transaction('rw', db.nodes, db.canvasWorkZones, db.canvases, async () => {
    for (const patch of patches) {
      const existing = await db.nodes.get(patch.id);
      const content =
        patch.type === 'note' && existing && !replaceableNoteContent.has((existing.content ?? '').trim())
          ? existing.content
          : patch.type === 'theme' && existing && !replaceableThemeContent.has((existing.content ?? '').trim())
            ? existing.content
            : patch.content;
      if (existing) {
        await db.nodes.update(patch.id, {
          x: patch.x,
          y: patch.y,
          width: patch.width,
          height: patch.height,
          content,
          type: patch.type,
        });
      } else {
        await db.nodes.add({
          ...patch,
          canvasId,
          createdAt: Date.now(),
        } as CanvasNode);
      }
    }

    await db.canvasWorkZones.update(askZone.id, targetRoom);
    await db.nodes.delete(DEFAULT_NODE_IDS.image2);
    await db.canvases.update(canvasId, { updatedAt: Date.now() });
  });

  const nextNodes = await db.nodes.filter((n) => n.canvasId === canvasId).toArray();
  const nextZones = await db.canvasWorkZones.where('canvasId').equals(canvasId).toArray();
  await reconcileNodeScopesFromZones(nextNodes, nextZones);

  const bottom = Math.max(
    targetRoom.y + targetRoom.height,
    ...patches.map((p) => p.y + (p.height ?? 0)),
  );
  await ensureAmbienceNodeForCanvas({
    canvasId,
    position: { x: targetRoom.x, y: bottom + ONBOARDING_MATERIAL_GAP },
  });
}

export function defaultSeedViewportForTests(): { width: number; height: number } {
  return { ...DEFAULT_SEED_VIEWPORT };
}
