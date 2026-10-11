import type { AIConfig } from '../components/AISettingsModal';
import { db } from '../db';
import { callUniversalAI } from '../services/ai';
import { parseLenientLlmJson } from './llmJson';

export const SUGGESTED_FOLLOW_UP_COUNT = 3;
const MAX_QUESTION_CHARS = 80;
const MIN_REPLY_CHARS = 12;

export function parseSuggestedFollowUps(raw: unknown): string[] {
  if (Array.isArray(raw)) return normalizeSuggestedFollowUps(raw);
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  const list = obj.questions ?? obj.followUps ?? obj.suggestedFollowUps;
  return Array.isArray(list) ? normalizeSuggestedFollowUps(list) : [];
}

export function normalizeSuggestedFollowUps(raw: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const cleaned = item
      .replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, '')
      .replace(/^\d+[\.．、\)）]\s*/, '')
      .replace(/^[Qq]\d+[:：]\s*/, '')
      .trim();
    if (!cleaned) continue;
    const clipped =
      cleaned.length > MAX_QUESTION_CHARS ? `${cleaned.slice(0, MAX_QUESTION_CHARS - 1).trim()}…` : cleaned;
    const key = clipped.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clipped);
    if (out.length >= SUGGESTED_FOLLOW_UP_COUNT) break;
  }
  return out;
}

export async function generateSuggestedFollowUps({
  config,
  userQuestion,
  assistantReply,
  t,
  sessionId,
}: {
  config: AIConfig;
  userQuestion: string;
  assistantReply: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
  sessionId?: string;
}): Promise<string[]> {
  const question = userQuestion.trim();
  const reply = assistantReply.trim();
  if (!question || reply.length < MIN_REPLY_CHARS) return [];
  try {
    const raw = await callUniversalAI({
      config,
      systemInstruction: t('ai.prompts.suggestedFollowUpsSystem'),
      messages: [
        {
          role: 'user',
          content: t('ai.prompts.suggestedFollowUpsUser', {
            question,
            reply: reply.slice(0, 4000),
          }),
        },
      ],
      temperature: 0.7,
      topP: 0.8,
      sessionId,
    });
    return parseSuggestedFollowUps(parseLenientLlmJson(raw));
  } catch {
    return [];
  }
}

export async function attachSuggestedFollowUpsToThreadMessage({
  threadId,
  messageId,
  config,
  userQuestion,
  t,
  sessionId,
}: {
  threadId: string;
  messageId: string;
  config: AIConfig;
  userQuestion: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
  sessionId?: string;
}): Promise<void> {
  const row = await db.canvasPersonaThreads.get(threadId);
  const assistant = row?.messages.find((m) => m.id === messageId);
  const reply = assistant?.text?.trim() ?? '';
  const followUps = await generateSuggestedFollowUps({
    config,
    userQuestion,
    assistantReply: reply,
    t,
    sessionId,
  });
  if (followUps.length === 0) return;
  const latest = await db.canvasPersonaThreads.get(threadId);
  if (!latest) return;
  const last = latest.messages[latest.messages.length - 1];
  if (last?.id !== messageId) return;
  const messages = latest.messages.map((m) =>
    m.id === messageId ? { ...m, suggestedFollowUps: followUps } : m,
  );
  await db.canvasPersonaThreads.put({ ...latest, messages, updatedAt: Date.now() });
}
