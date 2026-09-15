import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db';
import { AGENT_NODE_SIZE } from '../../src/utils/canvas';
import { syncAgentCanvasCardSize } from '../../src/utils/agentCoverCards';

describe('syncAgentCanvasCardSize', () => {
  beforeEach(async () => {
    await db.nodes.clear();
  });

  it('有封面时把该人格的 agent 卡改成 16:9', async () => {
    await db.nodes.bulkAdd([
      { id: 'a1', type: 'agent', agentConfigId: 'ag1', canvasId: 'default', x: 0, y: 0 },
      { id: 'a2', type: 'agent', agentConfigId: 'ag2', canvasId: 'default', x: 10, y: 10 },
      { id: 'n1', type: 'note', agentConfigId: 'ag1', canvasId: 'default', x: 20, y: 20 },
    ]);

    await syncAgentCanvasCardSize('ag1', true);

    const a1 = await db.nodes.get('a1');
    const a2 = await db.nodes.get('a2');
    const note = await db.nodes.get('n1');
    expect(a1?.width).toBe(AGENT_NODE_SIZE.width);
    expect(a1?.height).toBe(AGENT_NODE_SIZE.height);
    expect(a2?.width).toBeUndefined();
    expect(note?.width).toBeUndefined();
  });

  it('移除封面时清掉显式宽高', async () => {
    await db.nodes.add({
      id: 'a1',
      type: 'agent',
      agentConfigId: 'ag1',
      canvasId: 'default',
      x: 0,
      y: 0,
      width: AGENT_NODE_SIZE.width,
      height: AGENT_NODE_SIZE.height,
    });

    await syncAgentCanvasCardSize('ag1', false);

    const a1 = await db.nodes.get('a1');
    expect(a1?.width).toBeUndefined();
    expect(a1?.height).toBeUndefined();
  });
});
