import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useLiveQuery } from 'dexie-react-hooks';
import React, { useRef } from 'react';
import { db } from '../../src/db';
import type { CanvasNode } from '../../src/db';
import { withAppDialogProvider } from '../testUtils';
import { useRoomProactiveChat } from '../../src/hooks/useRoomProactiveChat';
import { isAutoAnnotationEnabled, setAutoAnnotationEnabled } from '../../src/utils/autoAnnotation';
import { runRoomProactivePass } from '../../src/services/roomProactivePass';
import type { AIConfig } from '../../src/components/AISettingsModal';

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

// mock service 而不是 mock 传输层：阈值、指纹、插话作废这些判据都在 hook 里，
// mock 掉 `callUniversalAI` 只会让它们全都测不到。
vi.mock('../../src/services/roomProactivePass', () => ({
  runRoomProactivePass: vi.fn(async () => ({ messages: [] })),
}));

const passMock = vi.mocked(runRoomProactivePass);

const CANVAS = 'c-proactive';
const PERSONA = 'p-1';
/** 注入给 hook 的空闲延迟。生产是 8 秒，测试里不能真等。 */
const IDLE = 40;
/** 断言用的等待上限。要盖住空闲延迟 + Dexie 的异步往返。 */
const WAIT = 2000;

// 要够长才过得去 `ROOM_PROACTIVE_MIN_CHARS`；三张卡 = 预算 3 条。
const CARD =
  '房间里的材料写的是一回事，另一张卡写的却是另一回事，两者对不上。' +
  '这一条是随手记下来的，没有出处，也没有说明为什么要记。'.repeat(2);

const AI_CONFIG = {
  provider: 'openrouter',
  apiKey: 'k',
  model: 'deepseek/deepseek-v4.1-flash',
} as AIConfig;

async function seedRoom(cardCount = 3, personaExtra: Partial<CanvasNode> = {}) {
  await db.canvasWorkZones.put({
    id: 'z-1',
    canvasId: CANVAS,
    personaNodeId: PERSONA,
    x: 0,
    y: 0,
    width: 900,
    height: 700,
    createdAt: 1,
  });
  await db.nodes.bulkPut([
    { id: PERSONA, canvasId: CANVAS, type: 'ask', x: 10, y: 10, ...personaExtra },
    ...Array.from({ length: cardCount }, (_, i) => ({
      id: `n-${i}`,
      canvasId: CANVAS,
      type: 'note' as const,
      x: 100 + i * 200,
      y: 100,
      content: CARD + i,
      contextScopeAgentId: PERSONA,
    })),
  ]);
}

function Harness({
  markProactiveBusy,
  onApi,
}: {
  markProactiveBusy: (personaNodeId: string, busy: boolean) => void;
  onApi: (api: {
    setEnabled: (enabled: boolean) => Promise<void>;
    isEnabled: (personaNodeId: string) => boolean;
  }) => void;
}) {
  // 和 App.tsx 一样用 liveQuery 读节点：指纹写回 db 之后候选要真的消失，
  // 这里就是那条"重跑一遍"的链路。
  const nodes = useLiveQuery(
    () => db.nodes.filter((n) => n.canvasId === CANVAS).toArray(),
    [],
  );
  const zones = useLiveQuery(
    () => db.canvasWorkZones.where('canvasId').equals(CANVAS).toArray(),
    [],
  );
  const nodesRef = useRef<Record<string, HTMLElement | null>>({});
  const api = useRoomProactiveChat({
    canvasId: CANVAS,
    nodes: nodes ?? [],
    zones: zones ?? [],
    agentConfigs: [],
    aiConfig: AI_CONFIG,
    nodesRef,
    markProactiveBusy,
    idleDelayMs: IDLE,
  });
  onApi({
    setEnabled: (enabled) => api.setProactiveEnabled(PERSONA, enabled),
    isEnabled: api.isProactiveEnabled,
  });
  return (
    <div>
      {Object.entries(api.statusById).map(([id, status]) => (
        <div key={id} data-testid="proactive-status" data-phase={status.phase} data-count={status.cardCount} />
      ))}
    </div>
  );
}

function renderHarness() {
  const markProactiveBusy = vi.fn();
  let api!: {
    setEnabled: (enabled: boolean) => Promise<void>;
    isEnabled: (personaNodeId: string) => boolean;
  };
  const view = render(
    withAppDialogProvider(
      <Harness markProactiveBusy={markProactiveBusy} onApi={(a) => { api = a; }} />,
    ),
  );
  return { view, markProactiveBusy, api: () => api };
}

beforeEach(async () => {
  passMock.mockReset();
  passMock.mockResolvedValue({ messages: [] });
  // 开关存 localStorage，测试之间必须清干净，否则上一条留下的"全局已关"
  // 会让这一条根本不起跑，断言看着像坏了。
  localStorage.clear();
  await db.nodes.clear();
  await db.canvasWorkZones.clear();
  await db.canvasPersonaThreads.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useRoomProactiveChat', () => {
  it('says nothing when the room has too little in it, and never calls the model', async () => {
    await seedRoom(1);
    await db.nodes.update('n-0', { content: '太短了' });
    renderHarness();
    await waitFor(() => expect(passMock).not.toHaveBeenCalled(), { timeout: WAIT });
    // 指纹照样写下了：不然这个空房间会每 8 秒醒一次，永远等下去。
    await waitFor(async () => {
      const node = await db.nodes.get(PERSONA);
      expect(node?.proactiveLastSignature).toBeTruthy();
    });
  });

  it('speaks once when the room fills, then stays quiet', async () => {
    passMock.mockResolvedValue({ messages: ['这两张卡说的其实不是一回事。'] });
    await seedRoom(3);
    renderHarness();

    await waitFor(() => expect(passMock).toHaveBeenCalledTimes(1), { timeout: WAIT });
    const threadId = `${CANVAS}:${PERSONA}`;
    await waitFor(async () => {
      const row = await db.canvasPersonaThreads.get(threadId);
      expect(row?.messages).toHaveLength(1);
      expect(row?.messages[0]?.role).toBe('assistant');
    });

    // 内容没再变，就不该再问一次模型。
    await new Promise((r) => setTimeout(r, WAIT));
    expect(passMock).toHaveBeenCalledTimes(1);
  });

  it('speaks again after the room changes', async () => {
    await seedRoom(3);
    renderHarness();
    await waitFor(() => expect(passMock).toHaveBeenCalledTimes(1), { timeout: WAIT });

    await db.nodes.add({
      id: 'n-new',
      canvasId: CANVAS,
      type: 'note',
      x: 900,
      y: 100,
      content: CARD + '新',
      contextScopeAgentId: PERSONA,
    });
    await waitFor(() => expect(passMock).toHaveBeenCalledTimes(2), { timeout: WAIT });
  });

  it('budgets by how much is in the room', async () => {
    await seedRoom(3);
    renderHarness();
    await waitFor(() => expect(passMock).toHaveBeenCalledTimes(1), { timeout: WAIT });
    // 三张卡 = 预算 2 条。这个数必须真的传进调用，不能只写死在文档里。
    expect(passMock.mock.calls[0]?.[0].maxMessages).toBe(2);
  });

  it('raises the budget when the room fills up', async () => {
    await seedRoom(4);
    renderHarness();
    await waitFor(() => expect(passMock).toHaveBeenCalledTimes(1), { timeout: WAIT });
    expect(passMock.mock.calls[0]?.[0].maxMessages).toBe(3);
  });

  it('leaves no message when the model chooses silence', async () => {
    passMock.mockResolvedValue({ messages: [] });
    await seedRoom(3);
    renderHarness();
    await waitFor(() => expect(passMock).toHaveBeenCalledTimes(1), { timeout: WAIT });
    const row = await db.canvasPersonaThreads.get(`${CANVAS}:${PERSONA}`);
    expect(row?.messages).toEqual([]);
    // 关键：沉默也要推进指纹，否则同一份内容会被一次又一次送去问模型。
    await waitFor(async () => {
      const node = await db.nodes.get(PERSONA);
      expect(node?.proactiveLastSignature).toBeTruthy();
    });
  });

  it('drops the pass and does not record it when the user talks mid-flight', async () => {
    let release!: () => void;
    passMock.mockReturnValueOnce(
      new Promise((resolve) => {
        release = () => resolve({ messages: ['来得太晚了。'] });
      }) as never,
    );
    await seedRoom(3);
    renderHarness();
    await waitFor(() => expect(passMock).toHaveBeenCalledTimes(1), { timeout: WAIT });

    const threadId = `${CANVAS}:${PERSONA}`;
    await db.canvasPersonaThreads.put({
      id: threadId,
      canvasId: CANVAS,
      agentNodeId: PERSONA,
      messages: [
        { id: 'm-user', role: 'user', text: '等等，先别急。', createdAt: Date.now() },
      ],
      updatedAt: Date.now(),
    });
    release();
    await new Promise((r) => setTimeout(r, WAIT));

    const row = await db.canvasPersonaThreads.get(threadId);
    expect(row?.messages).toHaveLength(1);
    expect(row?.messages[0]?.role).toBe('user');
    const node = await db.nodes.get(PERSONA);
    expect(node?.proactiveLastSignature).toBeUndefined();
  });

  it('never fires once the user turned rooms off', async () => {
    setAutoAnnotationEnabled('room', false);
    await seedRoom(3);
    renderHarness();
    await waitFor(() => expect(passMock).not.toHaveBeenCalled(), { timeout: WAIT });
  });

  it('turning it off voids a pass already in flight, and turning it back on wakes it', async () => {
    let release!: () => void;
    passMock.mockReturnValueOnce(
      new Promise((resolve) => {
        release = () => resolve({ messages: ['这条不该留下。'] });
      }) as never,
    );
    await seedRoom(3);
    const { api } = renderHarness();
    await waitFor(() => expect(passMock).toHaveBeenCalledTimes(1), { timeout: WAIT });

    await api().setEnabled(false);
    release();
    await new Promise((r) => setTimeout(r, WAIT));

    const row = await db.canvasPersonaThreads.get(`${CANVAS}:${PERSONA}`);
    expect(row?.messages ?? []).toEqual([]);
    expect(isAutoAnnotationEnabled('room')).toBe(false);

    await api().setEnabled(true);
    expect(isAutoAnnotationEnabled('room')).toBe(true);
    // 重新打开要抹掉指纹，否则要等下一次改动才醒，等同于没打开。
    const reopened = await db.nodes.get(PERSONA);
    expect(reopened?.proactiveLastSignature).toBeUndefined();
  });

  it('surfaces the pass on the persona card and takes it away afterwards', async () => {
    await seedRoom(3);
    renderHarness();
    const pill = await screen.findByTestId('proactive-status', undefined, { timeout: WAIT });
    expect(pill).toHaveAttribute('data-count', '3');
    await waitFor(() => expect(passMock).toHaveBeenCalled(), { timeout: WAIT });
    await waitFor(() => expect(screen.queryByTestId('proactive-status')).toBeNull(), {
      timeout: WAIT,
    });
  });
});
