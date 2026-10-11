import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { useRef } from 'react';
import { AppDialogProvider } from '../../src/components/AppDialogProvider';

// Lazy import so we can vi.resetModules between tests and re-mock dependencies in one place.

const stop = vi.fn(async () => undefined);
const startMicCapture = vi.fn(async () => ({ stop }));

const asrSession = {
  sendPcm: vi.fn(),
  finish: vi.fn(),
  close: vi.fn(),
};
// Use `any` for the mock signature so we can pass options through the vi.mock wrapper
// without forcing a public type for the test-only mock. Production types are validated
// by tests of the real implementation; this mock just needs to round-trip its args.
// 真实的 openVolcAsrSession 是 async（返回 Promise<session>），替身也得是：
// 同步返回的话，下面那次 mockImplementationOnce 覆写成 Promise 就对不上签名。
const openVolcAsrSession = vi.fn(async (_creds?: unknown, _options?: unknown) => asrSession);
const hasVolcAsrCredentials = vi.fn(() => true);

const setStreamingAiNodeIdMock = vi.fn();
const setCanvasTransformMock = vi.fn();

const callUniversalAIMock = vi.fn(async (_args?: unknown) => 'AI reply');

const playVoiceCueMock = vi.fn();
vi.mock('../../src/utils/voiceCue', () => ({
  playVoiceCue: (kind: 'on' | 'off') => playVoiceCueMock(kind),
}));

// Module-level db mock so individual tests can override get/update with a backing store.
// `add` records into a Map, `get` reads from it, `update` merges into it. This lets us
// reproduce "user edited the note while ASR was live" without spinning up fake-indexeddb.
const dbNodeStore = new Map<string, { id: string; content: string; canvasId: string; type: string; x: number; y: number }>();
// Loose typing on purpose — the test only needs the mock to round-trip args.
const dbNodesAddMock = vi.fn(async (n: { id: string; content?: string; canvasId?: string; type?: string; x?: number; y?: number }) => {
  const node = { id: n.id, content: n.content ?? '', canvasId: n.canvasId ?? 'c1', type: n.type ?? 'text', x: n.x ?? 0, y: n.y ?? 0 };
  dbNodeStore.set(n.id, node);
  return n.id;
});
const dbNodesUpdateMock = vi.fn(async (id: string, changes: Partial<{ content: string }>) => {
  const existing = dbNodeStore.get(id);
  if (existing) dbNodeStore.set(id, { ...existing, ...changes });
  return undefined;
});
const dbNodesGetMock = vi.fn(async (id: string) => dbNodeStore.get(id));

vi.mock('../../src/services/micCapture', () => ({
  startMicCapture: () => startMicCapture(),
}));
vi.mock('../../src/services/volcAsr', () => ({
  openVolcAsrSession: (creds: unknown, handlers: unknown, opts?: unknown) =>
    (openVolcAsrSession as unknown as (c: unknown, h: unknown, o?: unknown) => unknown)(
      creds,
      handlers,
      opts,
    ),
  hasVolcAsrCredentials: () => hasVolcAsrCredentials(),
}));
vi.mock('../../src/db', () => ({
  db: {
    nodes: {
      add: (n: unknown) => dbNodesAddMock(n as Parameters<typeof dbNodesAddMock>[0]),
      update: (id: unknown, changes: unknown) =>
        dbNodesUpdateMock(id as string, changes as Parameters<typeof dbNodesUpdateMock>[1]),
      get: (id: unknown) => dbNodesGetMock(id as string),
      where: () => ({ equals: () => ({ toArray: async () => [] }) }),
    },
    edges: {
      add: vi.fn(async (e: { id: string }) => e.id),
      delete: vi.fn(async () => undefined),
      where: () => ({ equals: () => ({ toArray: async () => [] }) }),
    },
    agents: {
      toArray: async () => [],
    },
  },
}));
vi.mock('../../src/services/ai', () => ({
  callUniversalAI: (...args: unknown[]) => callUniversalAIMock(...args),
  formatAiError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
vi.mock('../../src/utils/canvasStreamingAi', () => ({
  runCanvasStreamingAiCall: vi.fn(async ({ callAi }: { callAi: (cb: (s: string) => void) => Promise<void> | void }) => {
    await (callAi as (s: any) => any)('hello');
    return 'AI reply';
  }),
}));
vi.mock('../../src/utils/voiceNoteLayout', () => ({
  voiceAiPosition: (anchor: { x: number; y: number }) => ({ x: anchor.x + 200, y: anchor.y + 200 }),
  voiceUserPosition: (anchor: { x: number; y: number }) => ({ x: anchor.x, y: anchor.y + 100 }),
  transformToFocusNode: () => ({ x: 0, y: 0, scale: 1 }),
}));
vi.mock('../../src/utils/canvas', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/canvas')>();
  return {
    ...actual,
    getCanvasCenterPosition: () => ({ x: 100, y: 200 }),
  };
});
vi.mock('../../src/services/minimaxTts', () => ({
  synthesizeMinimaxSpeech: vi.fn(async () => new Blob()),
}));
vi.mock('../../src/services/minimaxTtsStream', () => ({
  // 记下参数是为了断言"这条流是按谁的音色开的"。
  openMinimaxTtsStream: vi.fn(async (_options?: unknown) => defaultTtsStream()),
}));

/** 一条"立刻放完"的假流。用例要模拟播放时长/录音时用 mockImplementationOnce 覆盖。 */
function defaultTtsStream(overrides?: Partial<{
  enqueueText: () => void;
  finish: () => void;
  waitUntilIdle: () => Promise<void>;
  stop: () => void;
  takeRecordedWavBytes: () => Uint8Array | null;
}>) {
  return {
    enqueueText: vi.fn(),
    finish: vi.fn(),
    waitUntilIdle: vi.fn(async () => undefined),
    stop: vi.fn(),
    takeRecordedWavBytes: vi.fn(() => null),
    ...overrides,
  };
}

import { openMinimaxTtsStream } from '../../src/services/minimaxTtsStream';

beforeEach(() => {
  stop.mockClear();
  stop.mockResolvedValue(undefined);
  startMicCapture.mockClear();
  openVolcAsrSession.mockClear();
  hasVolcAsrCredentials.mockClear();
  hasVolcAsrCredentials.mockReturnValue(true);
  asrSession.sendPcm.mockClear();
  asrSession.close.mockClear();
  setStreamingAiNodeIdMock.mockClear();
  setCanvasTransformMock.mockClear();
  callUniversalAIMock.mockClear();
  playVoiceCueMock.mockClear();
  vi.mocked(openMinimaxTtsStream).mockClear();
  // mockClear 不清实现：每个用例都从"立刻放完"的默认流开始，免得上一个用例的覆盖漏过来。
  vi.mocked(openMinimaxTtsStream).mockImplementation(async () => defaultTtsStream());
  dbNodeStore.clear();
  dbNodesAddMock.mockClear();
  dbNodesUpdateMock.mockClear();
  dbNodesGetMock.mockClear();
});

async function renderVoiceHook(options?: {
  editingNodeId?: string | null;
  targetAskCardId?: string | null;
  voiceInputMode?: 'handsfree' | 'dictation';
  onTranscript?: (t: string, askId: string) => void;
  onCommit?: (t: string, askId: string) => void;
  onOpenLogin?: () => void;
}) {
  const { useVoiceWritingMode } = await import('../../src/hooks/useVoiceWritingMode');
  const Wrapper = ({ children }: { children: React.ReactNode }) => {
    return React.createElement(AppDialogProvider, null, children);
  };
  const initialEditing = options?.editingNodeId !== undefined ? options.editingNodeId : null;
  const targetAskCardId = options?.targetAskCardId ?? null;
  return renderHook(
    ({ editingNodeId }: { editingNodeId: string | null }) => {
      // Mirror how App.tsx wires the Ask-card target: a ref that the parent
      // can mutate synchronously between renders.
      const ref = useRef<string | null>(targetAskCardId);
      ref.current = targetAskCardId;
      return useVoiceWritingMode({
        aiConfig: {
          provider: 'openai' as const,
          volcAsrApiKey: 'asr',
          minimaxApiKey: 'm',
          voiceInputMode: options?.voiceInputMode,
        } as any,
        activeCanvasId: 'c1',
        transformRef: { current: { x: 0, y: 0, scale: 1 } } as any,
        setCanvasTransform: setCanvasTransformMock,
        editingNodeId,
        setStreamingAiNodeId: setStreamingAiNodeIdMock,
        isAnyAiBusy: false,
        targetAskCardIdRef: ref,
        onTranscript: options?.onTranscript,
        onCommit: options?.onCommit,
        onOpenLogin: options?.onOpenLogin,
      });
    },
    {
      wrapper: Wrapper,
      initialProps: { editingNodeId: initialEditing },
    },
  );
}

describe('useVoiceWritingMode', () => {
  it('rejects back-to-back toggle clicks via the synchronous startingRef gate (#10)', async () => {
    const { result } = await renderVoiceHook();
    await act(async () => {
      result.current.toggleVoiceMode();
      result.current.toggleVoiceMode();
      result.current.toggleVoiceMode();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    // Only the first call should start anything observable; the second/third are dropped.
    expect(startMicCapture).toHaveBeenCalledTimes(1);
    expect(openVolcAsrSession).toHaveBeenCalledTimes(1);
  });

  it('offers sign-in when ASR keys are missing and the user can log in', async () => {
    hasVolcAsrCredentials.mockReturnValue(false);
    const onOpenLogin = vi.fn();
    const user = userEvent.setup();
    const { result } = await renderVoiceHook({ onOpenLogin });
    await act(async () => {
      result.current.toggleVoiceMode();
    });
    expect(startMicCapture).not.toHaveBeenCalled();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /登录|Sign in/i }));
    expect(onOpenLogin).toHaveBeenCalledTimes(1);
  });

  it('does not open login when the guest dismisses the missing-keys dialog', async () => {
    hasVolcAsrCredentials.mockReturnValue(false);
    const onOpenLogin = vi.fn();
    const user = userEvent.setup();
    const { result } = await renderVoiceHook({ onOpenLogin });
    await act(async () => {
      result.current.toggleVoiceMode();
    });
    await user.click(await screen.findByRole('button', { name: /知道了|OK/i }));
    expect(onOpenLogin).not.toHaveBeenCalled();
    expect(startMicCapture).not.toHaveBeenCalled();
  });

  it('keeps a settings-only alert when ASR keys are missing and login is unavailable', async () => {
    hasVolcAsrCredentials.mockReturnValue(false);
    const { result } = await renderVoiceHook();
    await act(async () => {
      result.current.toggleVoiceMode();
    });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /登录|Sign in/i })).toBeNull();
    expect(screen.getByRole('button', { name: /知道了|OK/i })).toBeInTheDocument();
  });

  it('starts voice without entering fullscreen', async () => {
    const { result } = await renderVoiceHook();
    await act(async () => {
      result.current.toggleVoiceMode();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(startMicCapture).toHaveBeenCalledTimes(1);
    expect(result.current.voiceModeActive).toBe(true);
  });

  it('opens the mic without waiting for the ASR handshake so leading speech is captured', async () => {
    let resolveAsr: (session: typeof asrSession) => void = () => undefined;
    openVolcAsrSession.mockImplementationOnce(
      () =>
        new Promise<typeof asrSession>((resolve) => {
          resolveAsr = resolve;
        }),
    );
    const { result } = await renderVoiceHook();
    await act(async () => {
      result.current.toggleVoiceMode();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(startMicCapture).toHaveBeenCalledTimes(1);
    expect(openVolcAsrSession).toHaveBeenCalledTimes(1);
    resolveAsr(asrSession);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it('releases startingRef after a successful start so the next click can stop voice mode', async () => {
    const { result } = await renderVoiceHook();
    await act(async () => {
      result.current.toggleVoiceMode();
      // Drain through getUserMedia → setPhase('listening') → startingRef.current = false.
      await Promise.resolve();
      await Promise.resolve();
    });
    // Voice mode is now active.
    expect(startMicCapture).toHaveBeenCalledTimes(1);
    // Second click must NOT be silently ignored — it should call stopVoiceMode, which
    // tear-downs the mic capture.
    await act(async () => {
      result.current.toggleVoiceMode();
      await Promise.resolve();
    });
    expect(stop).toHaveBeenCalled();
  });

  // 守护 bf6112f 的"ASR 与人工编辑共存"契约：用户编辑时 ASR 应当让位，提交时取用户文本。
  it('用户编辑便签时，ASR 部分结果不覆盖用户文本；mic-off 提交的是用户文本（不是 ASR 最新片段）', async () => {
    const { result, rerender } = await renderVoiceHook({ editingNodeId: null, voiceInputMode: 'handsfree' });

    // 1) 启动语音模式 —— 创建 user note（add 返回 id）并打开 ASR 会话。
    await act(async () => {
      result.current.toggleVoiceMode();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(startMicCapture).toHaveBeenCalledTimes(1);
    expect(openVolcAsrSession).toHaveBeenCalledTimes(1);
    // 抓取当前 ASR 会话注入的回调。
    const asrOpts = openVolcAsrSession.mock.calls[0]?.[1] as {
      onPartial?: (text: string) => void;
      onDefinite?: (text: string) => void;
    };

    // 2) 找到新建的 user note（add 的第一个参数带 id）。
    const userNoteId = (dbNodesAddMock.mock.calls.find(
      (c) => (c[0] as { type?: string }).type === 'text',
    )?.[0] as { id: string } | undefined)?.id;
    expect(userNoteId).toBeTruthy();

    // 3) 模拟"用户在便签上打字"——直接通过 update 把 db 里的内容写成用户文本。
    //    这相当于 contentEditable 的 onBlur 写库完成。
    await act(async () => {
      await dbNodesUpdateMock(userNoteId!, { content: '用户手动编辑的文本' });
    });
    expect(dbNodeStore.get(userNoteId!)?.content).toBe('用户手动编辑的文本');

    // 4) 重新渲染，把 editingNodeId 设成 user note id，模拟"用户已点进便签编辑"。
    rerender({ editingNodeId: userNoteId! });

    // 5) 触发 ASR onPartial：应当被 applyTranscript 静默丢弃，不写回 db。
    const updateCallsBeforeAsr = dbNodesUpdateMock.mock.calls.length;
    await act(async () => {
      asrOpts.onPartial?.('ASR 临时片段不应覆盖用户');
      await Promise.resolve();
    });
    const afterAsrUpdates = dbNodesUpdateMock.mock.calls
      .slice(updateCallsBeforeAsr)
      .filter((c) => c[0] === userNoteId);
    // 用户的文本必须保留，不被 ASR 改写。
    expect(dbNodeStore.get(userNoteId!)?.content).toBe('用户手动编辑的文本');
    expect(afterAsrUpdates).toEqual([]);

    // 6) 第二次 toggle —— 触发 finishListeningRoundRef。
    await act(async () => {
      result.current.toggleVoiceMode();
      await Promise.resolve();
      await Promise.resolve();
    });

    // 7) callUniversalAI 收到的 prompt 必须包含"用户手动编辑的文本"，不包含 ASR 片段。
    expect(callUniversalAIMock).toHaveBeenCalled();
    const lastCall = callUniversalAIMock.mock.calls.at(-1)?.[0] as { prompt: string };
    expect(lastCall.prompt).toContain('用户手动编辑的文本');
    expect(lastCall.prompt).not.toContain('ASR 临时片段');
  });

  // 配套守护：用户没在编辑时，ASR 正常推进，提交文本来自 ASR。
  it('用户未编辑便签时，ASR 部分结果正常写库；mic-off 提交的是 ASR 当前累积文本', async () => {
    const { result } = await renderVoiceHook({ editingNodeId: null, voiceInputMode: 'handsfree' });
    await act(async () => {
      result.current.toggleVoiceMode();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const asrOpts = openVolcAsrSession.mock.calls[0]?.[1] as {
      onPartial?: (text: string) => void;
    };
    const userNoteId = (dbNodesAddMock.mock.calls.find(
      (c) => (c[0] as { type?: string }).type === 'text',
    )?.[0] as { id: string } | undefined)?.id;
    expect(userNoteId).toBeTruthy();

    // ASR 推进；onDefinite 不会自动提交，applyTranscript 会更新 db。
    await act(async () => {
      asrOpts.onPartial?.('今天天气真好');
      await new Promise((resolve) => setTimeout(resolve, 200));
      await Promise.resolve();
    });
    expect(dbNodeStore.get(userNoteId!)?.content).toBe('今天天气真好');

    await act(async () => {
      result.current.toggleVoiceMode();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(callUniversalAIMock).toHaveBeenCalled();
    const lastCall = callUniversalAIMock.mock.calls.at(-1)?.[0] as { prompt: string };
    expect(lastCall.prompt).toContain('今天天气真好');
  });

  // 守护 d2d42c0 的"ASR 累积 = replace"契约：onDefinite 不再是"开始 AI 轮"，只是累积。
  it('onDefinite 只累积转写，不自动启动 AI 轮（防止半句触发思考）', async () => {
    const { result } = await renderVoiceHook({ editingNodeId: null });
    await act(async () => {
      result.current.toggleVoiceMode();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const asrOpts = openVolcAsrSession.mock.calls[1]?.[1] as {
      onDefinite?: (text: string) => void;
    } | undefined;
    // startListeningLoop 会再次打开 ASR；这里拿最近一次。
    const allAsrOpts = openVolcAsrSession.mock.calls
      .map((c) => c[1] as { onDefinite?: (text: string) => void })
      .filter(Boolean);
    const last = allAsrOpts.at(-1);

    const callCountBefore = callUniversalAIMock.mock.calls.length;
    await act(async () => {
      last?.onDefinite?.('我正在思考的半句话');
      await Promise.resolve();
    });
    // 不应触发 AI 调用。
    expect(callUniversalAIMock.mock.calls.length).toBe(callCountBefore);
  });

  // Ask-card 流：voice mode 不再生成 user-note，ASR 转写通过回调交给父组件。
  it('Ask 卡路径：voice mode 不生成 user-note，ASR 转写走 onTranscript 回调', async () => {
    const onTranscript = vi.fn();
    const onCommit = vi.fn();
    const { result } = await renderVoiceHook({
      targetAskCardId: 'ask-1',
      voiceInputMode: 'handsfree',
      onTranscript,
      onCommit,
    });
    await act(async () => {
      result.current.toggleVoiceMode();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // 关键契约：不创建 user-note (type==='text')。
    const spawnedNote = dbNodesAddMock.mock.calls.find(
      (c) => (c[0] as { type?: string }).type === 'text',
    );
    expect(spawnedNote).toBeUndefined();

    // ASR onPartial 应当走回调，而不是写 db。
    const asrOpts = openVolcAsrSession.mock.calls[0]?.[1] as {
      onPartial?: (text: string) => void;
    };
    dbNodesUpdateMock.mockClear();
    await act(async () => {
      asrOpts.onPartial?.('描述一下这张图');
      await new Promise((resolve) => setTimeout(resolve, 200));
      await Promise.resolve();
    });
    expect(onTranscript).toHaveBeenCalledWith('描述一下这张图', 'ask-1');
    expect(
      dbNodesUpdateMock.mock.calls.filter(([, changes]) =>
        (changes as { content?: string }).content === '描述一下这张图',
      ),
    ).toEqual([]);
  });

  it('Ask 卡路径：ASR 中间结果立刻出现在 liveTranscript（不等卡片 180ms 刷新）', async () => {
    const { result } = await renderVoiceHook({ targetAskCardId: 'ask-1' });
    await act(async () => {
      result.current.toggleVoiceMode();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.voicePhase).toBe('listening');
    expect(result.current.liveTranscript).toBe('');

    const asrOpts = openVolcAsrSession.mock.calls[0]?.[1] as {
      onPartial?: (text: string) => void;
    };
    await act(async () => {
      asrOpts.onPartial?.('你好世界');
    });
    expect(result.current.liveTranscript).toBe('你好世界');
  });

  it('Ask 卡路径：mic-off 触发 onCommit 回调（不会自己调 AI）', async () => {
    const onTranscript = vi.fn();
    const onCommit = vi.fn();
    const { result } = await renderVoiceHook({
      targetAskCardId: 'ask-1',
      voiceInputMode: 'handsfree',
      onTranscript,
      onCommit,
    });
    await act(async () => {
      result.current.toggleVoiceMode();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const asrOpts = openVolcAsrSession.mock.calls[0]?.[1] as {
      onPartial?: (text: string) => void;
    };
    await act(async () => {
      asrOpts.onPartial?.('这段在讲什么');
      await new Promise((resolve) => setTimeout(resolve, 200));
      await Promise.resolve();
    });
    // 第二次 toggle 触发 finishListeningRound。
    const callsBefore = callUniversalAIMock.mock.calls.length;
    await act(async () => {
      result.current.toggleVoiceMode();
      await Promise.resolve();
      await Promise.resolve();
    });
    // Ask 路径不调 AI（由父组件 runAskCardGeneration 负责）。
    expect(callUniversalAIMock.mock.calls.length).toBe(callsBefore);
    expect(onCommit).toHaveBeenCalledWith('这段在讲什么', 'ask-1');
  });

  it('Ask 卡路径：1.5s 静默后自动触发 onCommit', async () => {
    const onTranscript = vi.fn();
    const onCommit = vi.fn();
    const { result } = await renderVoiceHook({
      targetAskCardId: 'ask-1',
      voiceInputMode: 'handsfree',
      onTranscript,
      onCommit,
    });
    await act(async () => {
      result.current.toggleVoiceMode();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const asrOpts = openVolcAsrSession.mock.calls[0]?.[1] as {
      onPartial?: (text: string) => void;
    };
    // ASR 推进：onPartial 触发 onTranscript 并 arm 静默计时器。
    await act(async () => {
      asrOpts.onPartial?.('这段在讲什么');
      await new Promise((resolve) => setTimeout(resolve, 200));
      await Promise.resolve();
    });
    expect(onTranscript).toHaveBeenCalledWith('这段在讲什么', 'ask-1');
    // 第二次 toggle 不发生 —— 等静默计时器 1.5s 后自动触发。
    const callsBefore = callUniversalAIMock.mock.calls.length;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1600));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onCommit).toHaveBeenCalledWith('这段在讲什么', 'ask-1');
    expect(callUniversalAIMock.mock.calls.length).toBe(callsBefore);
  });

  it('转写模式：1.5s 静默不会 onCommit，文字留在输入框', async () => {
    const onTranscript = vi.fn();
    const onCommit = vi.fn();
    const { result } = await renderVoiceHook({
      targetAskCardId: 'ask-1',
      voiceInputMode: 'dictation',
      onTranscript,
      onCommit,
    });
    await act(async () => {
      result.current.toggleVoiceMode();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const asrOpts = openVolcAsrSession.mock.calls[0]?.[1] as {
      onPartial?: (text: string) => void;
    };
    await act(async () => {
      asrOpts.onPartial?.('我在 Redis 上面看到一个帖子');
      await new Promise((resolve) => setTimeout(resolve, 200));
      await Promise.resolve();
    });
    expect(onTranscript).toHaveBeenCalledWith('我在 Redis 上面看到一个帖子', 'ask-1');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1600));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onCommit).not.toHaveBeenCalled();
    expect(result.current.voiceModeActive).toBe(true);
    expect(result.current.voicePhase).toBe('listening');
  });

  it('转写模式：再点麦克风结束听写但不发送，进入 draft', async () => {
    const onTranscript = vi.fn();
    const onCommit = vi.fn();
    const { result } = await renderVoiceHook({
      targetAskCardId: 'ask-1',
      voiceInputMode: 'dictation',
      onTranscript,
      onCommit,
    });
    await act(async () => {
      result.current.toggleVoiceMode();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const asrOpts = openVolcAsrSession.mock.calls[0]?.[1] as {
      onPartial?: (text: string) => void;
    };
    await act(async () => {
      asrOpts.onPartial?.('这段先改再发');
      await new Promise((resolve) => setTimeout(resolve, 200));
      await Promise.resolve();
    });
    await act(async () => {
      result.current.toggleVoiceMode();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onCommit).not.toHaveBeenCalled();
    expect(result.current.voiceModeActive).toBe(true);
    expect(result.current.voicePhase).toBe('draft');
  });

  it('转写模式：草稿里再点麦克风退出语音，不发送', async () => {
    const onCommit = vi.fn();
    const { result } = await renderVoiceHook({
      targetAskCardId: 'ask-1',
      voiceInputMode: 'dictation',
      onCommit,
    });
    await act(async () => {
      result.current.toggleVoiceMode();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const asrOpts = openVolcAsrSession.mock.calls[0]?.[1] as {
      onPartial?: (text: string) => void;
    };
    await act(async () => {
      asrOpts.onPartial?.('这段先改再发');
      await new Promise((resolve) => setTimeout(resolve, 200));
      await Promise.resolve();
    });
    await act(async () => {
      result.current.toggleVoiceMode();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.voicePhase).toBe('draft');
    await act(async () => {
      result.current.toggleVoiceMode();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onCommit).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(result.current.voiceModeActive).toBe(false);
    });
    expect(result.current.voicePhase).toBe('idle');
  });

  it('stopTts 清掉挂着的提交：用户说了一段 → 点 stop → 静默定时器不再触发 onCommit', async () => {
    const onCommit = vi.fn();
    const { result } = await renderVoiceHook({
      targetAskCardId: 'ask-1',
      voiceInputMode: 'handsfree',
      onCommit,
    });
    await act(async () => {
      result.current.toggleVoiceMode();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const asrOpts = openVolcAsrSession.mock.calls[0]?.[1] as {
      onPartial?: (text: string) => void;
    };
    // 用户说了一段并进入静默倒计时窗口（1.5s）。
    await act(async () => {
      asrOpts.onPartial?.('这段不该被发出去');
      await Promise.resolve();
    });
    // 用户中途点 stop —— 应该取消挂着的提交。
    await act(async () => {
      await result.current.stopTts();
      await Promise.resolve();
    });
    // 等过静默窗口。
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1800));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('pushTtsChunk → endTtsReply：暴露在 hook 返回值上、按累积 chunk 顺序入队', async () => {
    const { result } = await renderVoiceHook({ targetAskCardId: 'ask-1' });
    // Voice mode exposes both the chunk-pusher and the finalizer for streaming-TTS wiring.
    expect(typeof result.current.pushTtsChunk).toBe('function');
    expect(typeof result.current.endTtsReply).toBe('function');
    // Old speakReply is gone — voice mode owns the TTS lifecycle now.
    expect((result.current as any).speakReply).toBeUndefined();

    // The pipeline (push → end) does not throw when voice mode is anchored on
    // an Ask card. The actual chunk → sentence split is exercised inside the
    // ttsSentenceQueue tests; here we just verify the integration glue.
    await act(async () => {
      result.current.toggleVoiceMode();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      result.current.pushTtsChunk('reply-1', '```speak\n概况。\n```\n你好。');
      result.current.pushTtsChunk('reply-1', '```speak\n概况。\n```\n你好。今天天气真好。后面还有展开。');
      await Promise.resolve();
    });
    expect(openMinimaxTtsStream).toHaveBeenCalledTimes(1);
    await act(async () => {
      await result.current.endTtsReply('reply-1', '你好。今天天气真好。后面还有展开。');
      await Promise.resolve();
    });
    // Must reuse the warmed stream — killing it here would delay the first sentence.
    expect(openMinimaxTtsStream).toHaveBeenCalledTimes(1);
  });

  it('markThinking 进入思考且不朗读垫话', async () => {
    const { result } = await renderVoiceHook({ targetAskCardId: 'ask-1' });
    await act(async () => {
      result.current.toggleVoiceMode();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      result.current.markThinking();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.voicePhase).toBe('thinking');
    expect(openMinimaxTtsStream).toHaveBeenCalled();
  });

  describe('voice cues', () => {
    it('fires on-cue once after voice mode fully boots', async () => {
      const { result } = await renderVoiceHook();
      await act(async () => {
        result.current.toggleVoiceMode();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      // mic + ASR are live → on-cue fired exactly once.
      expect(playVoiceCueMock).toHaveBeenCalledTimes(1);
      expect(playVoiceCueMock).toHaveBeenCalledWith('on');
    });

    it('fires off-cue when voice mode fully exits (mic-off with no spoken text)', async () => {
      const { result } = await renderVoiceHook();
      await act(async () => {
        result.current.toggleVoiceMode();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(playVoiceCueMock).toHaveBeenCalledWith('on');
      // No transcript was produced → finishListeningRound's "nothing spoken" branch
      // falls through to stopVoiceMode, which fires the off-cue.
      await act(async () => {
        result.current.toggleVoiceMode();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(playVoiceCueMock).toHaveBeenCalledTimes(2);
      expect(playVoiceCueMock).toHaveBeenNthCalledWith(1, 'on');
      expect(playVoiceCueMock).toHaveBeenNthCalledWith(2, 'off');
    });

    it('does NOT fire off-cue when mic-off only submits a turn (Ask-card path)', async () => {
      const onCommit = vi.fn();
      const { result } = await renderVoiceHook({
        targetAskCardId: 'ask-1',
        voiceInputMode: 'handsfree',
        onCommit,
      });
      await act(async () => {
        result.current.toggleVoiceMode();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(playVoiceCueMock).toHaveBeenCalledWith('on');

      // Speak a sentence via ASR so finishListeningRound has text to commit.
      const asrOpts = openVolcAsrSession.mock.calls.at(-1)?.[1] as {
        onPartial?: (text: string) => void;
      };
      await act(async () => {
        asrOpts.onPartial?.('这段在讲什么');
        await Promise.resolve();
      });
      // Second toggle = finishListeningRound → onCommit, NOT stopVoiceMode.
      await act(async () => {
        result.current.toggleVoiceMode();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(onCommit).toHaveBeenCalledWith('这段在讲什么', 'ask-1');
      // Voice mode continues → only the on-cue fires, no off-cue.
      expect(playVoiceCueMock).toHaveBeenCalledTimes(1);
      expect(playVoiceCueMock).toHaveBeenCalledWith('on');
    });

    it('does NOT fire any cue when voice mode fails to start (mic denied)', async () => {
      // Simulate getUserMedia rejection (mic permission denied).
      const micError = new Error('Permission denied');
      micError.name = 'NotAllowedError';
      startMicCapture.mockImplementationOnce(async () => {
        throw micError;
      });
      const { result } = await renderVoiceHook();
      await act(async () => {
        result.current.toggleVoiceMode();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      // rollbackOnStartFailure path → no cue, just the alert.
      expect(playVoiceCueMock).not.toHaveBeenCalled();
    });
  });
});

// 会话朗读按发言人换音色：房间里几个角色各念各的，划线跟着正在念的那条回复走。
describe('useVoiceWritingMode · 会话朗读的发言人音色', () => {
  type StreamOptions = {
    voiceId?: string;
    onActiveTextChange?: (sentence: string | null) => void;
  };
  const streamAt = (i: number) =>
    vi.mocked(openMinimaxTtsStream).mock.calls[i]?.[0] as StreamOptions | undefined;

  async function startVoice() {
    const rendered = await renderVoiceHook({ targetAskCardId: 'ask-1' });
    await act(async () => {
      rendered.result.current.toggleVoiceMode();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    return rendered;
  }

  it('markThinking 就按这个角色的音色开流（回复卡还没出现，也不能用错声音）', async () => {
    const { result } = await startVoice();
    await act(async () => {
      result.current.markThinking('female-yujie');
      await Promise.resolve();
    });
    await act(async () => {
      result.current.pushTtsChunk('reply-1', '第一句。', 'female-yujie');
      await Promise.resolve();
    });
    // 热好的那条流被这条回复认领，不另开一条
    expect(openMinimaxTtsStream).toHaveBeenCalledTimes(1);
    expect(streamAt(0)?.voiceId).toBe('female-yujie');
  });

  it('划线：回复卡 id 后到也能点亮（不再被建队列时捕获的 null 吃掉）', async () => {
    const { result } = await startVoice();
    await act(async () => {
      result.current.markThinking();
      result.current.pushTtsChunk('reply-1', '第一句。第二句。');
      await Promise.resolve();
    });
    await act(async () => {
      streamAt(0)?.onActiveTextChange?.('第一句。');
      await Promise.resolve();
    });
    expect(result.current.ttsHighlight).toEqual({ nodeId: 'reply-1', sentence: '第一句。' });
  });

  it('房间里主人答完参与者接话：一条一条念，各用各的音色，划线跟着换人', async () => {
    const { result } = await startVoice();
    await act(async () => {
      result.current.markThinking('Chinese (Mandarin)_Gentleman');
      result.current.pushTtsChunk('reply-host', '主人先说。', 'Chinese (Mandarin)_Gentleman');
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      result.current.pushTtsChunk('reply-peer', '参与者接话。', 'female-yujie');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    // 换人就换流：第二位的流按他自己的音色开
    expect(openMinimaxTtsStream).toHaveBeenCalledTimes(2);
    expect(streamAt(0)?.voiceId).toBe('Chinese (Mandarin)_Gentleman');
    expect(streamAt(1)?.voiceId).toBe('female-yujie');
    await act(async () => {
      streamAt(1)?.onActiveTextChange?.('参与者接话。');
      await Promise.resolve();
    });
    expect(result.current.ttsHighlight).toEqual({ nodeId: 'reply-peer', sentence: '参与者接话。' });
  });

  it('收尾：最后一位念完就清掉划线、重新开麦', async () => {
    // 免提模式才"念完继续听"；转写模式念完就是退出语音模式（既有行为）。
    const { result } = await renderVoiceHook({
      targetAskCardId: 'ask-1',
      voiceInputMode: 'handsfree',
    });
    await act(async () => {
      result.current.toggleVoiceMode();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const asrSessionsBefore = openVolcAsrSession.mock.calls.length;
    await act(async () => {
      result.current.markThinking('female-yujie');
      result.current.pushTtsChunk('reply-1', '你好。', 'female-yujie');
      await Promise.resolve();
    });
    await act(async () => {
      await result.current.endTtsReply('reply-1', '你好。');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.ttsHighlight).toBeNull();
    expect(result.current.voiceModeActive).toBe(true);
    expect(openVolcAsrSession.mock.calls.length).toBeGreaterThan(asrSessionsBefore);
  });

  it('手动朗读（喇叭）依旧按角色音色念', async () => {
    const { result } = await startVoice();
    await act(async () => {
      await result.current.speakMessage('m2', '第一句。第二句。', 'female-yujie');
      await Promise.resolve();
    });
    expect(streamAt(0)?.voiceId).toBe('female-yujie');
  });
});

describe('useVoiceWritingMode · 念完之后语音模式还在', () => {
  const streamAt = (i: number) =>
    vi.mocked(openMinimaxTtsStream).mock.calls[i]?.[0] as
      | { voiceId?: string; recordAudio?: boolean }
      | undefined;

  async function startVoice(voiceInputMode: 'handsfree' | 'dictation' = 'handsfree') {
    const rendered = await renderVoiceHook({ targetAskCardId: 'ask-1', voiceInputMode });
    await act(async () => {
      rendered.result.current.toggleVoiceMode();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    return rendered;
  }

  it('转写模式：一轮念完不退出语音模式，直接接着听（回归）', async () => {
    const { result } = await startVoice('dictation');
    await act(async () => {
      result.current.markThinking('female-yujie');
      result.current.pushTtsChunk('reply-1', '我先说。', 'female-yujie');
      await Promise.resolve();
    });
    const asrBefore = openVolcAsrSession.mock.calls.length;
    await act(async () => {
      await result.current.endTtsReply('reply-1', '我先说。');
      await Promise.resolve();
      await Promise.resolve();
    });
    // 以前这里会 stopVoiceMode()，房间里的角色挨个说完就被踢出语音模式
    expect(result.current.voiceModeActive).toBe(true);
    expect(result.current.voicePhase).not.toBe('idle');
    expect(openVolcAsrSession.mock.calls.length).toBeGreaterThan(asrBefore);
  });

  it('房间里三个人依次念完：语音模式还在，三条流按各自的音色、按说话顺序开', async () => {
    const { result } = await startVoice();
    await act(async () => {
      result.current.markThinking('Chinese (Mandarin)_Gentleman');
      result.current.pushTtsChunk('reply-host', '主人先说。', 'Chinese (Mandarin)_Gentleman');
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      result.current.pushTtsChunk('reply-peer-1', '甲接话。', 'female-yujie');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      result.current.pushTtsChunk('reply-peer-2', '乙也说话。', 'male-qn-badao');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await result.current.endTtsReply('reply-peer-2', '乙也说话。');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(streamAt(0)?.voiceId).toBe('Chinese (Mandarin)_Gentleman');
    expect(streamAt(1)?.voiceId).toBe('female-yujie');
    expect(streamAt(2)?.voiceId).toBe('male-qn-badao');
    expect(result.current.voiceModeActive).toBe(true);
  });

  it('前一位还在放音时，下一位的流不会同时开（一条接一条）', async () => {
    const { result } = await startVoice();
    let releaseFirst = () => {};
    const firstPlayback = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let opened = 0;
    vi.mocked(openMinimaxTtsStream).mockImplementation(async () => {
      opened += 1;
      return defaultTtsStream(
        opened === 1 ? { waitUntilIdle: () => firstPlayback } : undefined,
      );
    });

    await act(async () => {
      result.current.markThinking('Chinese (Mandarin)_Gentleman');
      result.current.pushTtsChunk('reply-host', '主人先说。', 'Chinese (Mandarin)_Gentleman');
      await Promise.resolve();
    });
    await act(async () => {
      // 第二位开口 = 上一位收口，但上一位的音频还在放
      result.current.pushTtsChunk('reply-peer', '甲接话。', 'female-yujie');
      await Promise.resolve();
      await Promise.resolve();
    });
    // 抢跑就会在这里看到第二条流；实际上要等第一条放完
    expect(openMinimaxTtsStream).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseFirst();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(openMinimaxTtsStream).toHaveBeenCalledTimes(2);
    expect(streamAt(1)?.voiceId).toBe('female-yujie');
  });

  it('没开录音的日常朗读不会顺手录（不留内存）', async () => {
    const { result } = await startVoice();
    await act(async () => {
      result.current.markThinking('female-yujie');
      result.current.pushTtsChunk('reply-1', '你好。', 'female-yujie');
      await Promise.resolve();
    });
    expect(streamAt(0)?.recordAudio).toBeUndefined();
  });
});
