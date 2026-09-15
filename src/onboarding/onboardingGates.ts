import type { CanvasNode, CanvasWorkZone } from '../db';

import { isNodeInWorkZone } from '../utils/workZoneGeometry';



export type OnboardingGate =

  | 'manual'

  | 'material-moved'

  | 'chat-sent'

  | 'excerpt-created'
  | 'essay-created';



export type MaterialPositionSnapshot = Map<string, { x: number; y: number }>;



const MOVE_EPSILON_PX = 10;



export function snapshotMaterialPositions(nodes: CanvasNode[]): MaterialPositionSnapshot {

  const map: MaterialPositionSnapshot = new Map();

  for (const node of nodes) {

    if (node.type === 'ambience' || node.type === 'ask' || node.type === 'agent') continue;

    map.set(node.id, { x: node.x, y: node.y });

  }

  return map;

}



/** Baseline for cards that start outside the work room (drag-in loop). */

export function snapshotOutsideMaterialPositions(

  nodes: CanvasNode[],

  zone: CanvasWorkZone,

): MaterialPositionSnapshot {

  const map: MaterialPositionSnapshot = new Map();

  for (const node of nodes) {

    if (node.type === 'ambience' || node.type === 'ask' || node.type === 'agent') continue;

    if (isNodeInWorkZone(node, zone)) continue;

    map.set(node.id, { x: node.x, y: node.y });

  }

  return map;

}



function movedEnough(

  start: { x: number; y: number },

  node: CanvasNode,

): boolean {

  const dx = node.x - start.x;

  const dy = node.y - start.y;

  return dx * dx + dy * dy >= MOVE_EPSILON_PX * MOVE_EPSILON_PX;

}



export function hasMovedMaterial(

  baseline: MaterialPositionSnapshot,

  nodes: CanvasNode[],

): boolean {

  if (baseline.size === 0) return false;

  for (const node of nodes) {

    if (node.type === 'ambience' || node.type === 'ask' || node.type === 'agent') continue;

    const start = baseline.get(node.id);

    if (!start) continue;

    if (movedEnough(start, node)) return true;

  }

  return false;

}



/** User dragged an outside card far enough and its center landed inside the room. */

export function hasDraggedMaterialIntoZone(

  baseline: MaterialPositionSnapshot,

  nodes: CanvasNode[],

  zone: CanvasWorkZone,

): boolean {

  if (baseline.size === 0) return false;

  for (const node of nodes) {

    if (node.type === 'ambience' || node.type === 'ask' || node.type === 'agent') continue;

    const start = baseline.get(node.id);

    if (!start) continue;

    if (!movedEnough(start, node)) continue;

    if (isNodeInWorkZone(node, zone)) return true;

  }

  return false;

}



export function countUserThreadMessages(

  messages: Array<{ role: string }> | undefined,

): number {

  return (messages ?? []).filter((m) => m.role === 'user').length;

}



export function hasExcerptedFromChat(

  nodes: CanvasNode[],

  baselineNodeIds: ReadonlySet<string>,

): boolean {

  return nodes.some(

    (node) => !baselineNodeIds.has(node.id) && Boolean(node.sourceMessageId),

  );

}



export function hasCreatedEssay(

  nodes: CanvasNode[],

  baselineNodeIds: ReadonlySet<string>,

): boolean {

  return nodes.some((node) => !baselineNodeIds.has(node.id) && node.type === 'essay');

}



export function isOnboardingGateMet(

  gate: OnboardingGate | undefined,

  ctx: {

    nodes: CanvasNode[];

    materialBaseline: MaterialPositionSnapshot;

    workZone: CanvasWorkZone | null;

    userMessageBaseline: number;

    userMessageCount: number;

    nodeIdsBaseline: ReadonlySet<string>;

  },

): boolean {

  if (!gate || gate === 'manual') return true;

  if (gate === 'material-moved') {

    if (!ctx.workZone) return false;

    return hasDraggedMaterialIntoZone(ctx.materialBaseline, ctx.nodes, ctx.workZone);

  }

  if (gate === 'chat-sent') {

    return ctx.userMessageCount > ctx.userMessageBaseline;

  }

  if (gate === 'excerpt-created') {

    return hasExcerptedFromChat(ctx.nodes, ctx.nodeIdsBaseline);

  }

  if (gate === 'essay-created') {

    return hasCreatedEssay(ctx.nodes, ctx.nodeIdsBaseline);

  }

  return true;

}



export function waitingLabelKeyForGate(gate: OnboardingGate | undefined): string | null {

  switch (gate) {

    case 'material-moved':

      return 'onboarding.cta_waiting_move';

    case 'chat-sent':

      return 'onboarding.cta_waiting_send';

    case 'excerpt-created':

      return 'onboarding.cta_waiting_excerpt';

    case 'essay-created':

      return 'onboarding.cta_waiting_compose';

    default:

      return null;

  }

}

