import type { AgentConfig } from '../db';

/** Personas written on first launch. */
export const SEEDED_AGENT_IDS = [
  'interviewer',
  'synthesizer',
  'stylist',
  'futurist',
] as const;

/**
 * Cosmos pack personas. Not seeded into the user's agent list.
 * They arrive only when the user applies the official「创伤内宇宙」community listing.
 * Seed may delete unused leftover rows; cards that still reference these ids keep them.
 */
export const OPTIONAL_SYSTEM_AGENT_IDS = [
  'cosmos_weaver',
  'character_atelier',
] as const;

export const SYSTEM_AGENT_IDS = [
  ...SEEDED_AGENT_IDS,
  ...OPTIONAL_SYSTEM_AGENT_IDS,
] as const;

export type SystemAgentId = (typeof SYSTEM_AGENT_IDS)[number];

export const SYSTEM_AGENT_TUNING: Record<
  SystemAgentId,
  Pick<AgentConfig, 'temperature' | 'creativity'>
> = {
  interviewer: { temperature: 0.7, creativity: 0.4 },
  synthesizer: { temperature: 0.8, creativity: 0.7 },
  stylist: { temperature: 0.6, creativity: 0.5 },
  futurist: { temperature: 0.9, creativity: 0.9 },
  cosmos_weaver: { temperature: 0.85, creativity: 0.75 },
  character_atelier: { temperature: 0.8, creativity: 0.7 },
};

/** 若本地仍保存旧版种子文案，启动时自动替换为当前语言的默认提示词（不覆盖用户已改写的提示词）。 */
export const LEGACY_AGENT_PROMPTS: Record<SystemAgentId, string[]> = {
  interviewer: [
    'You are an AI Interviewer who takes initiative. Do not wait for commands. Based on the provided context, actively start asking probing questions to draw out deeper narratives or follow-up ideas.',
  ],
  synthesizer: [
    'You are a Connector/Synthesizer. Your goal is to find hidden patterns and non-obvious relationships between the notes and ideas connected to you. Suggest how disparate concepts can be merged into a cohesive whole.',
  ],
  stylist: [
    'You are a Master Editor and Stylist. Your role is to take the provided content and elevate its quality. Focus on tone, clarity, and impact. Make the text compelling, professional, or poetic depending on the context.',
  ],
  futurist: [
    'You are a Visionary Futurist. Based on the ideas connected to you, project their evolution 10-20 years into the future. What are the long-term implications, potential disruptors, and wild possibilities?',
  ],
  cosmos_weaver: [],
  character_atelier: [],
};
