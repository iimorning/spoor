import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { I18nextProvider } from 'react-i18next';
import {
  ChatRoomParticipants,
  type ChatRoomParticipantsProps,
} from '../../../src/components/canvas/ChatRoomParticipants';
import i18n from '../../../src/i18n';

const host = { nodeId: 'host', name: '阿狸', isHost: true, muted: false };
const peer = { nodeId: 'b', name: '海龟', isHost: false, muted: false };

function renderCast(over: Partial<ChatRoomParticipantsProps> = {}) {
  const props: ChatRoomParticipantsProps = {
    participants: [host, peer],
    hostNodeId: 'host',
    titledNodeId: 'host',
    candidates: [{ id: 'c', name: '镜子' }],
    libraryCandidates: [{ id: 'cfg-x', name: '织工' }],
    maxParticipants: 3,
    onAdd: vi.fn(),
    onAddFromLibrary: vi.fn(),
    onRemove: vi.fn(),
    onToggleMuted: vi.fn(),
    ...over,
  };
  const view = render(
    <I18nextProvider i18n={i18n}>
      <ChatRoomParticipants {...props} />
    </I18nextProvider>,
  );
  return { props, ...view };
}

function openMenu() {
  fireEvent.click(screen.getByTestId('canvas-chat-room-add'));
}

describe('ChatRoomParticipants', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh');
  });

  it('renders nothing for a lone host with nobody to invite', () => {
    const { container } = renderCast({
      participants: [host],
      candidates: [],
      libraryCandidates: [],
    });
    expect(container.querySelector('[data-testid="canvas-chat-room"]')).toBeNull();
  });

  it('renders just the lamp and the invite button for a lone host who can invite', () => {
    renderCast({ participants: [host] });
    expect(screen.getByTestId('canvas-chat-room')).toBeTruthy();
    expect(screen.getByTestId('canvas-chat-room-add')).toBeTruthy();
    // 只有主 Agent 在场且它占着标题时，没有 chip
    expect(screen.queryByTestId('room-chip-host')).toBeNull();
  });

  it('lists peers as chips but not the persona holding the title', () => {
    renderCast({ titledNodeId: 'host' });
    expect(screen.getByTestId('room-chip-b')).toBeTruthy();
    expect(screen.queryByTestId('room-chip-host')).toBeNull();
  });

  it('moves the host into a chip when a peer holds the title', () => {
    renderCast({ titledNodeId: 'b' });
    const hostChip = screen.getByTestId('room-chip-host');
    expect(hostChip.textContent).toContain('阿狸');
    expect(hostChip.textContent).toContain('主持');
    // 主持也能被禁言，但不能被移出讨论
    expect(screen.getByTestId('room-mute-host').getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByTestId('room-remove-host')).toBeNull();
    expect(screen.queryByTestId('room-chip-b')).toBeNull();
  });

  it('leaves the title mute switch to the panel when the host holds the title', () => {
    renderCast({ titledNodeId: 'host' });
    // 主角色占着标题时不出现 host chip，也没有单独的麦克风按钮 ——
    // 那个开关就是面板渲染的标题文字本身（见 CanvasChatPanel.room.test）
    expect(screen.queryByTestId('room-chip-host')).toBeNull();
    expect(screen.queryByTestId('room-mute-host')).toBeNull();
    expect(screen.queryByTestId('icon-Mic')).toBeNull();
  });

  it('shows a muted host as struck through', () => {
    renderCast({
      participants: [{ ...host, muted: true }, peer],
      titledNodeId: 'b',
    });
    const hostChip = screen.getByTestId('room-chip-host');
    expect(hostChip.getAttribute('data-muted')).toBe('1');
    expect(screen.getByTestId('room-mute-host').getAttribute('aria-label')).toBe('开麦');
  });

  it('mutes the host by clicking its name in the chip', () => {
    const { props } = renderCast({ titledNodeId: 'b' });
    fireEvent.click(screen.getByTestId('room-mute-host'));
    expect(props.onToggleMuted).toHaveBeenCalledWith('host');
  });

  it('toggles mute and removes a peer', () => {
    const { props } = renderCast();
    fireEvent.click(screen.getByTestId('room-mute-b'));
    expect(props.onToggleMuted).toHaveBeenCalledWith('b');
    fireEvent.click(screen.getByTestId('room-remove-b'));
    expect(props.onRemove).toHaveBeenCalledWith('b');
  });

  it('dims the lamp and offers to unmute a muted peer', () => {
    renderCast({ participants: [host, { ...peer, muted: true }] });
    expect(screen.getByTestId('room-chip-b').getAttribute('data-muted')).toBe('1');
    const toggle = screen.getByTestId('room-mute-b');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('开麦');
  });

  it('keeps an unmuted peer lit', () => {
    renderCast();
    expect(screen.getByTestId('room-chip-b').getAttribute('data-muted')).toBe('0');
    expect(screen.getByTestId('room-mute-b').getAttribute('aria-label')).toBe('禁言');
  });

  it('draws room chips as tinted pills without an outline', () => {
    // 明确的产品决定：成员 chip 靠底色区分，不画外框线（虚线外框只留给"加入角色"）。
    // 占着标题的那个声音不出现 chip，所以用三个角色、让中间那位占标题。
    renderCast({
      participants: [host, peer, { nodeId: 'c', name: '编织者', isHost: false, muted: false }],
      titledNodeId: 'b',
    });
    expect(screen.getByTestId('room-chip-c').className).not.toContain('border');
    expect(screen.getByTestId('room-chip-host').className).not.toContain('border');
    expect(screen.getByTestId('canvas-chat-room-add').className).toContain('border-dashed');
  });

  it('puts the invite button after the chips, not between them', () => {
    renderCast();
    const html = screen.getByTestId('canvas-chat-room').innerHTML;
    expect(html.indexOf('canvas-chat-room-add')).toBeGreaterThan(html.indexOf('room-chip-b'));
    expect(html.indexOf('canvas-chat-room-add')).toBeGreaterThan(html.indexOf('room-lamp'));
  });

  it('puts every lamp to the right of the name it belongs to', () => {
    renderCast();
    const chip = screen.getByTestId('room-chip-b');
    const html = chip.innerHTML;
    // 名字在前，红点在后
    expect(html.indexOf('海龟')).toBeGreaterThan(-1);
    expect(html.indexOf('room-lamp')).toBeGreaterThan(html.indexOf('海龟'));
    expect(within(chip).getByTestId('room-lamp').getAttribute('data-lamp')).toBe('on');
  });

  it('lights the chip lamp off when that voice is muted', () => {
    renderCast({ participants: [host, { ...peer, muted: true }] });
    expect(
      within(screen.getByTestId('room-chip-b')).getByTestId('room-lamp').getAttribute('data-lamp'),
    ).toBe('off');
  });

  it('lights the title lamp from the voice holding the title, not from the host', () => {
    // 参与者占着标题时，标题后面那盏灯必须是它的状态：这里主人被禁言、参与者没有，
    // 所以灯应该是亮的（读作"海龟在说话"）。按旧写法它会显示主人的状态而灭掉。
    renderCast({
      participants: [{ ...host, muted: true }, peer],
      titledNodeId: 'b',
    });
    const lamps = within(screen.getByTestId('canvas-chat-room')).getAllByTestId('room-lamp');
    expect(lamps[0]!.getAttribute('data-lamp')).toBe('on');
    // 它自己的 chip 不出现（名字已经占着标题了）
    expect(screen.queryByTestId('room-chip-b')).toBeNull();
  });

  it('groups the menu into canvas personas and the persona library', () => {
    const { props } = renderCast();
    openMenu();
    const menu = screen.getByTestId('canvas-chat-room-menu');
    expect(menu.textContent).toContain('画布上的角色');
    expect(menu.textContent).toContain('角色库');

    fireEvent.click(screen.getByTestId('canvas-chat-room-candidate-c'));
    expect(props.onAdd).toHaveBeenCalledWith('c');
    expect(screen.queryByTestId('canvas-chat-room-menu')).toBeNull();
  });

  it('adds a persona straight from the library', () => {
    const { props } = renderCast();
    openMenu();
    fireEvent.click(screen.getByTestId('canvas-chat-room-library-cfg-x'));
    expect(props.onAddFromLibrary).toHaveBeenCalledWith('cfg-x');
  });

  it('can offer the library even when the canvas has no other persona', () => {
    renderCast({ participants: [host], candidates: [] });
    expect(screen.getByTestId('canvas-chat-room')).toBeTruthy();
    openMenu();
    expect(screen.getByTestId('canvas-chat-room-library-cfg-x')).toBeTruthy();
  });

  it('disables the invite button and says so once the room is full', () => {
    renderCast({
      participants: [
        host,
        peer,
        { nodeId: 'c', name: 'C', isHost: false, muted: false },
        { nodeId: 'd', name: 'D', isHost: false, muted: false },
      ],
      maxParticipants: 3,
    });
    expect((screen.getByTestId('canvas-chat-room-add') as HTMLButtonElement).disabled).toBe(true);
  });

  it('explains an empty menu when there is nobody left to add', () => {
    renderCast({ candidates: [], libraryCandidates: [] });
    openMenu();
    expect(screen.getByTestId('canvas-chat-room-menu').textContent).toContain('没有可以加入的角色');
  });
});
