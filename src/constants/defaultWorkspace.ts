import type { CanvasNode, Edge } from '../db';
import { ASK_NODE_SIZE, DEFAULT_NODE_SIZE, THEME_NODE_SIZE } from '../utils/canvas';

/** Stable ids on the default workspace so seed/migration can find them. */
export const DEFAULT_NODE_IDS = {
  theme: 'default-theme',
  ask: 'default-ask',
  note: 'default-note',
  image1: 'default-onboard-img-1',
  image2: 'default-onboard-img-2',
} as const;

/** Pre-onboarding trio — image starters are added by layout migration. */
export const CORE_DEFAULT_NODE_IDS = [
  DEFAULT_NODE_IDS.ask,
  DEFAULT_NODE_IDS.theme,
  DEFAULT_NODE_IDS.note,
] as const;

/**
 * Seed ids that a default-layout swap may delete. When you ship a new default
 * workspace, add the previous starter ids here so empty/unmodified first-run
 * canvases can upgrade — never add user-created ids.
 *
 * Historical cosmos + Memory Architect starter ids are intentionally NOT in
 * this set: an existing user who already has cosmos on their default canvas
 * should keep it untouched (we don't delete user data on the default layout
 * change). See `useSeedData.installDefaultWorkspace` for the swap logic.
 */
export const OFFICIAL_DEFAULT_STARTER_NODE_IDS: ReadonlySet<string> = new Set([
  ...Object.values(DEFAULT_NODE_IDS),
]);

export const OFFICIAL_DEFAULT_STARTER_EDGE_IDS: ReadonlySet<string> = new Set();

const ORIGIN_X = 100;
const ORIGIN_Y = 140;
const ASK_W = ASK_NODE_SIZE.width;
const ASK_H = ASK_NODE_SIZE.height;
const NOTE_W = DEFAULT_NODE_SIZE.width;
const NOTE_H = DEFAULT_NODE_SIZE.height;
const THEME_W = THEME_NODE_SIZE.width;
const THEME_H = THEME_NODE_SIZE.height;
/** Clear gap between starter cards (avoids chrome / ambience overlap). */
export const DEFAULT_WORKSPACE_COL_GAP = 80;

/**
 * Previous L-shape starter coords (ask top-left, theme top-right, note under ask).
 * Virgin canvases still on this layout get repositioned on seed — the note sat
 * on top of the bottom-left ambience fixture on common laptop heights.
 *
 * 键只有这三个，别按 `keyof typeof DEFAULT_NODE_IDS` 开：这张表记的是镜像卡出现
 * **之前**的布局。把 image1/image2 补进来（哪怕填上坐标）会让老画布凑不齐这张表，
 * 反而认不出旧布局、跳过那次挪位迁移。
 */
export const LEGACY_L_SHAPE_DEFAULT_POSITIONS: Readonly<
  Record<'ask' | 'theme' | 'note', { x: number; y: number }>
> = {
  ask: { x: 80, y: 80 },
  theme: { x: 456, y: 80 },
  note: { x: 80, y: 360 },
};

export function isLegacyLShapeDefaultLayout(
  nodes: ReadonlyArray<{ id: string; x: number; y: number }>,
): boolean {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return (
    Object.keys(LEGACY_L_SHAPE_DEFAULT_POSITIONS) as Array<
      keyof typeof LEGACY_L_SHAPE_DEFAULT_POSITIONS
    >
  ).every((key) => {
    const node = byId.get(DEFAULT_NODE_IDS[key]);
    const expected = LEGACY_L_SHAPE_DEFAULT_POSITIONS[key];
    return node != null && node.x === expected.x && node.y === expected.y;
  });
}

export type DefaultWorkspaceIds = {
  theme: string;
  ask: string;
  note: string;
};

/**
 * Build the starter layout: one Ask card (阿狸), one Theme card, and one
 * note card. No edges — the user wires them up.
 *
 * Used by first-run `useSeedData` (stable `DEFAULT_NODE_IDS`) and by
 * "new blank canvas" (caller-supplied UUIDs so canvases do not collide).
 *
 * Horizontal row from ORIGIN + card size + DEFAULT_WORKSPACE_COL_GAP (currently
 * 100/140 origin, 320-wide cards, 80 col gap) so the three starters stay clear
 * of each other and of the bottom-left ambience fixture on common laptop
 * viewports (the old L-shape put the note on top of that fixture):
 *   阿狸卡      (100, 140)           ask
 *   主题卡      (500, 140)           theme
 *   便签卡      (900, 140)           note
 */
export function buildDefaultWorkspace(opts: {
  canvasId: string;
  themeContent: string;
  noteContent: string;
  /** Defaults to `DEFAULT_NODE_IDS`. Pass fresh UUIDs for extra canvases. */
  ids?: DefaultWorkspaceIds;
}): { nodes: Omit<CanvasNode, 'createdAt'>[]; edges: Edge[] } {
  const { canvasId, themeContent, noteContent } = opts;
  const ids = opts.ids ?? DEFAULT_NODE_IDS;

  const askX = ORIGIN_X;
  const askY = ORIGIN_Y;
  const themeX = askX + ASK_W + DEFAULT_WORKSPACE_COL_GAP;
  const themeY = askY;
  const noteX = themeX + THEME_W + DEFAULT_WORKSPACE_COL_GAP;
  const noteY = askY;

  const nodes: Omit<CanvasNode, 'createdAt'>[] = [
    {
      id: ids.ask,
      canvasId,
      type: 'ask',
      content: '',
      x: askX,
      y: askY,
      width: ASK_W,
      height: ASK_H,
    },
    {
      id: ids.theme,
      canvasId,
      type: 'theme',
      content: themeContent,
      x: themeX,
      y: themeY,
      width: THEME_W,
      height: THEME_H,
    },
    {
      id: ids.note,
      canvasId,
      type: 'note',
      content: noteContent,
      x: noteX,
      y: noteY,
      width: NOTE_W,
      height: NOTE_H,
    },
  ];

  return { nodes, edges: [] };
}

/** Place the ambience fixture under the starter row with a clear gap. */
export function defaultWorkspaceAmbiencePosition(): { x: number; y: number } {
  const rowHeight = Math.max(ASK_H, THEME_H, NOTE_H);
  return {
    x: ORIGIN_X,
    y: ORIGIN_Y + rowHeight + DEFAULT_WORKSPACE_COL_GAP,
  };
}