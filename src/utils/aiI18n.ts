import i18n from '../i18n';
import type { AgentConfig } from '../db';
import { LEGACY_AGENT_PROMPTS, SYSTEM_AGENT_IDS, type SystemAgentId } from '../constants/defaultAgents';
import { communityOfficialEn, communityOfficialZh } from '../i18n/communityOfficialContent';
import { LEGACY_OFFICIAL_TURTLE_SOUP_PROMPTS } from '../i18n/legacyOfficialTurtleSoupPrompts';
import { formatAgentMarkdownKnowledgeBlock } from './agentMarkdownKnowledge';
import { isTurtleSoupHostAgent } from './agentPersonaSource';
import { localCalendarIsoDate } from './localCalendarDate';

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Language + device calendar date so “now / latest” is not the model’s training cutoff. */
export function getLocaleDirective(now = new Date()): string {
  return combineSystemParts(
    i18n.t('ai.prompts.localeDirective'),
    i18n.t('ai.prompts.clockDirective', { date: localCalendarIsoDate(now) }),
  );
}

export function combineSystemParts(...parts: (string | undefined | null)[]): string {
  return parts.map(p => p?.trim()).filter(Boolean).join('\n\n');
}

function isBuiltinAgentId(id: string): id is SystemAgentId {
  return (SYSTEM_AGENT_IDS as readonly string[]).includes(id);
}

/** 与 resolveAgentSystemPrompt 相同策略：内置人格在 en/zh 默认文案之间切换显示，用户自定义则保留。 */
function resolveAgentLocalizedField(agent: AgentConfig, field: 'name' | 'role'): string {
  const id = agent.id;
  if (!isBuiltinAgentId(id)) {
    return String(agent[field] ?? '');
  }
  const current = norm(String(agent[field] ?? ''));
  const candidates = new Set<string>();
  for (const lng of ['en', 'zh'] as const) {
    candidates.add(norm(i18n.getFixedT(lng)(`agents.defaults.${id}.${field}`)));
  }
  if (candidates.has(current)) {
    return i18n.t(`agents.defaults.${id}.${field}`);
  }
  return String(agent[field] ?? '');
}

export function resolveAgentLocalizedName(agent: AgentConfig): string {
  return resolveAgentLocalizedField(agent, 'name');
}

export function resolveAgentLocalizedRole(agent: AgentConfig): string {
  return resolveAgentLocalizedField(agent, 'role');
}

/**
 * If the saved prompt is still a stock / legacy built-in, use the string for the **current** UI language.
 * Custom user edits are left as-is (locale directive still applies separately).
 */
export function resolveAgentSystemPrompt(agent: AgentConfig): string {
  if (isTurtleSoupHostAgent(agent)) {
    const current = norm(agent.prompt ?? '');
    const stock = new Set<string>([
      norm(communityOfficialEn.turtle_soup.persona_prompt),
      norm(communityOfficialZh.turtle_soup.persona_prompt),
      ...LEGACY_OFFICIAL_TURTLE_SOUP_PROMPTS.map((prompt) => norm(prompt)),
    ]);
    if (!current || stock.has(current)) {
      return i18n.t('community.official.turtle_soup.persona_prompt');
    }
  }

  const id = agent.id;
  if (!isBuiltinAgentId(id)) return agent.prompt ?? '';

  const current = norm(agent.prompt ?? '');
  const candidates = new Set<string>();
  for (const lng of ['en', 'zh'] as const) {
    candidates.add(norm(i18n.getFixedT(lng)(`agents.defaults.${id}.prompt`)));
  }
  for (const leg of LEGACY_AGENT_PROMPTS[id as SystemAgentId] ?? []) {
    candidates.add(norm(leg));
  }
  if (candidates.has(current)) {
    return i18n.t(`agents.defaults.${id}.prompt`);
  }
  return agent.prompt ?? '';
}

/**
 * 人设场景的完整 system：语言指令 + 解析后的系统提示词（可选 fallback）+ Markdown 知识块。
 */
export function buildAgentSystemInstruction(
  agent: AgentConfig,
  options?: { fallbackPrompt?: string; extraParts?: Array<string | undefined | null> },
): string {
  const resolved = resolveAgentSystemPrompt(agent).trim();
  const promptPart = resolved || options?.fallbackPrompt?.trim() || undefined;
  return combineSystemParts(
    getLocaleDirective(),
    promptPart,
    formatAgentMarkdownKnowledgeBlock(agent),
    ...(options?.extraParts ?? []),
  );
}
