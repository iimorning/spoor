import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import type { AIConfig } from '../components/AISettingsModal';
import { useAppDialog } from '../components/AppDialogProvider';
import {
  MINIMAX_DEFAULT_TTS_MODEL,
  VOLC_ASR_DEFAULT_RESOURCE_ID,
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
import { createTtsSentenceQueue } from '../utils/ttsSentenceQueue';
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

export type VoicePhase = 'idle' | 'listening' | 'thinking' | 'speaking';

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
      playVoiceCue('off');
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

    // Silence detector: every ASR callback arms a timer; if no callback fires
    // within SILENCE_MS the buffered transcript is committed automatically.
    // Lets the user just speak and wait, no second mic click required.
    const SILENCE_MS = 1500;
    const TRANSCRIPT_RENDER_INTERVAL_MS = 180;
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;
    let transcriptFlushTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingTranscript: string | null = null;
    const armSilenceTimer = () => {
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
  const ensureTtsQueue = (replyNodeId?: string) => {
    if (replyNodeId) ttsHighlightNodeIdRef.current = replyNodeId;
    if (ttsRef.current) return ttsRef.current;
    if (!hasMinimaxTtsAccess(aiConfig.minimaxApiKey)) return null;
    const minimaxKey = (aiConfig.minimaxApiKey || '').trim();
    let tts: ReturnType<typeof createTtsSentenceQueue>;
    tts = createTtsSentenceQueue({
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
        const nodeId = ttsHighlightNodeIdRef.current;
        if (!sentence || !nodeId) {
          setTtsHighlight(null);
          return;
        }
        setTtsHighlight({ nodeId, sentence });
      },
      onError: (message) => {
        const stillActive = ttsRef.current === tts;
        if (stillActive) {
          try {
            ttsRef.current.stop();
          } catch {
            /* ignore */
          }
          ttsRef.current = null;
        }
        console.error('[Spoor] MiniMax TTS', message);
        if (!stillActive) return;
        void appAlert({ message: t('voice.tts_error', { message }) });
      },
    });
    ttsRef.current = tts;
    tts.warmup();
    return tts;
  };

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

  /** Push written-card text into the TTS queue as the stream accumulates. */
  const pushTtsChunk = useCallback(
    (replyNodeId: string, accumulated: string) => {
      closeAsr();
      const spoken = visibleAiReplyText(accumulated).trim();
      if (!spoken) return;
      const tts = ensureTtsQueue(replyNodeId);
      if (!tts) return;
      tts.pushAccumulatedText(spoken);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aiConfig.minimaxApiKey, aiConfig.minimaxTtsModel, aiConfig.minimaxVoiceId, closeAsr, i18n.language, t],
  );

  /** Flush leftover carry, wait for audio already in flight, then listen again. */
  const endTtsReply = useCallback(
    async (replyNodeId: string, spokenText: string): Promise<void> => {
      if (!activeRef.current) return;
      // Reuse the warmed / in-flight queue so first-sentence audio is not thrown away.
      const tts = replyNodeId ? ensureTtsQueue(replyNodeId) : ttsRef.current;
      if (!tts) {
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
      if (spokenText.trim()) {
        tts.pushAccumulatedText(spokenText.trim());
      }
      tts.flush();
      await tts.waitUntilIdle();
      try {
        tts.stop();
      } catch {
        /* ignore */
      }
      if (ttsRef.current === tts) ttsRef.current = null;
      ttsHighlightNodeIdRef.current = null;
      setTtsHighlight(null);
      handlingUtteranceRef.current = false;

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
    [aiConfig.minimaxApiKey, aiConfig.minimaxTtsModel, aiConfig.minimaxVoiceId, rollbackOnStartFailure, startListeningLoop, i18n.language, t, targetAskCardIdRef],
  );

  /** Stop the current TTS stream mid-playback. Clears the queue, drops the
   *  highlight, cancels any pending silence auto-commit and mic-off commit,
   *  and re-opens ASR so the user can keep talking. Does NOT exit voice mode. */
  const stopTts = useCallback(async (): Promise<void> => {
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

  /** Caller flips phase to "thinking"; MiniMax handshake starts immediately. */
  const markThinking = useCallback(() => {
    if (!activeRef.current) return;
    setPhase('thinking');
    closeAsr();
    ensureTtsQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiConfig.minimaxApiKey, aiConfig.minimaxTtsModel, aiConfig.minimaxVoiceId, closeAsr, i18n.language, t]);

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
    markThinking,
  };
}
