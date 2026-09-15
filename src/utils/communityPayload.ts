import type { AgentConfig, CanvasTemplateDoc, TemplateNode, TemplateEdge } from '../db';
import i18n from '../i18n';
import { inferCommunityPersonaKey } from './agentPersonaSource';

export type CommunityKind = 'canvas' | 'persona';

export type CommunityPayload = {
  version: 1;
  kind: CommunityKind;
  template: CanvasTemplateDoc | null;
  agents: AgentConfig[];
};

const MAX_TITLE = 120;
const MAX_DESCRIPTION = 2000;
const MAX_PROMPT = 8000;
const MAX_KNOWLEDGE_CHARS = 120_000;
const MAX_COVER_DATA_CHARS = 80_000;

function resolveI18n(key: string | undefined, fallback: string | undefined): string {
  if (key) {
    const translated = i18n.t(key);
    if (translated && translated !== key) return String(translated);
  }
  return fallback ?? '';
}

export function sanitizeAgentForPublish(agent: AgentConfig): AgentConfig {
  const knowledge = (agent.knowledgeMarkdownFiles ?? []).map((f) => ({
    name: String(f.name ?? 'note.md').slice(0, 120),
    content: String(f.content ?? '').slice(0, MAX_KNOWLEDGE_CHARS),
  }));
  let knowledgeBudget = MAX_KNOWLEDGE_CHARS;
  const trimmedKnowledge = knowledge.filter((f) => {
    if (knowledgeBudget <= 0) return false;
    if (f.content.length > knowledgeBudget) {
      f.content = f.content.slice(0, knowledgeBudget);
    }
    knowledgeBudget -= f.content.length;
    return true;
  });

  let cover = (agent.coverImageUrl ?? '').trim() || undefined;
  if (cover?.startsWith('data:') && cover.length > MAX_COVER_DATA_CHARS) {
    cover = undefined;
  }

  return {
    id: agent.id,
    name: String(agent.name ?? '').trim().slice(0, 80) || 'Persona',
    role: String(agent.role ?? '').trim().slice(0, 160),
    prompt: String(agent.prompt ?? '').slice(0, MAX_PROMPT),
    temperature: agent.temperature,
    creativity: agent.creativity,
    color: agent.color,
    knowledgeMarkdownFiles: trimmedKnowledge.length ? trimmedKnowledge : undefined,
    coverImageUrl: cover,
  };
}

export function freezeTemplateForPublish(template: CanvasTemplateDoc): CanvasTemplateDoc {
  const nodes: TemplateNode[] = template.nodes
    .filter((n) => n.type === 'theme' || n.type === 'note' || n.type === 'agent' || n.type === 'ask')
    .map((n) => ({
      key: n.key,
      type: n.type,
      contentText: resolveI18n(n.contentKey, n.contentText),
      ...(n.descriptionText ? { descriptionText: n.descriptionText } : {}),
      agentConfigId: n.agentConfigId,
      xFrac: n.xFrac,
      yFrac: n.yFrac,
      ...(n.wFrac !== undefined ? { wFrac: n.wFrac } : {}),
      ...(n.hFrac !== undefined ? { hFrac: n.hFrac } : {}),
    }));
  const keys = new Set(nodes.map((n) => n.key));
  const edges: TemplateEdge[] = template.edges
    .filter((e) => keys.has(e.fromKey) && keys.has(e.toKey))
    .map((e) => ({
      fromKey: e.fromKey,
      toKey: e.toKey,
      noteText: resolveI18n(e.noteKey, e.noteText) || undefined,
    }));

  return {
    id: template.id,
    name: resolveI18n(template.origin === 'system' ? template.name : undefined, template.name).slice(0, MAX_TITLE),
    description: (template.description ? resolveI18n(template.origin === 'system' ? template.description : undefined, template.description) : '').slice(0, MAX_DESCRIPTION),
    origin: 'user',
    builtinKey: null,
    listed: true,
    personaIds: [...template.personaIds],
    nodes,
    edges,
    createdAt: template.createdAt,
    updatedAt: Date.now(),
  };
}

export function buildCanvasPublishPayload(
  template: CanvasTemplateDoc,
  agents: AgentConfig[],
): CommunityPayload {
  const frozen = freezeTemplateForPublish(template);
  const bundledIds = new Set([
    ...frozen.personaIds,
    ...frozen.nodes.map((n) => n.agentConfigId).filter((id): id is string => Boolean(id)),
  ]);
  const bundled = agents.filter((a) => bundledIds.has(a.id)).map(sanitizeAgentForPublish);
  return { version: 1, kind: 'canvas', template: frozen, agents: bundled };
}

export function buildPersonaPublishPayload(agent: AgentConfig): CommunityPayload {
  const sanitized = sanitizeAgentForPublish(agent);
  return { version: 1, kind: 'persona', template: null, agents: [sanitized] };
}

export function parseCommunityPayload(raw: unknown): CommunityPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const kind = o.kind === 'persona' ? 'persona' : o.kind === 'canvas' ? 'canvas' : null;
  if (!kind) return null;
  const agents = Array.isArray(o.agents) ? (o.agents as AgentConfig[]) : [];
  const template =
    o.template && typeof o.template === 'object' ? (o.template as CanvasTemplateDoc) : null;
  if (kind === 'persona' && agents.length < 1) return null;
  if (kind === 'canvas' && (!template || !Array.isArray(template.nodes))) return null;
  return { version: 1, kind, template, agents };
}

export function remapAgents(
  agents: AgentConfig[],
  options?: {
    existingAgents?: AgentConfig[];
    resolvePersonaKey?: (agent: AgentConfig) => string | undefined;
  },
): { agents: AgentConfig[]; idMap: Map<string, string> } {
  const idMap = new Map<string, string>();
  const existingByKey = new Map<string, AgentConfig>();
  for (const agent of options?.existingAgents ?? []) {
    const key = agent.communityPersonaKey ?? inferCommunityPersonaKey(agent);
    if (key) existingByKey.set(key, agent);
  }

  const next = agents.map((agent) => {
    const sanitized = sanitizeAgentForPublish(agent);
    const personaKey = options?.resolvePersonaKey?.(agent);
    if (personaKey) {
      const existing = existingByKey.get(personaKey);
      if (existing) {
        idMap.set(agent.id, existing.id);
        return { ...sanitized, id: existing.id, communityPersonaKey: personaKey };
      }
    }
    const newId = crypto.randomUUID();
    idMap.set(agent.id, newId);
    return {
      ...sanitized,
      id: newId,
      ...(personaKey ? { communityPersonaKey: personaKey } : {}),
    };
  });
  return { agents: next, idMap };
}

export function remapTemplate(template: CanvasTemplateDoc, idMap: Map<string, string>): CanvasTemplateDoc {
  return {
    ...template,
    id: crypto.randomUUID(),
    origin: 'user',
    builtinKey: null,
    personaIds: template.personaIds.map((id) => idMap.get(id) ?? id),
    nodes: template.nodes.map((n) => ({
      ...n,
      agentConfigId: n.agentConfigId ? idMap.get(n.agentConfigId) ?? n.agentConfigId : undefined,
    })),
    edges: template.edges.map((e) => ({ ...e })),
  };
}

export function personaAsTemplate(agent: AgentConfig): CanvasTemplateDoc {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name: agent.name,
    description: agent.role,
    origin: 'user',
    builtinKey: null,
    listed: true,
    personaIds: [agent.id],
    nodes: [
      {
        key: 'agent',
        type: 'agent',
        agentConfigId: agent.id,
        xFrac: 0.38,
        yFrac: 0.32,
      },
      {
        key: 'note',
        type: 'note',
        contentText: agent.role || agent.name,
        xFrac: 0.38,
        yFrac: 0.55,
      },
    ],
    edges: [{ fromKey: 'note', toKey: 'agent' }],
    createdAt: now,
    updatedAt: now,
  };
}

export function clampTitle(value: string): string {
  return value.trim().slice(0, MAX_TITLE);
}

export function clampDescription(value: string): string {
  return value.trim().slice(0, MAX_DESCRIPTION);
}
