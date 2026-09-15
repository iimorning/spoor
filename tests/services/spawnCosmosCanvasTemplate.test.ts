import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db';
import {
  pruneRetiredCosmosThemeCards,
  spawnCosmosCanvasTemplate,
} from '../../src/services/spawnCosmosCanvasTemplate';
import { getSystemCanvasTemplateByKey, getSystemCanvasTemplates } from '../../src/utils/canvasTemplate';

describe('spawnCosmosCanvasTemplate', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.edges.clear();
    await db.canvases.clear();
  });

  it('does not list the cosmos template as a default option', () => {
    expect(getSystemCanvasTemplates().some((tpl) => tpl.builtinKey === 'cosmos')).toBe(false);
    expect(getSystemCanvasTemplateByKey('cosmos')?.builtinKey).toBe('cosmos');
  });

  it('creates world and cast themes, starter notes, two agents, and guide edges', async () => {
    const canvasId = 'cosmos-test-1';
    await db.canvases.add({
      id: canvasId,
      name: 'Trauma Inner Cosmos',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      template: 'cosmos',
    });

    await spawnCosmosCanvasTemplate(canvasId);

    const nodes = await db.nodes.where('canvasId').equals(canvasId).toArray();
    const edges = await db.edges.where('canvasId').equals(canvasId).toArray();

    const themes = nodes.filter((n) => n.type === 'theme');
    expect(themes.map((n) => n.id).sort()).toEqual([
      `cosmos-${canvasId}-theme-cast`,
      `cosmos-${canvasId}-theme-world`,
    ]);
    expect(nodes.some((n) => n.id.endsWith('theme-entry'))).toBe(false);
    expect(nodes.some((n) => n.id.endsWith('theme-props'))).toBe(false);
    expect(nodes.some((n) => n.id.endsWith('theme-ritual'))).toBe(false);

    expect(nodes.filter((n) => n.type === 'note')).toHaveLength(2);

    const agents = nodes.filter((n) => n.type === 'agent');
    expect(agents).toHaveLength(2);
    expect(agents.map((a) => a.agentConfigId).sort()).toEqual(['character_atelier', 'cosmos_weaver']);

    expect(edges).toHaveLength(5);
    expect(nodes.every((n) => typeof n.createdAt === 'number')).toBe(true);
    expect(edges.some((e) => e.from.endsWith('note-four') && e.to.endsWith('agent-weaver'))).toBe(true);
    expect(edges.some((e) => (e.note ?? '').length > 0)).toBe(true);
  });

  it('prunes retired theme cards from an existing cosmos canvas', async () => {
    const canvasId = 'cosmos-legacy-1';
    const prefix = `cosmos-${canvasId}-`;
    await db.canvases.add({
      id: canvasId,
      name: 'Trauma Inner Cosmos',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      template: 'cosmos',
    });

    await db.nodes.bulkPut([
      { id: `${prefix}theme-entry`, canvasId, type: 'theme', content: 'Entry', x: 0, y: 0 },
      { id: `${prefix}theme-world`, canvasId, type: 'theme', content: 'World', x: 0, y: 0 },
      { id: `${prefix}theme-cast`, canvasId, type: 'theme', content: 'Characters', x: 0, y: 0 },
      { id: `${prefix}theme-props`, canvasId, type: 'theme', content: 'Scenes & props', x: 0, y: 0 },
      { id: `${prefix}theme-ritual`, canvasId, type: 'theme', content: 'Ritual & output', x: 0, y: 0 },
      { id: `${prefix}note-four`, canvasId, type: 'note', content: 'Four questions', x: 0, y: 0 },
      { id: `${prefix}agent-weaver`, canvasId, type: 'agent', content: '', x: 0, y: 0 },
    ]);
    await db.edges.bulkPut([
      { id: `${prefix}e-entry-four`, canvasId, from: `${prefix}theme-entry`, to: `${prefix}note-four` },
      { id: `${prefix}e-atelier-props`, canvasId, from: `${prefix}theme-props`, to: `${prefix}theme-cast` },
      { id: `${prefix}e-world-ritual`, canvasId, from: `${prefix}theme-world`, to: `${prefix}theme-ritual` },
    ]);

    const result = await pruneRetiredCosmosThemeCards();
    expect(result.removedNodes).toBe(3);

    const nodes = await db.nodes.where('canvasId').equals(canvasId).toArray();
    const edges = await db.edges.where('canvasId').equals(canvasId).toArray();
    expect(nodes.map((n) => n.id).sort()).toEqual([
      `${prefix}agent-weaver`,
      `${prefix}note-four`,
      `${prefix}theme-cast`,
      `${prefix}theme-world`,
    ]);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      from: `${prefix}note-four`,
      to: `${prefix}agent-weaver`,
    });
  });
});
