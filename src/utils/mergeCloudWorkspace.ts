import type {
  AgentConfig,
  AgentSandboxThread,
  ArchiveFolder,
  ArchivedCard,
  Article,
  Canvas,
  CanvasChatMessage,
  CanvasChatSession,
  CanvasFolder,
  CanvasNode,
  CanvasPersonaThread,
  CanvasWorkZone,
  Edge,
} from '../db';
import { personaThreadId } from './agentWorkZone';
import { CHAT_SESSION_ARCHIVE_CAP } from './chatSessionArchive';
import { sortChatMessages } from './chatMessageOrder';
import { encodeEssayContent, tryParseEssayContent } from './essayPayload';

export type WorkspaceSnapshot = {
  canvases: Canvas[];
  nodes: CanvasNode[];
  edges: Edge[];
  articles: Article[];
  agents: AgentConfig[];
  sandboxThreads: AgentSandboxThread[];
  archivedCards: ArchivedCard[];
  archiveFolders: ArchiveFolder[];
  canvasFolders: CanvasFolder[];
  workZones: CanvasWorkZone[];
  personaThreads: CanvasPersonaThread[];
};

const DEFAULT_CANVAS_ID = 'default';
export const IMPORT_CARD_GAP = 160;

export function normalizeCanvasId(canvasId?: string | null): string {
  return canvasId && canvasId.length > 0 ? canvasId : DEFAULT_CANVAS_ID;
}

function byId<T>(rows: T[], idOf: (row: T) => string): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) map.set(String(idOf(row)), row);
  return map;
}

function articleBodyEqual(a: Article, b: Article): boolean {
  return a.title === b.title && a.content === b.content && (a.privateNotes ?? '') === (b.privateNotes ?? '');
}

function overlayDefined<T extends object>(cloud: T, local: T): T {
  const next = { ...cloud };
  for (const [key, value] of Object.entries(local)) {
    if (value !== undefined) (next as Record<string, unknown>)[key] = value;
  }
  return next;
}

function contentEqual(a: CanvasNode, b: CanvasNode): boolean {
  return (a.content ?? '') === (b.content ?? '') && (a.description ?? '') === (b.description ?? '') && a.type === b.type;
}

/**
 * Shift an imported cluster to the right of existing cloud cards.
 * Relative layout (including y) is kept — this is a group translation, not a row pack.
 */
export function offsetImportedCardGroup(nodes: CanvasNode[], cloudOnCanvas: CanvasNode[]): CanvasNode[] {
  if (nodes.length === 0 || cloudOnCanvas.length === 0) return nodes;
  const cloudMaxX = Math.max(...cloudOnCanvas.map((n) => n.x + (n.width ?? 0)));
  const localMinX = Math.min(...nodes.map((n) => n.x));
  const dx = cloudMaxX + IMPORT_CARD_GAP - localMinX;
  if (!Number.isFinite(dx) || dx <= 0) return nodes;
  return nodes.map((n) => ({ ...n, x: n.x + dx }));
}

function mapNodeRefs(node: CanvasNode, nodeMap: Map<string, string>, canvasMap: Map<string, string>): CanvasNode {
  const mapOne = (id: string | undefined) => (id ? (nodeMap.get(id) ?? id) : id);
  const mapMany = (ids: string[] | undefined) => ids?.map((id) => nodeMap.get(id) ?? id);
  const canvasId = node.canvasId
    ? (canvasMap.get(normalizeCanvasId(node.canvasId)) ?? node.canvasId)
    : node.canvasId;
  return {
    ...node,
    id: nodeMap.get(node.id) ?? node.id,
    canvasId,
    threadRootContextNodeId: mapOne(node.threadRootContextNodeId),
    threadContextImageNodeIds: mapMany(node.threadContextImageNodeIds),
    webSearchParentId: mapOne(node.webSearchParentId),
    bookExpandParentId: mapOne(node.bookExpandParentId),
    essaySourceNodeIds: mapMany(node.essaySourceNodeIds),
    essaySourceParentId: mapOne(node.essaySourceParentId),
    notePileMemberIds: mapMany(node.notePileMemberIds),
    notePileParentId: mapOne(node.notePileParentId),
    contextScopeAgentId: mapOne(node.contextScopeAgentId),
  };
}

function mapCanvasId(canvasId: string | undefined, canvasMap: Map<string, string>): string | undefined {
  if (!canvasId) return canvasId;
  return canvasMap.get(normalizeCanvasId(canvasId)) ?? canvasId;
}

function remapWorkZone(
  zone: CanvasWorkZone,
  nodeMap: Map<string, string>,
  canvasMap: Map<string, string>,
): CanvasWorkZone {
  const canvasId = mapCanvasId(zone.canvasId, canvasMap) ?? zone.canvasId;
  const personaNodeId = zone.personaNodeId
    ? (nodeMap.get(zone.personaNodeId) ?? zone.personaNodeId)
    : zone.personaNodeId;
  return { ...zone, canvasId, personaNodeId };
}

function remapPersonaThread(
  thread: CanvasPersonaThread,
  nodeMap: Map<string, string>,
  canvasMap: Map<string, string>,
): CanvasPersonaThread {
  const canvasId = mapCanvasId(thread.canvasId, canvasMap) ?? thread.canvasId;
  const agentNodeId = nodeMap.get(thread.agentNodeId) ?? thread.agentNodeId;
  return {
    ...thread,
    id: personaThreadId(canvasId, agentNodeId),
    canvasId,
    agentNodeId,
  };
}

function mergeSessionArchive(
  cloud: CanvasChatSession[] | undefined,
  local: CanvasChatSession[] | undefined,
): CanvasChatSession[] | undefined {
  const map = new Map<string, CanvasChatSession>();
  for (const session of cloud ?? []) map.set(session.id, session);
  for (const session of local ?? []) map.set(session.id, session);
  if (map.size === 0) return undefined;
  return [...map.values()]
    .sort((a, b) => b.endedAt - a.endedAt)
    .slice(0, CHAT_SESSION_ARCHIVE_CAP);
}

function mergePersonaThreadRows(
  cloud: CanvasPersonaThread,
  local: CanvasPersonaThread,
): CanvasPersonaThread {
  const byMessage = new Map<string, CanvasChatMessage>();
  for (const message of cloud.messages) byMessage.set(message.id, message);
  for (const message of local.messages) byMessage.set(message.id, message);
  const messages = sortChatMessages([...byMessage.values()]);
  const newer = local.updatedAt >= cloud.updatedAt ? local : cloud;
  return {
    ...newer,
    id: local.id,
    canvasId: local.canvasId,
    agentNodeId: local.agentNodeId,
    messages,
    sessionArchive: mergeSessionArchive(cloud.sessionArchive, local.sessionArchive),
    updatedAt: Math.max(cloud.updatedAt, local.updatedAt),
  };
}

function unionPersonaThreads(
  cloud: CanvasPersonaThread[],
  local: CanvasPersonaThread[],
): CanvasPersonaThread[] {
  const map = byId(cloud, (row) => String(row.id));
  for (const row of local) {
    const id = String(row.id);
    const existing = map.get(id);
    map.set(id, existing ? mergePersonaThreadRows(existing, row) : row);
  }
  return [...map.values()].map((thread) => ({
    ...thread,
    messages: sortChatMessages(thread.messages),
  }));
}

/** Cloud first; local rows whose id is missing are appended. */
function unionKeepCloud<T>(cloud: T[], extra: T[], idOf: (row: T) => string): T[] {
  const map = byId(cloud, idOf);
  for (const row of extra) {
    const id = String(idOf(row));
    if (!map.has(id)) map.set(id, row);
  }
  return [...map.values()];
}

/** Cloud first; local rows with the same id replace the cloud row. */
function unionOverlayLocal<T>(cloud: T[], local: T[], idOf: (row: T) => string): T[] {
  const map = byId(cloud, idOf);
  for (const row of local) map.set(String(idOf(row)), row);
  return [...map.values()];
}

/**
 * Cloud is the base. Local-only canvases/cards/agents are added.
 * Shared ids keep the cloud row when text differs (local copy is remapped so
 * neither side is dropped). Matching text field-merges: local defined fields
 * win (position, flags); cloud-only fields (themeTag, tags, …) are kept.
 */
export function mergeLocalOntoCloud(
  cloud: WorkspaceSnapshot,
  local: WorkspaceSnapshot,
  opts?: { newId?: () => string },
): WorkspaceSnapshot {
  const newId = opts?.newId ?? (() => crypto.randomUUID());
  const cloudCanvasById = byId(cloud.canvases, (c) => String(c.id));
  const cloudNodeById = byId(cloud.nodes, (n) => String(n.id));
  const cloudEdgeById = byId(cloud.edges, (e) => String(e.id));

  const canvasMap = new Map<string, string>();
  const importedCanvases: Canvas[] = [];
  for (const canvas of local.canvases) {
    const id = String(canvas.id);
    if (cloudCanvasById.has(id)) {
      canvasMap.set(id, id);
      continue;
    }
    importedCanvases.push(canvas);
  }

  const nodeMap = new Map<string, string>();
  const overlays: CanvasNode[] = [];
  const additions: CanvasNode[] = [];

  for (const node of local.nodes) {
    const id = String(node.id);
    const cloudNode = cloudNodeById.get(id);

    if (!cloudNode) {
      nodeMap.set(id, id);
      additions.push(node);
      continue;
    }

    if (contentEqual(node, cloudNode)) {
      nodeMap.set(id, id);
      overlays.push(overlayDefined(cloudNode, node));
      continue;
    }

    // Same id, different text: keep the cloud card and add the local copy.
    const remapped = newId();
    nodeMap.set(id, remapped);
    additions.push({ ...node, id: remapped });
  }

  const additionsByCanvas = new Map<string, CanvasNode[]>();
  for (const node of additions) {
    const canvasId = normalizeCanvasId(node.canvasId);
    const list = additionsByCanvas.get(canvasId) ?? [];
    list.push(node);
    additionsByCanvas.set(canvasId, list);
  }

  const placedAdditions: CanvasNode[] = [];
  for (const [canvasId, group] of additionsByCanvas) {
    const cloudOnCanvas = cloud.nodes.filter((n) => normalizeCanvasId(n.canvasId) === canvasId);
    placedAdditions.push(...offsetImportedCardGroup(group, cloudOnCanvas));
  }

  const cloudArticleById = byId(cloud.articles, (a) => String(a.id));
  const articleIdMap = new Map<string, string>();
  const importedArticles: Article[] = [];
  for (const article of local.articles) {
    const id = String(article.id);
    const cloudArticle = cloudArticleById.get(id);
    if (!cloudArticle) {
      importedArticles.push(article);
      continue;
    }
    if (articleBodyEqual(article, cloudArticle)) {
      importedArticles.push(overlayDefined(cloudArticle, article));
      continue;
    }
    const remapped = newId();
    articleIdMap.set(id, remapped);
    importedArticles.push({ ...article, id: remapped });
  }

  const remappedNodes = [...overlays, ...placedAdditions].map((node) => {
    const mapped = mapNodeRefs(node, nodeMap, canvasMap);
    const essay = tryParseEssayContent(mapped.content);
    if (!essay) return mapped;
    const nextArticleId = articleIdMap.get(essay.articleId);
    if (!nextArticleId) return mapped;
    return { ...mapped, content: encodeEssayContent({ articleId: nextArticleId }) };
  });

  const importedEdges: Edge[] = [];
  for (const edge of local.edges) {
    const originalFrom = edge.from;
    const originalTo = edge.to;
    const mappedFrom = nodeMap.get(originalFrom) ?? originalFrom;
    const mappedTo = nodeMap.get(originalTo) ?? originalTo;
    const canvasId = edge.canvasId
      ? (canvasMap.get(normalizeCanvasId(edge.canvasId)) ?? edge.canvasId)
      : edge.canvasId;
    const endpointsUnchanged = mappedFrom === originalFrom && mappedTo === originalTo;
    const duplicateOfCloudEdge = cloudEdgeById.has(String(edge.id)) && endpointsUnchanged;
    if (duplicateOfCloudEdge) continue;
    const nextId = cloudEdgeById.has(String(edge.id)) ? newId() : String(edge.id);
    importedEdges.push({ ...edge, id: nextId, from: mappedFrom, to: mappedTo, canvasId });
  }

  const importedArchived = local.archivedCards
    .filter((row) => !cloud.archivedCards.some((c) => String(c.id) === String(row.id)))
    .map((row) => ({
      ...row,
      sourceCanvasId: row.sourceCanvasId
        ? (canvasMap.get(normalizeCanvasId(row.sourceCanvasId)) ?? row.sourceCanvasId)
        : row.sourceCanvasId,
      node: mapNodeRefs(row.node, nodeMap, canvasMap),
    }));

  const localCanvasById = byId(local.canvases, (c) => String(c.id));
  const canvasesWithLocalOrg = cloud.canvases.map((canvas) => {
    const loc = localCanvasById.get(String(canvas.id));
    if (!loc) return canvas;
    const next: Canvas = { ...canvas };
    if (typeof loc.sortOrder === 'number') next.sortOrder = loc.sortOrder;
    if (loc.folderId) next.folderId = loc.folderId;
    else if (typeof loc.sortOrder === 'number') delete next.folderId;
    return next;
  });

  return {
    canvases: unionKeepCloud(canvasesWithLocalOrg, importedCanvases, (c) => String(c.id)),
    nodes: unionOverlayLocal(cloud.nodes, remappedNodes, (n) => String(n.id)),
    edges: unionKeepCloud(cloud.edges, importedEdges, (e) => String(e.id)),
    articles: unionOverlayLocal(cloud.articles, importedArticles, (a) => String(a.id)),
    agents: unionKeepCloud(cloud.agents, local.agents, (a) => String(a.id)),
    sandboxThreads: unionKeepCloud(cloud.sandboxThreads, local.sandboxThreads, (t) => String(t.agentId)),
    archivedCards: unionKeepCloud(cloud.archivedCards, importedArchived, (r) => String(r.id)),
    archiveFolders: unionKeepCloud(cloud.archiveFolders, local.archiveFolders, (f) => String(f.id)),
    canvasFolders: unionKeepCloud(cloud.canvasFolders, local.canvasFolders, (f) => String(f.id)),
    workZones: unionOverlayLocal(
      cloud.workZones,
      local.workZones.map((zone) => remapWorkZone(zone, nodeMap, canvasMap)),
      (zone) => String(zone.id),
    ),
    personaThreads: unionPersonaThreads(
      cloud.personaThreads,
      local.personaThreads.map((thread) => remapPersonaThread(thread, nodeMap, canvasMap)),
    ),
  };
}
