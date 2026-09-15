import type { RefObject } from 'react';
import type { CanvasNode } from '../db';
import { isPersonaAnchorNode } from './agentWorkZone';
import { DEFAULT_NODE_SIZE, findAdjacentCanvasPosition, type CanvasObstacle } from './canvas';

/** Keep in sync with the toolbar file picker. */
export const CANVAS_FILE_UPLOAD_ACCEPT =
  'image/*,video/*,audio/*,.wav,.mp3,.m4a,.aac,.ogg,.flac,.docx,.txt,.md,.pdf,.epub,application/pdf,application/epub+zip';

export function canvasObstaclesFromNodes(
  nodes: CanvasNode[],
  nodesRef: RefObject<Record<string, HTMLElement | null>>,
): CanvasObstacle[] {
  return nodes.map((node) => {
    const el = nodesRef.current[node.id];
    return {
      type: node.type,
      x: node.x,
      y: node.y,
      width: node.width && node.width > 0 ? node.width : el?.offsetWidth || undefined,
      height: node.height && node.height > 0 ? node.height : el?.offsetHeight || undefined,
    };
  });
}

/** Place chat uploads beside the active persona card. */
export function personaChatUploadOrigin(
  persona: CanvasNode,
  nodes: CanvasNode[],
  nodesRef: RefObject<Record<string, HTMLElement | null>>,
): { x: number; y: number } {
  const obstacles = canvasObstaclesFromNodes(nodes, nodesRef);
  const el = nodesRef.current[persona.id];
  const anchor: CanvasObstacle = {
    type: persona.type,
    x: persona.x,
    y: persona.y,
    width: persona.width && persona.width > 0 ? persona.width : el?.offsetWidth || undefined,
    height: persona.height && persona.height > 0 ? persona.height : el?.offsetHeight || undefined,
  };
  return findAdjacentCanvasPosition({
    obstacles,
    anchor,
    size: DEFAULT_NODE_SIZE,
  });
}

export function filesFromDataTransfer(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];
  if (data.files?.length) return Array.from(data.files);
  const out: File[] = [];
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file) out.push(file);
  }
  return out;
}

export function scopeIngestedNodesToPersona<T extends CanvasNode>(
  nodes: T[],
  personaNodeId: string,
): T[] {
  return nodes.map((node) =>
    isPersonaAnchorNode(node) ? node : { ...node, contextScopeAgentId: personaNodeId },
  );
}
