import { describe, it, expect } from 'vitest';
import {
  addSurfacePersona,
  buildSurfaceRoomParticipants,
  buildSurfaceTurnCue,
  formatSurfaceHistoryForSpeaker,
  hasSurfaceGuestVoices,
  listSurfaceLibraryCandidates,
  readSurfaceRoom,
  removeSurfacePersona,
  resolveSurfaceSpeakers,
  surfaceAnswerer,
  surfaceGuests,
  toggleSurfacePersonaMuted,
  type SurfaceRoomState,
} from '../../src/utils/surfacePersonaRoom';
import type { AgentConfig } from '../../src/db';

const agent = (id: string, extra: Partial<AgentConfig> = {}): AgentConfig => ({
  id,
  name: `Name ${id}`,
  role: 'role',
  prompt: `prompt ${id}`,
  ...extra,
});

const A = agent('a');
const B = agent('b');
const C = agent('c');
const D = agent('d');

const room = (personaIds: string[], mutedIds: string[] = []): SurfaceRoomState =>
  readSurfaceRoom(personaIds, mutedIds);

describe('readSurfaceRoom', () => {
  it('de-dupes ids', () => {
    const state = readSurfaceRoom(['a', 'a', 'b'], ['b']);
    expect(state.personaIds).toEqual(['a', 'b']);
    expect(state.mutedIds).toEqual(['b']);
  });

  it('保留不在名单里的禁言标记——阿狸恒在但不在名单里', () => {
    // 过滤掉的话，"禁言阿狸"会被当成野 id 丢掉，这个操作永远不生效。
    const state = readSurfaceRoom(['a'], ['__ask__']);
    expect(state.mutedIds).toEqual(['__ask__']);
  });

  it('treats missing input as an empty room', () => {
    expect(readSurfaceRoom(undefined, undefined)).toEqual({ personaIds: [], mutedIds: [] });
  });
});

describe('buildSurfaceRoomParticipants', () => {
  it('puts the first persona in the room as the host', () => {
    const parts = buildSurfaceRoomParticipants(room(['a', 'b']), [A, B, C]);
    expect(parts.map((p) => p.nodeId)).toEqual(['a', 'b']);
    expect(parts[0]?.isHost).toBe(true);
    expect(parts[1]?.isHost).toBe(false);
  });

  it('passes the host badge on when the first one is muted', () => {
    // 徽章跟着"这一轮谁答话"走。把第一个人禁言之后，答话的顺位给下一个，
    // 而不是留下一个点了没反应的开关。
    const parts = buildSurfaceRoomParticipants(room(['a', 'b', 'c'], ['a']), [A, B, C]);
    expect(parts.map((p) => p.isHost)).toEqual([false, true, false]);
  });

  it('gives nobody the badge when everyone is muted', () => {
    const parts = buildSurfaceRoomParticipants(room(['a', 'b'], ['a', 'b']), [A, B]);
    expect(parts.some((p) => p.isHost)).toBe(false);
    expect(surfaceAnswerer(room(['a', 'b'], ['a', 'b']), [A, B])).toBeNull();
  });

  it('answers with the first unmuted member', () => {
    expect(surfaceAnswerer(room(['a', 'b'], ['a']), [A, B])?.id).toBe('b');
  });

  it('drops personas that are no longer in the library', () => {
    // 同步把角色删了之后，名额得让出来，否则发言顺序里会有一个没有提示词的幽灵。
    const parts = buildSurfaceRoomParticipants(room(['a', 'ghost']), [A, B]);
    expect(parts.map((p) => p.nodeId)).toEqual(['a']);
  });

  it('carries the mute flag through', () => {
    const parts = buildSurfaceRoomParticipants(room(['a', 'b'], ['b']), [A, B]);
    expect(parts[1]?.muted).toBe(true);
  });
});

describe('listSurfaceLibraryCandidates', () => {
  it('offers everyone who is not in the room yet', () => {
    const candidates = listSurfaceLibraryCandidates(room(['a']), [A, B, C]);
    expect(candidates.map((c) => c.id)).toEqual(['b', 'c']);
  });

  it('passes the agent id as agentConfigId so the built-in icon resolves', () => {
    const [first] = listSurfaceLibraryCandidates(room([]), [agent('interviewer')]);
    expect(first?.agentConfigId).toBe('interviewer');
  });
});

describe('resolveSurfaceSpeakers', () => {
  it('speaks host first, then join order, skipping the muted', () => {
    const speakers = resolveSurfaceSpeakers(room(['a', 'b', 'c'], ['b']), [A, B, C]);
    expect(speakers.map((s) => s.id)).toEqual(['a', 'c']);
  });

  it('returns the full configs, since a turn needs the prompt and the sampling params', () => {
    const [first] = resolveSurfaceSpeakers(room(['a']), [agent('a', { temperature: 0.2 })]);
    expect(first?.temperature).toBe(0.2);
  });
});

describe('surfaceGuests', () => {
  it('is everyone in the roster — the host (阿狸) is not in it', () => {
    // 以前这里 slice(1)，那是在"首位是主人"的旧模型下切的；主人根本不在名单里，
    // 切一刀等于把第一个客人砍掉。
    expect(surfaceGuests(room(['a', 'b']), [A, B, C]).map((g) => g.id)).toEqual(['a', 'b']);
  });

  it('is empty for an empty room, so no discussion is offered', () => {
    expect(surfaceGuests(room([]), [A, B, C])).toEqual([]);
    expect(hasSurfaceGuestVoices(room([]), [A, B, C])).toBe(false);
  });

  it('is empty when every guest is muted, so the discussion button goes dead', () => {
    expect(hasSurfaceGuestVoices(room(['a', 'b'], ['a', 'b']), [A, B])).toBe(false);
  });
});

describe('roster edits', () => {
  it('appends, and stops at two guests — the third seat is 阿狸', () => {
    let state = room([]);
    state = addSurfacePersona(state, 'a');
    state = addSurfacePersona(state, 'b');
    state = addSurfacePersona(state, 'c');
    expect(state.personaIds).toEqual(['a', 'b']);
    expect(addSurfacePersona(state, 'd').personaIds).toEqual(['a', 'b']);
  });

  it('ignores adding the same persona twice', () => {
    expect(addSurfacePersona(room(['a']), 'a').personaIds).toEqual(['a']);
  });

  it('clears the mute flag on removal so the id cannot come back muted', () => {
    const next = removeSurfacePersona(room(['a', 'b'], ['b']), 'b');
    expect(next.personaIds).toEqual(['a']);
    expect(next.mutedIds).toEqual([]);
  });

  it('toggles mute and ignores people who are not in the room', () => {
    const muted = toggleSurfacePersonaMuted(room(['a', 'b']), 'b');
    expect(muted.mutedIds).toEqual(['b']);
    expect(toggleSurfacePersonaMuted(muted, 'b').mutedIds).toEqual([]);
    expect(toggleSurfacePersonaMuted(room(['a']), 'ghost')).toEqual(room(['a']));
  });
});

describe('formatSurfaceHistoryForSpeaker', () => {
  const msgs = [
    { role: 'user' as const, text: '这段在说什么' },
    { role: 'assistant' as const, text: '我在讲记忆', speakerAgentId: 'a', speakerName: '甲' },
  ];

  it('prefixes other voices so the model can tell them apart', () => {
    const history = formatSurfaceHistoryForSpeaker(msgs, 'b', (n) => `${n}: `);
    expect(history[1]?.content).toBe('甲: 我在讲记忆');
  });

  it('leaves the speaker’s own past turns bare', () => {
    const history = formatSurfaceHistoryForSpeaker(msgs, 'a', (n) => `${n}: `);
    expect(history[1]?.content).toBe('我在讲记忆');
  });

  it('attributes unsigned old replies to nobody rather than to the newest guest', () => {
    // 没有署名的只有内置助手会产出；算到刚加进来的嘉宾头上会凭空造出一段发言。
    const legacy = [{ role: 'assistant' as const, text: '旧回复' }];
    expect(formatSurfaceHistoryForSpeaker(legacy, 'b', (n) => `${n}: `)[0]?.content).toBe('旧回复');
  });

  it('drops blank turns', () => {
    const withBlank = [...msgs, { role: 'assistant' as const, text: '   ', speakerAgentId: 'a' }];
    expect(formatSurfaceHistoryForSpeaker(withBlank, 'b', () => '')).toHaveLength(2);
  });

  it('drops the whole tail when it has no user turn at all', () => {
    // 连着讨论几轮就会变成这个形状：连续好几条 assistant，没有一句用户发言。
    // 原样返回等于给 Anthropic / Gemini 一段以 assistant 开头的历史，它们会直接拒。
    const allAssistant = Array.from({ length: 15 }, (_, i) => ({
      role: 'assistant' as const,
      text: `第${i}条`,
      speakerAgentId: 'a',
    }));
    expect(formatSurfaceHistoryForSpeaker(allAssistant, 'b', () => '', 12)).toEqual([]);
  });

  it('trims to a tail that starts on a user turn, since some providers refuse otherwise', () => {
    const long = [
      { role: 'user' as const, text: 'q1' },
      { role: 'assistant' as const, text: 'a1', speakerAgentId: 'a' },
      { role: 'assistant' as const, text: 'a2', speakerAgentId: 'b' },
      { role: 'user' as const, text: 'q2' },
    ];
    const history = formatSurfaceHistoryForSpeaker(long, 'a', () => '', 3);
    expect(history[0]?.role).toBe('user');
  });
});

describe('buildSurfaceTurnCue', () => {
  const t = ((key: string, opts?: Record<string, unknown>) =>
    opts ? `${key}:${JSON.stringify(opts)}` : key) as never;

  it('asks the first guest to answer the user when nobody has spoken', () => {
    const cue = buildSurfaceTurnCue({
      messages: [{ role: 'user', text: '这段在说什么' }],
      hostNameFallback: '内置',
      t,
    });
    expect(cue).toBe('ai.prompts.personaGroupFirstTurn');
  });

  it('asks a guest to respond to the host, quoting them', () => {
    const cue = buildSurfaceTurnCue({
      messages: [
        { role: 'user', text: '这段在说什么' },
        { role: 'assistant', text: '我在讲记忆', speakerAgentId: 'a', speakerName: '甲' },
      ],
      hostNameFallback: '内置',
      t,
    });
    expect(cue).toContain('甲');
    expect(cue).toContain('我在讲记忆');
  });

  it('falls back to the host name when the previous reply predates the room', () => {
    const cue = buildSurfaceTurnCue({
      messages: [
        { role: 'user', text: '问' },
        { role: 'assistant', text: '答' },
      ],
      hostNameFallback: '内置助手',
      t,
    });
    expect(cue).toContain('内置助手');
  });

  it('caps the quoted text so a long turn cannot crowd out the cue', () => {
    const cue = buildSurfaceTurnCue({
      messages: [
        { role: 'user', text: '问' },
        { role: 'assistant', text: 'x'.repeat(5000), speakerAgentId: 'a', speakerName: '甲' },
      ],
      hostNameFallback: '内置',
      t,
    });
    expect(cue.length).toBeLessThan(1200);
  });
});
