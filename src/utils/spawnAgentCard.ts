import { db, type AgentConfig } from '../db';
import { AGENT_NODE_SIZE } from './canvas';
import { stampNewCard } from './stampNewCard';

/**
 * 把角色库里的一个角色放到画布上。与工具栏「+ → 角色」同一套写法：
 * 有封面才写 16:9 尺寸，让封面卡按设计稿尺寸渲染；没有封面就交给默认尺寸。
 * 返回新卡片节点 id。
 */
export async function spawnAgentCardOnCanvas(opts: {
  canvasId: string;
  agentConfig: AgentConfig;
  position: { x: number; y: number };
}): Promise<string> {
  const id = crypto.randomUUID();
  const hasCover = Boolean((opts.agentConfig.coverImageUrl ?? '').trim());
  await db.nodes.add(
    stampNewCard({
      id,
      canvasId: opts.canvasId,
      type: 'agent',
      agentConfigId: opts.agentConfig.id,
      x: opts.position.x,
      y: opts.position.y,
      ...(hasCover ? { width: AGENT_NODE_SIZE.width, height: AGENT_NODE_SIZE.height } : {}),
    }),
  );
  return id;
}
