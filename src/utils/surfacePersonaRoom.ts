import type { TFunction } from 'i18next';
import type { AgentConfig } from '../db';
import type { RoomParticipant } from './personaChatRoom';
import type { ChatRoomInviteCandidate } from '../components/canvas/ChatRoomParticipants';
import { dedupeAgentsForList } from './agentPersonaSource';
import { resolveAgentLocalizedName } from './aiI18n';

/**
 * 书籍卡 / 长文卡侧栏里的角色房间。
 *
 * 和画布上的那间房（`personaChatRoom.ts`）是同一个概念的第二个实现，不是同一份代码：
 * 画布那间的成员是**画布节点**，要判断节点还在不在、有没有绑角色、是谁在被点开；这里
 * 坐在侧栏里对着的是**角色库里的角色**，没有画布位置，也不该因为画布变了就掉出房间。
 * 两边的成员模型不一样，硬合成一份会把画布那套已有的行为也拖进来。
 *
 * 但邀请菜单那条（`ChatRoomParticipants`）是直接复用的——它只认一个标识符和一个名字，
 * "画布上的角色"那一组传空数组即可。
 */

/**
 * 房里最多几个人，**含阿狸**。嘉宾每人一轮都会真的发一次请求，所以必须有上限。
 * 阿狸恒在，所以实际能拉的客人是 3 − 1 = 2。
 */
export const SURFACE_ROOM_MAX_PARTICIPANTS = 3;

/** 能拉的客人上限 = 总数上限 − 阿狸那一位。 */
export const SURFACE_ROOM_MAX_GUESTS = SURFACE_ROOM_MAX_PARTICIPANTS - 1;

export type SurfaceRoomState = {
  /** 客人的 `AgentConfig.id`，按加入顺序。空数组 = 房里只有阿狸。 */
  personaIds: string[];
  mutedIds: string[];
};

export const EMPTY_SURFACE_ROOM: SurfaceRoomState = { personaIds: [], mutedIds: [] };

/** 读出房间状态，顺手把两处都清成去重后的干净形态。 */
export function readSurfaceRoom(
  personaIds: string[] | undefined,
  mutedIds?: string[],
): SurfaceRoomState {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const id of personaIds ?? []) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return {
    personaIds: ids,
    // 不按 personaIds 过滤：阿狸恒在但不在名单里，过滤会把他的禁言标记当成野 id
    // 丢掉，于是"禁言阿狸"这个操作永远不生效。名单里没有的 id 留着也只是
    // 匹配不上，不会误伤谁。
    mutedIds: [...new Set(mutedIds ?? [])],
  };
}

function agentsById(agents: AgentConfig[]): Map<string, AgentConfig> {
  return new Map(agents.map((a) => [a.id, a]));
}

/**
 * 名单里已经不在角色库里的 id（比如同步把它删了）要被丢掉——留在名单里的话，
 * 发言顺序里会有一个既没有提示词也没有名字的幽灵。
 */
function liveIds(ids: string[], byId: Map<string, AgentConfig>): string[] {
  return ids.filter((id) => byId.has(id));
}

/**
 * 面板头部那排 chip。
 *
 * 房里的成员是平等的：谁都没被钉死成"主角"，只是**第一个没被禁言的人**先答用户的话，
 * 徽章跟着他走。所以把第一个人禁言之后，徽章会顺位给下一个，而不是留下一个点了没反应的
 * 开关——那才是真正让人困惑的地方。
 */
export function buildSurfaceRoomParticipants(
  state: SurfaceRoomState,
  agents: AgentConfig[],
  host?: AgentConfig | null,
): RoomParticipant[] {
  const byId = agentsById(agents);
  const muted = new Set(state.mutedIds);
  // 阿狸（传进来的 `host`）恒在名单最前：书和长文是打开着的全屏面板，不像画布那样
  // 有��"哪张卡是主人"，所以阿狸就是那个默认在场的人。空房间代表房里只有他。
  const ids = [
    ...(host ? [host.id] : []),
    ...liveIds(state.personaIds, byId).filter((id) => id !== host?.id),
  ];
  const answerer = ids.find((id) => !muted.has(id));
  return ids.map((id) => ({
    nodeId: id,
    name: host && id === host.id ? host.name : resolveAgentLocalizedName(byId.get(id)!),
    isHost: id === answerer,
    muted: muted.has(id),
  }));
}

/** 这一轮由谁答用户的话。全员禁言时返回 null——那就不该发请求。 */
export function surfaceAnswerer(
  state: SurfaceRoomState,
  agents: AgentConfig[],
  host?: AgentConfig | null,
): AgentConfig | null {
  // 阿狸常驻，所以答话的人通常是他；他自己被禁言时才顺位给房里第一个没被禁言的。
  if (host && !state.mutedIds.includes(host.id)) return host;
  return resolveSurfaceSpeakers(state, agents)[0] ?? host ?? null;
}

/** 还没进房间的角色，可以被拉进来。 */
export function listSurfaceLibraryCandidates(
  state: SurfaceRoomState,
  agents: AgentConfig[],
): ChatRoomInviteCandidate[] {
  const inRoom = new Set(state.personaIds);
  return dedupeAgentsForList(agents)
    .filter((agent) => !inRoom.has(agent.id))
    .map((agent) => ({
      id: agent.id,
      agentConfigId: agent.id,
      name: resolveAgentLocalizedName(agent),
      coverUrl: agent.coverImageUrl,
    }));
}

/**
 * 这一轮谁发言。第一个先答用户的话，其余按加入顺序接下去。禁言的直接不在名单里。
 * 返回 `AgentConfig` 而不是 id：发言要的是提示词和采样参数。
 */
export function resolveSurfaceSpeakers(
  state: SurfaceRoomState,
  agents: AgentConfig[],
): AgentConfig[] {
  const byId = agentsById(agents);
  const muted = new Set(state.mutedIds);
  return liveIds(state.personaIds, byId)
    .filter((id) => !muted.has(id))
    .map((id) => byId.get(id)!);
}

/**
 * 房里这一轮该发言的**客人**。
 *
 * 不能 `slice(1)`：那是"首位是主人"的旧模型留下的，而主人（阿狸）根本不在名单里，
 * 切一刀等于把第一个客人砍掉。
 */
export function surfaceGuests(state: SurfaceRoomState, agents: AgentConfig[]): AgentConfig[] {
  return resolveSurfaceSpeakers(state, agents);
}

type SurfaceMessage = {
  role: 'user' | 'assistant';
  text: string;
  speakerAgentId?: string;
  speakerName?: string;
};

/**
 * 给某一位发言人重建历史。别人说的话加名字前缀，自己的原样——不加的话，模型读到
 * 一串同角色的对话分不清哪句是自己上一轮说的。
 *
 * 没有署名的旧回复归主持人：只有内置助手会产出那种消息，把它算到最近加入的嘉宾头上
 * 会凭空造出一段不属于任何人的发言。
 */
export function formatSurfaceHistoryForSpeaker(
  messages: SurfaceMessage[],
  selfAgentId: string,
  prefix: (name: string) => string,
  maxMessages?: number,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const m of messages) {
    const text = m.text.trim();
    if (!text) continue;
    if (m.role === 'user') {
      out.push({ role: 'user', content: text });
      continue;
    }
    const otherVoice = Boolean(m.speakerAgentId) && m.speakerAgentId !== selfAgentId;
    const name = otherVoice ? m.speakerName?.trim() : undefined;
    out.push({ role: 'assistant', content: name ? `${prefix(name)}${text}` : text });
  }
  if (maxMessages && out.length > maxMessages) {
    const tail = out.slice(out.length - maxMessages);
    // 一轮会追加不止一条回复，裁剪点未必落在用户发言上，而 Anthropic / Gemini
    // 都拒绝以 assistant 开头的历史。
    const firstUser = tail.findIndex((m) => m.role === 'user');
    if (firstUser > 0) return tail.slice(firstUser);
    // 一条用户发言都没有（连着讨论了好几轮就是这个形状）：开头那些回复整段丢掉，
    // 留个空历史给随后的 cue。别把 `tail` 原样返回——那会以 assistant 开头。
    return firstUser === -1 ? [] : tail;
  }
  return out;
}

/** 引用上一位发言时最多带多少字：整段历史已经在对话里，这里只是把注意力钉过去。 */
const TURN_CUE_QUOTE_MAX_CHARS = 600;

/**
 * 讨论时的轮次提示，作为 **user 消息**发出去（对话规则留在系统提示词里）。
 *
 * 侧栏房间的顺序是我们自己排的——主持人先答完用户，再依次轮到嘉宾——所以只有两种
 * 情况：没人说过（接用户的问题），或者上一位是别人（回应他）。
 */
export function buildSurfaceTurnCue(opts: {
  messages: SurfaceMessage[];
  /** 没有署名的旧回复都归主持人。 */
  hostNameFallback: string;
  t: TFunction;
}): string {
  const { messages, hostNameFallback, t } = opts;
  let lastUserAt = -1;
  let previousAt = -1;
  messages.forEach((m, i) => {
    if (m.role === 'user') lastUserAt = i;
    else if (m.text.trim()) previousAt = i;
  });
  if (previousAt < 0 || lastUserAt > previousAt) return t('ai.prompts.personaGroupFirstTurn');
  const previous = messages[previousAt]!;
  const quote = previous.text.trim().slice(0, TURN_CUE_QUOTE_MAX_CHARS);
  return t('ai.prompts.personaGroupRespondTurn', {
    name: previous.speakerName?.trim() || hostNameFallback,
    quote,
  });
}

/* ── 名单的三种操作，纯函数，好测 ── */

/** 拉一个角色进房间。满员或已经在房间里就不动。 */
export function addSurfacePersona(
  state: SurfaceRoomState,
  agentId: string,
): SurfaceRoomState {
  if (!agentId || state.personaIds.includes(agentId)) return state;
  if (state.personaIds.length >= SURFACE_ROOM_MAX_GUESTS) return state;
  return readSurfaceRoom([...state.personaIds, agentId], state.mutedIds);
}

/** 移出一个角色，禁言名单里的同 id 也要跟着清，否则 id 留着会复活。 */
export function removeSurfacePersona(
  state: SurfaceRoomState,
  agentId: string,
): SurfaceRoomState {
  return readSurfaceRoom(
    state.personaIds.filter((id) => id !== agentId),
    state.mutedIds.filter((id) => id !== agentId),
  );
}

export function toggleSurfacePersonaMuted(
  state: SurfaceRoomState,
  agentId: string,
): SurfaceRoomState {
  if (!state.personaIds.includes(agentId)) return state;
  const muted = new Set(state.mutedIds);
  if (muted.has(agentId)) muted.delete(agentId);
  else muted.add(agentId);
  return { personaIds: [...state.personaIds], mutedIds: [...muted] };
}

/** 房间里除了主持人还有没有能说话的人。全员禁言时不该再发请求。 */
export function hasSurfaceGuestVoices(state: SurfaceRoomState, agents: AgentConfig[]): boolean {
  return surfaceGuests(state, agents).length > 0;
}
