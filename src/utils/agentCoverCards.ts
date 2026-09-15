import { db } from '../db';
import { AGENT_NODE_SIZE } from './canvas';

/** Match canvas agent cards to the 16:9 cover footprint, or drop explicit size when the cover is removed. */
export async function syncAgentCanvasCardSize(agentConfigId: string, hasCover: boolean): Promise<void> {
  const canvasCards = await db.nodes.where('agentConfigId').equals(agentConfigId).toArray();
  await Promise.all(
    canvasCards
      .filter((n) => n.type === 'agent')
      .map(async (n) => {
        if (hasCover) {
          await db.nodes.update(n.id, {
            width: AGENT_NODE_SIZE.width,
            height: AGENT_NODE_SIZE.height,
          });
          return;
        }
        const next = { ...n };
        delete next.width;
        delete next.height;
        await db.nodes.put(next);
      }),
  );
}
