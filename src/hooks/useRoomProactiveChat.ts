import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AIConfig } from '../components/AISettingsModal';
import { db } from '../db';
import type { AgentConfig, CanvasNode, CanvasWorkZone } from '../db';
import { useAppDialog } from '../components/AppDialogProvider';
import { runRoomProactivePass } from '../services/roomProactivePass';
import {
  buildAgentSystemInstruction,
  combineSystemParts,
  getLocaleDirective,
} from '../utils/aiI18n';
import { spoorLlmSessionId } from '../utils/openRouterPromptCache';
import {
  buildWorkZoneContextText,
  collectWorkZoneContextPayload,
  collectWorkZoneNodeIds,
  isPersonaAnchorNode,
  personaThreadId,
} from '../utils/agentWorkZone';
import { getCanvasNodeContextText } from '../utils/canvasNodeContextText';
import { isAutoAnnotationEnabled, setAutoAnnotationEnabled } from '../utils/autoAnnotation';
import { useAutoAnnotation } from './useAutoAnnotation';
import {
  computeRoomSignature,
  planRoomProactivePass,
  type RoomProactiveStats,
} from '../utils/roomProactive';

/**
 * 内容变了先不动手，等房间安静下来。
 *
 * 8 秒不是把书籍那边的 1.5 秒改大来的。1.5 秒是"读者停下"这个**信号**——
 * 翻页动作本身就意味着到了该读的地方。画布上没有这个信号：用户还在拖卡片、
 * 还在便签里打字、还在改布局，这些都让房间变了。给短了会变成打断，
 * 给长了就不叫主动。
 */
export const PROACTIVE_IDLE_DELAY_MS = 8000;

/** 一次失败之后冷却多久再试。不写指纹是有意的（这一趟还没算数），但不能一直重试。 */
const PROACTIVE_FAILURE_COOLDOWN_MS = 60_000;

/** 两条主动消息之间隔多久，让它们看起来是两句，不是一坨。 */
const PROACTIVE_MESSAGE_STAGGER_MS = 900;

export type ProactivePhase = 'pending' | 'thinking';

export type ProactiveStatus = {
  phase: ProactivePhase;
  cardCount: number;
};

type Candidate = {
  personaNodeId: string;
  signature: string;
  cardCount: number;
};

/**
 * 房间主动发言的触发生命周期。
 *
 * 和书籍/长文标注是同一个骨架（延迟 + 单调 token + 持久指纹 + 发起前快照、
 * 回来后复读），只是把"多久算安静"换成了画布版的 8 秒。
 */
export function useRoomProactiveChat({
  canvasId,
  nodes,
  zones,
  agentConfigs,
  aiConfig,
  nodesRef,
  markProactiveBusy,
  idleDelayMs = PROACTIVE_IDLE_DELAY_MS,
}: {
  canvasId: string | null;
  nodes: CanvasNode[];
  zones: CanvasWorkZone[];
  agentConfigs: AgentConfig[];
  aiConfig: AIConfig | null;
  /** 读卡片正文用。DOM 优先，回落到 `content`。 */
  nodesRef: React.RefObject<Record<string, HTMLElement | null>>;
  /** 和 `sendPersonaMessage` 共用同一把锁的桥。 */
  markProactiveBusy: (personaNodeId: string, busy: boolean) => void;
  /** 只有测试会覆盖：真等 8 秒会让生命周期测试慢到没法跑。 */
  idleDelayMs?: number;
}) {
  const { t } = useTranslation();
  const { alert: appAlert } = useAppDialog();
  const [statusById, setStatusById] = useState<Record<string, ProactiveStatus>>({});
  /** 全局开关。任何一处关掉，所有房间的候选立刻清空、计时器全部作废。 */
  const [roomProactiveOn, setRoomProactiveOn] = useAutoAnnotation('room');

  /** 单调 token。取消、以及"期间出了别的事"，都靠比对它作废整趟。 */
  const runRef = useRef(0);
  const busyRef = useRef<Set<string>>(new Set());
  const failureAtRef = useRef<Map<string, number>>(new Map());

  // 一次跑一趟需要的东西。全部放进一个 ref，`runPass` 才能是稳定的 useCallback。
  // 这不是洁癖：`t` 和 `appAlert` 每次渲染都是新函数，`runPass` 一跟着它们变，
  // 下面那个建计时器的 effect 就每次渲染都重跑一遍，计时器被永远清掉重建。
  const envRef = useRef({
    canvasId,
    nodes,
    zones,
    agentConfigs,
    aiConfig,
    nodesRef,
    t,
    appAlert,
  });
  envRef.current = { canvasId, nodes, zones, agentConfigs, aiConfig, nodesRef, t, appAlert };

  const setStatus = useCallback((personaNodeId: string, status: ProactiveStatus | null) => {
    setStatusById((prev) => {
      const current = prev[personaNodeId];
      // 值没变就还旧对象：这个函数会在每次候选重算时被调一次，
      // 无脑写新对象会让 effect 自己把自己再触发一轮。
      if (!status) {
        if (!current) return prev;
        const next = { ...prev };
        delete next[personaNodeId];
        return next;
      }
      if (current && current.phase === status.phase && current.cardCount === status.cardCount) {
        return prev;
      }
      return { ...prev, [personaNodeId]: status };
    });
  }, []);

  const runPass = useCallback(
    async (personaNodeId: string) => {
      const env = envRef.current;
      const {
        canvasId: cid,
        nodes: liveNodes,
        zones: liveZones,
        agentConfigs: liveAgents,
        aiConfig: config,
        nodesRef: domRef,
        t: tr,
        appAlert: alert,
      } = env;
      if (!cid || !config) return;
      if (busyRef.current.has(personaNodeId)) return;

      const personaNode = liveNodes.find((n) => n.id === personaNodeId && isPersonaAnchorNode(n));
      if (!personaNode || !isAutoAnnotationEnabled('room')) return;

      const failedAt = failureAtRef.current.get(personaNodeId) ?? 0;
      if (failedAt && Date.now() - failedAt < PROACTIVE_FAILURE_COOLDOWN_MS) return;

      const roomIds = collectWorkZoneNodeIds(personaNodeId, liveNodes);
      const signature = computeRoomSignature(roomIds, liveNodes);
      if (personaNode.proactiveLastSignature === signature) return;

      const body = readBodyFrom(domRef, liveNodes);
      const payload = collectWorkZoneContextPayload(personaNodeId, liveNodes);
      const roomText = buildWorkZoneContextText(payload, tr, body);
      const stats = measureRoom(roomIds, liveNodes, body);

      const token = ++runRef.current;
      busyRef.current.add(personaNodeId);
      markProactiveBusy(personaNodeId, true);

      // 内容不够开口的：直接把指纹记下（不调模型），不然同一个空房间会每 8 秒
      // 醒一次、再睡一次，永远等下去。
      const plan = planRoomProactivePass(stats);
      if (!plan) {
        await persistSignature(personaNodeId, signature);
        busyRef.current.delete(personaNodeId);
        markProactiveBusy(personaNodeId, false);
        return;
      }

      const threadId = personaThreadId(cid, personaNodeId);
      const threadBefore = await ensureThread(threadId, cid, personaNodeId);
      const messagesAtStart = threadBefore.messages.length;

      setStatus(personaNodeId, { phase: 'thinking', cardCount: roomIds.length });

      try {
        const raw = await runRoomProactivePass({
          config,
          systemInstruction: buildProactiveSystem(personaNode, liveAgents, tr, plan.maxMessages),
          userPrompt: tr('ai.prompts.roomProactiveUser', {
            roomText,
            maxMessages: plan.maxMessages,
          }),
          maxMessages: plan.maxMessages,
          sessionId: spoorLlmSessionId('room-proactive', personaNodeId),
        });

        // 作废的两趟**不能**记成"读过了"（书籍那边的教训）。
        if (runRef.current !== token) return;
        // 期间用户自己说了话：他刚问过，角色不用再自作主张。
        const after = await db.canvasPersonaThreads.get(threadId);
        if ((after?.messages.length ?? 0) !== messagesAtStart) return;
        if (!isAutoAnnotationEnabled('room')) return;

        // 指纹**无论模型说不说都要写**：说过了当然要写，沉默了更要写，
        // 否则同一份内容会被一次又一次送去问模型。
        await persistSignature(personaNodeId, signature);

        for (const [index, text] of raw.messages.entries()) {
          if (index > 0) {
            await sleep(PROACTIVE_MESSAGE_STAGGER_MS);
            if (runRef.current !== token) return;
          }
          const row = await db.canvasPersonaThreads.get(threadId);
          if (!row) return;
          await db.canvasPersonaThreads.put({
            ...row,
            messages: [
              ...row.messages,
              {
                id: crypto.randomUUID(),
                role: 'assistant' as const,
                text,
                createdAt: Date.now(),
                // 主动说的话和用户发言在气泡上没有任何区别——这是有意的：
                // 它就是这间房里的一次正常发言。
              },
            ],
            updatedAt: Date.now(),
          });
        }
      } catch (err) {
        failureAtRef.current.set(personaNodeId, Date.now());
        console.error('[Spoor] 房间主动发言失败', err);
        alert({
          message: tr('canvas.v2.proactive_failed', {
            reason: err instanceof Error ? err.message : String(err),
          }),
        });
      } finally {
        if (runRef.current === token) {
          busyRef.current.delete(personaNodeId);
          markProactiveBusy(personaNodeId, false);
          setStatus(personaNodeId, null);
        }
      }
    },
    [markProactiveBusy, setStatus],
  );

  /**
   * 该不该为这个房间起一次定时器：角色卡还开着，而且内容确实变了。
   *
   * 这里**不算**条数预算——预算要按真实正文算，那要读 DOM，在 useMemo 里做
   * 既贵又不准；等真要跑的时候再判（见 `runPass`），不够就不调模型直接记账。
   */
  const candidates = useMemo<Candidate[]>(() => {
    if (!canvasId || !aiConfig) return [];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const out: Candidate[] = [];
    for (const zone of zones) {
      const personaNodeId = zone.personaNodeId;
      if (!personaNodeId) continue;
      const persona = byId.get(personaNodeId);
      if (!persona || !isPersonaAnchorNode(persona)) continue;
      if (!roomProactiveOn) continue;
      const roomIds = collectWorkZoneNodeIds(personaNodeId, nodes);
      const signature = computeRoomSignature(roomIds, nodes);
      if (persona.proactiveLastSignature === signature) continue;
      out.push({ personaNodeId, signature, cardCount: roomIds.length });
    }
    return out;
  }, [aiConfig, canvasId, nodes, roomProactiveOn, zones]);

  useEffect(() => {
    const timers: number[] = [];
    for (const candidate of candidates) {
      if (busyRef.current.has(candidate.personaNodeId)) continue;
      setStatus(candidate.personaNodeId, {
        phase: 'pending',
        cardCount: candidate.cardCount,
      });
      timers.push(
        window.setTimeout(() => {
          void runPass(candidate.personaNodeId);
        }, idleDelayMs),
      );
    }
    return () => {
      for (const id of timers) window.clearTimeout(id);
    };
    // setStatus 是稳定 useCallback；只跟着候选走，不然它自己会不停重置计时器。
  }, [candidates, idleDelayMs, runPass, setStatus]);

  const isProactiveEnabled = useCallback(() => isAutoAnnotationEnabled('room'), []);

  /**
   * 全局开关。关掉 = 所有房间都不再自己开口，重新打开才能恢复。
   *
   * 中途关掉时会把在途的那些趟全作废：token 加一，它们回来后发现对不上就自己丢掉，
   * 什么都不会写。`callUniversalAI` 不接受 signal，这是唯一能做的取消。
   *
   * 开关是全局的，所以这里清的是**所有**房间的在途状态，不是按钮所在那一个。
   *
   * 指纹的清空放在"打开"这一侧：上一次读的是上一次的内容，不抹的话每个房间都要等
   * 下一次改动才会醒，等同于没打开。
   */
  const setProactiveEnabled = useCallback(
    async (_personaNodeId: string, enabled: boolean) => {
      runRef.current += 1;
      for (const id of [...busyRef.current]) {
        busyRef.current.delete(id);
        markProactiveBusy(id, false);
        setStatus(id, null);
      }
      failureAtRef.current.clear();
      setAutoAnnotationEnabled('room', enabled);
      if (!enabled) return;
      await db.nodes.toCollection().modify({ proactiveLastSignature: undefined });
    },
    [markProactiveBusy, setStatus],
  );

  return { statusById, isProactiveEnabled, setProactiveEnabled };
}

function readBodyFrom(
  nodesRef: React.RefObject<Record<string, HTMLElement | null>>,
  liveNodes: CanvasNode[],
) {
  return (id: string): string => {
    const el = nodesRef.current?.[id];
    if (el) return getCanvasNodeContextText(el);
    return (liveNodes.find((n) => n.id === id)?.content ?? '').trim();
  };
}

function measureRoom(
  roomIds: string[],
  liveNodes: CanvasNode[],
  body: (id: string) => string,
): RoomProactiveStats {
  let totalChars = 0;
  let imageCount = 0;
  for (const id of roomIds) {
    const node = liveNodes.find((n) => n.id === id);
    if (!node) continue;
    if (node.type === 'image') {
      imageCount += 1;
      // 图上的文字是 OCR 结果或用户写的一句说明，它们同样算材料。
      totalChars += (node.ocrText ?? '').length + (node.description ?? '').length;
      continue;
    }
    totalChars += body(id).length;
  }
  return { cardCount: roomIds.length, totalChars, imageCount };
}

function buildProactiveSystem(
  personaNode: CanvasNode,
  agentConfigs: AgentConfig[],
  t: (key: string, opts?: Record<string, unknown>) => string,
  maxMessages: number,
): string {
  const contract = t('ai.prompts.roomProactiveSystem', { maxMessages });
  const agent =
    personaNode.type === 'agent' && personaNode.agentConfigId
      ? agentConfigs.find((a) => a.id === personaNode.agentConfigId)
      : undefined;
  if (agent) {
    return buildAgentSystemInstruction(agent, { extraParts: [contract] });
  }
  return combineSystemParts(
    getLocaleDirective(),
    t('ai.prompts.askCharacterIdentity', { name: t('ask.character_name') }),
    contract,
  );
}

async function persistSignature(personaNodeId: string, signature: string) {
  const node = await db.nodes.get(personaNodeId);
  if (!node) return;
  await db.nodes.update(personaNodeId, { proactiveLastSignature: signature });
}

async function ensureThread(
  threadId: string,
  canvasId: string,
  agentNodeId: string,
) {
  const existing = await db.canvasPersonaThreads.get(threadId);
  if (existing) return existing;
  const fresh: import('../db').CanvasPersonaThread = {
    id: threadId,
    canvasId,
    agentNodeId,
    messages: [],
    updatedAt: Date.now(),
  };
  await db.canvasPersonaThreads.put(fresh);
  return fresh;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}
