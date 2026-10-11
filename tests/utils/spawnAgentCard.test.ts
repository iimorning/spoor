import { beforeEach, describe, expect, it } from 'vitest';
import { db, type AgentConfig } from '../../src/db';
import { AGENT_NODE_SIZE } from '../../src/utils/canvas';
import { spawnAgentCardOnCanvas } from '../../src/utils/spawnAgentCard';

function config(id: string, coverImageUrl?: string): AgentConfig {
  return { id, name: id, role: 'r', prompt: 'p', ...(coverImageUrl ? { coverImageUrl } : {}) };
}

describe('spawnAgentCardOnCanvas', () => {
  beforeEach(async () => {
    await db.nodes.clear();
  });

  it('writes an agent card at the given spot and returns its id', async () => {
    const id = await spawnAgentCardOnCanvas({
      canvasId: 'c1',
      agentConfig: config('cfg-a'),
      position: { x: 40, y: 60 },
    });

    const node = await db.nodes.get(id);
    expect(node).toMatchObject({
      id,
      canvasId: 'c1',
      type: 'agent',
      agentConfigId: 'cfg-a',
      x: 40,
      y: 60,
    });
    expect(node?.createdAt).toBeTypeOf('number');
    // 没有封面就不写尺寸，交给卡片默认尺寸（与工具栏一致）
    expect(node?.width).toBeUndefined();
    expect(node?.height).toBeUndefined();
  });

  it('gives a persona with cover art the 16:9 card size', async () => {
    const id = await spawnAgentCardOnCanvas({
      canvasId: 'c1',
      agentConfig: config('cfg-b', 'https://img.example/cover.jpg'),
      position: { x: 0, y: 0 },
    });

    const node = await db.nodes.get(id);
    expect(node?.width).toBe(AGENT_NODE_SIZE.width);
    expect(node?.height).toBe(AGENT_NODE_SIZE.height);
  });
});
