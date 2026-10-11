import type { TFunction } from 'i18next';
import type { AgentConfig, CanvasChatMessage, CanvasNode, CanvasPersonaThread } from '../db';
import { isPersonaAnchorNode } from './agentWorkZone';
import { dedupeAgentsForList } from './agentPersonaSource';
import { resolveAgentLocalizedName } from './aiI18n';

/**
 * 侧栏对话框里的多角色房间：主 Agent 常驻，可再拉进其他角色卡一起讨论。
 * 最多这么多参与者（不含主 Agent）——每人一轮都会真的发一次请求，所以有上限。
 */
export const PANEL_ROOM_MAX_PARTICIPANTS = 3;

/** 讨论轮数的默认值与上下限：一轮 = 每个未禁言的声音各说一次。 */
export const DEFAULT_ROOM_DISCUSSION_ROUNDS = 2;
export const ROOM_DISCUSSION_ROUNDS_MAX = 5;

export function clampRoomDiscussionRounds(rounds: number | undefined): number {
  if (!Number.isFinite(rounds)) return DEFAULT_ROOM_DISCUSSION_ROUNDS;
  return Math.min(ROOM_DISCUSSION_ROUNDS_MAX, Math.max(1, Math.round(rounds as number)));
}

export type RoomParticipant = {
  nodeId: string;
  name: string;
  /** 主 Agent 恒在首位，且不能移出 / 禁言。 */
  isHost: boolean;
  muted: boolean;
};

export function personaNodeDisplayName(
  node: CanvasNode,
  agentConfigs: AgentConfig[],
  askName: string,
  fallbackName: string,
): string {
  if (node.type === 'ask') return askName;
  const conf = node.agentConfigId
    ? agentConfigs.find((a) => a.id === node.agentConfigId)
    : undefined;
  if (!conf) return fallbackName;
  return resolveAgentLocalizedName(conf) || fallbackName;
}

/**
 * 一轮回复流出的一块文本：哪条消息、谁说的、累积到哪儿了。
 *
 * 语音模式的朗读按发言人分音色，所以它需要的不只是"有文本了"，还有"这是谁在说" ——
 * 房间轮次是串行的，谁先说完、谁接上，全从这个回调里看得出来。
 */
export type PersonaSpeakerStream = {
  messageId: string;
  speakerNodeId: string;
  accumulated: string;
};

export type PersonaSpeakerStreamHandler = (chunk: PersonaSpeakerStream) => void;

/**
 * 一张角色卡自己配的朗读音色。没配、或卡上没有人设（阿狸问卡）时返回 undefined，
 * 交给全局设置与界面语言默认（见 resolveMinimaxTtsProfile）。
 */
export function personaVoiceIdForNode(
  nodeId: string | null | undefined,
  nodes: CanvasNode[],
  agentConfigs: AgentConfig[],
): string | undefined {
  if (!nodeId) return undefined;
  const node = nodes.find((n) => n.id === nodeId);
  const conf = node?.agentConfigId
    ? agentConfigs.find((a) => a.id === node.agentConfigId)
    : undefined;
  return conf?.voiceId?.trim() || undefined;
}

/**
 * 这条回复是谁说的 → 那个角色自己的朗读音色。没有署名（阿狸、或角色接入房间之前的
 * 老消息）时返回 undefined，同样交给全局默认。
 */
export function personaVoiceIdForMessage(
  messages: CanvasChatMessage[] | undefined,
  messageId: string,
  nodes: CanvasNode[],
  agentConfigs: AgentConfig[],
): string | undefined {
  const speakerNodeId = messages?.find((m) => m.id === messageId)?.speakerNodeId;
  return personaVoiceIdForNode(speakerNodeId, nodes, agentConfigs);
}

/**
 * 房间名单：只保留仍然存在的人设卡（agent / Ask），去掉主 Agent、重复项与超出上限的尾巴。
 * 角色卡被删掉后，thread 上残留的 id 在这里被静默丢弃，不写回数据库。
 */
export function sanitizeRoomRoster(
  hostNodeId: string,
  participantNodeIds: string[] | undefined,
  mutedNodeIds: string[] | undefined,
  nodes: CanvasNode[],
): { participantNodeIds: string[]; mutedNodeIds: string[] } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>([hostNodeId]);
  const kept: string[] = [];
  for (const id of participantNodeIds ?? []) {
    if (seen.has(id)) continue;
    const node = byId.get(id);
    if (!node || !isPersonaAnchorNode(node)) continue;
    seen.add(id);
    kept.push(id);
    if (kept.length >= PANEL_ROOM_MAX_PARTICIPANTS) break;
  }
  const keptSet = new Set(kept);
  const muted = [...new Set(mutedNodeIds ?? [])].filter(
    // 主角色也能被禁言（这一轮让参与者单独答），所以它的 id 不在参与者名单里也要留。
    (id) => keptSet.has(id) || id === hostNodeId,
  );
  return { participantNodeIds: kept, mutedNodeIds: muted };
}

/** 说话顺序：未禁言的主 Agent 先，然后按加入顺序排列未禁言的参与者。 */
export function resolveRoomSpeakers(
  hostNodeId: string,
  participantNodeIds: string[],
  mutedNodeIds: string[],
  nodes: CanvasNode[],
): string[] {
  const muted = new Set(mutedNodeIds);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const live = participantNodeIds.filter((id) => {
    if (muted.has(id)) return false;
    const node = byId.get(id);
    return Boolean(node && isPersonaAnchorNode(node));
  });
  const host = byId.get(hostNodeId);
  const hostSpeaks = Boolean(host && isPersonaAnchorNode(host)) && !muted.has(hostNodeId);
  return hostSpeaks ? [hostNodeId, ...live] : live;
}

/** 面板头部那排角色 chip（主 Agent 首位）。 */
export function buildRoomParticipants(
  hostNode: CanvasNode,
  participantNodeIds: string[],
  mutedNodeIds: string[],
  nodes: CanvasNode[],
  agentConfigs: AgentConfig[],
  askName: string,
  fallbackName: string,
): RoomParticipant[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const muted = new Set(mutedNodeIds);
  const host: RoomParticipant = {
    nodeId: hostNode.id,
    name: personaNodeDisplayName(hostNode, agentConfigs, askName, fallbackName),
    isHost: true,
    muted: muted.has(hostNode.id),
  };
  const rest = participantNodeIds
    .map((id) => byId.get(id))
    .filter((n): n is CanvasNode => Boolean(n && isPersonaAnchorNode(n)))
    .map((node) => ({
      nodeId: node.id,
      name: personaNodeDisplayName(node, agentConfigs, askName, fallbackName),
      isHost: false,
      muted: muted.has(node.id),
    }));
  return [host, ...rest];
}

/** 还能邀请的角色卡：画布上其余人设，按画布顺序，排除已在场与未绑定的。 */
export function listRoomInviteCandidates(
  hostNodeId: string,
  participantNodeIds: string[],
  nodes: CanvasNode[],
): CanvasNode[] {
  const taken = new Set([hostNodeId, ...participantNodeIds]);
  const seenPersonas = new Set<string>();
  const out: CanvasNode[] = [];
  for (const n of nodes) {
    if (taken.has(n.id)) continue;
    if (!isPersonaAnchorNode(n)) continue;
    if (n.type === 'agent' && !n.agentConfigId) continue;
    // 同一个角色在画布上可以有多张卡，但一场讨论里只需要一个声音。
    const personaKey = n.agentConfigId ?? 'ask';
    if (seenPersonas.has(personaKey)) continue;
    seenPersonas.add(personaKey);
    out.push(n);
  }
  return out;
}

/**
 * 角色库里还没在这张画布上出现过的角色 —— 可以现放到画布上再拉进讨论。
 * 已经在画布上的由 listRoomInviteCandidates 提供，这里不重复列。
 */
export function listRoomLibraryCandidates(
  agentConfigs: AgentConfig[],
  nodes: CanvasNode[],
): AgentConfig[] {
  const onCanvas = new Set(
    nodes
      .filter((n) => n.type === 'agent')
      .map((n) => n.agentConfigId)
      .filter((id): id is string => Boolean(id)),
  );
  return dedupeAgentsForList(agentConfigs).filter((agent) => !onCanvas.has(agent.id));
}

export function toggleRoomId(ids: string[], nodeId: string): string[] {
  return ids.includes(nodeId) ? ids.filter((id) => id !== nodeId) : [...ids, nodeId];
}

/**
 * 把线程里的一条 assistant 消息整理成发给某个发言人的对话历史。
 * 别人说的话带上名字前缀，自己说过的保持裸文本（读起来就是「我说过的」）。
 * 单人房间里没有任何消息带 speakerNodeId，结果与旧版逐字相同。
 */
export function formatRoomHistoryForSpeaker(
  messages: CanvasChatMessage[],
  speakerNodeId: string,
  speakerPrefix: (name: string) => string,
  maxMessages?: number,
  /**
   * 没有署名的旧回复一律归属于这个发言人（只有主 Agent 会产出无署名的回复）。
   * 给参与者建历史时传主 Agent 的名字，这样加进讨论之前的老对话也能分清是谁说的。
   */
  hostFallbackName?: string,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const m of messages) {
    const text = m.text.trim();
    if (!text) continue;
    if (m.role === 'user') {
      out.push({ role: 'user', content: text });
      continue;
    }
    const otherVoice = Boolean(m.speakerNodeId) && m.speakerNodeId !== speakerNodeId;
    const otherName = otherVoice
      ? m.speakerName
      : !m.speakerNodeId
        ? hostFallbackName
        : undefined;
    out.push({
      role: 'assistant',
      content: otherName ? `${speakerPrefix(otherName)}${text}` : text,
    });
  }
  if (maxMessages && out.length > maxMessages) {
    const tail = out.slice(out.length - maxMessages);
    // 房间里一轮会追加 3 条（用户 + 主 Agent + 参与者），裁剪点未必落在用户发言上。
    // Anthropic / Gemini 都拒绝以 assistant 开头的历史，所以把开头多余的回复丢掉。
    const firstUser = tail.findIndex((m) => m.role === 'user');
    return firstUser > 0 ? tail.slice(firstUser) : tail;
  }
  return out;
}

/** 引用上一位发言时最多带多少字：整段历史已经在对话里，这里只是把注意力钉过去。 */
const TURN_CUE_QUOTE_MAX_CHARS = 600;

/**
 * 这一轮的 cue：告诉发言人**现在发生了什么**（对话规则在系统提示词里，不在这里）。
 *
 * 三种情况分开写，因为"开口回答用户"、"回应上一位"和"接着自己想"是完全不同的任务：
 * - 用户刚问了一句（比最后一条回复更新）或还没人说过 → 针对用户的问题给出判断；
 * - 上一位是别人 → 优先回应他的具体观点，不要机械复述；
 * - 上一位是自己（房间里只有他在说）→ 接着往下讲，别重复。
 *
 * "上一位"从 transcript 里读，而不是由调度器传：实际发言顺序会被禁言、删卡打乱，
 * transcript 才是真正发生过的事。
 */
export function buildRoomTurnCue(opts: {
  speakerNodeId: string;
  messages: CanvasChatMessage[];
  /** 没有署名的旧回复都归主人 */
  hostNameFallback: string;
  t: TFunction;
}): string {
  const { speakerNodeId, hostNameFallback, messages, t } = opts;
  const lastUserAt = messages.reduce(
    (at, m, i) => (m.role === 'user' ? i : at),
    -1,
  );
  const previousAt = messages.reduce(
    (at, m, i) => (m.role === 'assistant' && (m.text ?? '').trim() ? i : at),
    -1,
  );
  // 用户的话比最后一条回复更新，说明这是对他新问题的回答，不是接着自己想
  // （主角色被禁言时就是这种情况：上一轮没有回复，用户直接问了下一句）。
  if (previousAt < 0 || lastUserAt > previousAt) return t('ai.prompts.personaGroupFirstTurn');

  const previous = messages[previousAt]!;
  const name = previous.speakerName?.trim() || hostNameFallback;
  if (previous.speakerNodeId === speakerNodeId) {
    return t('ai.prompts.personaGroupContinueOwnTurn');
  }
  const quote = (previous.text ?? '').trim().slice(0, TURN_CUE_QUOTE_MAX_CHARS);
  return t('ai.prompts.personaGroupRespondTurn', { name, quote });
}

/** 房间里有别人时，主 Agent 的回复也要打上名字，参与者才知道那是谁说的。 */
export function roomMessageSpeaker(
  hasRoom: boolean,
  speakerNodeId: string,
  speakerName: string,
): { speakerNodeId?: string; speakerName?: string } {
  if (!hasRoom) return {};
  return { speakerNodeId, speakerName };
}

/**
 * 房间标签：「阿狸的房间」，有客人时写出来 —— 「阿狸的房间 · 真知镜」。
 * 画布上因此直接看得见谁在这场讨论里，不需要额外连线或徽标。
 */
export function buildRoomLabelText(opts: {
  hostNode: CanvasNode;
  guestNodeIds: Iterable<string>;
  nodes: CanvasNode[];
  agentConfigs: AgentConfig[];
  askName: string;
  fallbackName: string;
  t: TFunction;
}): string {
  const { hostNode, guestNodeIds, nodes, agentConfigs, askName, fallbackName, t } = opts;
  const name = personaNodeDisplayName(hostNode, agentConfigs, askName, fallbackName);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const guestNames: string[] = [];
  for (const id of guestNodeIds) {
    const node = byId.get(id);
    if (!node || !isPersonaAnchorNode(node)) continue;
    guestNames.push(personaNodeDisplayName(node, agentConfigs, askName, fallbackName));
  }
  if (guestNames.length === 0) return t('canvas.v2.work_zone_room', { name });
  const separator = t('canvas.v2.room_guest_separator', { defaultValue: '、' });
  return t('canvas.v2.work_zone_room_with_guests', {
    name,
    guests: guestNames.join(separator),
  });
}

/**
 * 名单写入前的清理：丢掉已经被删掉的角色卡留下的残留 id。
 *
 * 不清的话残留项会永久占着 {PANEL_ROOM_MAX_PARTICIPANTS} 的名额，而界面上看不见它们
 * （sanitizeRoomRoster 会把它们藏起来），之后再加角色就会被 slice 悄悄扔掉 ——
 * 卡片出现在房间里，却不进名单、不发言。
 *
 * `nodes` 必须是这几张卡的权威行（调用方按 id 查库），不能是画布渲染列表：
 * 后者在加载中可能为空，会把整份名单误判成残留。
 * `keepIds` 用于刚放到画布、可能还没写进查询结果的新卡。
 */
export function pruneRoomRoster(
  roster: { participantNodeIds: string[]; mutedNodeIds: string[] },
  nodes: CanvasNode[],
  keepIds: Iterable<string> = [],
): { participantNodeIds: string[]; mutedNodeIds: string[] } {
  const keep = new Set(keepIds);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const isLive = (id: string) => {
    if (keep.has(id)) return true;
    const node = byId.get(id);
    return Boolean(node && isPersonaAnchorNode(node));
  };
  return {
    participantNodeIds: (roster.participantNodeIds ?? []).filter(isLive),
    mutedNodeIds: (roster.mutedNodeIds ?? []).filter(isLive),
  };
}

/**
 * 房间 → 客人集合（主角色节点 id → 讨论名单里的节点 id）。
 * 用于拖拽规则：名单里的人可以作为客人停进主角色的房间，房间归属不变。
 */
export function buildRoomGuestIndex(
  threads:
    | Array<Pick<CanvasPersonaThread, 'agentNodeId' | 'participantNodeIds'>>
    | undefined,
): Map<string, Set<string>> {
  const byHost = new Map<string, Set<string>>();
  for (const row of threads ?? []) {
    const guests = (row.participantNodeIds ?? []).filter(Boolean);
    if (guests.length === 0) continue;
    byHost.set(row.agentNodeId, new Set(guests));
  }
  return byHost;
}
