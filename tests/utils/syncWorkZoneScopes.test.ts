import { beforeEach, describe, expect, it } from 'vitest';
import { db, type CanvasNode, type CanvasWorkZone } from '../../src/db';
import { setCanvasV2Enabled } from '../../src/utils/canvasV2';
import {
  reconcileNodeScopesFromZones,
  stampWorkZoneScopeOnNewNode,
  stampWorkZoneScopeOnNewNodes,
} from '../../src/utils/syncWorkZoneScopes';

function node(
  partial: Partial<CanvasNode> & Pick<CanvasNode, 'id' | 'type' | 'x' | 'y'>,
): CanvasNode {
  return {
    content: '',
    width: 320,
    height: 200,
    canvasId: 'canvas-1',
    ...partial,
  };
}

function zone(
  partial: Partial<CanvasWorkZone> & Pick<CanvasWorkZone, 'id' | 'x' | 'y' | 'width' | 'height'>,
): CanvasWorkZone {
  return {
    canvasId: 'canvas-1',
    createdAt: 0,
    ...partial,
  };
}

describe('reconcileNodeScopesFromZones', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.canvasWorkZones.clear();
    localStorage.clear();
  });

  it('assigns contextScopeAgentId from overlapping work zone', async () => {
    const note = node({ id: 'note-1', type: 'note', x: 100, y: 80, content: 'in zone' });
    await db.nodes.add(note);

    await reconcileNodeScopesFromZones(
      [note],
      [
        zone({
          id: 'zone-a',
          personaNodeId: 'agent-a',
          x: 0,
          y: 0,
          width: 400,
          height: 300,
        }),
      ],
    );

    const updated = await db.nodes.get('note-1');
    expect(updated?.contextScopeAgentId).toBe('agent-a');
  });

  it('clears scope when node leaves all zones', async () => {
    const note = node({
      id: 'note-2',
      type: 'note',
      x: 900,
      y: 80,
      content: 'outside',
      contextScopeAgentId: 'agent-a',
    });
    await db.nodes.add(note);

    await reconcileNodeScopesFromZones([note], []);

    const updated = await db.nodes.get('note-2');
    expect(updated?.contextScopeAgentId).toBeUndefined();
  });

  it('skips persona anchor nodes', async () => {
    const ask = node({ id: 'ask-1', type: 'ask', x: 50, y: 50, content: '' });
    await db.nodes.add(ask);

    await reconcileNodeScopesFromZones(
      [ask],
      [
        zone({
          id: 'zone-a',
          personaNodeId: 'ask-1',
          x: 0,
          y: 0,
          width: 400,
          height: 300,
        }),
      ],
    );

    const updated = await db.nodes.get('ask-1');
    expect(updated?.contextScopeAgentId).toBeUndefined();
  });
});

describe('stampWorkZoneScopeOnNewNode', () => {
  const boundZone = zone({
    id: 'zone-a',
    personaNodeId: 'agent-a',
    x: 0,
    y: 0,
    width: 400,
    height: 300,
  });

  it('assigns scope when the new card center is in a bound room', () => {
    const note = node({ id: 'note-new', type: 'note', x: 80, y: 60 });
    expect(stampWorkZoneScopeOnNewNode(note, [boundZone]).contextScopeAgentId).toBe('agent-a');
  });

  it('does not assign scope outside rooms or in an unbound room', () => {
    const outside = node({ id: 'out', type: 'note', x: 900, y: 60 });
    expect(stampWorkZoneScopeOnNewNode(outside, [boundZone]).contextScopeAgentId).toBeUndefined();

    const emptyRoom = zone({
      id: 'empty',
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    });
    const insideEmpty = node({ id: 'in-empty', type: 'note', x: 80, y: 60 });
    expect(stampWorkZoneScopeOnNewNode(insideEmpty, [emptyRoom]).contextScopeAgentId).toBeUndefined();
  });

  it('clears a copied scope when the paste lands outside every room', () => {
    const pasted = node({
      id: 'paste',
      type: 'note',
      x: 900,
      y: 60,
      contextScopeAgentId: 'agent-old',
    });
    expect(stampWorkZoneScopeOnNewNode(pasted, [boundZone]).contextScopeAgentId).toBeUndefined();
  });

  it('does not stamp scope on persona anchors', () => {
    const ask = node({ id: 'ask-1', type: 'ask', x: 50, y: 50, contextScopeAgentId: 'stale' });
    expect(stampWorkZoneScopeOnNewNode(ask, [boundZone]).contextScopeAgentId).toBeUndefined();
  });
});

describe('stampWorkZoneScopeOnNewNodes', () => {
  beforeEach(async () => {
    await db.canvasWorkZones.clear();
    localStorage.clear();
  });

  it('loads rooms from Dexie when V2 is on', async () => {
    await db.canvasWorkZones.add(
      zone({
        id: 'zone-a',
        personaNodeId: 'agent-a',
        x: 0,
        y: 0,
        width: 400,
        height: 300,
      }),
    );
    const note = node({ id: 'n1', type: 'text', x: 40, y: 40 });
    const [stamped] = await stampWorkZoneScopeOnNewNodes([note], 'canvas-1');
    expect(stamped.contextScopeAgentId).toBe('agent-a');
  });

  it('leaves cards unchanged when V2 is off', async () => {
    setCanvasV2Enabled(false);
    await db.canvasWorkZones.add(
      zone({
        id: 'zone-a',
        personaNodeId: 'agent-a',
        x: 0,
        y: 0,
        width: 400,
        height: 300,
      }),
    );
    const note = node({ id: 'n1', type: 'text', x: 40, y: 40 });
    const [stamped] = await stampWorkZoneScopeOnNewNodes([note], 'canvas-1');
    expect(stamped.contextScopeAgentId).toBeUndefined();
  });
});
