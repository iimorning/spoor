import { describe, it, expect } from 'vitest';
import type { AgentConfig, CanvasTemplateDoc } from '../../src/db';
import {
  buildCanvasPublishPayload,
  buildPersonaPublishPayload,
  parseCommunityPayload,
  remapAgents,
  remapTemplate,
  sanitizeAgentForPublish,
} from '../../src/utils/communityPayload';

const agent: AgentConfig = {
  id: 'agent-a',
  name: 'Mirror',
  role: 'Critic',
  prompt: 'Challenge claims.',
  coverImageUrl: 'https://example.com/cover.png',
};

const template: CanvasTemplateDoc = {
  id: 'tpl-1',
  name: 'Starter',
  description: 'A small board',
  origin: 'user',
  builtinKey: null,
  personaIds: ['agent-a'],
  nodes: [
    { key: 'n1', type: 'note', contentText: 'Hello', xFrac: 0.2, yFrac: 0.2 },
    { key: 'a1', type: 'agent', agentConfigId: 'agent-a', xFrac: 0.5, yFrac: 0.3 },
  ],
  edges: [{ fromKey: 'n1', toKey: 'a1' }],
  createdAt: 1,
  updatedAt: 1,
};

describe('communityPayload', () => {
  it('strips oversized data-URL covers', () => {
    const huge = `data:image/png;base64,${'a'.repeat(90_000)}`;
    expect(sanitizeAgentForPublish({ ...agent, coverImageUrl: huge }).coverImageUrl).toBeUndefined();
    expect(sanitizeAgentForPublish(agent).coverImageUrl).toBe(agent.coverImageUrl);
  });

  it('bundles only personas referenced by the template', () => {
    const extra: AgentConfig = { ...agent, id: 'agent-b', name: 'Other' };
    const payload = buildCanvasPublishPayload(template, [agent, extra]);
    expect(payload.kind).toBe('canvas');
    expect(payload.agents.map((a) => a.id)).toEqual(['agent-a']);
    expect(payload.template?.nodes).toHaveLength(2);
  });

  it('builds a persona payload without a template', () => {
    const payload = buildPersonaPublishPayload(agent);
    expect(payload.kind).toBe('persona');
    expect(payload.template).toBeNull();
    expect(payload.agents).toHaveLength(1);
  });

  it('rejects malformed payloads', () => {
    expect(parseCommunityPayload(null)).toBeNull();
    expect(parseCommunityPayload({ kind: 'persona', agents: [] })).toBeNull();
    expect(parseCommunityPayload({ kind: 'canvas', template: {}, agents: [] })).toBeNull();
  });

  it('remaps agent ids in the template', () => {
    const { agents, idMap } = remapAgents([agent]);
    expect(agents[0]?.id).not.toBe(agent.id);
    const remapped = remapTemplate(template, idMap);
    expect(remapped.personaIds[0]).toBe(agents[0]?.id);
    expect(remapped.nodes.find((n) => n.type === 'agent')?.agentConfigId).toBe(agents[0]?.id);
  });
});
