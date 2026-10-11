import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { I18nextProvider } from 'react-i18next';
import { CanvasChatPanel } from '../../../src/components/canvas/CanvasChatPanel';
import { db, type CanvasNode } from '../../../src/db';
import i18n from '../../../src/i18n';

vi.mock('lucide-react', () => {
  const icon = (name: string) => (props: Record<string, unknown>) =>
    React.createElement('svg', { 'data-testid': `icon-${name}`, ...props });
  return {
    ArrowUp: icon('ArrowUp'),
    Bot: icon('Bot'),
    Brain: icon('Brain'),
    Check: icon('Check'),
    ChevronLeft: icon('ChevronLeft'),
    Copy: icon('Copy'),
    ExternalLink: icon('ExternalLink'),
    FileText: icon('FileText'),
    GripVertical: icon('GripVertical'),
    History: icon('History'),
    Loader2: icon('Loader2'),
    Mic: icon('Mic'),
    MicOff: icon('MicOff'),
    MessagesSquare: icon('MessagesSquare'),
    Plus: icon('Plus'),
    Square: icon('Square'),
    SquarePen: icon('SquarePen'),
    UserPlus: icon('UserPlus'),
    Volume2: icon('Volume2'),
    X: icon('X'),
  };
});

const host: CanvasNode = {
  id: 'agent-a', canvasId: 'c1', type: 'agent', agentConfigId: 'cfg-a', x: 0, y: 0,
};
const peer: CanvasNode = {
  id: 'agent-b', canvasId: 'c1', type: 'agent', agentConfigId: 'cfg-b', x: 0, y: 0,
};

const hostParticipant = { nodeId: 'agent-a', name: '真知镜', isHost: true, muted: false };
const peerParticipant = { nodeId: 'agent-b', name: '海龟', isHost: false, muted: false };

function panel(over: Partial<React.ComponentProps<typeof CanvasChatPanel>> = {}) {
  return (
    <I18nextProvider i18n={i18n}>
      <CanvasChatPanel
        canvasId="c1"
        agentNode={host}
        nodes={[host, peer]}
        nodesRef={{ current: {} }}
        isStreaming={false}
        streamingMessageId={null}
        streamingThought=""
        onClose={() => {}}
        onSend={() => {}}
        {...over}
      />
    </I18nextProvider>
  );
}

describe('CanvasChatPanel multi-persona room', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh');
    await db.canvasPersonaThreads.clear();
  });

  it('keeps the cast inside the header instead of a separate row', async () => {
    render(
      panel({
        roomParticipants: [hostParticipant, peerParticipant],
        roomInviteCandidates: [{ id: 'agent-c', name: '阿狸' }],
      }),
    );
    await waitFor(() => expect(screen.getByTestId('canvas-chat-room')).toBeTruthy());
    // 并进标题行：角色块是 header 的后代，而不是列表上面单独一行
    expect(
      screen.getByTestId('canvas-chat-room').closest('header'),
    ).toBe(screen.getByTestId('canvas-chat-panel').querySelector('header'));
    expect(screen.getByTestId('room-chip-agent-b')).toBeTruthy();
  });

  it('keeps the plain single-persona panel when no room props are given', async () => {
    render(panel());
    await waitFor(() => expect(screen.getByTestId('canvas-chat-panel')).toBeTruthy());
    expect(screen.queryByTestId('canvas-chat-room')).toBeNull();
    expect(screen.queryByTestId('canvas-chat-room-add')).toBeNull();
  });

  it('offers personas from the library, not only cards already on the canvas', async () => {
    render(
      panel({
        roomParticipants: [hostParticipant],
        roomInviteCandidates: [],
        roomLibraryCandidates: [{ id: 'cfg-lib', name: '织工' }],
        onAddRoomFromLibrary: vi.fn(),
      }),
    );
    await waitFor(() => expect(screen.getByTestId('canvas-chat-room-add')).toBeTruthy());
    fireEvent.click(screen.getByTestId('canvas-chat-room-add'));
    expect(screen.getByTestId('canvas-chat-room-menu').textContent).toContain('角色库');
    expect(screen.getByTestId('canvas-chat-room-library-cfg-lib').textContent).toContain('织工');
  });

  it('hands a library pick back to the caller', async () => {
    const onAddRoomFromLibrary = vi.fn();
    render(
      panel({
        roomParticipants: [hostParticipant],
        roomLibraryCandidates: [{ id: 'cfg-lib', name: '织工' }],
        onAddRoomFromLibrary,
      }),
    );
    await waitFor(() => expect(screen.getByTestId('canvas-chat-room-add')).toBeTruthy());
    fireEvent.click(screen.getByTestId('canvas-chat-room-add'));
    fireEvent.click(screen.getByTestId('canvas-chat-room-library-cfg-lib'));
    expect(onAddRoomFromLibrary).toHaveBeenCalledWith('cfg-lib');
  });

  it('gives the title and the live thought to whichever peer is currently speaking', async () => {
    await db.canvasPersonaThreads.put({
      id: 'c1:agent-a',
      canvasId: 'c1',
      agentNodeId: 'agent-a',
      messages: [
        { id: 'u1', role: 'user', text: '你们怎么看', createdAt: 1 },
        { id: 'm1', role: 'assistant', text: '我先说', createdAt: 2, speakerNodeId: 'agent-a', speakerName: '真知镜' },
        { id: 'm2', role: 'assistant', text: '', createdAt: 3, speakerNodeId: 'agent-b', speakerName: '海龟' },
      ],
      participantNodeIds: ['agent-b'],
      mutedNodeIds: [],
      updatedAt: Date.now(),
    });

    render(
      panel({
        isStreaming: true,
        roomParticipants: [hostParticipant, peerParticipant],
        // 真实应用会把整张 personaStreams 传进来：主 Agent 的槽位在整个房间轮次里
        // 都还在，且插入顺序在前，所以这里必须两个槽位都给。
        streamsByPersona: {
          'agent-a': { messageId: 'm1', thought: '' },
          'agent-b': { messageId: 'm2', thought: '正在想怎么反驳' },
        },
      }),
    );

    await waitFor(() => expect(screen.getByText('正在想怎么反驳')).toBeTruthy());
    // 说话的参与者占住标题，主 Agent 退成带「主持」的 chip
    expect(screen.getByTestId('room-chip-agent-a').textContent).toContain('主持');
    expect(screen.queryByTestId('room-chip-agent-b')).toBeNull();
    // 标题归谁，头部的思考就归谁：脑图标长在头部，气泡那份让位。
    const streamingHeader = screen.getByTestId('canvas-chat-panel').querySelector('header')!;
    expect(within(streamingHeader).getByTestId('chat-thinking-trace')).toBeTruthy();
  });

  it('does not hang a peer’s saved thought under the host title once the turn ends', async () => {
    await db.canvasPersonaThreads.put({
      id: 'c1:agent-a',
      canvasId: 'c1',
      agentNodeId: 'agent-a',
      messages: [
        { id: 'u1', role: 'user', text: '你们怎么看', createdAt: 1 },
        {
          id: 'm1',
          role: 'assistant',
          text: '我先说',
          createdAt: 2,
          speakerNodeId: 'agent-b',
          speakerName: '海龟',
          thinkingTrace: '海龟的思考',
        },
      ],
      participantNodeIds: ['agent-b'],
      mutedNodeIds: [],
      updatedAt: Date.now(),
    });

    // 空闲时的真实形状：讨论没在跑，personaStreams 是个空对象。
    render(panel({ roomParticipants: [hostParticipant, peerParticipant], streamsByPersona: {} }));

    // 面板走 portal，只能从面板根节点往下找。
    const panelEl = await screen.findByTestId('canvas-chat-panel');
    // 先等消息真的落进面板，否则"头部没有它"是一句空断言。
    const bubble = await waitFor(() => {
      const el = panelEl.querySelector('[data-chat-message-id="m1"]');
      if (!el) throw new Error('peer bubble not rendered yet');
      return el as HTMLElement;
    });
    // 最后发言的是海龟，而空闲时标题归主 Agent —— 头部不能把海龟的思考挂在主 Agent 名下。
    // 有思考才长得出这个脑图标，所以它不在头部就等于头部没认领任何人的思考。
    const header = panelEl.querySelector('header')!;
    expect(within(header).queryByTestId('chat-thinking-trace')).toBeNull();
    // 它自己那份还在自己的气泡里，点开能看到内容。
    fireEvent.click(within(bubble).getByTestId('chat-thinking-trace'));
    expect(screen.getByTestId('chat-thinking-trace-panel')).toHaveTextContent('海龟的思考');
  });

  it('shows no discussion row in a single-persona panel', async () => {
    render(panel({ roomParticipants: [hostParticipant], onStartRoomDiscussion: vi.fn() }));
    await waitFor(() => expect(screen.getByTestId('canvas-chat-panel')).toBeTruthy());
    expect(screen.queryByTestId('canvas-chat-discussion-start')).toBeNull();
    expect(screen.queryByTestId('canvas-chat-discussion-progress')).toBeNull();
  });

  it('starts a discussion from the room footer', async () => {
    const onStartRoomDiscussion = vi.fn();
    render(
      panel({
        roomParticipants: [hostParticipant, peerParticipant],
        onStartRoomDiscussion,
      }),
    );
    await waitFor(() => expect(screen.getByTestId('canvas-chat-discussion-start')).toBeTruthy());
    // 还没有任何回复时是"开始讨论"
    expect(screen.getByTestId('canvas-chat-discussion-start').textContent).toBe('开始讨论');
    fireEvent.click(screen.getByTestId('canvas-chat-discussion-start'));
    expect(onStartRoomDiscussion).toHaveBeenCalledTimes(1);
  });

  it('shows the round progress and stops on demand', async () => {
    const onStopRoomDiscussion = vi.fn();
    render(
      panel({
        roomParticipants: [hostParticipant, peerParticipant],
        roomDiscussion: { round: 2, rounds: 4 },
        onStartRoomDiscussion: vi.fn(),
        onStopRoomDiscussion,
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('canvas-chat-discussion-progress')).toBeTruthy(),
    );
    expect(screen.getByTestId('canvas-chat-discussion-progress').textContent).toContain('2/4');
    expect(screen.queryByTestId('canvas-chat-discussion-start')).toBeNull();
    fireEvent.click(screen.getByTestId('canvas-chat-discussion-stop'));
    expect(onStopRoomDiscussion).toHaveBeenCalledTimes(1);
  });

  it('keeps the composer usable while a discussion runs, so the user can cut in', async () => {
    render(
      panel({
        isStreaming: true,
        roomParticipants: [hostParticipant, peerParticipant],
        roomDiscussion: { round: 1, rounds: 2 },
        onStartRoomDiscussion: vi.fn(),
        composerSegments: [{ type: 'text', content: '我来插一句' }],
      }),
    );
    // isStreaming 为真（有人正在说），但自动讨论期间发送按钮不能禁用 —— 发出去就是插话
    await waitFor(() => expect(screen.getByTestId('canvas-chat-discussion-progress')).toBeTruthy());
    await waitFor(() =>
      expect((screen.getByTestId('canvas-chat-send') as HTMLButtonElement).disabled).toBe(false),
    );
  });

  it('makes the host title itself the mute switch, with no separate mic button', async () => {
    const onToggleRoomParticipantMuted = vi.fn();
    render(
      panel({
        // 真实调用里 App 会传角色名；标题名和 chip 名都从这里来
        personaDisplayName: '真知镜',
        roomParticipants: [hostParticipant, peerParticipant],
        onToggleRoomParticipantMuted,
      }),
    );

    const titleSwitch = await screen.findByTestId('room-mute-agent-a');
    // 就是标题文字本身：点它禁言，没有额外的麦克风按钮
    expect(titleSwitch.tagName).toBe('BUTTON');
    expect(titleSwitch.textContent).toBe('真知镜');
    expect(titleSwitch.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByTestId('icon-Mic')).toBeNull();

    fireEvent.click(titleSwitch);
    expect(onToggleRoomParticipantMuted).toHaveBeenCalledWith('agent-a');
  });

  it('strikes the host title through once the host is muted', async () => {
    render(
      panel({
        roomParticipants: [{ ...hostParticipant, muted: true }, peerParticipant],
        onToggleRoomParticipantMuted: vi.fn(),
      }),
    );

    const titleSwitch = await screen.findByTestId('room-mute-agent-a');
    expect(titleSwitch.getAttribute('aria-pressed')).toBe('true');
    expect(titleSwitch.getAttribute('aria-label')).toBe('开麦');
    expect(titleSwitch.className).toContain('line-through');
  });

  it('hands the title switch to whoever holds the title', async () => {
    await db.canvasPersonaThreads.put({
      id: 'c1:agent-a',
      canvasId: 'c1',
      agentNodeId: 'agent-a',
      messages: [
        { id: 'u1', role: 'user', text: '你们怎么看', createdAt: 1 },
        { id: 'm2', role: 'assistant', text: '', createdAt: 3, speakerNodeId: 'agent-b', speakerName: '海龟' },
      ],
      participantNodeIds: ['agent-b'],
      mutedNodeIds: [],
      updatedAt: Date.now(),
    });

    const onToggleRoomParticipantMuted = vi.fn();
    render(
      panel({
        isStreaming: true,
        personaDisplayName: '真知镜',
        onToggleRoomParticipantMuted,
        roomParticipants: [hostParticipant, peerParticipant],
        // 参与者占着标题（正在回复）
        streamsByPersona: { 'agent-b': { messageId: 'm2', thought: '在想' } },
      }),
    );

    // 等真正的不变量：thread 加载、标题归参与者之后，它的 chip 就该消失。
    // （直接 find room-mute-agent-b 会先命中 chip 里的同名开关，等于没等。）
    await waitFor(() => expect(screen.queryByTestId('room-chip-agent-b')).toBeNull());

    // 标题的开关现在是参与者的，而不是主角色的 —— 主角色这时只是 chip
    const titleSwitch = screen.getByTestId('room-mute-agent-b');
    expect(titleSwitch.textContent).toBe('海龟');
    expect(screen.getByTestId('room-mute-agent-a')).toBeTruthy(); // 来自它的 chip
  });

  it('does not make the title a switch in a single-persona panel', async () => {
    render(panel({ roomParticipants: [hostParticipant], onToggleRoomParticipantMuted: vi.fn() }));
    await waitFor(() => expect(screen.getByTestId('canvas-chat-panel')).toBeTruthy());
    expect(screen.queryByTestId('room-mute-agent-a')).toBeNull();
  });

  it('lets the user type the round count next to the start button', async () => {
    const onChangeRoomDiscussionRounds = vi.fn();
    render(
      panel({
        roomParticipants: [hostParticipant, peerParticipant],
        roomDiscussionRounds: 2,
        onChangeRoomDiscussionRounds,
        onStartRoomDiscussion: vi.fn(),
      }),
    );

    const input = (await screen.findByTestId(
      'canvas-chat-discussion-rounds',
    )) as HTMLInputElement;
    expect(input.value).toBe('2');
    expect(input.nextElementSibling?.textContent).toBe('轮');

    // 输入过程中不夹取：打到 "10" 才收口，不会在中间被改成 "5"
    fireEvent.change(input, { target: { value: '1' } });
    expect(input.value).toBe('1');
    expect(onChangeRoomDiscussionRounds).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '10' } });
    expect(input.value).toBe('10');
    expect(onChangeRoomDiscussionRounds).not.toHaveBeenCalled();

    fireEvent.blur(input);
    expect(onChangeRoomDiscussionRounds).toHaveBeenCalledWith(5);
  });

  it('commits the round count on Enter and ignores junk', async () => {
    const onChangeRoomDiscussionRounds = vi.fn();
    render(
      panel({
        roomParticipants: [hostParticipant, peerParticipant],
        roomDiscussionRounds: 3,
        onChangeRoomDiscussionRounds,
        onStartRoomDiscussion: vi.fn(),
      }),
    );

    const input = (await screen.findByTestId(
      'canvas-chat-discussion-rounds',
    )) as HTMLInputElement;
    // 非数字直接丢掉，不留进草稿
    fireEvent.change(input, { target: { value: 'ab' } });
    expect(input.value).toBe('');
    fireEvent.change(input, { target: { value: '4' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChangeRoomDiscussionRounds).toHaveBeenCalledWith(4);
  });

  it('does not call back when the round count is unchanged', async () => {
    const onChangeRoomDiscussionRounds = vi.fn();
    render(
      panel({
        roomParticipants: [hostParticipant, peerParticipant],
        roomDiscussionRounds: 2,
        onChangeRoomDiscussionRounds,
        onStartRoomDiscussion: vi.fn(),
      }),
    );
    const input = (await screen.findByTestId(
      'canvas-chat-discussion-rounds',
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.blur(input);
    expect(onChangeRoomDiscussionRounds).not.toHaveBeenCalled();
  });

  it('hides the round input while the discussion is running', async () => {
    render(
      panel({
        roomParticipants: [hostParticipant, peerParticipant],
        roomDiscussion: { round: 1, rounds: 3 },
        roomDiscussionRounds: 3,
        onChangeRoomDiscussionRounds: vi.fn(),
        onStartRoomDiscussion: vi.fn(),
        onStopRoomDiscussion: vi.fn(),
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('canvas-chat-discussion-progress')).toBeTruthy(),
    );
    expect(screen.getByTestId('canvas-chat-discussion-progress').textContent).toContain('1/3');
    expect(screen.queryByTestId('canvas-chat-discussion-rounds')).toBeNull();
  });

  it('puts a read-aloud button after the copy button on a reply', async () => {
    await db.canvasPersonaThreads.put({
      id: 'c1:agent-a',
      canvasId: 'c1',
      agentNodeId: 'agent-a',
      messages: [
        { id: 'u1', role: 'user', text: '问一句', createdAt: 1 },
        { id: 'm1', role: 'assistant', text: '答一句', createdAt: 2 },
      ],
      participantNodeIds: [],
      mutedNodeIds: [],
      updatedAt: Date.now(),
    });

    const onReadMessage = vi.fn();
    render(
      panel({
        canReadAloud: true,
        onReadMessage,
        onStopSpeaking: vi.fn(),
      }),
    );

    const speak = await screen.findByTestId('chat-reply-tts-speak');
    // 在复制按钮后面
    const body = speak.closest('div')!.parentElement!;
    expect(body.innerHTML.indexOf('chat-reply-copy')).toBeLessThan(
      body.innerHTML.indexOf('chat-reply-tts-speak'),
    );
    // 用户那条不该有朗读按钮
    expect(screen.getAllByTestId('chat-reply-tts-speak')).toHaveLength(1);

    fireEvent.click(speak);
    expect(onReadMessage).toHaveBeenCalledWith('m1', '答一句');
  });

  it('swaps the read button for a stop button while that reply is being read', async () => {
    await db.canvasPersonaThreads.put({
      id: 'c1:agent-a',
      canvasId: 'c1',
      agentNodeId: 'agent-a',
      messages: [{ id: 'm1', role: 'assistant', text: '正在读', createdAt: 2 }],
      participantNodeIds: [],
      mutedNodeIds: [],
      updatedAt: Date.now(),
    });

    const onStopSpeaking = vi.fn();
    render(panel({ canReadAloud: true, speakingMessageId: 'm1', onStopSpeaking }));

    const stop = await screen.findByTestId('chat-reply-tts-stop');
    expect(screen.queryByTestId('chat-reply-tts-speak')).toBeNull();
    fireEvent.click(stop);
    expect(onStopSpeaking).toHaveBeenCalledTimes(1);
  });

  it('hides the read button without TTS credentials, and says replay once it has been read', async () => {
    await db.canvasPersonaThreads.put({
      id: 'c1:agent-a',
      canvasId: 'c1',
      agentNodeId: 'agent-a',
      messages: [{ id: 'm1', role: 'assistant', text: '读过了', createdAt: 2 }],
      participantNodeIds: [],
      mutedNodeIds: [],
      updatedAt: Date.now(),
    });

    const { unmount } = render(panel({ onReadMessage: vi.fn(), onStopSpeaking: vi.fn() }));
    await waitFor(() => expect(screen.getByTestId('chat-reply-copy')).toBeTruthy());
    expect(screen.queryByTestId('chat-reply-tts-speak')).toBeNull();
    unmount();

    render(panel({ canReadAloud: true, lastSpokenMessageId: 'm1', onReadMessage: vi.fn(), onStopSpeaking: vi.fn() }));
    const speak = await screen.findByTestId('chat-reply-tts-speak');
    expect(speak.getAttribute('aria-label')).toBe('重播');
  });

  it('offers continue rather than start once the room already has replies', async () => {
    await db.canvasPersonaThreads.put({
      id: 'c1:agent-a',
      canvasId: 'c1',
      agentNodeId: 'agent-a',
      messages: [
        { id: 'u1', role: 'user', text: '开场', createdAt: 1 },
        { id: 'm1', role: 'assistant', text: '我先说', createdAt: 2, speakerNodeId: 'agent-a', speakerName: '真知镜' },
      ],
      participantNodeIds: ['agent-b'],
      mutedNodeIds: [],
      updatedAt: Date.now(),
    });

    render(
      panel({
        roomParticipants: [hostParticipant, peerParticipant],
        onStartRoomDiscussion: vi.fn(),
      }),
    );

    // 等文案本身：按钮随"房间有人"立刻出现，而文案要等 thread 加载完
    await waitFor(() =>
      expect(screen.getByTestId('canvas-chat-discussion-start').textContent).toBe('继续讨论'),
    );
  });

  it('does not keep the host reply stuck in its streaming state during a peer turn', async () => {
    await db.canvasPersonaThreads.put({
      id: 'c1:agent-a',
      canvasId: 'c1',
      agentNodeId: 'agent-a',
      messages: [
        { id: 'u1', role: 'user', text: '你们怎么看', createdAt: 1 },
        { id: 'm1', role: 'assistant', text: '我先说完了', createdAt: 2, speakerNodeId: 'agent-a', speakerName: '真知镜' },
        { id: 'm2', role: 'assistant', text: '', createdAt: 3, speakerNodeId: 'agent-b', speakerName: '海龟' },
      ],
      participantNodeIds: ['agent-b'],
      mutedNodeIds: [],
      updatedAt: Date.now(),
    });

    render(
      panel({
        isStreaming: true,
        onDropReplyAt: vi.fn(),
        roomParticipants: [hostParticipant, peerParticipant],
        // 主 Agent 的槽位在整个房间轮次里都还在，所以两个槽位都要给。
        streamsByPersona: {
          'agent-a': { messageId: 'm1', thought: '' },
          'agent-b': { messageId: 'm2', thought: '在想' },
        },
      }),
    );

    // 已经答完的那条要恢复成普通气泡：可以整段拖到画布上
    await waitFor(() =>
      expect(screen.getByTestId('chat-reply-drag-handle')).toBeTruthy(),
    );
    const handle = screen.getByTestId('chat-reply-drag-handle');
    expect(handle.closest('[data-chat-message-id]')?.getAttribute('data-chat-message-id')).toBe('m1');
  });
});
