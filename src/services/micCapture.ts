/**
 * Capture microphone PCM s16le @ 16 kHz for Volc ASR.
 */

import { downsampleTo16k, floatTo16BitPcm } from '../utils/pcm16k';

export type MicCapture = {
  stop: () => Promise<void>;
};

/**
 * Like `navigator.mediaDevices.getUserMedia(...)` but cancellable. `getUserMedia` itself
 * doesn't honor AbortSignal — we pipe through `signal` so a stop() that races with a still-
 * pending capture can short-circuit before the user gets a "permission denied" microtask storm.
 */
function getUserMediaCancellable(
  constraints: MediaStreamConstraints,
  signal: AbortSignal,
): Promise<MediaStream> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    navigator.mediaDevices
      .getUserMedia(constraints)
      .then((stream) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) {
          for (const track of stream.getTracks()) track.stop();
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        resolve(stream);
      })
      .catch((err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      });
  });
}

export async function startMicCapture(onPcm: (pcm: Uint8Array) => void): Promise<MicCapture> {
  const abort = new AbortController();
  const stream = await getUserMediaCancellable(
    {
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    },
    abort.signal,
  );

  const audioCtx = new AudioContext();
  // Some browsers start the context suspended (autoplay policy). If suspended, onaudioprocess
  // fires with zero-filled input buffers → silent PCM → ASR VAD never fires → no results.
  if (audioCtx.state === 'suspended') {
    console.log('[Spoor Mic] AudioContext suspended, resuming');
    try {
      await audioCtx.resume();
    } catch (e) {
      console.warn('[Spoor Mic] resume failed', e);
    }
  }
  const tracks = stream.getAudioTracks();
  tracks.forEach((t) => {
    t.onmute = () => console.warn('[Spoor Mic] track muted by system', t.label);
    t.onended = () => console.warn('[Spoor Mic] track ended', t.label);
  });

  const source = audioCtx.createMediaStreamSource(stream);
  // ~200ms at context rate → good for Volc packet sizing after downsample
  const bufferSize = 4096;
  const processor = audioCtx.createScriptProcessor(bufferSize, 1, 1);

  let silentStreak = 0;
  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    const down = downsampleTo16k(input, audioCtx.sampleRate);
    if (down.length === 0) return;
    const pcm = floatTo16BitPcm(down);
    let sumSq = 0;
    for (let i = 0; i < input.length; i++) {
      const v = input[i]!;
      sumSq += v * v;
    }
    const rms = input.length > 0 ? Math.sqrt(sumSq / input.length) : 0;
    if (rms < 0.0001) silentStreak += 1; else silentStreak = 0;
    if (silentStreak === 5) {
      console.warn('[Spoor Mic] 5 consecutive silent frames — mic device may be muted, wrong default device, or blocked by OS privacy settings. Check: Windows 麦克风隐私设置 / 浏览器地址栏麦克风权限 / 默认录音设备');
    }
    onPcm(pcm);
  };

  source.connect(processor);
  const mute = audioCtx.createGain();
  mute.gain.value = 0;
  processor.connect(mute);
  mute.connect(audioCtx.destination);

  let stopped = false;
  return {
    async stop() {
      if (stopped) return;
      stopped = true;
      // Signal the still-pending getUserMedia (if any) — once everything is resolved this is
      // a no-op, but it prevents a half-resolved capture from injecting a callback after stop.
      abort.abort();
      // Disconnect the entire audio graph BEFORE closing the context so the nodes aren't
      // retained by the context's node graph during teardown. ScriptProcessor and mute both
      // hold references; the destination-attached mute in particular would otherwise linger.
      try {
        processor.disconnect();
      } catch {
        /* already disconnected */
      }
      try {
        source.disconnect();
      } catch {
        /* already disconnected */
      }
      try {
        mute.disconnect();
      } catch {
        /* already disconnected */
      }
      // Release the mic tracks synchronously so the OS-level mic indicator turns off even if
      // the AudioContext close promise is still in flight.
      for (const track of stream.getTracks()) track.stop();
      // Await the close so a subsequent startMicCapture can open a fresh context without
      // racing toward the browser's per-page AudioContext quota.
      try {
        await audioCtx.close();
      } catch {
        /* context may already be closed */
      }
    },
  };
}
