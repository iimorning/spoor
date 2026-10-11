import { useEffect } from 'react';
import i18n from '../i18n';
import { db } from '../db';
import type { AgentConfig } from '../db';
import { LEGACY_AGENT_PROMPTS, OPTIONAL_SYSTEM_AGENT_IDS, SEEDED_AGENT_IDS, SYSTEM_AGENT_IDS, SYSTEM_AGENT_TUNING, type SystemAgentId } from '../constants/defaultAgents';
import { buildSystemAgentRowForLang } from '../utils/seedAgentRows';
import { pruneRetiredCosmosThemeCards } from '../services/spawnCosmosCanvasTemplate';
import { migrateArticlesToEssayNodes } from '../utils/migrateArticlesToEssayNodes';
import { stampNewCards } from '../utils/stampNewCard';
import { recoverStaleGeneratingImages } from '../services/fulfillDrawTool';
import { recoverStaleGeneratingAiCards } from '../utils/aiCardGeneration';
import { tryParseEssayContent } from '../utils/essayPayload';
import { consolidateDuplicateCommunityAgents, repairOfficialCommunityPersonaCovers } from '../utils/agentPersonaSource';
import {
  LEGACY_DEFAULT_ESSAY_ARTICLE_ID,
} from '../constants/defaultCosmosWorkspace';
import {
  buildDefaultWorkspace,
  DEFAULT_NODE_IDS,
  CORE_DEFAULT_NODE_IDS,
  defaultWorkspaceAmbiencePosition,
  isLegacyLShapeDefaultLayout,
  OFFICIAL_DEFAULT_STARTER_EDGE_IDS,
  OFFICIAL_DEFAULT_STARTER_NODE_IDS,
} from '../constants/defaultWorkspace';
import { ensureAmbienceNodeForCanvas } from '../utils/ensureAmbienceNode';
import { ensureDefaultAskWorkZone } from '../utils/seedDefaultAskWorkZone';
import { applyOnboardingWorkroomLayout } from '../utils/onboardingWorkroomLayout';
import { withoutSyncHooks } from '../utils/syncHookGuard';

/** 仍在使用旧版种子文案时，写入当前语言的默认提示词（不覆盖用户自定义）。 */
async function migrateLegacyAgentPrompts() {
  for (const id of SYSTEM_AGENT_IDS) {
    const legacies = LEGACY_AGENT_PROMPTS[id];
    if (!legacies?.length) continue;
    const row = await db.agents.get(id);
    if (!row) continue;
    const current = (row.prompt ?? '').trim();
    if (legacies.includes(current)) {
      await db.agents.update(id, { prompt: i18n.t(`agents.defaults.${id}.prompt`) });
    }
  }
}

/** Drop leftover cosmos personas that are not on any canvas card. */
async function retireUnusedOptionalSystemAgents(): Promise<void> {
  const nodes = await db.nodes.toArray();
  const used = new Set(
    nodes.map((n) => n.agentConfigId).filter((id): id is string => Boolean(id)),
  );
  for (const id of OPTIONAL_SYSTEM_AGENT_IDS) {
    if (used.has(id)) continue;
    await db.agents.delete(id);
  }
}

// 构造逻辑挪到 utils/seedAgentRows：登录合并时要按语言重建种子来判定"还是不是出厂的"，
// 两边共用一份，才不会各自漂移。
const buildSystemAgentRow = (id: SystemAgentId): AgentConfig => buildSystemAgentRowForLang(id, i18n.language);

function isOfficialDefaultStarterNode(node: {
  id: string;
  type: string;
  content?: string;
}): boolean {
  if (OFFICIAL_DEFAULT_STARTER_NODE_IDS.has(node.id)) return true;
  if (node.type === 'essay' && tryParseEssayContent(node.content)?.articleId === LEGACY_DEFAULT_ESSAY_ARTICLE_ID) {
    return true;
  }
  return false;
}

/**
 * First-run / virgin official starters may be swapped for a new default layout.
 * Any non-official card on the main workspace aborts the swap entirely.
 *
 * The official starter set intentionally excludes legacy cosmos + Memory
 * Architect node ids: an existing user who already has cosmos content on
 * their default canvas is treated as "has non-official content" and the swap
 * is aborted, so we never delete user data.
 */
async function installDefaultWorkspace(): Promise<void> {
  const canvasId = 'default';
  const seedAskWorkZone = async () => {
    await ensureDefaultAskWorkZone({
      canvasId,
      askNodeId: DEFAULT_NODE_IDS.ask,
    });
    await applyOnboardingWorkroomLayout(canvasId);
  };
  const onDefault = (await db.nodes.toArray()).filter(
    (n) => (!n.canvasId || n.canvasId === canvasId) && n.type !== 'ambience',
  );

  if (onDefault.some((n) => !isOfficialDefaultStarterNode(n))) {
    await seedAskWorkZone();
    return;
  }

  const presentIds = new Set(onDefault.map((n) => n.id));
  const hasCoreLayout = CORE_DEFAULT_NODE_IDS.every((id) => presentIds.has(id));
  if (hasCoreLayout) {
    // Virgin L-shape only: move the three official cards into the horizontal row.
    // Skip if the user already dragged any starter off the seeded coords.
    if (isLegacyLShapeDefaultLayout(onDefault)) {
      const { nodes } = buildDefaultWorkspace({
        canvasId,
        themeContent: i18n.t('canvas.starter.blank_theme'),
        noteContent: i18n.t('canvas.starter.blank_note'),
      });
      await db.transaction('rw', db.nodes, db.canvases, async () => {
        for (const node of nodes) {
          await db.nodes.update(node.id, {
            x: node.x,
            y: node.y,
            width: node.width,
            height: node.height,
          });
        }
        await db.canvases.update(canvasId, { updatedAt: Date.now() });
      });
      await ensureAmbienceNodeForCanvas({
        canvasId,
        position: defaultWorkspaceAmbiencePosition(),
      });
    }
    await seedAskWorkZone();
    return;
  }

  const removeIds = onDefault.map((n) => n.id);
  const edges = await db.edges.toArray();
  const removeIdSet = new Set(removeIds);
  const edgeIdsToDelete = edges
    .filter((e) => {
      const onCanvas = !e.canvasId || e.canvasId === canvasId;
      if (!onCanvas) return false;
      if (removeIdSet.has(e.from) || removeIdSet.has(e.to)) return true;
      return OFFICIAL_DEFAULT_STARTER_EDGE_IDS.has(e.id);
    })
    .map((e) => e.id);

  if (removeIds.length > 0) await db.nodes.bulkDelete(removeIds);
  if (edgeIdsToDelete.length > 0) await db.edges.bulkDelete(edgeIdsToDelete);
  await db.articles.delete(LEGACY_DEFAULT_ESSAY_ARTICLE_ID);

  const { nodes } = buildDefaultWorkspace({
    canvasId,
    themeContent: i18n.t('canvas.starter.blank_theme'),
    noteContent: i18n.t('canvas.starter.blank_note'),
  });

  await db.nodes.bulkPut(stampNewCards(nodes));
  await db.canvases.update(canvasId, { updatedAt: Date.now() });
  await ensureAmbienceNodeForCanvas({
    canvasId,
    position: defaultWorkspaceAmbiencePosition(),
  });
  await seedAskWorkZone();
}

/** Seed the database with default agents, nodes, and articles on first run. */
export function useSeedData() {
  useEffect(() => {
    const seed = async () => {
      const defaultCanvas = await db.canvases.get('default');
      if (!defaultCanvas) {
        await db.canvases.add({
          id: 'default',
          name: i18n.t('canvas.default_workspace_name'),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }

      const existingAgents = await db.agents.toArray();
      const existingIds = new Set(existingAgents.map((a) => a.id));
      const missingIds = SEEDED_AGENT_IDS.filter((id) => !existingIds.has(id));

      if (missingIds.length > 0) {
        const toAdd: AgentConfig[] = missingIds.map((id) => buildSystemAgentRow(id));
        await db.agents.bulkPut(toAdd);
      }

      await retireUnusedOptionalSystemAgents();
      await migrateLegacyAgentPrompts();
      await consolidateDuplicateCommunityAgents();
      await repairOfficialCommunityPersonaCovers();
      await pruneRetiredCosmosThemeCards();
      await db.agents.delete('challenger');
      await db.agents.delete('pragmatist');

      await installDefaultWorkspace();

      // After seed (or on existing DBs): ensure every article has an essay canvas card.
      await migrateArticlesToEssayNodes({ preferredCanvasId: 'default' });
      await recoverStaleGeneratingImages();
      await recoverStaleGeneratingAiCards();
    };
    void withoutSyncHooks(seed);
  }, []);
}