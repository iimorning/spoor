import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, type CanvasNode, type Edge } from '../../src/db';
import { migrateCanvasToWorkZones } from '../../src/utils/migrateCanvasToWorkZones';

const MIGRATED_KEY = 'spoor.migratedWorkZoneCanvasIds';

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

describe('migrateCanvasToWorkZones', () => {
  beforeEach(async () => {
    localStorage.removeItem(MIGRATED_KEY);
    await db.nodes.clear();
  });

  afterEach(() => {
    localStorage.removeItem(MIGRATED_KEY);
  });

  it('assigns scope from edge-connected component once per canvas', async () => {
    const agent = node({ id: 'agent-a', type: 'agent', x: 0, y: 0, agentConfigId: 'cfg' });
    const note = node({ id: 'note-1', type: 'note', x: 100, y: 50, content: 'linked' });
    const edges: Edge[] = [{ id: 'e1', canvasId: 'canvas-1', from: 'agent-a', to: 'note-1' }];

    await db.nodes.bulkAdd([agent, note]);

    const first = await migrateCanvasToWorkZones('canvas-1', [agent, note], edges);
    expect(first.assigned).toBe(1);

    const updated = await db.nodes.get('note-1');
    expect(updated?.contextScopeAgentId).toBe('agent-a');

    const second = await migrateCanvasToWorkZones('canvas-1', [agent, note], edges);
    expect(second.assigned).toBe(0);
    expect(second.skipped).toBe(2);
  });

  it('does not overwrite existing contextScopeAgentId', async () => {
    const agent = node({ id: 'agent-a', type: 'agent', x: 0, y: 0, agentConfigId: 'cfg' });
    const note = node({
      id: 'note-1',
      type: 'note',
      x: 100,
      y: 50,
      content: 'already scoped',
      contextScopeAgentId: 'agent-b',
    });
    const edges: Edge[] = [{ id: 'e1', canvasId: 'canvas-1', from: 'agent-a', to: 'note-1' }];

    await db.nodes.bulkAdd([agent, note]);

    const result = await migrateCanvasToWorkZones('canvas-1', [agent, note], edges);
    expect(result.assigned).toBe(0);

    const updated = await db.nodes.get('note-1');
    expect(updated?.contextScopeAgentId).toBe('agent-b');
  });
});
