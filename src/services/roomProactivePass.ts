import type { AIConfig } from '../components/AISettingsModal';
import { callUniversalAI } from './ai';
import { parseLenientLlmJson } from '../utils/llmJson';
import { pickProactiveMessages } from '../utils/roomProactive';

export type RoomProactivePassResult = {
  /** 通过校验、能直接上屏的消息。空数组 = 这一趟该沉默。 */
  messages: string[];
};

/**
 * 把模型回的东西变成"能上屏的几句话"。
 *
 * 和 `parseBookFocusPass` 同一个职责划分：这里只负责把**任何**输入变成一个
 * 可用的结果，最差也就是"什么都不说"。主动发言是自动触发的，模型某次
 * 先写一句"好的，我看看"再给信封，不该把这一趟炸掉。
 */
export function parseRoomProactivePass(raw: unknown, maxMessages: number): RoomProactivePassResult {
  let parsed: unknown = null;
  try {
    parsed = parseLenientLlmJson(typeof raw === 'string' ? raw : '');
  } catch {
    return { messages: [] };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { messages: [] };
  }
  const obj = parsed as Record<string, unknown>;
  return { messages: pickProactiveMessages(obj.messages ?? obj.message ?? obj.notes, maxMessages) };
}

/**
 * 在一个房间里主动说一次话。
 *
 * 不传流式回调：这一趟的结果是"决定说哪几句"，条数要按卡片多寡算死，
 * 没有"边写边看"的形态。真正会流式的是用户自己发起的对话。
 *
 * `systemInstruction` 由调用方拼好（含角色身份），这里不再关心是阿狸还是
 * 别的角色——那是 `useAiActions` 和 `essayFocusPass` 已经分好的岔。
 */
export async function runRoomProactivePass({
  config,
  lockModel,
  systemInstruction,
  userPrompt,
  maxMessages,
  sessionId,
}: {
  config: AIConfig;
  lockModel?: boolean;
  /** 已含角色身份。 */
  systemInstruction: string;
  /** 已把 `{{roomText}}` / `{{maxMessages}}` 填好的用户段。 */
  userPrompt: string;
  maxMessages: number;
  sessionId?: string;
}): Promise<RoomProactivePassResult> {
  if (maxMessages <= 0) return { messages: [] };
  console.info('[Spoor] 房间主动发言 · 请求', { maxMessages, chars: userPrompt.length });
  const raw = await callUniversalAI({
    config,
    lockModel,
    systemInstruction,
    messages: [{ role: 'user', content: userPrompt }],
    temperature: 0.4,
    topP: 0.9,
    sessionId,
  });
  const result = parseRoomProactivePass(raw, maxMessages);
  let offered = 0;
  try {
    const parsed = parseLenientLlmJson(String(raw)) as { messages?: unknown } | null;
    offered = Array.isArray(parsed?.messages) ? parsed.messages.length : 0;
  } catch {
    offered = -1;
  }
  console.info(
    `[Spoor] 房间主动发言 · 模型给了 ${offered} 条，通过校验 ${result.messages.length} 条`,
  );
  return result;
}
