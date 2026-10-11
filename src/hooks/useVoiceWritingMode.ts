import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import type { AIConfig } from '../components/AISettingsModal';
import { useAppDialog } from '../components/AppDialogProvider';
import {
  MINIMAX_DEFAULT_TTS_MODEL,
  VOLC_ASR_DEFAULT_RESOURCE_ID,
  resolveVoiceInputMode,
} from '../constants/voiceWriting';
import { db } from '../db';
import { stampNewCard } from '../utils/stampNewCard';
import { aiGeneratingPatch, settleAiCardGeneration } from '../utils/aiCardGeneration';
import { formatImageGenerationError, IMAGE_GEN_ERROR, isImageGenerationTimeoutError } from '../utils/imageGenerationWait';
import { callUniversalAI, formatAiError } from '../services/ai';
import type { MicCapture } from '../services/micCapture';
import { startMicAndAsrSession } from '../services/startMicAndAsr';
import { loadVolcAsrBiasForAskCard } from '../utils/volcAsrBias';
import { generateGptImage2, hasFlux302Credentials, imageKeysFromAiConfig } from '../services/flux302';
import { fulfillDrawToolFromNode, resolveDrawInputReferences } from '../services/fulfillDrawTool';
import { fulfillSearchToolFromNode } from '../services/fulfillSearchTool';
import { synthesizeAskFromSearch } from '../services/synthesizeAskFromSearch';
import {
  fluxImageBesideAnchorPos,
  fluxImageCardSize,
  spawnFluxImageCard,
} from '../services/spawnFluxImageCards';
import { hasVolcAsrCredentials, type VolcAsrSession } from '../services/volcAsr';
import { getCanvasCenterPosition } from '../utils/canvas';
import { clipImageSourceNote } from '../utils/canvasContextImages';
import { runCanvasStreamingAiCall } from '../utils/canvasStreamingAi';
import { combineSystemParts, getLocaleDirective } from '../utils/aiI18n';
import { spoorLlmSessionId } from '../utils/openRouterPromptCache';
import { createTtsSentenceQueue, speakWholeText } from '../utils/ttsSentenceQueue';
import { playVoiceCue } from '../utils/voiceCue';
import { parseVoiceDrawIntent } from '../utils/voiceDrawIntent';
import { inferImageOrientation } from '../utils/imageOrientation';
import { voiceAiPosition, voiceUserPosition, transformToFocusNode } from '../utils/voiceNoteLayout';
import { searchNoResultsI18nKey } from '../utils/webSearchCommand';
import { hasLiveWebSearchAccess, hasMinimaxTtsAccess } from '../lib/serverConfig';
import { liveSearchMissingKeyI18nKey, liveSearchToolsPromptKey, liveSearchUsesImmediateUserQuestion } from '../constants/webSearchBackend';
import { spokenFallbackFromWritten } from '../utils/voiceSpokenBrief';
import { visibleAiReplyText } from '../utils/visibleAiReply';
import type { CanvasTransform } from './useCanvasInteraction';

export type VoicePhase = 'idle' | 'listening' | 'draft' | 'thinking' | 'speaking';

/**
 * 会话朗读播放列表里的一条：谁在说、用什么音色、说到哪了。
 *
 * 一个发言人一条队列（一个队列 = 一条 MiniMax 流 = 一个音色），按发言顺序串着念：
 * 房间里主人答完、参与者接话时，几个人各用自己的声音，而且不会同时出声。
 */
type SessionSpeechItem = {
  /** 回复卡 id。`''` 是 markThinking 预热出来的空位，等这轮的第一条回复认领它。 */
  messageId: string;
  voiceId?: string;
  /** 这个发言人已经流出来的可见文本（累积）。 */
  text: string;
  /** 话已经说完：可以 flush 收尾了。 */
  complete: boolean;
  /** 队列。预热或轮到它时才建 —— 空转太久的流会被服务端判超时。 */
  queue: ReturnType<typeof createTtsSentenceQueue> | null;
  played: boolean;
};

type UseVoiceWritingModeParams = {
  aiConfig: AIConfig;
  activeCanvasId: string;
  transformRef: RefObject<CanvasTransform>;
  setCanvasTransform: Dispatch<SetStateAction<CanvasTransform>>;
  /** When the user is typing in a note, ASR must not overwrite that note. */
  editingNodeId: string | null;
  setStreamingAiNodeId: (id: string | null) => void;
  isAnyAiBusy: boolean;
  /** Mutable ref so the voice hook reads the latest Ask card id at the moment
   *  {@link toggleVoiceMode} fires. Passing a value (captured at render time)
   *  is too late: the parent sets the target and calls toggle in the same
   *  synchronous tick, so the next render's closure still sees the old value. */
  targetAskCardIdRef: RefObject<string | null>;
  /** Live ASR transcript (replaced, not appended, on each Volc callback). */
  onTranscript?: (text: string, askNodeId: string) => void;
  /** User finished a turn (clicked mic to send) — final transcript + the Ask
   *  card it should land on. Passing the ask id explicitly avoids a ref-read
   *  race: the parent may clear voiceTargetAskCardIdRef synchronously right
   *  before triggering toggleVoiceMode, so by the time this callback fires
   *  the ref is no longer trustworthy. */
  onCommit?: (text: string, askNodeId: string) => void;
  onOpenSettings?: () => void;
  /** Logged-out canvas: missing ASR/TTS keys offer Sign in, which opens Settings. */
  onOpenLogin?: () => void;
  onStreamingThought?: (thought: string) => void;
};

export function useVoiceWritingMode({
  aiConfig,
  activeCanvasId,
  transformRef,
  setCanvasTransform,
  editingNodeId,
  setStreamingAiNodeId,
  isAnyAiBusy,
  targetAskCardIdRef,
  onTranscript,
  onCommit,
  onOpenSettings: _onOpenSettings,
  onOpenLogin,
  onStreamingThought,
}: UseVoiceWritingModeParams) {
  const { t, i18n } = useTranslation();
  const { alert: appAlert, confirm: appConfirm } = useAppDialog();
  const [voiceModeActive, setVoiceModeActive] = useState(false);
  const [voicePhase, setVoicePhase] = useState<VoicePhase>('idle');
  /** Follow-along highlight while MiniMax TTS plays a sentence on an AI card. */
  const [ttsHighlight, setTtsHighlight] = useState<{ nodeId: string; sentence: string } | null>(null);
  const [liveTranscript, setLiveTranscript] = useState('');

  const activeRef = useRef(false);
  const rowRef = useRef(0);
  const currentUserNoteIdRef = useRef<string | null>(null);
  /** Snapshot of targetAskCardId taken when voice mode starts; survives the
   *  parent clearing targetAskCardIdRef synchronously before mic-off commit.
   *  Cleared when voice mode fully stops. */
  const currentTargetAskCardIdRef = useRef<string | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const micRef = useRef<MicCapture | null>(null);
  const asrRef = useRef<VolcAsrSession | null>(null);
  const ttsRef = useRef<ReturnType<typeof createTtsSentenceQueue> | null>(null);
  /** 手动朗读（侧栏/卡片上的喇叭）专用的队列，和语音会话那个互不干扰。 */
  const manualTtsRef = useRef<ReturnType<typeof createTtsSentenceQueue> | null>(null);
  /**
   * 会话朗读的播放列表：一个发言人一条队列，按发言顺序串着念。同一时刻只有一条流在放，
   * 换人就是停掉上一条、用新音色开一条（所以房间里几个角色的声音能分开）。
   */
  const sessionSpeechRef = useRef<SessionSpeechItem[]>([]);
  /** 正在跑的播放循环 + 它属于哪一代。停止朗读会把代号推进，旧循环自己退场。 */
  const sessionPumpRef = useRef<{ gen: number; promise: Promise<void> } | null>(null);
  const sessionSpeechGenRef = useRef(0);
  /**
   * 丢掉整条播放列表（停止朗读 / 会话结束）。流也一并停掉，别留着占用连接。
   * 代号先推进：还在等音频的旧播放循环据此知道这一趟已经不算数了。
   */
  const clearSessionSpeech = useCallback(() => {
    sessionSpeechGenRef.current += 1;
    for (const item of sessionSpeechRef.current) {
      item.played = true;
      const queue = item.queue;
      item.queue = null;
      try {
        queue?.stop();
      } catch {
        /* ignore */
      }
    }
    sessionSpeechRef.current.length = 0;
  }, []);
  const [manualSpeechMessageId, setManualSpeechMessageId] = useState<string | null>(null);
  /** Card to highlight while TTS plays; empty during thinking fillers. */
  const ttsHighlightNodeIdRef = useRef<string | null>(null);
  const handlingUtteranceRef = useRef(false);
  const pausedListeningRef = useRef(false);
  const latestTranscriptRef = useRef('');
  const voicePhaseRef = useRef<VoicePhase>('idle');
  const editingNodeIdRef = useRef<string | null>(editingNodeId);
  editingNodeIdRef.current = editingNodeId;
  /** Assigned while a listening session is live; mic toggle calls this to commit the turn. */
  const finishListeningRoundRef = useRef<(() => void) | null>(null);
  /** Clears timers scoped to the current ASR listening loop. */
  const clearListeningTimersRef = useRef<(() => void) | null>(null);
  // Synchronous gate: voiceModeActive is React state and lags behind ref writes by one tick,
  // so a fast double-click observes the same `false` in both closures and would launch two
  // sessions. `startingRef` is a ref so the second click sees `true` immediately.
  const voiceInputModeRef = useRef(resolveVoiceInputMode(aiConfig.voiceInputMode));
  voiceInputModeRef.current = resolveVoiceInputMode(aiConfig.voiceInputMode);
  const startingRef = useRef(false);

  const setPhase = (p: VoicePhase) => {
    voicePhaseRef.current = p;
    setVoicePhase(p);
  };

  const teardownSession = useCallback(async () => {
    finishListeningRoundRef.current = null;
    clearListeningTimersRef.current?.();
    clearListeningTimersRef.current = null;
    // Stop the TTS instance we currently own *before* awaiting mic shutdown.
    // Mic stop can lag; if we wait and then stop `ttsRef.current`, we would
    // kill a reply stream that started while we were still tearing down.
    clearSessionSpeech();
    const ttsToStop = ttsRef.current;
    ttsRef.current = null;
    ttsHighlightNodeIdRef.current = null;
    try {
      ttsToStop?.stop();
    } catch {
      /* ignore */
    }
    try {
      asrRef.current?.close();
    } catch {
      /* ignore */
    }
    asrRef.current = null;
    setLiveTranscript('');
    const mic = micRef.current;
    micRef.current = null;
    if (mic) {
      await mic.stop().catch(() => {
        /* best effort */
      });
    }
    // Note: silenceTimer is owned by the startListeningLoop closure and cleared
    // when a new ASR session is opened or when finishListeningRound fires.
  }, []);

  const focusNode = useCallback(
    (x: number, y: number) => {
      const scale = transformRef.current.scale || 1;
      setCanvasTransform(transformToFocusNode(x, y, scale));
    },
    [setCanvasTransform, transformRef],
  );

  async function rollbackOnStartFailure(e: unknown): Promise<void> {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[Spoor] startVoiceMode failed', msg);
    void appAlert({
      message: /Permission|NotAllowed|麦克风|microphone/i.test(msg)
        ? t('voice.mic_denied')
        : t('voice.asr_error', { message: msg }),
    });
    startingRef.current = false;
    activeRef.current = false;
    await teardownSession();
    setVoiceModeActive(false);
    setStreamingAiNodeId(null);
    setPhase('idle');
  }

  const stopVoiceMode = useCallback(() => {
    // Draft already played the off-cue when the mic stopped.
    const playOff = voicePhaseRef.current !== 'draft';
    activeRef.current = false;
    pausedListeningRef.current = true;
    handlingUtteranceRef.current = false;
    startingRef.current = false;
    latestTranscriptRef.current = '';
    currentTargetAskCardIdRef.current = null;
    finishListeningRoundRef.current = null;
    setTtsHighlight(null);
    void teardownSession().finally(() => {
      // Mic + ASR + TTS are all torn down at this point — fire the off-cue as the
      // audible "voice mode ended" signal. Cues are fire-and-forget; even if Web
      // Audio is locked or unavailable the session still exits cleanly.
      if (playOff) playVoiceCue('off');
      setStreamingAiNodeId(null);
      setVoiceModeActive(false);
      setPhase('idle');
    });
  }, [setStreamingAiNodeId, teardownSession]);

  const startListeningLoop = useCallback(async () => {
    if (!activeRef.current) return;

    await teardownSession();
    // Capture from this click, not after the ASR handshake. Otherwise the first
    // words spoken while the token/WS are still opening never become PCM.
    pausedListeningRef.current = false;

    const creds = {
      apiKey: aiConfig.volcAsrApiKey,
      appId: aiConfig.volcAsrAppId,
      accessToken: aiConfig.volcAsrAccessToken,
      resourceId: aiConfig.volcAsrResourceId || VOLC_ASR_DEFAULT_RESOURCE_ID,
    };

    latestTranscriptRef.current = '';
    setLiveTranscript('');

    // Silence detector (handsfree only): every ASR callback arms a timer; if no
    // callback fires within SILENCE_MS the buffered transcript is committed.
    // Dictation mode skips this so pauses in a long utterance do not auto-send.
    const SILENCE_MS = 1500;
    const TRANSCRIPT_RENDER_INTERVAL_MS = 180;
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;
    let transcriptFlushTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingTranscript: string | null = null;
    const armSilenceTimer = () => {
      if (voiceInputModeRef.current === 'dictation') return;
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        silenceTimer = null;
        if (activeRef.current && !handlingUtteranceRef.current) {
          finishListeningRoundRef.current?.();
        }
      }, SILENCE_MS);
    };

    const flushTranscript = async () => {
      if (transcriptFlushTimer) {
        clearTimeout(transcriptFlushTimer);
        transcriptFlushTimer = null;
      }
      const next = pendingTranscript;
      pendingTranscript = null;
      if (!next) return;
      const id = currentUserNoteIdRef.current;
      if (id) {
        if (editingNodeIdRef.current === id) {
          return;
        }
        await db.nodes.update(id, { content: next });
        return;
      }
      if (onTranscript) {
        onTranscript(next, targetAskCardIdRef.current || currentTargetAskCardIdRef.current || '');
      }
    };

    // Volc result_type=full: every callback is the complete transcript so far.
    // Keep the newest value in a ref for immediate commit, but coalesce canvas
    // writes and React work to avoid re-rendering the whole graph per packet.
    const applyTranscript = (incoming: string) => {
      const next = incoming.trim();
      if (!next || next === latestTranscriptRef.current) return;
      latestTranscriptRef.current = next;
      pendingTranscript = next;
      setLiveTranscript(next);
      if (!transcriptFlushTimer) {
        transcriptFlushTimer = setTimeout(() => {
          void flushTranscript();
        }, TRANSCRIPT_RENDER_INTERVAL_MS);
      }
      armSilenceTimer();
    };
    clearListeningTimersRef.current = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = null;
      if (transcriptFlushTimer) clearTimeout(transcriptFlushTimer);
      transcriptFlushTimer = null;
      pendingTranscript = null;
    };

    const commitUtterance = (text: string) => {
      if (!activeRef.current || handlingUtteranceRef.current) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      handlingUtteranceRef.current = true;
      pausedListeningRef.current = true;
      latestTranscriptRef.current = '';
      finishListeningRoundRef.current = null;
      void (async () => {
        await teardownSession();
        if (!activeRef.current) return;
        void runAiTurn(trimmed).finally(() => {
          handlingUtteranceRef.current = false;
        });
      })();
    };

    finishListeningRoundRef.current = () => {
      if (!activeRef.current || handlingUtteranceRef.current) return;
      if (voicePhaseRef.current !== 'listening') return;
      // Cancel any pending silence auto-commit; we're committing now.
      if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
      const id = currentUserNoteIdRef.current;
      void (async () => {
        // Persist the latest coalesced ASR result before reading this turn.
        await flushTranscript();
        // Flush uncontrolled contentEditable → db before reading the note.
        const ae = document.activeElement;
        if (ae instanceof HTMLElement && ae.isContentEditable) {
          ae.blur();
          await Promise.resolve();
        }
        const text = id
          ? (await db.nodes.get(id))?.content ?? latestTranscriptRef.current
          : latestTranscriptRef.current;
        const trimmed = text.trim();
        if (!trimmed) {
          // Nothing spoken — treat mic-off as exiting voice mode.
          stopVoiceMode();
          return;
        }
        if (voiceInputModeRef.current === 'dictation') {
          // Keep the transcript in the composer. User edits, then clicks send.
          // Stay in voice mode so the same AI+TTS reply path still works.
          pausedListeningRef.current = true;
          finishListeningRoundRef.current = null;
          if (silenceTimer) {
            clearTimeout(silenceTimer);
            silenceTimer = null;
          }
          await teardownSession();
          if (!activeRef.current) return;
          playVoiceCue('off');
          setPhase('draft');
          startingRef.current = false;
          return;
        }
        // Ask card path: hand the final transcript to the parent (which will
        // trigger Ask's submit). Skip the legacy runAiTurn entirely.
        if (!id) {
          handlingUtteranceRef.current = true;
          pausedListeningRef.current = true;
          latestTranscriptRef.current = '';
          finishListeningRoundRef.current = null;
          await teardownSession();
          if (!activeRef.current) return;
          onCommit?.(trimmed, targetAskCardIdRef.current || currentTargetAskCardIdRef.current || '');
          return;
        }
        commitUtterance(trimmed);
      })();
    };

    let mic: MicCapture;
    let session: VolcAsrSession;
    let corpusContext: string | undefined;
    const askId = targetAskCardIdRef.current || currentTargetAskCardIdRef.current;
    if (askId) {
      try {
        corpusContext = await loadVolcAsrBiasForAskCard(askId, activeCanvasId);
        if (corpusContext) {
          console.log('[Spoor ASR] canvas bias attached', { chars: corpusContext.length });
        }
      } catch (e) {
        console.warn('[Spoor ASR] canvas bias skipped', e);
      }
    }
    try {
      const started = await startMicAndAsrSession(
        creds,
        {
          onPartial: (partial) => {
            if (!activeRef.current || pausedListeningRef.current) {
              return;
            }
            applyTranscript(partial);
          },
          onDefinite: (text) => {
            // Definite only finalizes transcript segments — never auto-starts the AI turn.
            if (!activeRef.current || pausedListeningRef.current) return;
            applyTranscript(text);
          },
          onError: (message) => {
            if (!activeRef.current) return;
            console.error('[Spoor] Volc ASR', message);
            void appAlert({ message: t('voice.asr_error', { message }) });
            // The session is gone — surface this as a stop so the hook returns to idle.
            stopVoiceMode();
          },
        },
        {
          shouldSendPcm: () => Boolean(activeRef.current && !pausedListeningRef.current),
          asrOptions: corpusContext ? { corpusContext } : undefined,
        },
      );
      mic = started.mic;
      session = started.session;
    } catch (e) {
      if (!activeRef.current) return;
      await rollbackOnStartFailure(e);
      return;
    }
    console.log('[Spoor Voice] ASR session opened');

    // Race: user may have toggled off while token/getUserMedia were awaiting.
    if (!activeRef.current) {
      await mic.stop().catch(() => {
        /* ignore */
      });
      try {
        session.close();
      } catch {
        /* ignore */
      }
      return;
    }
    asrRef.current = session;
    micRef.current = mic;
    // Voice mode is now fully booted: ASR + mic are live and the race guard above
    // (line ~335) has confirmed the user hasn't toggled off mid-start. Fire the
    // on-cue so the user hears a clear "I'm listening" confirmation.
    playVoiceCue('on');
    setPhase('listening');
    pausedListeningRef.current = false;
    // Voice mode is now fully booted: release the synchronous startingRef so the next click
    // on the toolbar mic button can call stopVoiceMode() instead of being ignored as a
    // duplicate. Mirrors the rollback path which resets startingRef on failure/stop.
    startingRef.current = false;

    async function runAiTurn(userText: string) {
      if (!activeRef.current) return;

      const userNoteId = currentUserNoteIdRef.current;
      if (userNoteId) {
        await db.nodes.update(userNoteId, { content: userText });
      }

      const origin = originRef.current || getCanvasCenterPosition(transformRef.current);
      const aiPos = voiceAiPosition(origin, rowRef.current);

      const aiNodeId = crypto.randomUUID();
      const edgeId = crypto.randomUUID();
      await db.nodes.add(stampNewCard({
        id: aiNodeId,
        canvasId: activeCanvasId,
        type: 'ai',
        content: '',
        userTurn: userText,
        x: aiPos.x,
        y: aiPos.y,
        ...(userNoteId ? { threadRootContextNodeId: userNoteId } : {}),
        ...aiGeneratingPatch(),
      }));
      if (userNoteId) {
        await db.edges.add({
          id: edgeId,
          canvasId: activeCanvasId,
          from: userNoteId,
          to: aiNodeId,
        });
      }
      focusNode(aiPos.x, aiPos.y);
      setStreamingAiNodeId(aiNodeId);
      setPhase('thinking');

      const minimaxKey = (aiConfig.minimaxApiKey || '').trim();
      const tts = hasMinimaxTtsAccess(aiConfig.minimaxApiKey)
          ? createTtsSentenceQueue({
              apiKey: minimaxKey,
              model: aiConfig.minimaxTtsModel || MINIMAX_DEFAULT_TTS_MODEL,
              voiceId: aiConfig.minimaxVoiceId,
              language: i18n.language,
              onSpeakingChange: (speaking) => {
                if (!activeRef.current) return;
                if (speaking) setPhase('speaking');
              },
              onActiveSentenceChange: (sentence) => {
                if (!activeRef.current) return;
                if (!sentence) {
                  setTtsHighlight(null);
                  return;
                }
                setTtsHighlight({ nodeId: aiNodeId, sentence });
              },
              onError: (message) => {
                const stillActive = ttsRef.current === tts;
                if (stillActive) {
                  ttsRef.current = null;
                }
                console.error('[Spoor] MiniMax TTS', message);
                if (!stillActive) return;
                void appAlert({ message: t('voice.tts_error', { message }) });
              },
            })
          : null;
      ttsRef.current = tts;
      tts?.warmup();

      let replyText = '';
      let lastRaw = '';
      try {
        let aiPrompt = userText;
        const drawIntent = parseVoiceDrawIntent(userText);
        if (drawIntent) {
            const fluxKey = (aiConfig.api302Key || '').trim();
            const orImageKey = imageKeysFromAiConfig(aiConfig).openrouterApiKey;
            const drawPrompt = drawIntent.prompt.trim() || userText.trim();
            if (!hasFlux302Credentials(fluxKey, orImageKey)) {
              void appAlert({ message: t('voice.flux_need_key') });
              aiPrompt =
                '用户想生成配图，但尚未配置 302.AI API Key。请简洁说明这一点，并请用户在设置中填写后重试。';
            } else if (!drawPrompt) {
              aiPrompt = '用户想生成配图，但没有说明画什么。请简洁请用户补充想画的内容。';
            } else {
              // Generate beside the AI card without blocking TTS of the spoken reply.
              void (async () => {
                const orientation = inferImageOrientation(drawPrompt);
                const card = fluxImageCardSize(orientation);
                const pos = fluxImageBesideAnchorPos(aiPos, 0, card);
                // Ghost first so the canvas shows the pending card during the wait.
                const imageNodeId = await spawnFluxImageCard({
                  canvasId: activeCanvasId,
                  imageUrl: '',
                  description: drawPrompt.slice(0, 80),
                  x: pos.x,
                  y: pos.y,
                  linkFromId: aiNodeId,
                  imageStatus: 'generating',
                  imagePrompt: drawPrompt,
                  imageSourceNote: clipImageSourceNote(userText),
                  width: card.width,
                  height: card.height,
                });
                // Move the camera now rather than after the model returns.
                if (activeRef.current) {
                  setCanvasTransform(
                    transformToFocusNode(
                      pos.x,
                      pos.y,
                      transformRef.current.scale || 1,
                      card.width,
                      card.height,
                    ),
                  );
                }
                try {
                  const { url } = await generateGptImage2({
                    apiKey: fluxKey,
                    openrouterApiKey: orImageKey,
                    prompt: drawPrompt,
                    orientation,
                    inputReferences: await resolveDrawInputReferences(aiNodeId, [imageNodeId]),
                  });
                  // Always resolve the ghost, even if voice mode already exited —
                  // the card is on the canvas and would otherwise spin forever.
                  await db.nodes.update(imageNodeId, {
                    content: url,
                    imageStatus: undefined,
                    imageError: undefined,
                  });
                } catch (e) {
                  const msg = isImageGenerationTimeoutError(e)
                    ? IMAGE_GEN_ERROR.timeout
                    : formatAiError(e);
                  console.error('[Spoor] voice flux image failed', msg);
                  await db.nodes.update(imageNodeId, { imageStatus: 'error', imageError: msg });
                  void appAlert({
                    message: t('voice.flux_error', { message: formatImageGenerationError(msg, t) }),
                  });
                }
              })();
              aiPrompt = [
                `用户请求用 AI 画一张图，主题是：${drawPrompt}`,
                '系统已在后台生成插画并放到画布上。请用一两句口语确认你理解的画面，不要输出 JSON 或工具标记。',
              ].join('\n');
            }
        }

        replyText = await runCanvasStreamingAiCall({
          nodeId: aiNodeId,
          onThinking: onStreamingThought,
          ...(liveSearchUsesImmediateUserQuestion() && userText.trim()
            ? { immediateSearchQuery: userText.trim() }
            : {}),
          synthesizeFromSearch:
            hasLiveWebSearchAccess({
              metasoApiKey: aiConfig.metasoApiKey,
              provider: aiConfig.provider,
              llmApiKey: aiConfig.apiKey,
            }) && userText.trim()
              ? async ({ draftAnswer, hits, onStreamChunk }) => {
                  const revised = await synthesizeAskFromSearch({
                    config: aiConfig,
                    t,
                    userQuestion: userText.trim(),
                    draftAnswer,
                    hits,
                    onStreamChunk: (accumulated) => {
                      onStreamChunk(accumulated);
                      const spoken = visibleAiReplyText(accumulated).trim();
                      if (spoken) tts?.pushAccumulatedText(spoken);
                    },
                    sessionId: spoorLlmSessionId(
                      'voice-synth',
                      currentTargetAskCardIdRef.current || activeCanvasId,
                    ),
                  });
                  lastRaw = revised;
                  return revised;
                }
              : undefined,
          callAi: (onStreamChunk) =>
            callUniversalAI({
              config: aiConfig,
              systemInstruction: combineSystemParts(
                getLocaleDirective(),
                t('ai.prompts.askCharacterIdentity', { name: t('ask.character_name') }),
                t('ai.prompts.voiceWritingPersona'),
                t('ai.prompts.voiceSpokenBrief'),
                hasLiveWebSearchAccess({
                  metasoApiKey: aiConfig.metasoApiKey,
                  provider: aiConfig.provider,
                  llmApiKey: aiConfig.apiKey,
                })
                  ? t(liveSearchToolsPromptKey())
                  : '',
                hasFlux302Credentials(aiConfig.api302Key, imageKeysFromAiConfig(aiConfig).openrouterApiKey) ? t('ai.prompts.drawToolAvailable') : '',
              ),
              prompt: aiPrompt,
              sessionId: spoorLlmSessionId(
                'voice',
                currentTargetAskCardIdRef.current || activeCanvasId,
              ),
              onStreamChunk: (accumulated) => {
                lastRaw = accumulated;
                onStreamChunk(accumulated);
                const spoken = visibleAiReplyText(accumulated).trim();
                if (spoken) tts?.pushAccumulatedText(spoken);
              },
            }),
          onDrawImages: (images) => {
            void fulfillDrawToolFromNode({
              nodeId: aiNodeId,
              images,
              ...imageKeysFromAiConfig(aiConfig),
              onMissingKey: () => {
                void appAlert({ message: t('voice.flux_need_key') });
              },
              onError: (message) => {
                void appAlert({ message: t('voice.flux_error', { message: formatImageGenerationError(message, t) }) });
              },
            });
          },
          onSearchTools: async (searches) =>
            fulfillSearchToolFromNode({
              nodeId: aiNodeId,
              searches,
              userQuestion: userText.trim(),
              apiKey: aiConfig.metasoApiKey,
              openRouterApiKey: aiConfig.provider === 'openrouter' ? aiConfig.apiKey : '',
              llmProvider: aiConfig.provider,
              reportEmpty: false,
              onMissingKey: () => {
                void appAlert({ message: t(liveSearchMissingKeyI18nKey()) });
              },
              onError: (message) => {
                void appAlert({ message: `${t('nodes.search_failed')}\n\n${message}` });
              },
              filterWebpages: {
                config: aiConfig,
                t,
                sessionId: spoorLlmSessionId('ask-web-filter', aiNodeId),
              },
            }),
          onSearchNoResults: (detail) => {
            void appAlert({ message: t(searchNoResultsI18nKey(detail?.scopes ?? [])) });
          },
        });

        const spoken =
          visibleAiReplyText(lastRaw).trim() || spokenFallbackFromWritten(replyText);
        if (spoken) tts?.pushAccumulatedText(spoken);
        tts?.flush();
        if (tts) {
          setPhase('speaking');
          await tts.waitUntilIdle();
          try {
            tts.stop();
          } catch {
            /* ignore */
          }
        }

      } catch (e) {
        const msg = formatAiError(e);
        console.error('[Spoor] voice AI turn failed', msg);
        try {
          await settleAiCardGeneration(aiNodeId, msg);
        } catch {
          /* stream helper may already have marked the card */
        }
      } finally {
        await settleAiCardGeneration(aiNodeId);
        setStreamingAiNodeId(null);
        setTtsHighlight(null);
        ttsRef.current?.stop();
        ttsRef.current = null;
        ttsHighlightNodeIdRef.current = null;
      }

      if (!activeRef.current) return;

      const nextOrigin = originRef.current || getCanvasCenterPosition(transformRef.current);
      const nextRow = rowRef.current + 1;
      rowRef.current = nextRow;
      const nextPos = voiceUserPosition(nextOrigin, nextRow);
      const nextUserId = crypto.randomUUID();
      await db.nodes.add(stampNewCard({
        id: nextUserId,
        canvasId: activeCanvasId,
        type: 'text',
        content: '',
        x: nextPos.x,
        y: nextPos.y,
      }));
      if (replyText) {
        await db.edges.add({
          id: crypto.randomUUID(),
          canvasId: activeCanvasId,
          from: aiNodeId,
          to: nextUserId,
        });
      }
      currentUserNoteIdRef.current = nextUserId;
      focusNode(nextPos.x, nextPos.y);
      await startListeningLoop();
    }
  }, [
    activeCanvasId,
    aiConfig,
    appAlert,
    focusNode,
    rollbackOnStartFailure,
    setStreamingAiNodeId,
    stopVoiceMode,
    t,
    teardownSession,
    transformRef,
  ]);

  const promptMissingVoiceKeys = useCallback(
    async (kind: 'asr' | 'tts') => {
      if (!onOpenLogin) {
        await appAlert({
          message: t(kind === 'asr' ? 'voice.need_asr_keys' : 'voice.need_minimax_key'),
        });
        return;
      }
      const goLogin = await appConfirm({
        title: t('dialog.alert_title'),
        message: t(kind === 'asr' ? 'voice.need_asr_keys_guest' : 'voice.need_minimax_key'),
        confirmLabel: t('cloud.signIn'),
        cancelLabel: t('dialog.ok'),
      });
      if (goLogin) onOpenLogin();
    },
    [appAlert, appConfirm, onOpenLogin, t],
  );

  const startVoiceMode = useCallback(async () => {
    // Synchronous guard so back-to-back clicks can't both start.
    if (startingRef.current) return;
    if (voiceModeActive || isAnyAiBusy) return;
    startingRef.current = true;

    const asrOk = hasVolcAsrCredentials({
      apiKey: aiConfig.volcAsrApiKey,
      appId: aiConfig.volcAsrAppId,
      accessToken: aiConfig.volcAsrAccessToken,
    });
    if (!asrOk) {
      startingRef.current = false;
      void promptMissingVoiceKeys('asr');
      return;
    }
    if (!hasMinimaxTtsAccess(aiConfig.minimaxApiKey)) {
      startingRef.current = false;
      void promptMissingVoiceKeys('tts');
      return;
    }

    activeRef.current = true;
    setVoiceModeActive(true);
    rowRef.current = 0;
    handlingUtteranceRef.current = false;

    try {
      // Read the ref AT call time, not at render time. toggleVoiceMode is fired
      // synchronously after the parent updates the ref, so this sees the fresh
      // value even before React re-renders.
      const targetAskCardId = targetAskCardIdRef.current;
      currentTargetAskCardIdRef.current = targetAskCardId;
      if (!targetAskCardId) {
        // Legacy fallback: spawn a user-note as the voice buffer. Not reachable
        // from the toolbar anymore (Ask card is the only entry point), but
        // kept so a future caller without a target doesn't crash.
        const { x, y } = getCanvasCenterPosition(transformRef.current);
        const userNoteId = crypto.randomUUID();
        await db.nodes.add(stampNewCard({
          id: userNoteId,
          canvasId: activeCanvasId,
          type: 'text',
          content: '',
          x,
          y,
        }));
        currentUserNoteIdRef.current = userNoteId;
        originRef.current = { x, y };
        focusNode(x, y);
      }

      try {
        await startListeningLoop();
      } catch (e) {
        await rollbackOnStartFailure(e);
      }
    } catch (e) {
      await rollbackOnStartFailure(e);
    }
  }, [
    activeCanvasId,
    aiConfig,
    focusNode,
    targetAskCardIdRef,
    isAnyAiBusy,
    promptMissingVoiceKeys,
    rollbackOnStartFailure,
    startListeningLoop,
    transformRef,
    voiceModeActive,
  ]);

  const toggleVoiceMode = useCallback(() => {
    if (startingRef.current) return; // mid-startup click — let the in-flight start resolve
    if (!voiceModeActive) {
      void startVoiceMode();
      return;
    }
    // Listening: mic-off ends this speaking turn (or exits if nothing was said).
    // Dictation draft: mic is already off; another click leaves voice mode.
    // Thinking / speaking: mic-off cancels the whole voice session.
    if (voicePhaseRef.current === 'listening' && !handlingUtteranceRef.current) {
      finishListeningRoundRef.current?.();
      return;
    }
    stopVoiceMode();
  }, [startVoiceMode, stopVoiceMode, voiceModeActive]);

  /**
   * Toolbar phase-chip stop:
   * - listening → finish this turn (same as mic)
   * - speaking → stop TTS only, then continue to the next listening note
   * - thinking → cancel the whole voice session
   */
  const stopVoiceActivity = useCallback(() => {
    if (!voiceModeActive || startingRef.current) return;
    const phase = voicePhaseRef.current;
    if (phase === 'speaking') {
      setTtsHighlight(null);
      try {
        ttsRef.current?.stop();
      } catch {
        /* ignore */
      }
      ttsRef.current = null;
      ttsHighlightNodeIdRef.current = null;
      return;
    }
    if (phase === 'listening' && !handlingUtteranceRef.current) {
      finishListeningRoundRef.current?.();
      return;
    }
    stopVoiceMode();
  }, [stopVoiceMode, voiceModeActive]);

  useEffect(() => {
    return () => {
      activeRef.current = false;
      startingRef.current = false;
      void teardownSession();
    };
  }, [teardownSession]);

  /**
   * TTS queue for the spoken reply. Follow-along highlight is skipped until a
   * reply card id is set. Creating the queue starts the MiniMax handshake so
   * the first sentence does not wait on token + WebSocket.
   */
  /**
   * 造一个 TTS 队列。会话朗读（回复流式朗读）与手动朗读共用这里，
   * 区别只在回调是否受语音会话限制、以及谁持有这个队列。
   */
  const buildTtsQueue = (
    replyNodeId: string | null,
    mode: 'session' | 'manual',
    onDone?: () => void,
    /** 这个声音的音色（角色卡上配的）；空 = 全局设置 → 界面语言默认。 */
    voiceId?: string,
  ) => {
    if (!hasMinimaxTtsAccess(aiConfig.minimaxApiKey)) return null;
    let tts: ReturnType<typeof createTtsSentenceQueue>;
    tts = createTtsSentenceQueue({
      apiKey: (aiConfig.minimaxApiKey || '').trim(),
      model: aiConfig.minimaxTtsModel || MINIMAX_DEFAULT_TTS_MODEL,
      voiceId: voiceId || aiConfig.minimaxVoiceId,
      language: i18n.language,
      onSpeakingChange: (speaking) => {
        // 手动朗读不受语音会话限制；会话朗读依然只在会话里起作用。
        if (mode === 'session' && !activeRef.current) return;
        if (speaking) setPhase('speaking');
      },
      onActiveSentenceChange: (sentence) => {
        if (mode === 'session' && !activeRef.current) return;
        // 会话朗读的回复卡 id 是**后来**才知道的：markThinking 先把流热起来，回复卡随后才出现。
        // 所以这里按"这条流现在念的是谁"解析，而不是建队列时捕获的那个值 —— 捕获值一直是 null，
        // 整段朗读就都不会有划线。
        const nodeId = mode === 'session' ? ttsHighlightNodeIdRef.current : replyNodeId;
        if (!sentence || !nodeId) {
          setTtsHighlight(null);
          if (!sentence) onDone?.();
          return;
        }
        setTtsHighlight({ nodeId, sentence });
      },
      onError: (message) => {
        console.error('[Spoor] MiniMax TTS', message);
        if (mode === 'manual') {
          // 已经念完（或被停掉）的队列迟到的报错不该弹：用户看到的是"读完之后报错"。
          if (manualTtsRef.current !== tts) return;
          manualTtsRef.current = null;
          setManualSpeechMessageId(null);
          setTtsHighlight(null);
          void appAlert({ message: t('voice.tts_error', { message }) });
          return;
        }
        const stillActive = ttsRef.current === tts;
        if (stillActive) {
          try {
            tts.stop();
          } catch {
            /* ignore */
          }
          ttsRef.current = null;
        }
        if (!stillActive) return;
        void appAlert({ message: t('voice.tts_error', { message }) });
      },
    });
    return tts;
  };

  const sessionItem = (messageId: string) =>
    sessionSpeechRef.current.find((it) => it.messageId === messageId);

  /**
   * 把列表里还没念的发言人一个个念完，直到念不动为止。
   *
   * 循环在两种情况下退出：列表空了（念完），或者当前这位还在流式（等下一块文本再来驱动）。
   * 两种都算"这一趟结束"，所以句柄在结算时清掉；被"停止朗读"打断的那一趟会认出代号变了，
   * 既不接着念新一代的列表，也不会把新一代的句柄误清掉。
   */
  const pumpSessionSpeech = useCallback((): Promise<void> => {
    const gen = sessionSpeechGenRef.current;
    const existing = sessionPumpRef.current;
    if (existing && existing.gen === gen) return existing.promise;
    const run = (async () => {
      for (;;) {
        if (gen !== sessionSpeechGenRef.current) return;
        const item = sessionSpeechRef.current.find((it) => !it.played);
        if (!item) break;
        if (!item.text.trim()) {
          // 空位（预热出来的）或还没吐出文本：等文本，别把它算成"念完了"。
          if (!item.complete) return;
          // 这一轮没留下可念的话（空回复 / 轮次失败）：别空占一条流。
          item.played = true;
          item.queue?.stop();
          item.queue = null;
          continue;
        }
        const tts =
          item.queue ?? buildTtsQueue(item.messageId || null, 'session', undefined, item.voiceId);
        if (!tts) break;
        item.queue = tts;
        ttsRef.current = tts;
        // 划线跟着"正在念的这条回复"走：换人时改这里的 id，界面上的下划线就换气泡。
        if (item.messageId) ttsHighlightNodeIdRef.current = item.messageId;
        tts.pushAccumulatedText(item.text);
        if (!item.complete) return;
        tts.flush();
        await tts.waitUntilIdle();
        if (gen !== sessionSpeechGenRef.current) return;
        try {
          tts.stop();
        } catch {
          /* ignore */
        }
        item.played = true;
        item.queue = null;
        if (ttsRef.current === tts) ttsRef.current = null;
      }
    })();
    sessionPumpRef.current = { gen, promise: run };
    void run
      .catch(() => {
        /* 单个队列报错自己会走 onError；循环本身不该把错误抛给调用方 */
      })
      .finally(() => {
        if (sessionPumpRef.current?.promise === run) sessionPumpRef.current = null;
      });
    return run;
  }, [aiConfig.minimaxApiKey, aiConfig.minimaxTtsModel, aiConfig.minimaxVoiceId, i18n.language, t]);

  /** Drop the current ASR WebSocket session if any. Called whenever TTS is
   *  about to start so the Volc server doesn't sit on an idle WS until its
   *  MaxDuration timeout fires (code:100008 "Timeout waiting next packet").
   *  Mic capture is left alone — pausedListeningRef alone is enough to drop
   *  frames, but we want the WS itself closed. startListeningLoop opens a
   *  fresh session once TTS finishes. */
  const closeAsr = useCallback(() => {
    if (!asrRef.current) return;
    try {
      asrRef.current.close();
    } catch {
      /* ignore */
    }
    asrRef.current = null;
  }, []);

  /**
   * 把一块流式文本喂给"正在说的这位"。`voiceId` 是说话人自己的音色（角色卡上配的）：
   * 房间里换人时，这里把上一位收口、给新的一位按他自己的音色排一条。
   */
  const pushTtsChunk = useCallback(
    (replyNodeId: string, accumulated: string, voiceId?: string) => {
      closeAsr();
      const spoken = visibleAiReplyText(accumulated).trim();
      if (!spoken) return;
      const items = sessionSpeechRef.current;
      let item = sessionItem(replyNodeId);
      if (!item) {
        // 认领 markThinking 预热出来的空位（音色对不上就重开一条，别整段用错声音）。
        const warm = items.find((it) => !it.messageId && !it.played && !it.text);
        item = warm ?? {
          messageId: '',
          voiceId,
          text: '',
          complete: false,
          queue: null,
          played: false,
        };
        if (!warm) {
          items.push(item);
        } else if (warm.voiceId !== voiceId) {
          warm.queue?.stop();
          warm.queue = null;
          warm.voiceId = voiceId;
        }
        item.messageId = replyNodeId;
      }
      if (item.voiceId === undefined) item.voiceId = voiceId;
      // 上一位的话到这儿就算说完了：房间轮次是一条一条排着来的，新发言人开口即前任收尾。
      // 在这里收口，他的最后半句才不会永远卡在 carry 里没人念。
      for (const other of items) {
        if (other === item) break;
        if (!other.played && other.messageId) other.complete = true;
      }
      item.text = spoken;
      void pumpSessionSpeech();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aiConfig.minimaxApiKey, aiConfig.minimaxTtsModel, aiConfig.minimaxVoiceId, closeAsr, i18n.language, t],
  );

  /** Flush leftover carry, wait for the whole playlist, then listen again. */
  const endTtsReply = useCallback(
    async (replyNodeId: string, spokenText: string): Promise<void> => {
      if (!activeRef.current) return;
      const items = sessionSpeechRef.current;
      const tail = spokenText.trim();
      let last = replyNodeId ? sessionItem(replyNodeId) : undefined;
      if (tail) {
        if (!last) {
          // 这条回复一个 chunk 都没吐过：认领预热出来的空位（音色就是它热的那一个），
          // 没有空位才补一条新的。
          const warm = items.find((it) => !it.messageId && !it.played && !it.text);
          last =
            warm ?? {
              messageId: '',
              voiceId: undefined,
              text: '',
              complete: false,
              queue: null,
              played: false,
            };
          if (!warm) items.push(last);
          last.messageId = replyNodeId;
        }
        // 写下来的可能比念出来的全（收尾那段在 thread 里更完整）：以完整文本为准。
        if (tail.length >= last.text.length) last.text = tail;
      }
      // 这一轮的话到这儿全说完了。房间里只有最后一位会走到这里，所以剩下的都在这里统一收口；
      // 没留下文本的（空回复、失败的轮次）直接淘汰，免得空占一条流。
      for (const item of items) {
        if (item.text.trim()) {
          item.complete = true;
        } else {
          item.played = true;
          item.queue?.stop();
          item.queue = null;
        }
      }
      if (!items.some((it) => !it.played && it.text.trim())) {
        // 这一轮没有任何可念的话（没有 MiniMax key / 空回复）：直接回到听。
        // 注意这里不区分输入模式：见下面"念完继续听"的说明。
        handlingUtteranceRef.current = false;
        if (targetAskCardIdRef.current) {
          try {
            await startListeningLoop();
          } catch (e) {
            await rollbackOnStartFailure(e);
          }
        }
        return;
      }
      await pumpSessionSpeech();
      clearSessionSpeech();
      ttsRef.current = null;
      ttsHighlightNodeIdRef.current = null;
      setTtsHighlight(null);
      handlingUtteranceRef.current = false;

      // 念完继续听。语音模式不因为"这一轮读完了"自己退出 —— 房间里一串角色挨个说完之后
      // 被踢出语音模式尤其莫名其妙（转写模式的差别只在"用户说的话进输入框、不自动发送"，
      // 跟读完要不要接着听无关）。要停就由用户点麦克风/停止，走 stopVoiceMode 那条路。
      if (!activeRef.current) return;
      if (targetAskCardIdRef.current) {
        try {
          await startListeningLoop();
        } catch (e) {
          await rollbackOnStartFailure(e);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aiConfig.minimaxApiKey, aiConfig.minimaxTtsModel, aiConfig.minimaxVoiceId, rollbackOnStartFailure, startListeningLoop, stopVoiceMode, i18n.language, t, targetAskCardIdRef],
  );

  /** Stop the current TTS stream mid-playback. Clears the queue, drops the
   *  highlight, cancels any pending silence auto-commit and mic-off commit,
   *  and re-opens ASR so the user can keep talking. Does NOT exit voice mode. */
  const stopTts = useCallback(async (): Promise<void> => {
    clearSessionSpeech();
    if (ttsRef.current) {
      try {
        ttsRef.current.stop();
      } catch {
        /* ignore */
      }
      ttsRef.current = null;
      ttsHighlightNodeIdRef.current = null;
    }
    setTtsHighlight(null);
    handlingUtteranceRef.current = false;
    // Cancel any pending silence timer / mic-off commit — the user pressed
    // stop, not commit, so the buffered speech must NOT auto-submit to the AI.
    finishListeningRoundRef.current = null;
    latestTranscriptRef.current = '';
    if (!activeRef.current) return;
    if (targetAskCardIdRef.current) {
      try {
        await startListeningLoop();
      } catch (e) {
        await rollbackOnStartFailure(e);
      }
    }
  }, [rollbackOnStartFailure, startListeningLoop, targetAskCardIdRef]);

  /**
   * Caller flips phase to "thinking"; MiniMax handshake starts immediately.
   *
   * `voiceId` 是"用户正在跟谁说话"那个角色的音色 —— 流必须照着它开：回复卡要到流式开始
   * 之后才存在，等拿到卡 id 再定音色就晚了（那时整段音频都已经按错的音色合成了）。
   */
  const markThinking = useCallback(
    (voiceId?: string) => {
      if (!activeRef.current) return;
      setPhase('thinking');
      closeAsr();
      // 上一轮的列表在收尾时已经清空了；这里再清一次，免得残留的条目把这一轮顶乱。
      clearSessionSpeech();
      const tts = buildTtsQueue(null, 'session', undefined, voiceId);
      if (!tts) return;
      ttsRef.current = tts;
      // 预热出来的空位：回复卡出现后由 pushTtsChunk 认领。
      sessionSpeechRef.current.push({
        messageId: '',
        voiceId,
        text: '',
        complete: false,
        queue: tts,
        played: false,
      });
      tts.warmup();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aiConfig.minimaxApiKey, aiConfig.minimaxTtsModel, aiConfig.minimaxVoiceId, closeAsr, i18n.language, t],
  );

  const stopManualSpeech = useCallback(async (): Promise<void> => {
    const tts = manualTtsRef.current;
    manualTtsRef.current = null;
    setManualSpeechMessageId(null);
    if (tts) {
      try {
        tts.stop();
      } catch {
        /* ignore */
      }
    }
    // 只有手动朗读在说话时才清高亮：语音会话的朗读由 stopTts 自己管。
    if (!activeRef.current) setTtsHighlight(null);
  }, []);

  /**
   * 手动朗读一条**已经写完**的回复（侧栏气泡与画布卡片上的喇叭）。
   * 不依赖语音会话：音频输出这件事本身跟"正在录音"没关系。
   *
   * 每次都用新队列：流式那个队列记得"已经念到哪"，重播要的是从头念。
   */
  const speakMessage = useCallback(
    async (messageId: string, text: string, voiceId?: string): Promise<void> => {
      const spoken = visibleAiReplyText(text).trim();
      await stopManualSpeech();
      if (!spoken) return;
      const tts = buildTtsQueue(
        messageId,
        'manual',
        () => setManualSpeechMessageId(null),
        voiceId,
      );
      if (!tts) {
        void appAlert({ message: t('voice.need_minimax_key') });
        return;
      }
      manualTtsRef.current = tts;
      setManualSpeechMessageId(messageId);
      // 读完整段：内部会 flush + 等念完 + 关流。少任何一步都会出问题（半句不念 / 空闲超时报错）。
      const finished = await speakWholeText(tts, spoken, {
        isStillCurrent: () => manualTtsRef.current === tts,
      });
      if (finished) setManualSpeechMessageId(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aiConfig.minimaxApiKey, aiConfig.minimaxTtsModel, aiConfig.minimaxVoiceId, i18n.language, stopManualSpeech, t],
  );

  /**
   * 界面上的"停止朗读"：手动朗读和语音会话里的朗读都停掉。
   * （会话朗读还会顺手把麦克风重新打开，那是 stopTts 的职责。）
   */
  const stopSpeaking = useCallback(async (): Promise<void> => {
    await stopManualSpeech();
    if (activeRef.current) await stopTts();
  }, [stopManualSpeech, stopTts]);

  return {
    voiceModeActive,
    voicePhase,
    liveTranscript,
    ttsHighlight,
    toggleVoiceMode,
    stopVoiceMode,
    stopVoiceActivity,
    pushTtsChunk,
    endTtsReply,
    stopTts,
    /** 手动朗读：读一条已经写完的回复 / 重播。 */
    speakMessage,
    stopSpeaking,
    /** 正在被手动朗读的消息 id（没有则为 null），界面据此切换喇叭/停止。 */
    manualSpeechMessageId,
    markThinking,
  };
}
