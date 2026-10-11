import type { TFunction } from 'i18next';
import type { AIConfig } from '../components/AISettingsModal';
import { callUniversalAI } from './ai';
import { parseLenientLlmJson } from '../utils/llmJson';
import { buildAgentSystemInstruction } from '../utils/aiI18n';
import type { AgentConfig } from '../db';
import {
  normalizeEssayFocusMessage,
  pickEssayFocusMarks,
  splitNewTextForScan,
  type EssayFocusMarkDraft,
} from '../utils/essayFocusMarks';

export type EssayFocusPassResult = {
  marks: EssayFocusMarkDraft[];
  message: string;
};

/**
 * 模型回的东西全是不信的时候才做的事：能解析就用，不能就当它什么都没说。
 * 这套功能"沉默是正确答案"的次数远多于开口，所以这里永远不会抛错。
 */
export function parseEssayFocusPass(source: string, raw: unknown): EssayFocusPassResult {
  let parsed: unknown = null;
  try {
    parsed = parseLenientLlmJson(typeof raw === 'string' ? raw : '');
  } catch {
    return { marks: [], message: '' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { marks: [], message: '' };
  }
  const obj = parsed as {
    marks?: unknown;
    highlights?: unknown;
    passages?: unknown;
    message?: unknown;
    note?: unknown;
    remark?: unknown;
  };
  return {
    marks: pickEssayFocusMarks(source, obj.marks ?? obj.highlights ?? obj.passages),
    message: normalizeEssayFocusMessage(obj.message ?? obj.note ?? obj.remark),
  };
}

/**
 * 让 AI 读用户新写的那一段，挑出值得停下来的行。
 *
 * 只送**新增**的部分，外加一小截前文做连贯性。整篇重读有两个坏处：贵；以及模型会
 * 反复标同一批句子，于是同一句话在正文里被标一次、又标一次，清掉旧的之后又冒出来。
 *
 * 提示词按书籍那一套拼：选了角色就把角色的提示词接在标注契约前面，采样跟角色走。
 * 没选角色时只发契约，和加这个功能之前逐字节一致。
 */
export async function runEssayFocusPass({
  config,
  title,
  body,
  lastScanChars,
  agent,
  t,
  sessionId,
}: {
  config: AIConfig;
  title: string;
  /** 当前整篇正文。 */
  body: string;
  /** 上一次读到第几个字。 */
  lastScanChars: number | undefined;
  /** 侧栏房间里这一轮答话的人；没有就只发标注契约。 */
  agent?: AgentConfig | null;
  t: TFunction<'translation', undefined>;
  sessionId?: string;
}): Promise<EssayFocusPassResult> {
  const { contextBefore, newText } = splitNewTextForScan(body, lastScanChars);
  if (!newText.trim()) return { marks: [], message: '' };

  const contract = t('ai.prompts.essayFocusSystem');
  const systemInstruction = agent
    ? buildAgentSystemInstruction(agent, { extraParts: [contract] })
    : contract;
  const sampling = agent
    ? { temperature: agent.temperature ?? 0.3, topP: agent.creativity ?? 0.9 }
    : { temperature: 0.3, topP: 0.9 };

  console.info('[Spoor] 长文标注 · 请求', {
    provider: config.provider,
    model: config.model,
    agentId: agent?.id ?? null,
    newChars: newText.length,
  });

  const raw = await callUniversalAI({
    config,
    systemInstruction,
    messages: [
      {
        role: 'user',
        content: t('ai.prompts.essayFocusUser', { title, contextBefore, newText }),
      },
    ],
    ...sampling,
    sessionId,
  });

  // 校验用的是**整篇**正文，不是送去读的新段：引文只要在整篇里唯一就够定位。
  // 用新段校验会漏掉一件事——模型偶尔把跨段落的句子标出来，那在整篇里仍然是唯一的。
  const result = parseEssayFocusPass(body, raw);
  let offered = 0;
  try {
    const parsed = parseLenientLlmJson(String(raw)) as { marks?: unknown } | null;
    offered = Array.isArray(parsed?.marks) ? parsed.marks.length : 0;
  } catch {
    offered = -1;
  }
  console.info(`[Spoor] 长文标注 · 模型给了 ${offered} 条，通过校验 ${result.marks.length} 条`);
  return result;
}
