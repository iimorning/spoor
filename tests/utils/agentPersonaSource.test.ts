import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db';
import type { AgentConfig } from '../../src/db';
import {
  agentListDedupeKey,
  consolidateDuplicateCommunityAgents,
  dedupeAgentsForList,
  mergeCommunityAgentFields,
  officialCommunityPersonaKey,
  preferCommunityAgent,
  isTurtleSoupHostAgent,
  repairOfficialCommunityPersonaCovers,
  resolveAgentPersonaSource,
} from '../../src/utils/agentPersonaSource';
import turtleSoupHostCover from '../../src/assets/agent-icons/turtle-soup-host.png';

describe('agentPersonaSource', () => {
  it('prefers the persona with a cover over a longer prompt without cover', () => {
    const withoutCover: AgentConfig = {
      id: 'old',
      name: '海龟汤主持人',
      role: 'host',
      prompt: 'much longer official prompt body that should not win alone',
      communityPersonaKey: officialCommunityPersonaKey('turtle_soup_host'),
    };
    const withCover: AgentConfig = {
      id: 'new',
      name: '海龟汤主持人',
      role: 'host',
      prompt: 'short',
      coverImageUrl: turtleSoupHostCover,
    };

    expect(preferCommunityAgent(withoutCover, withCover).id).toBe('new');
    expect(dedupeAgentsForList([withoutCover, withCover])[0]?.id).toBe('new');
  });

  it('recognizes official turtle soup hosts after listing remap', () => {
    expect(
      isTurtleSoupHostAgent({
        id: 'turtle_soup_host',
        name: '海龟汤主持人',
        role: 'host',
        prompt: 'p',
      }),
    ).toBe(true);
    expect(
      isTurtleSoupHostAgent({
        id: 'uuid-remapped',
        name: '海龟汤主持人',
        role: 'host',
        prompt: 'p',
        communityPersonaKey: officialCommunityPersonaKey('turtle_soup_host'),
      }),
    ).toBe(true);
    expect(
      isTurtleSoupHostAgent({
        id: 'other',
        name: 'Custom',
        role: 'host',
        prompt: 'p',
      }),
    ).toBe(false);
  });

  it('dedupes official community personas in list view', () => {
    const agents: AgentConfig[] = [
      {
        id: 'a1',
        name: '海龟汤主持人',
        role: 'host',
        prompt: 'short',
        coverImageUrl: turtleSoupHostCover,
      },
      {
        id: 'a2',
        name: '海龟汤主持人',
        role: 'host',
        prompt: 'much longer official prompt body',
        coverImageUrl: turtleSoupHostCover,
        communityPersonaKey: officialCommunityPersonaKey('turtle_soup_host'),
      },
    ];

    const listed = dedupeAgentsForList(agents);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.coverImageUrl).toBe(turtleSoupHostCover);
    expect(agentListDedupeKey(listed[0]!)).toBe(officialCommunityPersonaKey('turtle_soup_host'));
  });

  it('merges cover and prompt fields when consolidating duplicates', () => {
    const keeper = mergeCommunityAgentFields(
      {
        id: 'keep',
        name: '海龟汤主持人',
        role: 'host',
        prompt: 'short',
        coverImageUrl: turtleSoupHostCover,
        communityPersonaKey: officialCommunityPersonaKey('turtle_soup_host'),
      },
      {
        id: 'drop',
        name: '海龟汤主持人',
        role: 'host',
        prompt: 'much longer official prompt body',
      },
    );

    expect(keeper.coverImageUrl).toBe(turtleSoupHostCover);
    expect(keeper.prompt).toContain('much longer official prompt body');
  });

  it('labels built-in and community sources', () => {
    expect(
      resolveAgentPersonaSource({
        id: 'interviewer',
        name: 'Mirror',
        role: 'r',
        prompt: 'p',
      }),
    ).toBe('builtin');
    expect(
      resolveAgentPersonaSource({
        id: 'uuid-1',
        name: '海龟汤主持人',
        role: 'host',
        prompt: 'p',
        coverImageUrl: turtleSoupHostCover,
      }),
    ).toBe('community');
  });
});

describe('consolidateDuplicateCommunityAgents', () => {
  beforeEach(async () => {
    await db.agents.clear();
    await db.nodes.clear();
    await db.canvasTemplates.clear();
    await db.agentSandboxThreads.clear();
  });

  it('keeps the covered persona and merges prompt from the duplicate', async () => {
    await db.agents.bulkPut([
      {
        id: 'dup-1',
        name: '海龟汤主持人',
        role: 'host',
        prompt: 'old short prompt',
        communityPersonaKey: officialCommunityPersonaKey('turtle_soup_host'),
      },
      {
        id: 'dup-2',
        name: '海龟汤主持人',
        role: 'host',
        prompt: 'newer official prompt with full rules',
        coverImageUrl: turtleSoupHostCover,
      },
    ]);
    await db.nodes.add({
      id: 'node-1',
      canvasId: 'canvas-1',
      type: 'agent',
      agentConfigId: 'dup-1',
      content: '',
      x: 0,
      y: 0,
    });

    await consolidateDuplicateCommunityAgents();

    const agents = await db.agents.toArray();
    expect(agents).toHaveLength(1);
    expect(agents[0]?.id).toBe('dup-2');
    expect(agents[0]?.coverImageUrl).toBe(turtleSoupHostCover);
    expect(agents[0]?.prompt).toContain('newer official prompt');
    expect(agents[0]?.communityPersonaKey).toBe(officialCommunityPersonaKey('turtle_soup_host'));
    const node = await db.nodes.get('node-1');
    expect(node?.agentConfigId).toBe('dup-2');
  });

  it('backfills missing official covers after a bad merge', async () => {
    await db.agents.put({
      id: 'bare-host',
      name: '海龟汤主持人',
      role: 'host',
      prompt: 'prompt without cover',
      communityPersonaKey: officialCommunityPersonaKey('turtle_soup_host'),
    });

    await repairOfficialCommunityPersonaCovers();

    const agent = await db.agents.get('bare-host');
    expect(agent?.coverImageUrl).toBe(turtleSoupHostCover);
  });
});
