import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { AIConfig } from '../../src/components/AISettingsModal';

const playVoiceCueMock = vi.fn();
vi.mock('../../src/utils/voiceCue', () => ({
  playVoiceCue: (kind: 'on' | 'off') => playVoiceCueMock(kind),
}));

const micStop = vi.fn(async () => undefined);
const asrClose = vi.fn();
let asrHandlers: { onPartial?: (text: string) => void } = {};

vi.mock('../../src/services/startMicAndAsr', () => ({
  startMicAndAsrSession: vi.fn(async (_creds: unknown, handlers: { onPartial?: (text: string) => void }) => {
    asrHandlers = handlers;
    return {
      mic: { stop: micStop },
      session: { sendPcm: vi.fn(), finish: vi.fn(), close: asrClose },
    };
  }),
}));

vi.mock('../../src/services/volcAsr', () => ({
  hasVolcAsrCredentials: () => true,
}));

vi.mock('../../src/lib/serverConfig', () => ({
  hasMinimaxTtsAccess: () => true,
}));

vi.mock('../../src/utils/ttsSentenceQueue', () => ({
  createTtsSentenceQueue: () => ({
    pushAccumulatedText: vi.fn(),
    flush: vi.fn(),
    waitUntilIdle: vi.fn(async () => undefined),
    stop: vi.fn(),
  }),
}));

import { useChatVoice } from '../../src/hooks/useChatVoice';

const aiConfig = {
  provider: 'openrouter',
  apiKey: 'k',
  baseUrl: '',
  model: 'x',
  volcAsrApiKey: 'asr',
  minimaxApiKey: 'm',
} as AIConfig;

describe('useChatVoice cues', () => {
  beforeEach(() => {
    playVoiceCueMock.mockClear();
    micStop.mockClear();
    asrClose.mockClear();
    asrHandlers = {};
  });

  it('plays the on-cue once mic and ASR are live', async () => {
    const { result } = renderHook(() =>
      useChatVoice({
        aiConfig,
        sendMessage: async () => 'reply',
      }),
    );
    await act(async () => {
      await result.current.toggle();
    });
    expect(playVoiceCueMock).toHaveBeenCalledTimes(1);
    expect(playVoiceCueMock).toHaveBeenCalledWith('on');
    expect(result.current.phase).toBe('listening');
  });

  it('does not chime when the essay editor mounts or unmounts without voice', () => {
    const { unmount } = renderHook(() =>
      useChatVoice({
        aiConfig,
        sendMessage: async () => 'reply',
      }),
    );
    unmount();
    expect(playVoiceCueMock).not.toHaveBeenCalled();
  });

  it('plays the off-cue when voice mode exits with nothing spoken', async () => {
    const { result } = renderHook(() =>
      useChatVoice({
        aiConfig,
        sendMessage: async () => 'reply',
      }),
    );
    await act(async () => {
      await result.current.toggle();
    });
    await act(async () => {
      await result.current.toggle();
    });
    expect(playVoiceCueMock).toHaveBeenNthCalledWith(1, 'on');
    expect(playVoiceCueMock).toHaveBeenNthCalledWith(2, 'off');
    expect(result.current.active).toBe(false);
  });

  it('plays the on-cue again after the AI reply so the user can speak', async () => {
    const sendMessage = vi.fn(async () => '先看约束。');
    const { result } = renderHook(() =>
      useChatVoice({
        aiConfig: { ...aiConfig, voiceInputMode: 'handsfree' },
        sendMessage,
      }),
    );
    await act(async () => {
      await result.current.toggle();
    });
    act(() => {
      asrHandlers.onPartial?.('这个方案怎么样');
    });
    await act(async () => {
      await result.current.toggle();
    });
    expect(sendMessage).toHaveBeenCalledWith('这个方案怎么样');
    expect(playVoiceCueMock.mock.calls.map((c) => c[0])).toEqual(['on', 'on']);
    expect(result.current.phase).toBe('listening');
    expect(result.current.active).toBe(true);
  });
});

describe('useChatVoice dictation', () => {
  beforeEach(() => {
    playVoiceCueMock.mockClear();
    micStop.mockClear();
    asrClose.mockClear();
    asrHandlers = {};
  });

  it('keeps the transcript as a draft instead of sending on mic-off', async () => {
    const sendMessage = vi.fn(async () => 'reply');
    const { result } = renderHook(() =>
      useChatVoice({
        aiConfig: { ...aiConfig, voiceInputMode: 'dictation' },
        sendMessage,
      }),
    );
    await act(async () => {
      await result.current.toggle();
    });
    act(() => {
      asrHandlers.onPartial?.('为什么在国内做 AI 应用就这么难');
    });
    await act(async () => {
      await result.current.toggle();
    });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(result.current.active).toBe(true);
    expect(result.current.phase).toBe('draft');
    expect(result.current.partialTranscript).toBe('为什么在国内做 AI 应用就这么难');
  });

  it('lets the user click the mic again in draft to leave voice mode', async () => {
    const sendMessage = vi.fn(async () => 'reply');
    const { result } = renderHook(() =>
      useChatVoice({
        aiConfig: { ...aiConfig, voiceInputMode: 'dictation' },
        sendMessage,
      }),
    );
    await act(async () => {
      await result.current.toggle();
    });
    act(() => {
      asrHandlers.onPartial?.('先写进输入框');
    });
    await act(async () => {
      await result.current.toggle();
    });
    expect(result.current.phase).toBe('draft');
    await act(async () => {
      await result.current.toggle();
    });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(result.current.active).toBe(false);
    expect(result.current.phase).toBe('idle');
  });

  it('sends the composer text when the user clicks send', async () => {
    const sendMessage = vi.fn(async () => 'reply');
    const { result } = renderHook(() =>
      useChatVoice({
        aiConfig: { ...aiConfig, voiceInputMode: 'dictation' },
        sendMessage,
      }),
    );
    await act(async () => {
      await result.current.toggle();
    });
    act(() => {
      asrHandlers.onPartial?.('原稿');
    });
    await act(async () => {
      await result.current.toggle();
    });
    await act(async () => {
      await result.current.commitComposer('改过的问题');
    });
    expect(sendMessage).toHaveBeenCalledWith('改过的问题');
    expect(result.current.active).toBe(false);
  });
});

