import type { CanvasNode } from '../db';
import { hasSubstantiveText } from './substantive';

/**
 * 房间主动发言：用户没问，角色自己开口。
 *
 * 这一套的三个判据都在这个文件里，因为它们是最容易悄悄退化的部分：
 * 「内容变了没有」「够不够开口」「这一次能说几条」全部是纯函数，
 * 脱离模型就能单测。真正的模型往返在 `services/roomProactivePass.ts`。
 */

/**
 * 房间内容低于这个量就**完全不调模型**。
 *
 * 沉默在这里不只是省钱，是产品纪律：一个空房间说"我看到你放了几张卡"，
 * 比不说话糟糕得多——那是模型在表演主动性，不是在想事情。
 */
export const ROOM_PROACTIVE_MIN_CHARS = 120;

/** 一次主动发言的条数硬上限。实际给多少由 `planRoomProactivePass` 按卡片量算。 */
export const ROOM_PROACTIVE_MAX_MESSAGES = 3;

/** 单条消息太短就是交差（模型常用「…」凑数），直接丢掉。 */
export const ROOM_PROACTIVE_MESSAGE_MIN_CHARS = 8;

/**
 * 单条消息的字符上限。
 *
 * 超过就**整条丢掉**，不截断：截断会在半句话上停下来，读起来比不说更糟。
 * 说太长本来就说明它想写总评，而总评正是这里最不该出现的东西。
 */
export const ROOM_PROACTIVE_MESSAGE_MAX_CHARS = 400;

/**
 * 内容变了才动身：卡片变多、变少、或者正文被改过。
 *
 * 存的是指纹而不是时间戳——时间戳挡不住"编辑已有卡片"，而编辑恰恰是最该
 * 触发的一次。
 */
export function computeRoomSignature(
  roomNodeIds: string[],
  nodes: CanvasNode[],
): string {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parts: string[] = [];
  for (const id of [...roomNodeIds].sort()) {
    const node = byId.get(id);
    if (!node) continue;
    // 还在生成中的卡片不算数：AI 往回复卡里流式写字时正文每毫秒都在变，
    // 把它算进来，指纹永远对不上静止的那一刻。
    if (isRoomNodeStillMoving(node)) continue;
    parts.push(`${node.id}${node.type}${node.content ?? ''}${node.description ?? ''}`);
  }
  return fnv1a(parts.join(''));
}

/**
 * 这张卡是不是正在被写。
 *
 * 只认两种：AI 回复卡的 `aiStatus`，和长文卡自己那个生成位。别的状态
 * （比如图片还在下载）不动 `content`，不用管。
 */
export function isRoomNodeStillMoving(node: CanvasNode): boolean {
  if (node.aiStatus === 'generating') return true;
  if (node.type === 'essay') {
    const raw = (node.content ?? '').trim();
    if (!raw.startsWith('{')) return false;
    try {
      const parsed = JSON.parse(raw) as { generating?: unknown };
      return parsed.generating === true;
    } catch {
      return false;
    }
  }
  return false;
}

export interface RoomProactiveStats {
  cardCount: number;
  totalChars: number;
  imageCount: number;
}

export interface RoomProactivePlan {
  maxMessages: number;
}

/**
 * 这一趟值不值得跑、又能说几条。
 *
 * 返回 `null` = 这一趟**一次模型都不调**。
 * 条数上限在这里算死、也在这里被 `pickProactiveMessages` 强制执行，
 * 不是只写进提示词求模型听话——求它不如卡死它（和 `bookFocusMarks`
 * 强制 `BOOK_FOCUS_MAX_PER_CHAPTER` 同一个做法）。
 */
export function planRoomProactivePass(
  stats: RoomProactiveStats,
): RoomProactivePlan | null {
  if (stats.cardCount <= 0) return null;
  // 图片只贡献图注/OCR 文字。一屋子没有文字的图片等于没有材料。
  if (stats.totalChars < ROOM_PROACTIVE_MIN_CHARS) return null;
  if (stats.cardCount <= 1) return { maxMessages: 1 };
  if (stats.cardCount <= 3) return { maxMessages: 2 };
  return { maxMessages: ROOM_PROACTIVE_MAX_MESSAGES };
}

/**
 * 从模型回的信封里挑出能直接上屏的几条。
 *
 * 丢空串、丢交差的省略号、丢说太长的总评、丢重复，最后按预算封顶。
 */
export function pickProactiveMessages(value: unknown, maxMessages: number): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const limit = Math.max(0, Math.min(maxMessages, ROOM_PROACTIVE_MAX_MESSAGES));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (out.length >= limit) break;
    const text = typeof item === 'string' ? item.trim() : '';
    if (!hasSubstantiveText(text)) continue;
    if (text.length < ROOM_PROACTIVE_MESSAGE_MIN_CHARS) continue;
    if (text.length > ROOM_PROACTIVE_MESSAGE_MAX_CHARS) continue;
    const key = text.replace(/\s+/g, ' ').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

/** 便宜的非加密哈希，够用来发现"内容变了"这件事。 */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}
