import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { db } from '../../src/db';
import type { AgentConfig } from '../../src/db';
import { SurfacePersonaStrip } from '../../src/components/SurfacePersonaStrip';
import { EMPTY_SURFACE_ROOM, readSurfaceRoom, type SurfaceRoomState } from '../../src/utils/surfacePersonaRoom';
import { ASK_PERSONA_ID } from '../../src/utils/askPersona';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

vi.mock('../../src/components/AgentIcon', () => ({
  AgentIcon: ({ agentId }: { agentId: string }) => (
    <span data-testid={`agent-icon-${agentId}`} />
  ),
}));

const persona = (id: string, name = `名字${id}`): AgentConfig => ({
  id,
  name,
  role: 'role',
  prompt: `PROMPT_${id}`,
});

const A = persona('a');
const B = persona('b');
const C = persona('c');

beforeEach(async () => {
  await db.agents.clear();
  await db.agents.bulkAdd([A, B, C]);
});

/** 角色库是异步查出来的，菜单在它到位之前整个不渲染——所以先等邀请按钮出现。 */
async function renderStrip(
  initial: SurfaceRoomState = EMPTY_SURFACE_ROOM,
  onDiscuss?: () => void,
) {
  const onRoomChange = vi.fn();
  const view = (room: SurfaceRoomState) => (
    <SurfacePersonaStrip room={room} onRoomChange={onRoomChange} onDiscuss={onDiscuss} />
  );
  const utils = render(view(initial));
  onRoomChange.mockImplementation((next: SurfaceRoomState) => {
    utils.rerender(view(next));
  });
  // 邀请按钮要角色库到位才出现（没人可邀请时整块不渲染），chip 则要房里的人查得到。
  // 两样都得等，否则会在数据还没到的时候去点一个还不存在的按钮。
  await waitFor(() => {
    expect(screen.getByTestId('canvas-chat-room-add')).toBeInTheDocument();
  });
  const lastChip = initial.personaIds.at(-1);
  if (lastChip) {
    await waitFor(() => {
      expect(screen.getByTestId(`room-chip-${lastChip}`)).toBeInTheDocument();
    });
  }
  return { onRoomChange };
}

describe('SurfacePersonaStrip', () => {
  it('角色库还在查的时候不画那条空边条', async () => {
    // 查的过程中 agents 是 undefined。先画一条空条子再填上内容，
    // 会在每次打开全屏时闪一下——比"什么都没有"更难看。
    await db.agents.clear();
    render(<SurfacePersonaStrip room={EMPTY_SURFACE_ROOM} onRoomChange={() => {}} />);
    expect(screen.queryByTestId('surface-persona-strip')).toBeNull();
  });

  it('角色库是空的时仍然渲染——阿狸常驻，栏里至少有他', async () => {
    await db.agents.clear();
    render(<SurfacePersonaStrip room={EMPTY_SURFACE_ROOM} onRoomChange={() => {}} />);
    await waitFor(() => {
      expect(screen.getByTestId('surface-persona-strip')).toBeInTheDocument();
    });
  });

  it('空房间时阿狸是唯一在场的人', async () => {
    await renderStrip(EMPTY_SURFACE_ROOM);
    const chip = await screen.findByTestId(`room-chip-${ASK_PERSONA_ID}`);
    expect(chip).toHaveAttribute('data-muted', '0');
  });

  it('不画"谁在说话"的红灯，也不挂主持徽章', async () => {
    // 阿狸本来就有自己的红点标识，再加一颗灯、挂一枚「主持」是同一个信息说两遍。
    await renderStrip(readSurfaceRoom(['a', 'b']));
    await screen.findByTestId(`room-chip-${ASK_PERSONA_ID}`);
    expect(screen.queryByTestId('room-lamp')).toBeNull();
    expect(screen.queryByText('canvas.v2.room_host_badge')).toBeNull();
  });

  it('房间里没人时只有一颗加入按钮', async () => {
    await renderStrip();
    await waitFor(() => {
      expect(screen.getByTestId('canvas-chat-room-add')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('room-chip-a')).toBeNull();
  });

  it('邀请菜单列的是角色库里的人', async () => {
    const user = userEvent.setup();
    await renderStrip();
    await user.click(screen.getByTestId('canvas-chat-room-add'));
    expect(await screen.findByTestId('canvas-chat-room-library-b')).toBeInTheDocument();
    expect(screen.getByTestId('canvas-chat-room-library-c')).toBeInTheDocument();
  });

  it('点一个角色就把他加进房间', async () => {
    const user = userEvent.setup();
    const { onRoomChange } = await renderStrip();
    await user.click(screen.getByTestId('canvas-chat-room-add'));
    await user.click(await screen.findByTestId('canvas-chat-room-library-b'));
    expect(onRoomChange).toHaveBeenCalledWith(readSurfaceRoom(['b'], []));
    expect(await screen.findByTestId('room-chip-b')).toBeInTheDocument();
  });

  it('已经在房间里的人不会再出现在候选里', async () => {
    const user = userEvent.setup();
    await renderStrip(readSurfaceRoom(['b']));
    await user.click(screen.getByTestId('canvas-chat-room-add'));
    expect(screen.queryByTestId('canvas-chat-room-library-b')).toBeNull();
    expect(await screen.findByTestId('canvas-chat-room-library-c')).toBeInTheDocument();
  });

  it('满员之后加不进来', async () => {
    const user = userEvent.setup();
    await renderStrip(readSurfaceRoom(['a', 'b', 'c']));
    expect(screen.getByTestId('canvas-chat-room-add')).toBeDisabled();
  });

  it('嘉宾可以被移出房间', async () => {
    const user = userEvent.setup();
    const { onRoomChange } = await renderStrip(readSurfaceRoom(['a', 'b']));
    await user.click(screen.getByTestId('room-remove-b'));
    expect(onRoomChange).toHaveBeenCalledWith(readSurfaceRoom(['a'], []));
  });

  it('禁言只动被点的那一个', async () => {
    const user = userEvent.setup();
    const { onRoomChange } = await renderStrip(readSurfaceRoom(['a', 'b']));
    await user.click(screen.getByTestId('room-mute-b'));
    expect(onRoomChange).toHaveBeenCalledWith(readSurfaceRoom(['a', 'b'], ['b']));
  });

  it('禁言第一个人时，主持徽章顺位给下一个', async () => {
    const user = userEvent.setup();
    const { onRoomChange } = await renderStrip(readSurfaceRoom(['a', 'b']));
    await user.click(screen.getByTestId('room-mute-a'));
    onRoomChange(readSurfaceRoom(['a', 'b'], ['a']));
    expect(await screen.findByTestId('room-chip-b')).toHaveAttribute('data-muted', '0');
  });

  it('房里只有阿狸时不显示"让他们都说说"', async () => {
    await renderStrip(EMPTY_SURFACE_ROOM, () => {});
    await waitFor(() => {
      expect(screen.getByTestId('canvas-chat-room-add')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('surface-persona-discuss')).toBeNull();
  });

  it('有第二个声音时才显示讨论按钮', async () => {
    const user = userEvent.setup();
    const onDiscuss = vi.fn();
    await renderStrip(readSurfaceRoom(['a', 'b']), onDiscuss);
    await user.click(screen.getByTestId('surface-persona-discuss'));
    expect(onDiscuss).toHaveBeenCalled();
  });

  it('全员禁言时讨论按钮消失', async () => {
    await renderStrip(readSurfaceRoom(['a', 'b'], ['a', 'b']), () => {});
    await waitFor(() => {
      expect(screen.getByTestId('canvas-chat-room-add')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('surface-persona-discuss')).toBeNull();
  });
});
