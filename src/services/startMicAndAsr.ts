import { startMicCapture, type MicCapture } from './micCapture';
import {
  openVolcAsrSession,
  type OpenVolcAsrSessionOptions,
  type VolcAsrCredentials,
  type VolcAsrHandlers,
  type VolcAsrSession,
} from './volcAsr';

/** Match `sendPcm`'s pre-ACK queue so a hung handshake cannot grow without bound. */
const MAX_EARLY_BYTES = 256 * 1024;

export type StartMicAndAsrOptions = {
  /** Drop frames while this returns false (paused / torn down). */
  shouldSendPcm?: () => boolean;
  asrOptions?: OpenVolcAsrSessionOptions;
  /**
   * Fires once getUserMedia succeeds — before the ASR handshake finishes.
   * Callers that need a user-gesture follow-up (fullscreen) must not wait for
   * the whole session: the permission prompt already consumed the original click.
   */
  onMicReady?: () => void;
};

/**
 * Open the microphone in the same click as the ASR token + WebSocket handshake.
 *
 * Previously callers awaited the session (HTTP token + WS + ACK) *then* called
 * getUserMedia. Speech in those seconds never reached PCM, so the first words
 * were dropped. `sendPcm` already queues until the server is ready; this helper
 * queues even earlier — from the first mic callback until the session object exists.
 */
export async function startMicAndAsrSession(
  creds: VolcAsrCredentials,
  handlers: VolcAsrHandlers,
  options: StartMicAndAsrOptions = {},
): Promise<{ mic: MicCapture; session: VolcAsrSession }> {
  let session: VolcAsrSession | null = null;
  const early: Uint8Array[] = [];
  let earlyBytes = 0;

  const pump = (pcm?: Uint8Array) => {
    if (pcm && pcm.length > 0) {
      early.push(pcm);
      earlyBytes += pcm.length;
      while (earlyBytes > MAX_EARLY_BYTES && early.length > 1) {
        const dropped = early.shift()!;
        earlyBytes -= dropped.length;
      }
    }
    if (!session) return;
    while (early.length > 0) {
      const chunk = early.shift()!;
      earlyBytes -= chunk.length;
      session.sendPcm(chunk);
    }
  };

  let micPromise: Promise<MicCapture>;
  try {
    micPromise = Promise.resolve(
      startMicCapture((pcm) => {
        if (options.shouldSendPcm && !options.shouldSendPcm()) return;
        pump(pcm);
      }),
    ).then((mic) => {
      try {
        options.onMicReady?.();
      } catch {
        /* caller UI — never fail the capture */
      }
      return mic;
    });
  } catch (err) {
    micPromise = Promise.reject(err);
  }

  let sessionPromise: Promise<VolcAsrSession>;
  try {
    sessionPromise = Promise.resolve(
      openVolcAsrSession(creds, handlers, options.asrOptions),
    ).then((s) => {
      session = s;
      pump();
      return s;
    });
  } catch (err) {
    sessionPromise = Promise.reject(err);
  }

  try {
    const [mic, sess] = await Promise.all([micPromise, sessionPromise]);
    return { mic, session: sess };
  } catch (err) {
    void micPromise.then((m) => m.stop()).catch(() => undefined);
    void sessionPromise.then((s) => s.close()).catch(() => undefined);
    throw err;
  }
}
