import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AIConfig } from '../components/AISettingsModal';
import { useAppDialog } from '../components/AppDialogProvider';
import { MINIMAX_DEFAULT_TTS_MODEL, resolveVoiceInputMode } from '../constants/voiceWriting';
import { hasMinimaxTtsAccess } from '../lib/serverConfig';
import { startMicAndAsrSession } from '../services/startMicAndAsr';
import { hasVolcAsrCredentials, type VolcAsrSession } from '../services/volcAsr';
import { formatAiError } from '../services/ai';
import type { MicCapture } from '../services/micCapture';
import { createTtsSentenceQueue } from '../utils/ttsSentenceQueue';
import { playVoiceCue } from '../utils/voiceCue';

export type ChatVoicePhase = 'idle' | 'listening' | 'draft' | 'thinking' | 'speaking';

type UseChatVoiceParams = {
  aiConfig: AIConfig | null;
  disabled?: boolean;
  sendMessage: (text: string) => Promise<string | null>;
};

export function useChatVoice({
  aiConfig,
  disabled,
  sendMessage,
}: UseChatVoiceParams) {
  const { t, i18n } = useTranslation();
  const { alert: appAlert } = useAppDialog();

  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState<ChatVoicePhase>('idle');
  const [partialTranscript, setPartialTranscript] = useState('');

  const activeRef = useRef(false);
  const phaseRef = useRef<ChatVoicePhase>('idle');
  const micRef = useRef<MicCapture | null>(null);
  const asrRef = useRef<VolcAsrSession | null>(null);
  const ttsRef = useRef<ReturnType<typeof createTtsSentenceQueue> | null>(null);
  const latestTranscriptRef = useRef('');
  const voiceInputModeRef = useRef(resolveVoiceInputMode(aiConfig?.voiceInputMode));
  const finishRoundRef = useRef<(() => string) | null>(null);
  const suppressAsrCloseStopRef = useRef(false);
  const startingRef = useRef(false);
  const listeningCueRef = useRef(false);
  const sendMessageRef = useRef(sendMessage);

  sendMessageRef.current = sendMessage;
  phaseRef.current = phase;
  voiceInputModeRef.current = resolveVoiceInputMode(aiConfig?.voiceInputMode);

  const setPhaseSync = useCallback((next: ChatVoicePhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const teardownSession = useCallback(() => {
    suppressAsrCloseStopRef.current = true;
    if (micRef.current) {
      void micRef.current.stop();
      micRef.current = null;
    }
    if (asrRef.current) {
      asrRef.current.close();
      asrRef.current = null;
    }
    if (ttsRef.current) {
      ttsRef.current.stop();
      ttsRef.current = null;
    }
    finishRoundRef.current = null;
    latestTranscriptRef.current = '';
    setPartialTranscript('');
  }, []);

  const stop = useCallback(() => {
    const playOff = listeningCueRef.current;
    listeningCueRef.current = false;
    activeRef.current = false;
    startingRef.current = false;
    setActive(false);
    setPhaseSync('idle');
    teardownSession();
    // Only chime when listening actually started. Opening/closing the essay
    // editor always unmounts this hook (and StrictMode remounts it on enter).
    if (playOff) playVoiceCue('off');
  }, [setPhaseSync, teardownSession]);

  useEffect(() => () => { teardownSession(); }, [teardownSession]);

  useEffect(() => {
    if (disabled || !aiConfig) {
      if (activeRef.current) stop();
    }
  }, [disabled, aiConfig, stop]);

  const startListening = useCallback(async () => {
    if (!aiConfig) {
      stop();
      return;
    }
    const creds = {
      apiKey: aiConfig.volcAsrApiKey,
      appId: aiConfig.volcAsrAppId,
      accessToken: aiConfig.volcAsrAccessToken,
      resourceId: aiConfig.volcAsrResourceId,
    };
    if (!hasVolcAsrCredentials(creds)) {
      appAlert({ message: t('voice.need_asr_keys') });
      stop();
      return;
    }
    if (!hasMinimaxTtsAccess(aiConfig.minimaxApiKey)) {
      appAlert({ message: t('voice.need_minimax_key') });
      stop();
      return;
    }

    latestTranscriptRef.current = '';
    setPartialTranscript('');
    suppressAsrCloseStopRef.current = false;

    const replaceTranscript = (text: string) => {
      if (!activeRef.current) return;
      latestTranscriptRef.current = text;
      setPartialTranscript(text);
    };

    const { mic, session } = await startMicAndAsrSession(
      creds,
      {
        onPartial: replaceTranscript,
        onDefinite: replaceTranscript,
        onError: (message) => {
          if (!activeRef.current || suppressAsrCloseStopRef.current) return;
          appAlert({ message });
          stop();
        },
        onClose: () => {
          if (!activeRef.current || suppressAsrCloseStopRef.current) return;
          stop();
        },
      },
      { shouldSendPcm: () => activeRef.current },
    );
    if (!activeRef.current) {
      await mic.stop().catch(() => undefined);
      try {
        session.close();
      } catch {
        /* ignore */
      }
      return;
    }
    asrRef.current = session;
    micRef.current = mic;
    listeningCueRef.current = true;
    playVoiceCue('on');

    finishRoundRef.current = () => {
      finishRoundRef.current = null;
      const userText = latestTranscriptRef.current.trim();
      setPartialTranscript('');
      suppressAsrCloseStopRef.current = true;
      if (micRef.current) {
        void micRef.current.stop();
        micRef.current = null;
      }
      if (asrRef.current) {
        asrRef.current.close();
        asrRef.current = null;
      }
      return userText;
    };

    setPhaseSync('listening');
  }, [aiConfig, appAlert, setPhaseSync, stop, t]);

  const runAiTurn = useCallback(async (userText: string) => {
    setPhaseSync('thinking');

    if (!aiConfig) {
      stop();
      return;
    }

    const minimaxKey = (aiConfig.minimaxApiKey ?? '').trim();
    const tts = createTtsSentenceQueue({
      apiKey: minimaxKey,
      model: aiConfig.minimaxTtsModel || MINIMAX_DEFAULT_TTS_MODEL,
      voiceId: aiConfig.minimaxVoiceId,
      language: i18n.language,
      onSpeakingChange: (speaking) => {
        if (speaking) setPhaseSync('speaking');
      },
      onError: (message) => appAlert({ message }),
    });
    ttsRef.current = tts;

    let reply = '';
    try {
      reply = (await sendMessageRef.current(userText))?.trim() ?? '';
    } catch (err) {
      reply = err instanceof Error ? err.message : String(err);
    }

    if (reply) {
      tts.pushAccumulatedText(reply);
      tts.flush();
    }

    await tts.waitUntilIdle();
    if (ttsRef.current === tts) ttsRef.current = null;

    if (!activeRef.current) return;
    if (voiceInputModeRef.current === 'dictation') {
      stop();
      return;
    }
    setPhaseSync('idle');
    await startListening();
  }, [aiConfig, appAlert, i18n.language, setPhaseSync, startListening, stop]);

  const toggle = useCallback(async () => {
    if (disabled) return;
    if (startingRef.current) return;
    if (activeRef.current) {
      const currentPhase = phaseRef.current;
      // Draft: mic is already off. Another click must leave voice mode so the
      // user can clear the box and not get stuck with a lit mic button.
      if (currentPhase === 'draft') {
        stop();
        return;
      }
      if (currentPhase === 'listening' && finishRoundRef.current) {
        const userText = finishRoundRef.current();
        if (userText) {
          if (voiceInputModeRef.current === 'dictation') {
            setPartialTranscript(userText);
            listeningCueRef.current = false;
            playVoiceCue('off');
            setPhaseSync('draft');
            return;
          }
          await runAiTurn(userText);
          return;
        }
      }
      stop();
      return;
    }
    startingRef.current = true;
    activeRef.current = true;
    setActive(true);
    try {
      await startListening();
    } catch (e) {
      console.error('[Spoor] chat voice toggle start failed', { error: formatAiError(e) });
      stop();
    } finally {
      startingRef.current = false;
    }
  }, [disabled, runAiTurn, setPhaseSync, startListening, stop]);

  const commitComposer = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !activeRef.current) return;
    if (phaseRef.current === 'thinking' || phaseRef.current === 'speaking') return;
    if (phaseRef.current === 'listening' && finishRoundRef.current) {
      finishRoundRef.current();
    }
    await runAiTurn(trimmed);
  }, [runAiTurn]);

  return { active, phase, partialTranscript, toggle, stop, commitComposer };
}
