import { describe, it, expect, vi, beforeEach } from 'vitest';
import { startMicAndAsrSession } from '../../src/services/startMicAndAsr';

const micStop = vi.fn(async () => undefined);
const sendPcm = vi.fn();
const asrClose = vi.fn();
const asrFinish = vi.fn();

let onPcm: ((pcm: Uint8Array) => void) | undefined;

const startMicCapture = vi.fn(async (cb: (pcm: Uint8Array) => void) => {
  onPcm = cb;
  return { stop: micStop };
});

const openVolcAsrSession = vi.fn(async () => ({
  sendPcm,
  finish: asrFinish,
  close: asrClose,
}));

vi.mock('../../src/services/micCapture', () => ({
  startMicCapture: (cb: (pcm: Uint8Array) => void) => startMicCapture(cb),
}));

vi.mock('../../src/services/volcAsr', () => ({
  openVolcAsrSession: (...a: unknown[]) =>
    (openVolcAsrSession as unknown as (...args: unknown[]) => unknown)(...a),
}));

describe('startMicAndAsrSession', () => {
  beforeEach(() => {
    micStop.mockClear();
    sendPcm.mockClear();
    asrClose.mockClear();
    asrFinish.mockClear();
    startMicCapture.mockClear();
    openVolcAsrSession.mockClear();
    onPcm = undefined;
    startMicCapture.mockImplementation(async (cb: (pcm: Uint8Array) => void) => {
      onPcm = cb;
      return { stop: micStop };
    });
    openVolcAsrSession.mockImplementation(async () => ({
      sendPcm,
      finish: asrFinish,
      close: asrClose,
    }));
  });

  it('starts the mic without waiting for the ASR handshake', async () => {
    let resolveAsr!: (session: { sendPcm: typeof sendPcm; finish: typeof asrFinish; close: typeof asrClose }) => void;
    openVolcAsrSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAsr = resolve;
        }),
    );

    const pending = startMicAndAsrSession({ apiKey: 'k' }, {});
    await Promise.resolve();
    await Promise.resolve();

    expect(startMicCapture).toHaveBeenCalledTimes(1);
    expect(openVolcAsrSession).toHaveBeenCalledTimes(1);

    onPcm?.(new Uint8Array([1, 2]));
    onPcm?.(new Uint8Array([3, 4]));
    expect(sendPcm).not.toHaveBeenCalled();

    resolveAsr({ sendPcm, finish: asrFinish, close: asrClose });
    await pending;
    expect(sendPcm).toHaveBeenCalledTimes(2);
    expect(sendPcm.mock.calls[0]?.[0]).toEqual(new Uint8Array([1, 2]));
    expect(sendPcm.mock.calls[1]?.[0]).toEqual(new Uint8Array([3, 4]));
  });

  it('fires onMicReady when the mic is granted, before ASR finishes', async () => {
    let resolveAsr!: (session: { sendPcm: typeof sendPcm; finish: typeof asrFinish; close: typeof asrClose }) => void;
    openVolcAsrSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAsr = resolve;
        }),
    );
    const onMicReady = vi.fn();

    const pending = startMicAndAsrSession({ apiKey: 'k' }, {}, { onMicReady });
    await Promise.resolve();
    await Promise.resolve();

    expect(onMicReady).toHaveBeenCalledTimes(1);

    resolveAsr({ sendPcm, finish: asrFinish, close: asrClose });
    await pending;
    expect(onMicReady).toHaveBeenCalledTimes(1);
  });

  it('does not fire onMicReady when getUserMedia fails', async () => {
    const onMicReady = vi.fn();
    startMicCapture.mockRejectedValueOnce(new Error('Permission denied'));
    await expect(
      startMicAndAsrSession({ apiKey: 'k' }, {}, { onMicReady }),
    ).rejects.toThrow(/Permission denied/);
    expect(onMicReady).not.toHaveBeenCalled();
  });

  it('closes ASR when getUserMedia fails', async () => {
    startMicCapture.mockRejectedValueOnce(new Error('Permission denied'));
    await expect(startMicAndAsrSession({ apiKey: 'k' }, {})).rejects.toThrow(/Permission denied/);
    await Promise.resolve();
    await Promise.resolve();
    expect(asrClose).toHaveBeenCalled();
  });

  it('stops the mic when ASR open fails', async () => {
    openVolcAsrSession.mockRejectedValueOnce(new Error('token failed'));
    await expect(startMicAndAsrSession({ apiKey: 'k' }, {})).rejects.toThrow(/token failed/);
    await Promise.resolve();
    await Promise.resolve();
    expect(micStop).toHaveBeenCalled();
  });
});
