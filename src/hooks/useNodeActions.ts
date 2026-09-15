import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { CanvasTransform } from './useCanvasInteraction';
import { useAppDialog } from '../components/AppDialogProvider';
import { db, type CanvasNode } from '../db';
import i18n from '../i18n';
import { ASK_NODE_SIZE, getCanvasCenterPosition, DEFAULT_NODE_SIZE, THEME_NODE_SIZE } from '../utils/canvas';
import { archiveNode, isArchivableNodeType } from '../utils/archiveCards';
import { writeLastArchiveFolderId } from '../utils/archiveFolders';
import { ingestFilesToCanvas } from '../utils/canvasFileIngest';
import { articleIdsOrphanedByRemovingEssayNodes, placeEssayNode } from '../utils/essayNodes';
import { tryParseEssayContent } from '../utils/essayPayload';
import { isAmbienceFixtureNode } from '../utils/ensureAmbienceNode';
import { setBookExpandBranchesCollapsed } from '../services/spawnBookExpandCards';
import { stampNewCard } from '../utils/stampNewCard';
import { stampWorkZoneScopeOnNewNodes } from '../utils/syncWorkZoneScopes';
import { isPersonaAnchorNode, releasePersonaBindings } from '../utils/agentWorkZone';

interface UseNodeActionsParams {
  activeCanvasId: string;
  nodesRef: RefObject<Record<string, HTMLElement | null>>;
  connectingFrom: string | null;
  setConnectingFrom: (v: string | null) => void;
  edges: { from: string; to: string }[];
  selectedNodes: Set<string>;
  setSelectedNodes: React.Dispatch<React.SetStateAction<Set<string>>>;
  transformRef: RefObject<CanvasTransform>;
  /** After creating an essay card, open fullscreen reader. */
  onOpenEssay?: (articleId: string, nodeId: string) => void;
}

export function useNodeActions({
  activeCanvasId,
  nodesRef,
  connectingFrom,
  setConnectingFrom,
  edges,
  selectedNodes,
  setSelectedNodes,
  transformRef,
  onOpenEssay,
}: UseNodeActionsParams) {
  const { t } = useTranslation();
  const { alert: appAlert, confirm } = useAppDialog();
  const toggleNodeSelection = (id: string) => {
    setSelectedNodes(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const restackCollapsedThemeIfNeeded = async (nodeId: string) => {
    const node = await db.nodes.get(nodeId);
    if (!node || node.type !== 'theme' || !node.bookExpandBranchesCollapsed) return;
    const el = nodesRef.current[nodeId];
    const hubHeight =
      node.height && node.height > 0 ? node.height : el?.offsetHeight || undefined;
    await setBookExpandBranchesCollapsed(nodeId, true, { hubHeight });
  };

  const handleLink = (id: string) => {
    if (connectingFrom) {
      if (connectingFrom !== id && !edges.find(e => (e.from === connectingFrom && e.to === id) || (e.from === id && e.to === connectingFrom))) {
        const fromId = connectingFrom;
        void (async () => {
          await db.edges.add({
            id: crypto.randomUUID(),
            canvasId: activeCanvasId,
            from: fromId,
            to: id,
          });
          await restackCollapsedThemeIfNeeded(fromId);
          await restackCollapsedThemeIfNeeded(id);
        })();
      }
      setConnectingFrom(null);
    } else {
      setConnectingFrom(id);
    }
  };

  /**
   * While in link mode (`connectingFrom`), place a blank note at canvas coords
   * and wire an edge from the source card. Clears link mode.
   */
  const createLinkedNoteAt = async (
    fromId: string,
    x: number,
    y: number,
  ): Promise<string | null> => {
    const source = await db.nodes.get(fromId);
    if (!source) {
      setConnectingFrom(null);
      return null;
    }
    const id = crypto.randomUUID();
    const edgeId = crypto.randomUUID();
    const [note] = await stampWorkZoneScopeOnNewNodes(
      [
        stampNewCard({
          id,
          canvasId: activeCanvasId,
          type: 'text',
          content: '',
          x,
          y,
          width: DEFAULT_NODE_SIZE.width,
          height: DEFAULT_NODE_SIZE.height,
        }) as CanvasNode,
      ],
      activeCanvasId,
    );
    await db.transaction('rw', db.nodes, db.edges, async () => {
      await db.nodes.add(note);
      await db.edges.add({
        id: edgeId,
        canvasId: activeCanvasId,
        from: fromId,
        to: id,
      });
    });
    setConnectingFrom(null);
    await restackCollapsedThemeIfNeeded(fromId);
    return id;
  };

  const deleteEdge = (id: string) => {
    db.edges.delete(id);
  };

  const deleteEssayArticlesForNodes = async (nodes: { id: string; type: string; content?: string }[]) => {
    const articleIds = await articleIdsOrphanedByRemovingEssayNodes(nodes);
    if (articleIds.length === 0) return;
    await db.articles.bulkDelete(articleIds);
  };

  const removeNodeId = async (id: string): Promise<boolean> => {
    const node = await db.nodes.get(id);
    if (isAmbienceFixtureNode(node?.type)) return false;
    if (node?.type === 'essay') {
      const articleId = tryParseEssayContent(node.content)?.articleId;
      const title = node.description || t('nodes.essay_untitled');
      const ok = await confirm({
        message: t('nodes.essay_delete_confirm', { title }),
        variant: 'danger',
        confirmLabel: t('dialog.confirm'),
        cancelLabel: t('dialog.cancel'),
      });
      if (!ok) return false;
      await db.transaction('rw', db.nodes, db.edges, db.articles, async () => {
        await db.nodes.delete(id);
        await db.edges.where('from').equals(id).or('to').equals(id).delete();
        if (articleId) {
          const stillLinked = (await db.nodes.where('type').equals('essay').toArray()).some(
            (n) => tryParseEssayContent(n.content)?.articleId === articleId,
          );
          if (!stillLinked) await db.articles.delete(articleId);
        }
      });
      return true;
    }
    if (node && isPersonaAnchorNode(node)) {
      await releasePersonaBindings([id]);
    }
    await db.nodes.delete(id);
    await db.edges.where('from').equals(id).or('to').equals(id).delete();
    return true;
  };

  const removeNodeIds = async (ids: Iterable<string>): Promise<string[]> => {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return [];
    const nodes = await db.nodes.bulkGet(uniqueIds);
    const present = nodes
      .filter((n): n is NonNullable<typeof n> => Boolean(n))
      .filter((n) => !isAmbienceFixtureNode(n.type));
    const deletableIds = present.map((n) => n.id);
    if (deletableIds.length === 0) return [];
    const essayNodes = present.filter((n) => n.type === 'essay');
    if (essayNodes.length > 0) {
      const ok = await confirm({
        message: t('nodes.essay_delete_bulk_confirm', { count: essayNodes.length }),
        variant: 'danger',
        confirmLabel: t('dialog.confirm'),
        cancelLabel: t('dialog.cancel'),
      });
      if (!ok) return [];
    }
    await db.transaction('rw', db.nodes, db.edges, db.articles, async () => {
      await deleteEssayArticlesForNodes(present);
      await db.nodes.bulkDelete(deletableIds);
      for (const id of deletableIds) {
        await db.edges.where('from').equals(id).or('to').equals(id).delete();
      }
    });
    const personaIds = present.filter((n) => isPersonaAnchorNode(n)).map((n) => n.id);
    if (personaIds.length > 0) await releasePersonaBindings(personaIds);
    setSelectedNodes(new Set());
    return deletableIds;
  };

  const archiveNodeId = async (id: string, folderId?: string | null) => {
    const node = await db.nodes.get(id);
    if (!node || !isArchivableNodeType(node.type)) return;
    try {
      await archiveNode(id, folderId);
      writeLastArchiveFolderId(folderId ?? null);
    } catch (e) {
      console.error('[Spoor] archiveNode failed', e);
      await appAlert({ message: t('archive.archive_failed') });
    }
  };

  const addTextNode = async () => {
    const { x, y } = getCanvasCenterPosition(transformRef.current);
    const [node] = await stampWorkZoneScopeOnNewNodes(
      [
        stampNewCard({
          id: crypto.randomUUID(),
          canvasId: activeCanvasId,
          type: 'text',
          content: '',
          x,
          y,
        }) as CanvasNode,
      ],
      activeCanvasId,
    );
    await db.nodes.add(node);
  };

  const addAskNode = async () => {
    const { x, y } = getCanvasCenterPosition(transformRef.current);
    await db.nodes.add(stampNewCard({
      id: crypto.randomUUID(),
      canvasId: activeCanvasId,
      type: 'ask',
      content: '',
      x,
      y,
      width: ASK_NODE_SIZE.width,
      height: ASK_NODE_SIZE.height,
    }));
  };

  const addThemeNode = async () => {
    const { x, y } = getCanvasCenterPosition(transformRef.current);
    const [node] = await stampWorkZoneScopeOnNewNodes(
      [
        stampNewCard({
          id: crypto.randomUUID(),
          canvasId: activeCanvasId,
          type: 'theme',
          content: i18n.t('nodes.new_theme_title'),
          x,
          y,
          width: THEME_NODE_SIZE.width,
          height: THEME_NODE_SIZE.height,
        }) as CanvasNode,
      ],
      activeCanvasId,
    );
    await db.nodes.add(node);
  };

  const addEssayNode = async () => {
    const articleId = crypto.randomUUID();
    const title = t('nodes.essay_untitled');
    await db.articles.add({
      id: articleId,
      title,
      content: '',
      date: String(new Date().getFullYear()),
      type: 'REF',
      tags: [],
      linkedCanvasIds: [activeCanvasId],
      author: '',
      privateNotes: '',
    });
    const { x, y } = getCanvasCenterPosition(transformRef.current);
    const nodeId = await placeEssayNode({
      articleId,
      canvasId: activeCanvasId,
      x,
      y,
      title,
    });
    setSelectedNodes(new Set([nodeId]));
    onOpenEssay?.(articleId, nodeId);
  };

  const addFileNode = async (e: React.ChangeEvent<HTMLInputElement>): Promise<string[]> => {
    const list = e.target.files;
    if (!list || list.length === 0) return [];
    const { x, y } = getCanvasCenterPosition(transformRef.current);
    const { addedBookIds, failures } = await ingestFilesToCanvas({
      canvasId: activeCanvasId,
      files: list,
      origin: { x, y },
    });
    e.target.value = '';
    if (failures.length > 0) {
      await appAlert({
        message: t('canvas.upload_fail', {
          count: failures.length,
          names: failures.map((f) => f.name).join(', '),
        }),
      });
    }
    return addedBookIds;
  };

  return {
    toggleNodeSelection,
    handleLink,
    createLinkedNoteAt,
    deleteEdge,
    removeNodeId,
    removeNodeIds,
    archiveNodeId,
    addTextNode,
    addThemeNode,
    addAskNode,
    addEssayNode,
    addFileNode,
  };
}
