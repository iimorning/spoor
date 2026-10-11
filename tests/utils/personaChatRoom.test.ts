import { beforeAll, describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import i18n from '../../src/i18n';
import type { AgentConfig, CanvasChatMessage, CanvasNode } from '../../src/db';
import {
  DEFAULT_ROOM_DISCUSSION_ROUNDS,
  PANEL_ROOM_MAX_PARTICIPANTS,
  ROOM_DISCUSSION_ROUNDS_MAX,
  buildRoomGuestIndex,
  buildRoomLabelText,
  buildRoomParticipants,
  buildRoomTurnCue,
  clampRoomDiscussionRounds,
  formatRoomHistoryForSpeaker,
  listRoomInviteCandidates,
  listRoomLibraryCandidates,
  personaNodeDisplayName,
  personaVoiceIdForMessage,
  personaVoiceIdForNode,
  pruneRoomRoster,
  resolveRoomSpeakers,
  roomMessageSpeaker,
  sanitizeRoomRoster,
  toggleRoomId,
} from '../../src/utils/personaChatRoom';

function node(
  partial: Partial<CanvasNode> & Pick<CanvasNode, 'id' | 'type' | 'x' | 'y'>,
): CanvasNode {
  return { content: '', width: 320, height: 200, ...partial };
}

function agent(id: string, agentConfigId?: string): CanvasNode {
  return node({ id, type: 'agent', x: 0, y: 0, agentConfigId: agentConfigId ?? `cfg-${id}` });
}

function ask(id: string): CanvasNode {
  return node({ id, type: 'ask', x: 0, y: 0 });
}

function note(id: string): CanvasNode {
  return node({ id, type: 'text', x: 0, y: 0, content: '正文' });
}

function config(id: string, name: string): AgentConfig {
  return { id, name } as AgentConfig;
}

function msg(partial: Partial<CanvasChatMessage> & Pick<CanvasChatMessage, 'id' | 'role'>): CanvasChatMessage {
  return { text: '', createdAt: 0, ...partial };
}

const FALLBACK = '角色';

describe('personaChatRoom', () => {
  // cue 的测试用真实 i18n：它测的是真实提示词，不是桩
  beforeAll(async () => {
    await i18n.changeLanguage('zh');
  });

  describe('sanitizeRoomRoster', () => {
    it('keeps live personas in order and drops the host and duplicates', () => {
      const nodes = [agent('host'), agent('b'), agent('c'), note('n1')];
      expect(
        sanitizeRoomRoster('host', ['b', 'host', 'b', 'n1', 'c'], [], nodes),
      ).toEqual({ participantNodeIds: ['b', 'c'], mutedNodeIds: [] });
    });

    it('drops ids whose card was deleted', () => {
      const nodes = [agent('host'), agent('b')];
      expect(sanitizeRoomRoster('host', ['gone', 'b'], [], nodes).participantNodeIds).toEqual(['b']);
    });

    it('caps participants and prunes mute ids that are no longer in the room', () => {
      const nodes = [agent('host'), agent('b'), agent('c'), agent('d'), agent('e')];
      const roster = sanitizeRoomRoster(
        'host',
        ['b', 'c', 'd', 'e'],
        ['d', 'e'],
        nodes,
      );
      expect(roster.participantNodeIds).toHaveLength(PANEL_ROOM_MAX_PARTICIPANTS);
      expect(roster.participantNodeIds).toEqual(['b', 'c', 'd']);
      expect(roster.mutedNodeIds).toEqual(['d']);
    });

    it('treats a missing roster as an empty single-persona room', () => {
      expect(sanitizeRoomRoster('host', undefined, undefined, [agent('host')])).toEqual({
        participantNodeIds: [],
        mutedNodeIds: [],
      });
    });

    it('keeps the host id in the mute list even though it is not a participant', () => {
      const nodes = [agent('host'), agent('b')];
      expect(
        sanitizeRoomRoster('host', ['b'], ['host'], nodes).mutedNodeIds,
      ).toEqual(['host']);
      expect(
        sanitizeRoomRoster('host', ['b'], ['host', 'b'], nodes).mutedNodeIds,
      ).toEqual(['host', 'b']);
    });

    it('drops an unrelated id from the mute list', () => {
      expect(
        sanitizeRoomRoster('host', ['b'], ['ghost'], [agent('host'), agent('b')]).mutedNodeIds,
      ).toEqual([]);
    });
  });

  describe('resolveRoomSpeakers', () => {
    it('puts the host first, then unmuted participants in join order', () => {
      const nodes = [agent('host'), agent('b'), agent('c'), agent('d')];
      expect(resolveRoomSpeakers('host', ['b', 'c', 'd'], ['c'], nodes)).toEqual([
        'host',
        'b',
        'd',
      ]);
    });

    it('is just the host in a single-persona room', () => {
      expect(resolveRoomSpeakers('host', [], [], [agent('host')])).toEqual(['host']);
    });

    it('skips participants whose card is gone', () => {
      expect(resolveRoomSpeakers('host', ['b', 'gone'], [], [agent('host'), agent('b')])).toEqual([
        'host',
        'b',
      ]);
    });

    it('drops the host when it is muted, so the participants answer alone', () => {
      const nodes = [agent('host'), agent('b'), agent('c')];
      expect(resolveRoomSpeakers('host', ['b', 'c'], ['host'], nodes)).toEqual(['b', 'c']);
      expect(resolveRoomSpeakers('host', ['b', 'c'], ['host', 'b'], nodes)).toEqual(['c']);
    });

    it('is empty when everyone is muted', () => {
      expect(
        resolveRoomSpeakers('host', ['b'], ['host', 'b'], [agent('host'), agent('b')]),
      ).toEqual([]);
    });
  });

  describe('buildRoomParticipants', () => {
    it('labels the host and marks muted peers', () => {
      const nodes = [agent('host'), agent('b'), ask('fox')];
      const rows = buildRoomParticipants(
        nodes[0]!,
        ['b', 'fox'],
        ['b'],
        nodes,
        [config('cfg-host', '真知镜'), config('cfg-b', '镜子')],
        '阿狸',
        FALLBACK,
      );
      expect(rows.map((r) => [r.name, r.isHost, r.muted])).toEqual([
        ['真知镜', true, false],
        ['镜子', false, true],
        ['阿狸', false, false],
      ]);
    });

    it('marks the host as muted when it is in the mute list', () => {
      const nodes = [agent('host'), agent('b')];
      const rows = buildRoomParticipants(
        nodes[0]!,
        ['b'],
        ['host'],
        nodes,
        [config('cfg-host', '真知镜'), config('cfg-b', '镜子')],
        '阿狸',
        FALLBACK,
      );
      expect(rows.map((r) => [r.name, r.isHost, r.muted])).toEqual([
        ['真知镜', true, true],
        ['镜子', false, false],
      ]);
    });

    it('falls back when the agent config is missing', () => {
      const nodes = [agent('host'), agent('b')];
      expect(
        personaNodeDisplayName(nodes[1]!, [], '阿狸', FALLBACK),
      ).toBe(FALLBACK);
    });
  });

  describe('listRoomInviteCandidates', () => {
    it('offers other personas on the canvas, skipping the host, current peers, notes and unbound agents', () => {
      const nodes = [
        agent('host'),
        agent('b'),
        ask('fox'),
        note('n1'),
        node({ id: 'unbound', type: 'agent', x: 0, y: 0 }),
      ];
      expect(listRoomInviteCandidates('host', ['b'], nodes).map((n) => n.id)).toEqual(['fox']);
    });

    it('offers a persona once even when the canvas holds two cards for it', () => {
      const nodes = [agent('host'), agent('b', 'cfg-b'), agent('b2', 'cfg-b'), ask('fox1'), ask('fox2')];
      expect(listRoomInviteCandidates('host', [], nodes).map((n) => n.id)).toEqual(['b', 'fox1']);
    });
  });

  describe('listRoomLibraryCandidates', () => {
    it('offers library personas whose card is not on this canvas yet', () => {
      const nodes = [agent('host'), ask('fox')];
      const configs = [config('cfg-host', '真知镜'), config('cfg-new', '织工')];
      expect(listRoomLibraryCandidates(configs, nodes).map((a) => a.id)).toEqual(['cfg-new']);
    });

    it('still offers a persona that lives only on another canvas', () => {
      expect(listRoomLibraryCandidates([config('cfg-a', 'A')], []).map((a) => a.id)).toEqual([
        'cfg-a',
      ]);
    });

    it('collapses duplicate rows for the same persona', () => {
      const rows = [
        { ...config('cfg-1', 'A'), communityPersonaKey: 'dup' } as AgentConfig,
        { ...config('cfg-2', 'A'), communityPersonaKey: 'dup' } as AgentConfig,
      ];
      expect(listRoomLibraryCandidates(rows, [])).toHaveLength(1);
    });
  });

  describe('buildRoomGuestIndex', () => {
    it('maps each host persona to the personas sitting in its room', () => {
      const index = buildRoomGuestIndex([
        { agentNodeId: 'host-a', participantNodeIds: ['b', 'c'] },
        { agentNodeId: 'host-d', participantNodeIds: [] },
        { agentNodeId: 'host-e', participantNodeIds: ['f'] },
      ]);
      expect([...index.keys()].sort()).toEqual(['host-a', 'host-e']);
      expect(index.get('host-a')?.has('b')).toBe(true);
      expect(index.get('host-a')?.has('z')).toBe(false);
      expect(index.get('host-d')).toBeUndefined();
    });

    it('tolerates a thread that never had a roster', () => {
      expect(buildRoomGuestIndex(undefined).size).toBe(0);
      expect(buildRoomGuestIndex([{ agentNodeId: 'host-a' }]).size).toBe(0);
    });
  });

  describe('pruneRoomRoster', () => {
    const host = agent('host');
    const guests = [agent('b'), agent('c')];

    it('drops ids whose card was deleted', () => {
      expect(
        pruneRoomRoster(
          { participantNodeIds: ['b', 'ghost'], mutedNodeIds: ['ghost', 'b'] },
          [host, ...guests],
        ),
      ).toEqual({ participantNodeIds: ['b'], mutedNodeIds: ['b'] });
    });

    it('keeps a card that was just spawned and is not in the query result yet', () => {
      expect(
        pruneRoomRoster({ participantNodeIds: ['fresh'], mutedNodeIds: [] }, [host], ['fresh']),
      ).toEqual({ participantNodeIds: ['fresh'], mutedNodeIds: [] });
    });

    it('frees the cap so a new member still joins past a deleted guest', () => {
      // 删掉的角色卡会在库里留下残留 id，界面看不见它们，但它们曾经占满上限，
      // 导致新加入的角色被 slice 静默丢掉。
      const fresh = agent('e');
      const pruned = pruneRoomRoster(
        { participantNodeIds: ['b', 'ghost1', 'ghost2'], mutedNodeIds: [] },
        [host, ...guests, fresh],
      );
      expect(pruned.participantNodeIds).toEqual(['b']);
      const next = [...pruned.participantNodeIds, 'e'].slice(0, PANEL_ROOM_MAX_PARTICIPANTS);
      expect(next).toEqual(['b', 'e']);
    });
  });

  describe('buildRoomLabelText', () => {
    const t = ((key: string, vars?: Record<string, unknown>) => {
      const templates: Record<string, string> = {
        'canvas.v2.work_zone_room': '{{name}}的房间',
        'canvas.v2.work_zone_room_with_guests': '{{name}}的房间 · {{guests}}',
        'canvas.v2.room_guest_separator': '、',
      };
      return (templates[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, k: string) =>
        String(vars?.[k] ?? ''),
      );
    }) as unknown as TFunction;

    const host = node({ id: 'host', type: 'ask', x: 0, y: 0 });
    const guest = agent('b', 'cfg-b');
    const label = (guestNodeIds: string[], nodes: CanvasNode[], configs = [config('cfg-b', '真知镜')]) =>
      buildRoomLabelText({
        hostNode: host,
        guestNodeIds,
        nodes,
        agentConfigs: configs,
        askName: '阿狸',
        fallbackName: '角色',
        t,
      });

    it('is just the host room when nobody joined', () => {
      expect(label([], [host, guest])).toBe('阿狸的房间');
    });

    it('lists the guests in the label', () => {
      expect(label(['b'], [host, guest])).toBe('阿狸的房间 · 真知镜');
    });

    it('joins several guests with the locale separator', () => {
      const second = agent('c', 'cfg-c');
      expect(
        label(['b', 'c'], [host, guest, second], [
          config('cfg-b', '真知镜'),
          config('cfg-c', '编织者'),
        ]),
      ).toBe('阿狸的房间 · 真知镜、编织者');
    });

    it('skips a guest whose card is gone or is not a persona', () => {
      const note = node({ id: 'note', type: 'text', x: 0, y: 0 });
      expect(label(['gone', 'note'], [host, guest, note])).toBe('阿狸的房间');
      expect(label(['gone', 'b', 'note'], [host, guest, note])).toBe('阿狸的房间 · 真知镜');
    });
  });

  describe('buildRoomTurnCue', () => {
    const t = ((key: string, opts?: Record<string, unknown>) =>
      i18n.t(key, opts)) as unknown as TFunction;
    const cue = (
      speakerNodeId: string,
      messages: CanvasChatMessage[],
      hostNameFallback = '真知镜',
    ) => buildRoomTurnCue({ speakerNodeId, messages, hostNameFallback, t });

    it('asks the first speaker for a judgement, not a response', () => {
      const text = cue('host', []);
      expect(text).toContain('第一个发言');
      expect(text).toContain('最重要的一条理由');
    });

    it('names the previous speaker and quotes what they said', () => {
      const text = cue('b', [
        msg({ id: 'm1', role: 'user', text: '你们怎么看' }),
        msg({
          id: 'm2', role: 'assistant', text: '最大的问题是成本',
          speakerNodeId: 'host', speakerName: '真知镜',
        }),
      ]);
      expect(text).toContain('上一位发言者：真知镜');
      expect(text).toContain('「最大的问题是成本」');
      // 明确要求回应而不是复述
      expect(text).toContain('不要把他的原话复述回去');
    });

    it('tells the only remaining voice to keep going rather than repeat itself', () => {
      const text = cue('host', [
        msg({
          id: 'm2', role: 'assistant', text: '我接着说',
          speakerNodeId: 'host', speakerName: '真知镜',
        }),
      ]);
      expect(text).toContain('又轮到你了');
      expect(text).toContain('不要重复已经说过的内容');
    });

    it('同一个人连着两轮时，不再谎报"房间里只有他在发言"（房间里可能有别人没接话）', () => {
      const text = cue('host', [
        msg({
          id: 'm2', role: 'assistant', text: '我接着说',
          speakerNodeId: 'host', speakerName: '真知镜',
        }),
      ]);
      // 触发条件只看"上句是不是我说的"，跟房间里有几个人无关，所以不能断言房间里只有他
      expect(text).not.toContain('只有你在发言');
      expect(text).toContain('中间没有别人接话');
    });

    it('sends a speaker back to the user question when it is newer than the last reply', () => {
      // 主角色被禁言时就是这样：上一轮没有回复，用户接着问了下一句。
      // 这时不能对他说"接着你自己刚才说的往下讲"。
      const text = cue('b', [
        msg({ id: 'm1', role: 'assistant', text: '我先说的', speakerNodeId: 'b', speakerName: '海龟' }),
        msg({ id: 'u2', role: 'user', text: '那这个呢？' }),
      ]);
      expect(text).toContain('针对用户的问题');
      expect(text).not.toContain('又轮到你了');
    });

    it('skips empty replies when looking for the previous point', () => {
      const text = cue('b', [
        msg({ id: 'm1', role: 'assistant', text: '   ', speakerNodeId: 'host' }),
      ]);
      expect(text).toContain('第一个发言');
    });

    it('falls back to the host name for an unsigned legacy reply', () => {
      const text = cue('b', [msg({ id: 'm1', role: 'assistant', text: '加进讨论前的老回复' })]);
      expect(text).toContain('上一位发言者：真知镜');
    });

    it('caps how much of a long previous reply it quotes', () => {
      const text = cue('b', [
        msg({
          id: 'm1', role: 'assistant', text: 'x'.repeat(2000),
          speakerNodeId: 'host', speakerName: '真知镜',
        }),
      ]);
      expect(text).not.toContain('x'.repeat(601));
      expect(text).toContain('x'.repeat(600));
    });
  });

  describe('clampRoomDiscussionRounds', () => {
    it('defaults when the room never chose a number', () => {
      expect(clampRoomDiscussionRounds(undefined)).toBe(DEFAULT_ROOM_DISCUSSION_ROUNDS);
      expect(clampRoomDiscussionRounds(Number.NaN)).toBe(DEFAULT_ROOM_DISCUSSION_ROUNDS);
    });

    it('keeps a sensible number inside the range', () => {
      expect(clampRoomDiscussionRounds(1)).toBe(1);
      expect(clampRoomDiscussionRounds(3)).toBe(3);
    });

    it('clamps both ends', () => {
      expect(clampRoomDiscussionRounds(0)).toBe(1);
      expect(clampRoomDiscussionRounds(-4)).toBe(1);
      expect(clampRoomDiscussionRounds(99)).toBe(ROOM_DISCUSSION_ROUNDS_MAX);
    });
  });

  describe('toggleRoomId', () => {
    it('adds then removes', () => {
      expect(toggleRoomId([], 'b')).toEqual(['b']);
      expect(toggleRoomId(['b'], 'b')).toEqual([]);
    });
  });

  describe('formatRoomHistoryForSpeaker', () => {
    const messages = [
      msg({ id: 'm1', role: 'user', text: '你们怎么看' }),
      msg({ id: 'm2', role: 'assistant', text: '我先说', speakerNodeId: 'host', speakerName: '镜子' }),
      msg({ id: 'm3', role: 'assistant', text: '我不同意', speakerNodeId: 'b', speakerName: '海龟' }),
      msg({ id: 'm4', role: 'assistant', text: '   ' }),
    ];

    it('prefixes other speakers and leaves your own turns bare', () => {
      expect(
        formatRoomHistoryForSpeaker(messages, 'b', (name) => `${name}：`),
      ).toEqual([
        { role: 'user', content: '你们怎么看' },
        { role: 'assistant', content: '镜子：我先说' },
        { role: 'assistant', content: '我不同意' },
      ]);
    });

    it('leaves single-persona history untouched', () => {
      const solo = [messages[0]!, msg({ id: 'm5', role: 'assistant', text: '好' })];
      expect(formatRoomHistoryForSpeaker(solo, 'host', (name) => `${name}：`)).toEqual([
        { role: 'user', content: '你们怎么看' },
        { role: 'assistant', content: '好' },
      ]);
    });

    it('keeps only the tail when a cap is given', () => {
      expect(formatRoomHistoryForSpeaker(messages, 'host', (n) => `${n}：`, 2)).toEqual([
        { role: 'assistant', content: '我先说' },
        { role: 'assistant', content: '海龟：我不同意' },
      ]);
    });

    it('never lets a trimmed room window start with an assistant turn', () => {
      // 房间里一轮追加 3 条（用户 + 主 Agent + 参与者），裁剪点会落在回复上。
      const roomy: CanvasChatMessage[] = [];
      for (let turn = 0; turn < 15; turn++) {
        roomy.push(msg({ id: `u${turn}`, role: 'user', text: `问 ${turn}` }));
        roomy.push(
          msg({
            id: `h${turn}`,
            role: 'assistant',
            text: `主 ${turn}`,
            speakerNodeId: 'host',
            speakerName: '镜子',
          }),
        );
        roomy.push(
          msg({
            id: `p${turn}`,
            role: 'assistant',
            text: `客 ${turn}`,
            speakerNodeId: 'b',
            speakerName: '海龟',
          }),
        );
      }
      for (const speaker of ['host', 'b'] as const) {
        const trimmed = formatRoomHistoryForSpeaker(roomy, speaker, (n) => `${n}：`, 40);
        expect(trimmed.length).toBeLessThanOrEqual(40);
        expect(trimmed[0]!.role).toBe('user');
      }
    });

    it('attributes unsigned legacy replies to the host when building a peer view', () => {
      const legacy = [
        msg({ id: 'l1', role: 'user', text: '先问你一个' }),
        msg({ id: 'l2', role: 'assistant', text: '我说过这句话' }),
      ];
      // 主 Agent 看自己的历史：不给自己加前缀
      expect(formatRoomHistoryForSpeaker(legacy, 'host', (n) => `${n}：`)).toEqual([
        { role: 'user', content: '先问你一个' },
        { role: 'assistant', content: '我说过这句话' },
      ]);
      // 参与者看同一段历史：那些老回复是主 Agent 说的
      expect(formatRoomHistoryForSpeaker(legacy, 'b', (n) => `${n}：`, undefined, '镜子')).toEqual([
        { role: 'user', content: '先问你一个' },
        { role: 'assistant', content: '镜子：我说过这句话' },
      ]);
    });
  });

  describe('roomMessageSpeaker', () => {
    it('signs replies only once someone else is in the room', () => {
      expect(roomMessageSpeaker(false, 'host', '镜子')).toEqual({});
      expect(roomMessageSpeaker(true, 'host', '镜子')).toEqual({
        speakerNodeId: 'host',
        speakerName: '镜子',
      });
    });
  });

  describe('personaVoiceIdForNode', () => {
    const nodes = [agent('a1', 'cfg-a1'), ask('ask1')];
    const agents: AgentConfig[] = [
      { id: 'cfg-a1', name: '镜子', voiceId: 'female-yujie' } as AgentConfig,
    ];

    it('角色卡返回自己配的音色；阿狸问卡 / 找不到的卡 / 空 id 交给全局', () => {
      expect(personaVoiceIdForNode('a1', nodes, agents)).toBe('female-yujie');
      expect(personaVoiceIdForNode('ask1', nodes, agents)).toBeUndefined();
      expect(personaVoiceIdForNode('gone', nodes, agents)).toBeUndefined();
      expect(personaVoiceIdForNode(null, nodes, agents)).toBeUndefined();
      expect(personaVoiceIdForNode(undefined, nodes, agents)).toBeUndefined();
    });
  });

  describe('personaVoiceIdForMessage', () => {
    const messages: CanvasChatMessage[] = [
      { id: 'm1', role: 'user', text: '你们怎么看', createdAt: 1 },
      {
        id: 'm2',
        role: 'assistant',
        text: '我先说',
        createdAt: 2,
        speakerNodeId: 'a1',
        speakerName: '镜子',
      },
    ];
    const nodes = [agent('a1', 'cfg-a1'), agent('b1', 'cfg-b1')];

    it('取发言角色自己的音色', () => {
      const agents: AgentConfig[] = [
        { id: 'cfg-a1', name: '镜子', voiceId: 'female-yujie' } as AgentConfig,
      ];
      expect(personaVoiceIdForMessage(messages, 'm2', nodes, agents)).toBe('female-yujie');
    });

    it('没配音色的角色返回 undefined，交给全局设置', () => {
      const agents: AgentConfig[] = [{ id: 'cfg-a1', name: '镜子' } as AgentConfig];
      expect(personaVoiceIdForMessage(messages, 'm2', nodes, agents)).toBeUndefined();
    });

    it('空字符串与找不到的发言人都不算音色', () => {
      const agents: AgentConfig[] = [
        { id: 'cfg-a1', name: '镜子', voiceId: '   ' } as AgentConfig,
      ];
      expect(personaVoiceIdForMessage(messages, 'm2', nodes, agents)).toBeUndefined();
      // 单人对话的老消息没有 speakerNodeId
      expect(personaVoiceIdForMessage(messages, 'm1', nodes, agents)).toBeUndefined();
      expect(personaVoiceIdForMessage(messages, 'missing', nodes, agents)).toBeUndefined();
    });
  });
});
