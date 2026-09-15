import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db';
import { applyCommunityListing } from '../../src/utils/applyCommunityListing';
import type { CommunityListing } from '../../src/services/community';
import { OFFICIAL_TRAUMA_INNER_COSMOS_ID, OFFICIAL_TURTLE_SOUP_ID } from '../../src/constants/officialCommunityListings';

describe('applyCommunityListing', () => {
  beforeEach(async () => {
    await db.agents.clear();
    await db.canvases.clear();
    await db.nodes.clear();
    await db.edges.clear();
    await db.canvasTemplates.clear();
  });

  it('clones a persona into a new canvas with remapped agent id', async () => {
    const listing: CommunityListing = {
      id: '11111111-1111-4111-8111-111111111111',
      author_id: 'user-1',
      author_name: 'Ada',
      kind: 'persona',
      title: 'Mirror',
      description: 'Critic',
      cover_url: null,
      payload: {
        version: 1,
        kind: 'persona',
        template: null,
        agents: [{ id: 'agent-src', name: 'Mirror', role: 'Critic', prompt: 'Ask why.' }],
      },
      published: true,
      like_count: 0,
      favorite_count: 0,
      comment_count: 0,
      apply_count: 0,
      created_at: new Date().toISOString(),
    };

    const canvasId = await applyCommunityListing(listing);
    const agents = await db.agents.toArray();
    expect(agents).toHaveLength(1);
    expect(agents[0]?.id).not.toBe('agent-src');
    expect(agents[0]?.name).toBe('Mirror');
    const canvas = await db.canvases.get(canvasId);
    expect(canvas?.name).toBe('Mirror');
    const nodes = await db.nodes.where('canvasId').equals(canvasId).toArray();
    expect(nodes.some((n) => n.type === 'agent' && n.agentConfigId === agents[0]?.id)).toBe(true);
    // User-submitted listings still spawn the ambience/audio fixture card —
    // only official templates skip it (see the test below).
    expect(nodes.some((n) => n.type === 'ambience')).toBe(true);
    // User-submitted persona listings also land in the user's templates list
    // so they can edit / re-apply them.
    const templates = await db.canvasTemplates.toArray();
    expect(templates).toHaveLength(1);
    expect(templates[0]?.origin).toBe('user');
    expect(templates[0]?.builtinKey).toBeNull();
    expect(templates[0]?.personaIds[0]).toBe(agents[0]?.id);
    expect(localStorage.getItem('active_canvas_id')).toBe(canvasId);
  });

  it('applies an official Turtle Soup listing and remaps the host persona id', async () => {
    const listing: CommunityListing = {
      id: OFFICIAL_TURTLE_SOUP_ID,
      author_id: '00000000-0000-0000-0000-000000000001',
      author_name: 'Spoor',
      kind: 'canvas',
      title: '海龟汤：情境推理',
      description: '一个人设就能玩。',
      cover_url: null,
      is_official: true,
      payload: {
        version: 1,
        kind: 'canvas',
        template: {
          id: 'official:turtle-soup-template',
          name: '海龟汤：情境推理',
          description: '一个人设就能玩。',
          origin: 'user',
          builtinKey: null,
          listed: true,
          personaIds: ['turtle_soup_host'],
          nodes: [
            {
              key: 'note-start',
              type: 'note',
              contentText: '开始一局海龟汤。出一道原创题。',
              xFrac: 0.066,
              yFrac: 0.55,
              wFrac: 0.283,
              hFrac: 0.1875,
            },
            {
              key: 'agent-host',
              type: 'agent',
              agentConfigId: 'turtle_soup_host',
              xFrac: 0.466,
              yFrac: 0.3125,
            },
            {
              key: 'ask',
              type: 'ask',
              xFrac: 0.716,
              yFrac: 0.1125,
              wFrac: 0.25,
              hFrac: 0.2375,
            },
          ],
          edges: [{ fromKey: 'note-start', toKey: 'agent-host', noteText: '运行主持人 → 开局' }],
          createdAt: 0,
          updatedAt: 0,
        },
        agents: [
          {
            id: 'turtle_soup_host',
            name: '海龟汤主持人',
            role: '情境推理主持',
            prompt: '主持海龟汤游戏。',
            temperature: 0.85,
            creativity: 0.75,
          },
        ],
      },
      published: true,
      like_count: 0,
      favorite_count: 0,
      comment_count: 0,
      apply_count: 0,
      created_at: new Date().toISOString(),
    };

    const canvasId = await applyCommunityListing(listing);
    const agents = await db.agents.toArray();
    expect(agents).toHaveLength(1);
    expect(agents[0]?.id).not.toBe('turtle_soup_host');
    expect(agents[0]?.name).toMatch(/海龟汤|Turtle Soup Host/);
    expect(agents[0]?.coverImageUrl).toBeTruthy();
    expect(agents[0]?.communityPersonaKey).toBe('official:turtle_soup_host');
    const nodes = await db.nodes.where('canvasId').equals(canvasId).toArray();
    expect(nodes.some((n) => n.type === 'agent' && n.agentConfigId === agents[0]?.id)).toBe(true);
    expect(nodes.some((n) => n.type === 'ambience')).toBe(false);
    // Official templates land in the user's own canvasTemplates table so the
    // user can find them, edit them, or re-apply with changes.
    const templates = await db.canvasTemplates.toArray();
    expect(templates).toHaveLength(1);
    const tpl = templates[0]!;
    expect(tpl.origin).toBe('user');
    expect(tpl.builtinKey).toBeNull();
    expect(tpl.id).not.toBe('official:turtle-soup-template');
    expect(tpl.personaIds).toHaveLength(1);
    expect(tpl.personaIds[0]).not.toBe('turtle_soup_host');
    expect(tpl.personaIds[0]).toBe(agents[0]?.id);
    expect(
      tpl.nodes.some((n) => n.key === 'theme-howto' && n.type === 'theme'),
    ).toBe(true);
    expect(tpl.nodes.some((n) => n.key === 'note-start')).toBe(false);
    expect(tpl.createdAt).toBeGreaterThan(0);
    expect(localStorage.getItem('active_canvas_id')).toBe(canvasId);
  });

  it('reuses the same local persona when an official listing is applied twice', async () => {
    const listing: CommunityListing = {
      id: OFFICIAL_TURTLE_SOUP_ID,
      author_id: '00000000-0000-0000-0000-000000000001',
      author_name: 'Spoor',
      kind: 'canvas',
      title: '海龟汤：情境推理',
      description: '一个人设就能玩。',
      cover_url: null,
      is_official: true,
      payload: {
        version: 1,
        kind: 'canvas',
        template: {
          id: 'official:turtle-soup-template',
          name: '海龟汤：情境推理',
          description: '一个人设就能玩。',
          origin: 'user',
          builtinKey: null,
          listed: true,
          personaIds: ['turtle_soup_host'],
          nodes: [
            {
              key: 'agent-host',
              type: 'agent',
              agentConfigId: 'turtle_soup_host',
              xFrac: 0.466,
              yFrac: 0.3125,
            },
          ],
          edges: [],
          createdAt: 0,
          updatedAt: 0,
        },
        agents: [
          {
            id: 'turtle_soup_host',
            name: '海龟汤主持人',
            role: '情境推理主持',
            prompt: '主持海龟汤游戏。',
          },
        ],
      },
      published: true,
      like_count: 0,
      favorite_count: 0,
      comment_count: 0,
      apply_count: 0,
      created_at: new Date().toISOString(),
    };

    await applyCommunityListing(listing);
    const firstAgents = await db.agents.toArray();
    expect(firstAgents).toHaveLength(1);
    const firstId = firstAgents[0]!.id;

    await applyCommunityListing(listing);
    const secondAgents = await db.agents.toArray();
    expect(secondAgents).toHaveLength(1);
    expect(secondAgents[0]?.id).toBe(firstId);
    expect(secondAgents[0]?.communityPersonaKey).toBe('official:turtle_soup_host');
  });

  it('overlays the in-code official template so the ask/Ali card is not spawned', async () => {
    const listing: CommunityListing = {
      id: OFFICIAL_TURTLE_SOUP_ID,
      author_id: '00000000-0000-0000-0000-000000000001',
      author_name: 'Spoor',
      kind: 'canvas',
      title: '海龟汤：情境推理',
      description: '一个人设就能玩。',
      cover_url: null,
      is_official: true,
      payload: {
        version: 1,
        kind: 'canvas',
        template: {
          id: 'official:turtle-soup-template',
          name: 'stale',
          origin: 'user',
          builtinKey: null,
          listed: true,
          personaIds: ['turtle_soup_host'],
          nodes: [
            { key: 'ask', type: 'ask', xFrac: 0.7, yFrac: 0.1, wFrac: 0.25, hFrac: 0.2 },
            {
              key: 'note-start',
              type: 'note',
              contentText: '开始一局海龟汤。出一道原创题。',
              xFrac: 0.066,
              yFrac: 0.55,
            },
            {
              key: 'agent-host',
              type: 'agent',
              agentConfigId: 'turtle_soup_host',
              xFrac: 0.466,
              yFrac: 0.3125,
            },
          ],
          edges: [{ fromKey: 'note-start', toKey: 'agent-host' }],
          createdAt: 0,
          updatedAt: 0,
        },
        agents: [
          {
            id: 'turtle_soup_host',
            name: '海龟汤主持人',
            role: '情境推理主持',
            prompt: '主持海龟汤游戏。',
          },
        ],
      },
      published: true,
      like_count: 0,
      favorite_count: 0,
      comment_count: 0,
      apply_count: 0,
      created_at: new Date().toISOString(),
    };

    const canvasId = await applyCommunityListing(listing);
    const nodes = await db.nodes.where('canvasId').equals(canvasId).toArray();
    expect(nodes.some((n) => n.type === 'ask')).toBe(false);
    expect(nodes.some((n) => n.type === 'theme')).toBe(true);
  });

  it('applies Trauma Inner Cosmos and adds both personas plus the starter canvas', async () => {
    const listing: CommunityListing = {
      id: OFFICIAL_TRAUMA_INNER_COSMOS_ID,
      author_id: '00000000-0000-0000-0000-000000000001',
      author_name: 'Spoor',
      kind: 'canvas',
      title: '创伤内宇宙',
      description: '',
      cover_url: null,
      is_official: true,
      payload: {
        version: 1,
        kind: 'canvas',
        template: {
          id: 'stub',
          name: 'stub',
          description: '',
          origin: 'user',
          builtinKey: null,
          listed: true,
          personaIds: [],
          nodes: [],
          edges: [],
          createdAt: 0,
          updatedAt: 0,
        },
        agents: [],
      },
      published: true,
      like_count: 0,
      favorite_count: 0,
      comment_count: 0,
      apply_count: 0,
      created_at: new Date().toISOString(),
    };

    const canvasId = await applyCommunityListing(listing);
    const agents = await db.agents.toArray();
    expect(agents).toHaveLength(2);
    expect(agents.map((a) => a.communityPersonaKey).sort()).toEqual(
      ['official:character_atelier', 'official:cosmos_weaver'].sort(),
    );
    const nodes = await db.nodes.where('canvasId').equals(canvasId).toArray();
    const agentIds = new Set(agents.map((a) => a.id));
    expect(nodes.filter((n) => n.type === 'agent' && n.agentConfigId && agentIds.has(n.agentConfigId))).toHaveLength(2);
    expect(nodes.some((n) => n.type === 'note')).toBe(true);
    const canvas = await db.canvases.get(canvasId);
    expect(canvas?.name).toMatch(/创伤内宇宙|Trauma Inner Cosmos/);
  });
});
