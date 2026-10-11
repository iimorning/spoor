import i18n from '../i18n';
import { communityOfficialEn, communityOfficialZh } from '../i18n/communityOfficialContent';
import { OFFICIAL_LISTINGS, officialListingPersonaIds } from '../constants/officialCommunityListings';
import { agentDefaultsEn, agentDefaultsZh } from '../i18n/agentDefaultsContent';
import { officialPersonaCoverUrl } from '../constants/officialPersonaCovers';
import { SYSTEM_AGENT_IDS, type SystemAgentId } from '../constants/defaultAgents';
import type { AgentConfig } from '../db';
import { db } from '../db';

export type AgentPersonaSource = 'builtin' | 'community' | 'custom';

export function officialCommunityPersonaKey(personaId: string): string {
  return `official:${personaId}`;
}

export function isTurtleSoupHostAgent(agent: AgentConfig | undefined | null): boolean {
  if (!agent) return false;
  if (agent.id === 'turtle_soup_host') return true;
  return inferCommunityPersonaKey(agent) === officialCommunityPersonaKey('turtle_soup_host');
}

export function listingPersonaKey(listingId: string, sourceAgentId: string): string {
  return `listing:${listingId}:${sourceAgentId}`;
}

function officialPersonaDisplayNames(personaId: string): string[] {
  const spec = OFFICIAL_LISTINGS.find((entry) => officialListingPersonaIds(entry).includes(personaId));
  const names: string[] = [];
  if (spec && spec.personaId === personaId) {
    const blockEn = communityOfficialEn[spec.key as keyof typeof communityOfficialEn];
    const blockZh = communityOfficialZh[spec.key as keyof typeof communityOfficialZh];
    const enName = (blockEn as { persona_name?: string } | undefined)?.persona_name;
    const zhName = (blockZh as { persona_name?: string } | undefined)?.persona_name;
    if (enName?.trim()) names.push(enName.trim());
    if (zhName?.trim()) names.push(zhName.trim());
  }
  const fromDefaults = [
    agentDefaultsEn[personaId as keyof typeof agentDefaultsEn]?.name,
    agentDefaultsZh[personaId as keyof typeof agentDefaultsZh]?.name,
  ];
  for (const name of fromDefaults) {
    if (name?.trim()) names.push(name.trim());
  }
  return names;
}

export function agentMatchesOfficialPersona(agent: AgentConfig, personaId: string): boolean {
  const cover = officialPersonaCoverUrl(personaId);
  if (cover && agent.coverImageUrl === cover) return true;
  const names = officialPersonaDisplayNames(personaId);
  return names.some((name) => agent.name.trim() === name.trim());
}

/** Infer a stable community dedupe key for agents created before tagging existed. */
export function inferCommunityPersonaKey(agent: AgentConfig): string | undefined {
  if (agent.communityPersonaKey) return agent.communityPersonaKey;
  for (const spec of OFFICIAL_LISTINGS) {
    for (const personaId of officialListingPersonaIds(spec)) {
      if (agentMatchesOfficialPersona(agent, personaId)) {
        return officialCommunityPersonaKey(personaId);
      }
    }
  }
  return undefined;
}

export function resolveAgentPersonaSource(agent: AgentConfig): AgentPersonaSource {
  if (SYSTEM_AGENT_IDS.includes(agent.id as SystemAgentId)) return 'builtin';
  if (inferCommunityPersonaKey(agent)) return 'community';
  return 'custom';
}

export function agentListDedupeKey(agent: AgentConfig): string {
  return inferCommunityPersonaKey(agent) ?? agent.id;
}

function hasCover(agent: AgentConfig): boolean {
  return Boolean(agent.coverImageUrl?.trim());
}

function officialCoverForPersonaKey(key: string): string | undefined {
  if (!key.startsWith('official:')) return undefined;
  return officialPersonaCoverUrl(key.slice('official:'.length));
}

/** Pick the canonical community persona row — cover art beats prompt length. */
export function preferCommunityAgent(a: AgentConfig, b: AgentConfig): AgentConfig {
  const aCover = hasCover(a);
  const bCover = hasCover(b);
  if (aCover !== bCover) return aCover ? a : b;

  const key =
    a.communityPersonaKey ??
    b.communityPersonaKey ??
    inferCommunityPersonaKey(a) ??
    inferCommunityPersonaKey(b);
  const officialCover = key ? officialCoverForPersonaKey(key) : undefined;
  if (officialCover) {
    const aOfficial = a.coverImageUrl === officialCover;
    const bOfficial = b.coverImageUrl === officialCover;
    if (aOfficial !== bOfficial) return aOfficial ? a : b;
  }

  if (a.communityPersonaKey && !b.communityPersonaKey) return a;
  if (b.communityPersonaKey && !a.communityPersonaKey) return b;

  return (b.prompt?.length ?? 0) >= (a.prompt?.length ?? 0) ? b : a;
}

/** Merge the best fields from two duplicate rows onto the preferred keeper. */
export function mergeCommunityAgentFields(keeper: AgentConfig, other: AgentConfig): AgentConfig {
  return {
    ...keeper,
    coverImageUrl: keeper.coverImageUrl?.trim() || other.coverImageUrl?.trim() || undefined,
    prompt: (other.prompt?.length ?? 0) > (keeper.prompt?.length ?? 0) ? other.prompt : keeper.prompt,
    role: keeper.role?.trim() ? keeper.role : other.role,
    communityPersonaKey: keeper.communityPersonaKey ?? other.communityPersonaKey,
    temperature: keeper.temperature ?? other.temperature,
    creativity: keeper.creativity ?? other.creativity,
    // 音色是用户挑的偏好，合并重复人设时别把它丢了（两条都配了就听 keeper 的）。
    voiceId: keeper.voiceId ?? other.voiceId,
    knowledgeMarkdownFiles: keeper.knowledgeMarkdownFiles?.length
      ? keeper.knowledgeMarkdownFiles
      : other.knowledgeMarkdownFiles,
  };
}

function preferAgentForList(a: AgentConfig, b: AgentConfig): AgentConfig {
  return preferCommunityAgent(a, b);
}

/** Collapse duplicate community personas in the Agents Studio sidebar. */
export function dedupeAgentsForList(agents: AgentConfig[]): AgentConfig[] {
  const byKey = new Map<string, AgentConfig>();
  for (const agent of agents) {
    const key = agentListDedupeKey(agent);
    const prev = byKey.get(key);
    byKey.set(key, prev ? preferAgentForList(prev, agent) : agent);
  }
  return Array.from(byKey.values());
}

/**
 * Merge duplicate community personas already stored locally (e.g. from repeated
 * template applies before dedupe existed) and retarget canvas references.
 */
export async function consolidateDuplicateCommunityAgents(): Promise<void> {
  const agents = await db.agents.toArray();
  const groups = new Map<string, AgentConfig[]>();

  for (const agent of agents) {
    if (SYSTEM_AGENT_IDS.includes(agent.id as SystemAgentId)) continue;
    const key = inferCommunityPersonaKey(agent);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(agent);
    groups.set(key, group);
  }

  for (const [key, group] of groups) {
    if (group.length <= 1) {
      const only = group[0];
      if (only && !only.communityPersonaKey) {
        await db.agents.update(only.id, { communityPersonaKey: key });
      }
      continue;
    }

    const keeper = group.reduce((best, next) => {
      const preferred = preferCommunityAgent(best, next);
      const other = preferred.id === best.id ? next : best;
      return mergeCommunityAgentFields(preferred, other);
    });
    await db.agents.put({
      ...keeper,
      communityPersonaKey: keeper.communityPersonaKey ?? key,
    });

    const dupIds = group.filter((agent) => agent.id !== keeper.id).map((agent) => agent.id);
    for (const dupId of dupIds) {
      const liveNodes = await db.nodes.toArray();
      for (const node of liveNodes) {
        if (node.type === 'agent' && node.agentConfigId === dupId) {
          await db.nodes.update(node.id, { agentConfigId: keeper.id });
        }
      }

      const templates = await db.canvasTemplates.toArray();
      for (const tpl of templates) {
        let changed = false;
        const personaIds = tpl.personaIds.map((id) => {
          if (id !== dupId) return id;
          changed = true;
          return keeper.id;
        });
        const nodes = tpl.nodes.map((node) => {
          if (node.agentConfigId !== dupId) return node;
          changed = true;
          return { ...node, agentConfigId: keeper.id };
        });
        if (changed) {
          await db.canvasTemplates.update(tpl.id, { personaIds, nodes });
        }
      }

      try {
        await db.agentSandboxThreads.delete(dupId);
      } catch {
        /* ignore */
      }
      await db.agents.delete(dupId);
    }
  }
}

/** Backfill missing bundled covers on official community personas after bad merges. */
export async function repairOfficialCommunityPersonaCovers(): Promise<void> {
  const agents = await db.agents.toArray();
  for (const spec of OFFICIAL_LISTINGS) {
    for (const personaId of officialListingPersonaIds(spec)) {
      const key = officialCommunityPersonaKey(personaId);
      const cover = officialPersonaCoverUrl(personaId);
      if (!cover) continue;

      for (const agent of agents) {
        const agentKey = agent.communityPersonaKey ?? inferCommunityPersonaKey(agent);
        if (agentKey !== key) continue;
        if (agent.coverImageUrl?.trim()) continue;
        await db.agents.update(agent.id, {
          coverImageUrl: cover,
          communityPersonaKey: key,
        });
      }
    }
  }
}

export function resolveOfficialListingPersonaKey(
  listingId: string,
  sourceAgentId: string,
): string | undefined {
  const spec = OFFICIAL_LISTINGS.find((entry) => entry.listingId === listingId);
  if (!spec || !officialListingPersonaIds(spec).includes(sourceAgentId)) return undefined;
  return officialCommunityPersonaKey(sourceAgentId);
}

export function resolveListingPersonaKey(listingId: string, sourceAgentId: string): string {
  return (
    resolveOfficialListingPersonaKey(listingId, sourceAgentId) ??
    listingPersonaKey(listingId, sourceAgentId)
  );
}

/** i18n label key for a community persona badge (official templates only). */
export function communityPersonaBadgeKey(agent: AgentConfig): string | null {
  const key = inferCommunityPersonaKey(agent);
  if (!key?.startsWith('official:')) return null;
  const personaId = key.slice('official:'.length);
  const spec = OFFICIAL_LISTINGS.find((entry) => officialListingPersonaIds(entry).includes(personaId));
  if (!spec) return null;
  return `${spec.i18nPrefix}.title`;
}

export function resolveCommunityPersonaBadge(agent: AgentConfig): string | null {
  const badgeKey = communityPersonaBadgeKey(agent);
  if (!badgeKey) return null;
  const label = i18n.t(badgeKey);
  return label === badgeKey ? null : label;
}
