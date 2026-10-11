/**
 * 出厂种子人格的构造。
 *
 * 原来这段在 `useSeedData` 里，只能读全局 i18n。这里把它抽成纯函数，
 * 好让调用方能按语言构造——种子文案是跟着界面语言走的。
 *
 * ⚠️ 这里**刻意不 import `../i18n`**：i18n 模块在 import 时就会 `i18next.use(...).init(...)`，
 * 把 i18next 的初始化塞进别的模块是个意外的重副作用。种子的文案本体就是
 * `src/i18n/agentDefaultsContent` 里那两份纯数据（i18n.ts 的 `agents.defaults` 就是它们），
 * 直接读即可。
 */
import type { AgentConfig } from '../db';
import { agentDefaultsEn, agentDefaultsZh } from '../i18n/agentDefaultsContent';
import {
  SYSTEM_AGENT_TUNING,
  type SystemAgentId,
} from '../constants/defaultAgents';
import { cosmosNarrativeKnowledgeFile } from '../constants/agentKnowledge/cosmosNarrativeGrammar';

const COSMOS_AGENT_IDS = new Set<SystemAgentId>(['cosmos_weaver', 'character_atelier']);

type SeedDefaults = Record<string, { name: string; role: string; prompt: string }>;

/**
 * 取某个语言的出厂文案。
 *
 * 判定口径必须和 i18next 一致：只有 `zh*` 走中文，其余一律英文。
 * i18next 的 `fallbackLng` 就是 'en'，`en-US` 之类的子标签也会归到 `en`——
 * 这里跟着走，否则会出现"i18n.t 给出英文、种子却给出中文"这种漂移。
 */
function seedDefaultsForLang(lang: string): SeedDefaults {
  return lang.toLowerCase().startsWith('zh') ? agentDefaultsZh : agentDefaultsEn;
}

/**
 * 按指定语言构造出厂人格。
 */
export function buildSystemAgentRowForLang(id: SystemAgentId, lang: string): AgentConfig {
  const entry = seedDefaultsForLang(lang)[id];
  const row: AgentConfig = {
    id,
    name: entry.name,
    role: entry.role,
    prompt: entry.prompt,
    ...SYSTEM_AGENT_TUNING[id],
  };
  if (COSMOS_AGENT_IDS.has(id)) {
    row.knowledgeMarkdownFiles = [cosmosNarrativeKnowledgeFile(lang)];
  }
  return row;
}