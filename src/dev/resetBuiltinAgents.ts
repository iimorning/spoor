import { db } from '../db';
import { SEEDED_AGENT_IDS } from '../constants/defaultAgents';

/** 删除默认内置 Agent，便于开发者拉取新文案后由 `useSeedData` 重灌。不删造宇宙/角色工坊。 */
export async function resetBuiltinAgentsInDb(): Promise<void> {
  await Promise.all(SEEDED_AGENT_IDS.map((id) => db.agents.delete(id)));
}

const win = typeof globalThis !== 'undefined' ? (globalThis as typeof globalThis & { __SCRIBE_RESET_BUILTIN_AGENTS?: () => Promise<void> }) : undefined;

/** 挂载 `globalThis.__SCRIBE_RESET_BUILTIN_AGENTS`（仅 dev）；执行删除后刷新页面即可由 `useSeedData` 重灌默认。 */
export function registerDevBuiltinAgentReset(): void {
  if (!import.meta.env.DEV || !win) return;
  win.__SCRIBE_RESET_BUILTIN_AGENTS = () => resetBuiltinAgentsInDb();
}
