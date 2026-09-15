import { useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentConfig, CanvasNode, Edge as DbEdge } from '../db';
import type { AIConfig } from '../components/AISettingsModal';
import type { CanvasTransform } from './useCanvasInteraction';
import { callUniversalAI, formatAiError, maskApiKeyForLog } from '../services/ai';
import { metasoSearch } from '../services/search';
import type { MetasoImage, MetasoMediaItem, MetasoWebpage } from '../services/search';
import { deriveNoteSearchQueries } from '../services/deriveNoteSearchQueries';
import { runNoteSearchAgent } from '../services/noteSearchAgent';
import {
  deriveSearchQueryFromNoteText,
  spawnWebSearchCardsFromImages,
  spawnWebSearchCardsFromMedia,
  spawnWebSearchCardsFromPages,
} from '../services/spawnWebSearchNoteCards';
import { searchNoResultsI18nKey } from '../utils/webSearchCommand';
import { hasLiveWebSearchAccess, hasMetasoAccess } from '../lib/serverConfig';
import { liveSearchMissingKeyI18nKey, liveSearchToolsPromptKey, liveSearchUsesImmediateUserQuestion } from '../constants/webSearchBackend';
import { generateGptImage2, hasFlux302Credentials, imageKeysFromAiConfig } from '../services/flux302';
import { isDrawChaseUp, parseVoiceDrawIntent } from '../utils/voiceDrawIntent';
import { fulfillDrawToolFromNode, fulfillDrawToolIntoChat, resolveDrawInputReferences } from '../services/fulfillDrawTool';
import { fulfillSearchToolFromNode } from '../services/fulfillSearchTool';
import { collectWebpageOgImages } from '../services/attachWebpageOgImages';
import { synthesizeAskFromSearch } from '../services/synthesizeAskFromSearch';
import { formatLiveSearchQuestion } from '../services/openRouterPerplexitySearch';
import type { SearchToolSpec } from '../utils/askTools';
import { webSearchRelationContext } from '../utils/webSearchMediaCaption';
import { DEFAULT_NODE_SIZE, findOpenCanvasPosition, PUBLISH_MIN_SELECTION } from '../utils/canvas';
import { expandSelectionWithNotePiles } from '../services/notePile';
import { synthesizePublishEssay } from '../utils/synthesizePublishEssay';
import { assembleEssayDraft } from '../utils/assembleEssayDraft';
import type { CanvasObstacle } from '../utils/canvas';
import { normalizeExtractedPassage } from '../utils/sliceSourceMarkdownFromSelection';
import {
  buildAgentSystemInstruction,
  combineSystemParts,
  getLocaleDirective,
  resolveAgentLocalizedName,
  resolveAgentLocalizedRole,
  resolveAgentSystemPrompt,
} from '../utils/aiI18n';
import { collectAiThreadChain, formatAgentDiscussionDialogueHistory } from '../utils/agentThreadContext';
import { spoorLlmSessionId } from '../utils/openRouterPromptCache';
import {
  DISCUSSION_TURN_COUNT,
  findDiscussionHubAgentId,
  isAgentDiscussionLeaf,
  isAskDiscussionSpeaker,
  resolveAgentDiscussionParticipants,
} from '../utils/agentDiscussion';
import {
  resolveImageDataUrlsFromNodeIds,
  materializeImageDataUrls,
} from '../utils/canvasContextImages';
import { getCanvasNodeContextText } from '../utils/canvasNodeContextText';
import { canAskAiOnNode } from '../utils/canvasAskAi';
import { isTurtleSoupHostAgent } from '../utils/agentPersonaSource';
import {
  TURTLE_SOUP_JUDGE_FALLBACK_INSTRUCTION,
  TURTLE_SOUP_SETTER_JSON_INSTRUCTION,
  composeTurtleSoupStreamChunk,
  findTurtleSoupRoundInHistory,
  formatTurtleSoupOpening,
  formatTurtleSoupRefereePacket,
  parseTurtleSoupSetterOutput,
  sanitizeTurtleSoupPlayerText,
  shouldRunTurtleSoupSetter,
  turtleSoupJudgeTemperature,
  turtleSoupLiveThought,
  turtleSoupThinkingTrace,
} from '../utils/turtleSoupRound';
import {
  collectLinkedCardTextsForSearch,
  formatLinkedCardContextForSearch,
} from '../utils/linkedCardSearchContext';
import { db } from '../db';
import { stampNewCard } from '../utils/stampNewCard';
import { stampWorkZoneScopeOnNewNodes } from '../utils/syncWorkZoneScopes';
import { aiGeneratingPatch, markAiCardFailed, settleAiCardGeneration } from '../utils/aiCardGeneration';
import { promptAiFailureOpenSettings } from '../utils/promptAiFailureOpenSettings';
import { formatImageGenerationError } from '../utils/imageGenerationWait';
import { useAppDialog } from '../components/AppDialogProvider';
import { runCanvasStreamingAiCall } from '../utils/canvasStreamingAi';
import { stripThinking } from '../utils/stripThinking';
import { isCanvasV2Enabled } from '../utils/canvasV2';
import {
  buildWorkZoneBackgroundText,
  buildWorkZoneContextText,
  collectWorkZoneContextPayload,
  filterSelectionToWorkZoneFocus,
  isPersonaAnchorNode,
  personaThreadId,
} from '../utils/agentWorkZone';
import {
  collectFocusImageDataUrls,
  composerHasContent,
  focusNodeIdsFromSegments,
  segmentsFromFocusAndText,
  serializeComposerSegments,
  userTextFromSegments,
  type ComposerSegment,
} from '../utils/chatComposer';
import {
  getOrCreatePersonaThread,
  mergeThreadMessageSearchHits,
  runPersonaStreamingCall,
} from '../utils/personaStreamingAi';
import type { CanvasChatMessage } from '../db';
import { parseBookExpandPlan, spawnBookExpandCards } from '../services/spawnBookExpandCards';
import { transcribeAudioUrlWithVolcFlash } from '../services/volcAsrFlash';
import { spawnLinkedTranscriptNote } from '../services/spawnLinkedTranscriptNote';
import { isCanvasAudioCard } from '../utils/canvasAudioCard';
import { hasVolcAsrCredentials } from '../services/volcAsr';
import { GPT_IMAGE_SIZE } from '../utils/imageOrientation';
import { buildAgentCoverPrompt } from '../constants/agentCoverPrompt';
import { syncAgentCanvasCardSize } from '../utils/agentCoverCards';

function mergeCanvasRecords<T extends { id: string; canvasId?: string }>(
  fromReact: T[],
  fromDb: T[],
  canvasId: string,
): T[] {
  const byId = new Map<string, T>();
  for (const row of fromReact) {
    if (!row.canvasId || row.canvasId === canvasId) byId.set(row.id, row);
  }
  for (const row of fromDb) {
    byId.set(row.id, row);
  }
  return [...byId.values()];
}

function placementObstacle(
  node: CanvasNode,
  nodesRef: RefObject<Record<string, HTMLElement | null>>,
): CanvasObstacle {
  const el = nodesRef.current[node.id];
  // Use live canvas x/y, not saved Ask expanded offsets — those can point at a
  // phantom location far from 阿狸 after collapse / a drag-back.
  return {
    type: node.type,
    x: node.x,
    y: node.y,
    width: node.width && node.width > 0 ? node.width : el?.offsetWidth || undefined,
    height: node.height && node.height > 0 ? node.height : el?.offsetHeight || undefined,
  };
}

interface UseAiActionsParams {
  aiConfig: AIConfig;
  agentConfigs: AgentConfig[];
  activeCanvasId: string;
  nodesRef: RefObject<Record<string, HTMLElement | null>>;
  transformRef: RefObject<CanvasTransform>;
  dynamicNodes: CanvasNode[];
  edges: DbEdge[];
  selectedNodes: Set<string>;
  setSelectedNodes: React.Dispatch<React.SetStateAction<Set<string>>>;
  onOpenSettings?: () => void;
}

export function useAiActions({
  aiConfig,
  agentConfigs,
  activeCanvasId,
  nodesRef,
  transformRef,
  dynamicNodes,
  edges,
  selectedNodes,
  setSelectedNodes,
  onOpenSettings,
}: UseAiActionsParams) {
  const { t } = useTranslation();
  const { alert: appAlert, confirm } = useAppDialog();
  const [isPublishing, setIsPublishing] = useState(false);
  /** Canvas stroke-order mode after box-select + publish (no AI arrange). */
  const [publishSequenceActive, setPublishSequenceActive] = useState(false);
  const [publishSequenceCandidateIds, setPublishSequenceCandidateIds] = useState<string[]>([]);
  const [publishSequenceOrderedIds, setPublishSequenceOrderedIds] = useState<string[]>([]);
  const [publishSequenceGenerating, setPublishSequenceGenerating] = useState(false);
  const [analyzingAgentNodeId, setAnalyzingAgentNodeId] = useState<string | null>(null);
  const [streamingAiNodeId, setStreamingAiNodeId] = useState<string | null>(null);
  /** Ask card whose submitted prompt is currently being answered. */
  const [streamingAskNodeId, setStreamingAskNodeId] = useState<string | null>(null);
  const [streamingThought, setStreamingThought] = useState('');
  const [expandingBookNodeId, setExpandingBookNodeId] = useState<string | null>(null);
  const [searchingNoteNodeId, setSearchingNoteNodeId] = useState<string | null>(null);
  const [generatingCoverAgentId, setGeneratingCoverAgentId] = useState<string | null>(null);
  const [transcribingAudioNodeId, setTranscribingAudioNodeId] = useState<string | null>(null);
  const [personaStreams, setPersonaStreams] = useState<
    Record<string, { messageId: string; thought: string }>
  >({});
  const personaBusyRef = useRef(new Set<string>());
  const transcribeAudioGuardRef = useRef(false);
  const expandGuardRef = useRef(false);
  const noteSearchGuardRef = useRef(false);

  const THREAD_GAP = 24;
  const ASK_THREAD_MAX_ROUNDS = 20;

  const notifyAiFailure = (msg: string) => {
    void promptAiFailureOpenSettings({
      confirm,
      t,
      errorMessage: msg,
      onOpenSettings,
    });
  };

  const loadLiveCanvasGraph = async () => {
    const [dbNodes, dbEdges] = await Promise.all([
      db.nodes.where('canvasId').equals(activeCanvasId).toArray(),
      db.edges.where('canvasId').equals(activeCanvasId).toArray(),
    ]);
    return {
      liveNodes: mergeCanvasRecords(dynamicNodes, dbNodes, activeCanvasId),
      liveEdges: mergeCanvasRecords(edges, dbEdges, activeCanvasId),
    };
  };

  // streamingAiNodeId is intentionally included: voice-writing mode mutates it
  // without holding streamingAskNodeId, so omitting it would let the user launch
  // a second concurrent AI run that races on the same flag.
  const isNonPersonaAiBusy =
    isPublishing ||
    publishSequenceActive ||
    publishSequenceGenerating ||
    analyzingAgentNodeId !== null ||
    streamingAiNodeId !== null ||
    streamingAskNodeId !== null ||
    expandingBookNodeId !== null ||
    searchingNoteNodeId !== null ||
    generatingCoverAgentId !== null;
  const isAnyAiBusy = isNonPersonaAiBusy || Object.keys(personaStreams).length > 0;

  const imageKeys = () => imageKeysFromAiConfig(aiConfig);
  const canGenerateImages = () => {
    const keys = imageKeys();
    return hasFlux302Credentials(keys.apiKey, keys.openrouterApiKey);
  };

  const drawSystemAppendix = () =>
    canGenerateImages() ? t('ai.prompts.drawToolAvailable') : '';

  const searchSystemAppendix = () =>
    hasLiveWebSearchAccess({
      metasoApiKey: aiConfig.metasoApiKey,
      provider: aiConfig.provider,
      llmApiKey: aiConfig.apiKey,
    })
      ? t(liveSearchToolsPromptKey())
      : '';

  const runStreamingWithDraw = (
    params: Parameters<typeof runCanvasStreamingAiCall>[0] & {
      /** User turn or note context — enables search-then-reason after Metaso hits. */
      searchSynthesisContext?: string;
    },
  ) => {
    const { searchSynthesisContext, ...rest } = params;
    const synthesisQuestion = searchSynthesisContext?.trim() ?? '';
    const synthesisEnabled =
      synthesisQuestion.length > 0 &&
      hasLiveWebSearchAccess({
        metasoApiKey: aiConfig.metasoApiKey,
        provider: aiConfig.provider,
        llmApiKey: aiConfig.apiKey,
      });

    return runCanvasStreamingAiCall({
      ...rest,
      ...(liveSearchUsesImmediateUserQuestion() && synthesisQuestion
        ? { immediateSearchQuery: synthesisQuestion }
        : {}),
      onThinking: rest.onThinking ?? setStreamingThought,
      onDrawImages: (images) => {
        void fulfillDrawToolFromNode({
          nodeId: rest.nodeId,
          images,
          ...imageKeys(),
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
          nodeId: rest.nodeId,
          searches,
          userQuestion: synthesisQuestion,
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
            sessionId: spoorLlmSessionId('ask-web-filter', rest.nodeId),
          },
        }),
      onSearchNoResults: (detail) => {
        void appAlert({ message: t(searchNoResultsI18nKey(detail?.scopes ?? [])) });
      },
      synthesizeFromSearch: synthesisEnabled
        ? async ({ draftAnswer, hits, onStreamChunk }) =>
            synthesizeAskFromSearch({
              config: aiConfig,
              t,
              userQuestion: synthesisQuestion,
              draftAnswer,
              hits,
              onStreamChunk,
              sessionId: spoorLlmSessionId('ask-synth', rest.nodeId),
            })
        : undefined,
    });
  };

  const handlePublish = () => {
    if (isAnyAiBusy) return;
    const ids = expandSelectionWithNotePiles(Array.from(selectedNodes), dynamicNodes);
    if (ids.length < PUBLISH_MIN_SELECTION) return;
    setPublishSequenceCandidateIds(ids);
    setPublishSequenceOrderedIds([]);
    setPublishSequenceGenerating(false);
    setPublishSequenceActive(true);
  };

  const cancelPublishSequence = () => {
    if (publishSequenceGenerating) return;
    setPublishSequenceActive(false);
    setPublishSequenceCandidateIds([]);
    setPublishSequenceOrderedIds([]);
    setPublishSequenceGenerating(false);
  };

  const confirmPublishSequence = async (
    onEssayCreated: (articleId: string, nodeId: string) => void,
  ) => {
    if (publishSequenceGenerating) return;
    if (publishSequenceOrderedIds.length < PUBLISH_MIN_SELECTION) return;
    setPublishSequenceGenerating(true);
    setIsPublishing(true);
    let openedEssay = false;
    let assembleArticleId: string | null = null;
    try {
      const { articleId, nodeId, willAssemble } = await synthesizePublishEssay({
        orderedIds: publishSequenceOrderedIds,
        candidateIds: publishSequenceCandidateIds,
        dynamicNodes,
        nodesRef: nodesRef.current,
        activeCanvasId,
        fallbackTitle: t('ai.generated_article_title'),
        relatedHeading: t('ai.publish_related_media'),
        kindLabel: (kind) => t(`canvas.search_type_${kind}`, { defaultValue: kind }),
        aiConfig,
        t,
      });
      // Leave the canvas spinner ASAP: open the stitched draft first, assemble after.
      setPublishSequenceActive(false);
      setPublishSequenceCandidateIds([]);
      setPublishSequenceOrderedIds([]);
      setPublishSequenceGenerating(false);
      setSelectedNodes(new Set());
      onEssayCreated(articleId, nodeId);
      openedEssay = true;

      if (willAssemble && aiConfig) {
        assembleArticleId = articleId;
        try {
          await assembleEssayDraft({ articleId, aiConfig, t });
        } catch (e) {
          console.error('[Spoor] assembleEssayDraft failed', e);
          await db.articles.update(articleId, { generating: false });
        }
      }
    } catch (e) {
      const msg = formatAiError(e);
      console.error('[Spoor] confirmPublishSequence failed', { error: msg });
      if (assembleArticleId) {
        await db.articles.update(assembleArticleId, { generating: false });
      }
      if (!openedEssay) {
        void appAlert({
          message: `${t('publish.generate_failed')}\n\n${msg}`,
        });
      }
    } finally {
      setPublishSequenceGenerating(false);
      setIsPublishing(false);
    }
  };

  const readWorkZoneBody = (liveNodes: CanvasNode[]) => (id: string) => {
    const el = nodesRef.current[id];
    if (el) return getCanvasNodeContextText(el);
    const n = liveNodes.find((x) => x.id === id);
    return (n?.content ?? '').trim();
  };

  const readWorkZoneContext = (
    agentNodeId: string,
    liveNodes: CanvasNode[],
    focusNodeIds?: string[],
    backgroundOnly = false,
  ) => {
    const rawFocus = focusNodeIds ?? expandSelectionWithNotePiles([...selectedNodes], liveNodes);
    const focus = filterSelectionToWorkZoneFocus(agentNodeId, liveNodes, rawFocus);
    const payload = collectWorkZoneContextPayload(agentNodeId, liveNodes, focus);
    const readBody = readWorkZoneBody(liveNodes);
    const contextText = backgroundOnly
      ? buildWorkZoneBackgroundText(payload, t, readBody)
      : buildWorkZoneContextText(payload, t, readBody);
    return { contextText, payload, focus, readBody };
  };

  const sendPersonaMessage = async (
    personaNodeId: string,
    request: string,
    options?: {
      composerSegments?: ComposerSegment[];
      focusNodeIds?: string[];
      voiceBrief?: boolean;
      onStreamChunk?: (accumulated: string) => void;
      onReplyCreated?: (messageId: string) => void;
      /** Fired once the user turn is stored. Composer can clear only after this. */
      onAccepted?: () => void;
    },
  ): Promise<string | null> => {
    const trimmed = request.trim();
    if (isNonPersonaAiBusy || personaBusyRef.current.has(personaNodeId)) {
      void appAlert({ message: t('canvas.v2.send_busy') });
      return null;
    }
    personaBusyRef.current.add(personaNodeId);

    const patchPersonaThought = (thought: string) => {
      setPersonaStreams((prev) => {
        const slot = prev[personaNodeId];
        if (!slot) return prev;
        return { ...prev, [personaNodeId]: { ...slot, thought } };
      });
    };

    try {
    const { liveNodes } = await loadLiveCanvasGraph();
    const personaNode = liveNodes.find((n) => n.id === personaNodeId && isPersonaAnchorNode(n));
    if (!personaNode) return null;

    const provisionalFocus =
      options?.composerSegments != null
        ? focusNodeIdsFromSegments(options.composerSegments)
        : (options?.focusNodeIds ??
          filterSelectionToWorkZoneFocus(
            personaNodeId,
            liveNodes,
            expandSelectionWithNotePiles([...selectedNodes], liveNodes),
          ));
    const composerSegments =
      options?.composerSegments ?? segmentsFromFocusAndText(provisionalFocus, trimmed);
    if (!composerHasContent(composerSegments)) return null;

    const { contextText, payload, readBody } = readWorkZoneContext(
      personaNodeId,
      liveNodes,
      focusNodeIdsFromSegments(composerSegments),
      true,
    );
    const userQuestion = userTextFromSegments(composerSegments) || trimmed;
    const serializedUser = serializeComposerSegments(composerSegments, liveNodes, readBody);

    // V2: Ask is always 阿狸. Agent prompts only apply when the user opened that agent card.
    const speakingAgent =
      personaNode.type === 'agent' && personaNode.agentConfigId
        ? agentConfigs.find((a) => a.id === personaNode.agentConfigId)
        : undefined;
    if (personaNode.type === 'agent' && personaNode.agentConfigId && !speakingAgent) {
      void appAlert({ message: t('canvas.v2.send_failed') });
      return null;
    }
    if (personaNode.type !== 'agent' && personaNode.type !== 'ask') return null;

    const turtleHost = Boolean(speakingAgent && isTurtleSoupHostAgent(speakingAgent));
    const contextBlock = contextText
      ? `---\n\nWorkspace context (applies to every turn):\n${contextText}`
      : '';
    const toolParts = turtleHost
      ? []
      : [searchSystemAppendix(), drawSystemAppendix()];

    let systemInstruction: string;
    let temperature = speakingAgent?.temperature ?? 0.7;
    let topP = speakingAgent?.creativity ?? 0.4;

    if (speakingAgent) {
      systemInstruction = buildAgentSystemInstruction(speakingAgent, {
        extraParts: [
          contextBlock,
          ...toolParts,
          options?.voiceBrief ? t('ai.prompts.voiceSpokenBrief') : '',
        ],
      });
    } else {
      const identity = t('ai.prompts.askCharacterIdentity', { name: t('ask.character_name') });
      const systemBase = contextText
        ? t('ai.prompts.toolbarWithNotesSystem')
        : t('ai.prompts.toolbarBarePersona');
      systemInstruction = combineSystemParts(
        getLocaleDirective(),
        identity,
        systemBase,
        contextBlock,
        ...toolParts,
        options?.voiceBrief ? t('ai.prompts.voiceSpokenBrief') : '',
      );
    }

    const threadId = personaThreadId(activeCanvasId, personaNodeId);
    const thread = await getOrCreatePersonaThread(activeCanvasId, personaNodeId);
    const turtleHistory = thread.messages.map((m) => ({
      content: m.text,
      turtleSoupRound: m.turtleSoupRound,
    }));
    const priorTurtleRound = turtleHost ? findTurtleSoupRoundInHistory(turtleHistory) : undefined;
    const turtleSetter = turtleHost && shouldRunTurtleSoupSetter(userQuestion, turtleHistory);
    const turtlePlayerFallback = {
      setterFailed: t('nodes.turtle_soup_deal_failed'),
      leakHidden: t('nodes.turtle_soup_output_hidden'),
    };
    const turnAt = Date.now();
    const userMsg: CanvasChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: serializedUser,
      createdAt: turnAt,
    };
    const assistantMsg: CanvasChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      text: '',
      createdAt: turnAt + 1,
      ...(turtleHost && priorTurtleRound && !turtleSetter
        ? { turtleSoupRound: priorTurtleRound }
        : {}),
    };
    await db.canvasPersonaThreads.put({
      ...thread,
      messages: [...thread.messages, userMsg, assistantMsg],
      composerDraft: undefined,
      composerSegments: [{ type: 'text', content: '' }],
      updatedAt: Date.now(),
    });
    options?.onReplyCreated?.(assistantMsg.id);
    options?.onAccepted?.();

    const historyMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const m of thread.messages) {
      const text = m.text.trim();
      if (!text) continue;
      historyMessages.push({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: text,
      });
    }
    const maxMessages = ASK_THREAD_MAX_ROUNDS * 2;
    const trimmedHistory =
      historyMessages.length > maxMessages
        ? historyMessages.slice(historyMessages.length - maxMessages)
        : historyMessages;

    const turtleUserTail = turtleHost
      ? turtleSetter
        ? TURTLE_SOUP_SETTER_JSON_INSTRUCTION
        : priorTurtleRound
          ? formatTurtleSoupRefereePacket(priorTurtleRound)
          : TURTLE_SOUP_JUDGE_FALLBACK_INSTRUCTION
      : '';
    const userTurn = [serializedUser, turtleUserTail].filter((p) => p.trim()).join('\n\n');
    const messages = turtleSetter
      ? [{ role: 'user' as const, content: userTurn }]
      : [
          ...trimmedHistory,
          { role: 'user' as const, content: userTurn },
        ];

    setPersonaStreams((prev) => ({
      ...prev,
      [personaNodeId]: { messageId: assistantMsg.id, thought: '' },
    }));

    try {
      if (turtleSetter) {
        const raw = await callUniversalAI({
          config: aiConfig,
          systemInstruction,
          messages,
          temperature: speakingAgent?.temperature ?? 0.85,
          topP: speakingAgent?.creativity ?? 0.75,
          onStreamChunk: (accumulated) => {
            patchPersonaThought(turtleSoupLiveThought(accumulated));
            const thought = turtleSoupLiveThought(accumulated);
            if (thought) options?.onStreamChunk?.(`<think>${thought}</think>`);
          },
          sessionId: spoorLlmSessionId('persona', personaNodeId),
        });
        const thinkingTrace = turtleSoupThinkingTrace(raw || '');
        const round = parseTurtleSoupSetterOutput(raw);
        const visible = round
          ? formatTurtleSoupOpening(round)
          : sanitizeTurtleSoupPlayerText(raw || '', 'setter', turtlePlayerFallback);
        const row = await db.canvasPersonaThreads.get(threadId);
        if (row) {
          const next = row.messages.map((m) =>
            m.id === assistantMsg.id
              ? {
                  ...m,
                  text: visible,
                  ...(thinkingTrace ? { thinkingTrace } : {}),
                  ...(round ? { turtleSoupRound: round } : {}),
                }
              : m,
          );
          await db.canvasPersonaThreads.put({ ...row, messages: next, updatedAt: Date.now() });
        }
        options?.onStreamChunk?.(visible);
        return assistantMsg.id;
      }

      if (turtleHost) {
        temperature = turtleSoupJudgeTemperature();
        topP = 0.2;
      }

      const focusImages = collectFocusImageDataUrls(composerSegments, liveNodes);
      const images =
        turtleHost || focusImages.dataUrls.length === 0
          ? []
          : await materializeImageDataUrls(focusImages.dataUrls);

      await runPersonaStreamingCall({
        threadId,
        messageId: assistantMsg.id,
        onThinking: patchPersonaThought,
        onStreamChunk: turtleHost
          ? (accumulated) => {
              options?.onStreamChunk?.(
                sanitizeTurtleSoupPlayerText(stripThinking(accumulated), 'judge', turtlePlayerFallback),
              );
            }
          : options?.onStreamChunk,
        fallbackDrawFromUser: turtleHost ? undefined : userQuestion,
        ...(turtleHost || !(liveSearchUsesImmediateUserQuestion() && userQuestion)
          ? {}
          : { immediateSearchQuery: userQuestion }),
        onDrawImages: turtleHost ? undefined : (drawImages) => {
          void (async () => {
            const extraImageNodeIds = focusImages.nodeIds;
            const refs = await resolveDrawInputReferences(personaNodeId, [], extraImageNodeIds);
            await fulfillDrawToolIntoChat({
              images: drawImages,
              ...imageKeys(),
              inputReferences: refs,
              onMissingKey: () => {
                void appAlert({ message: t('voice.flux_need_key') });
              },
              onError: (message) => {
                void appAlert({
                  message: t('voice.flux_error', {
                    message: formatImageGenerationError(message, t),
                  }),
                });
              },
              onUpdate: async (images) => {
                const row = await db.canvasPersonaThreads.get(threadId);
                if (!row) return;
                const messages = row.messages.map((m) =>
                  m.id === assistantMsg.id ? { ...m, images } : m,
                );
                await db.canvasPersonaThreads.put({ ...row, messages, updatedAt: Date.now() });
              },
            });
          })();
        },
        onSearchTools: turtleHost
          ? undefined
          : async (searches) => {
          const hits = await fulfillSearchToolFromNode({
            nodeId: personaNodeId,
            searches,
            userQuestion,
            apiKey: aiConfig.metasoApiKey,
            openRouterApiKey: aiConfig.provider === 'openrouter' ? aiConfig.apiKey : '',
            llmProvider: aiConfig.provider,
            reportEmpty: false,
            placeOnCanvas: false,
            onMissingKey: () => {
              void appAlert({ message: t(liveSearchMissingKeyI18nKey()) });
            },
            onError: (message) => {
              void appAlert({ message: `${t('nodes.search_failed')}\n\n${message}` });
            },
            filterWebpages: {
              config: aiConfig,
              t,
              sessionId: spoorLlmSessionId('persona-web-filter', personaNodeId),
            },
          });
          await mergeThreadMessageSearchHits(threadId, assistantMsg.id, hits);
          return hits;
        },
        onSearchNoResults: turtleHost
          ? undefined
          : (detail) => {
          void appAlert({ message: t(searchNoResultsI18nKey(detail?.scopes ?? [])) });
        },
        synthesizeFromSearch:
          !turtleHost && userQuestion && hasLiveWebSearchAccess({
            metasoApiKey: aiConfig.metasoApiKey,
            provider: aiConfig.provider,
            llmApiKey: aiConfig.apiKey,
          })
            ? async ({ draftAnswer, hits, onStreamChunk }) =>
                synthesizeAskFromSearch({
                  config: aiConfig,
                  t,
                  userQuestion,
                  draftAnswer,
                  hits,
                  onStreamChunk,
                  sessionId: spoorLlmSessionId('persona-synth', personaNodeId),
                })
            : undefined,
        callAi: async (onStreamChunk) => {
          const raw = await callUniversalAI({
            config: aiConfig,
            messages,
            systemInstruction,
            temperature,
            topP,
            images: images.length > 0 ? images : undefined,
            onStreamChunk: turtleHost
              ? (accumulated) => {
                  const safe = sanitizeTurtleSoupPlayerText(
                    stripThinking(accumulated),
                    'judge',
                    turtlePlayerFallback,
                  );
                  onStreamChunk(composeTurtleSoupStreamChunk(accumulated, safe));
                }
              : onStreamChunk,
            sessionId: spoorLlmSessionId('persona', personaNodeId),
          });
          return turtleHost
            ? sanitizeTurtleSoupPlayerText(stripThinking(raw || ''), 'judge', turtlePlayerFallback)
            : raw;
        },
      });
      return assistantMsg.id;
    } catch (e) {
      const msg = formatAiError(e);
      console.error('[Spoor] sendPersonaMessage failed', { error: msg });
      void notifyAiFailure(msg);
      const row = await db.canvasPersonaThreads.get(threadId);
      if (row) {
        const messages = row.messages.map((m) =>
          m.id === assistantMsg.id ? { ...m, text: msg } : m,
        );
        await db.canvasPersonaThreads.put({ ...row, messages, updatedAt: Date.now() });
      }
      return null;
    }
    } finally {
      personaBusyRef.current.delete(personaNodeId);
      setPersonaStreams((prev) => {
        if (!(personaNodeId in prev)) return prev;
        const next = { ...prev };
        delete next[personaNodeId];
        return next;
      });
    }
  };

  const triggerAgentAnalysis = async (
    agentConfigId: string,
    agentNodeId: string,
    contextNodeId: string,
    options?: { reuseNodeId?: string },
  ) => {
    if (!options?.reuseNodeId) {
      const agent = agentConfigs.find((a) => a.id === agentConfigId);
      const starter = agent
        ? isTurtleSoupHostAgent(agent)
          ? t('community.official.turtle_soup.note_start')
          : t('canvas.v2.agent_analyze_starter', {
              defaultValue: '请结合工作区里的素材，给出你的分析与建议。',
            })
        : '';
      await sendPersonaMessage(agentNodeId, starter);
      return;
    }

    const agentConfig = agentConfigs.find(a => a.id === agentConfigId);
    if (!agentConfig) return;

    const { contextText, payload: ctxPayload } = readWorkZoneContext(agentNodeId, dynamicNodes);
    if (!contextText.trim()) return;

    setAnalyzingAgentNodeId(agentNodeId);
    const agentNode = dynamicNodes.find(n => n.id === agentNodeId);
    const x = agentNode ? agentNode.x + 350 : window.innerWidth / 2;
    const y = agentNode ? agentNode.y : window.innerHeight / 2;
    const newNodeId = options?.reuseNodeId ?? crypto.randomUUID();
    const edgeId = crypto.randomUUID();

    if (options?.reuseNodeId) {
      await db.nodes.update(newNodeId, {
        ...aiGeneratingPatch(),
        content: '',
        thinkingTrace: undefined,
      });
    } else {
      await db.nodes.add(stampNewCard({
        id: newNodeId,
        canvasId: activeCanvasId,
        type: 'ai',
        content: '',
        x,
        y,
        threadRootContextNodeId: contextNodeId,
        threadAgentConfigId: agentConfigId,
        ...(ctxPayload.imageNodeIds.length > 0 ? { threadContextImageNodeIds: ctxPayload.imageNodeIds } : {}),
        ...aiGeneratingPatch(),
      }));
      await db.edges.add({ id: edgeId, canvasId: activeCanvasId, from: agentNodeId, to: newNodeId });
    }
    setStreamingAiNodeId(newNodeId);

    try {
      const images =
        ctxPayload.imageDataUrls.length > 0
          ? await materializeImageDataUrls(ctxPayload.imageDataUrls)
          : [];
      await runStreamingWithDraw({
        nodeId: newNodeId,
        searchSynthesisContext: contextText.trim(),
        callAi: (onStreamChunk) =>
          callUniversalAI({
            config: aiConfig,
            prompt: t('ai.prompts.agentContext', { content: contextText }),
            systemInstruction: buildAgentSystemInstruction(agentConfig, {
              extraParts: [searchSystemAppendix(), drawSystemAppendix()],
            }),
            temperature: agentConfig.temperature ?? 0.7,
            topP: agentConfig.creativity ?? 0.4,
            images: images.length > 0 ? images : undefined,
            onStreamChunk,
            sessionId: spoorLlmSessionId('agent', agentNodeId),
          }),
      });
    } catch (e) {
      const msg = formatAiError(e);
      console.error('[Spoor] triggerAgentAnalysis failed', { error: msg, provider: aiConfig.provider, model: aiConfig.model, apiKey: maskApiKeyForLog(aiConfig.apiKey) });
      try {
        await markAiCardFailed(newNodeId, msg);
      } catch {
        /* stream helper may already have marked the card */
      }
    } finally {
      await settleAiCardGeneration(newNodeId);
      setStreamingAiNodeId(null);
      setAnalyzingAgentNodeId(null);
    }
  };

  const speakerDisplayName = (agentConfigId: string) => {
    if (isAskDiscussionSpeaker(agentConfigId)) return t('ask.character_name');
    const conf = agentConfigs.find((a) => a.id === agentConfigId);
    return conf ? resolveAgentLocalizedName(conf) : agentConfigId;
  };

  /**
   * Spawn DISCUSSION_TURN_COUNT discussion cards in a vertical thread.
   * `historyCards` is prior dialogue (empty on the first exchange).
   */
  const spawnDiscussionTurns = async ({
    discussionId,
    contextNodeId,
    speakerAgentConfigIds,
    initialContext,
    threadContextImageNodeIds,
    contextImageDataUrls,
    historyCards,
    startTurnIndex,
    prevAiId: startPrevAiId,
    cursorX,
    cursorY,
    fromNodeId,
    reuseNodeId,
  }: {
    discussionId: string;
    contextNodeId: string;
    speakerAgentConfigIds: string[];
    initialContext: string;
    threadContextImageNodeIds: string[];
    contextImageDataUrls: string[];
    historyCards: CanvasNode[];
    startTurnIndex: number;
    prevAiId: string | null;
    cursorX: number;
    cursorY: number;
    fromNodeId: string;
    /** Re-run a single failed turn into this existing card. */
    reuseNodeId?: string;
  }) => {
    const spawnedCards = [...historyCards];
    let prevAiId = startPrevAiId;
    let x = cursorX;
    let y = cursorY;
    const batchEnd = reuseNodeId ? startTurnIndex + 1 : startTurnIndex + DISCUSSION_TURN_COUNT;
    const images =
      contextImageDataUrls.length > 0
        ? await materializeImageDataUrls(contextImageDataUrls)
        : [];

    for (let turn = startTurnIndex; turn < batchEnd; turn++) {
      const speakerId = speakerAgentConfigIds[turn % speakerAgentConfigIds.length]!;
      const askSpeaker = isAskDiscussionSpeaker(speakerId);
      const agentConfig = askSpeaker ? undefined : agentConfigs.find((a) => a.id === speakerId);
      if (!askSpeaker && !agentConfig) continue;

      const speakerName = speakerDisplayName(speakerId);
      const otherSpeakers = speakerAgentConfigIds
        .filter((id) => id !== speakerId)
        .map(speakerDisplayName)
        .join(', ');

      const dialogueHistory =
        formatAgentDiscussionDialogueHistory(spawnedCards, speakerDisplayName) || '—';

      const newNodeId = reuseNodeId ?? crypto.randomUUID();
      const edgeId = crypto.randomUUID();

      if (!reuseNodeId && prevAiId) {
        const prevEl = nodesRef.current[prevAiId];
        const prevNode = spawnedCards[spawnedCards.length - 1];
        const h = prevEl?.offsetHeight ?? prevNode?.height ?? 200;
        x = prevNode?.x ?? x;
        y = (prevNode?.y ?? y) + h + THREAD_GAP;
      }

      const cardRow: CanvasNode = {
        id: newNodeId,
        canvasId: activeCanvasId,
        type: 'ai',
        userTurn: speakerName,
        content: '',
        x,
        y,
        threadRootContextNodeId: contextNodeId,
        threadAgentConfigId: speakerId,
        threadDiscussionId: discussionId,
        threadDiscussionAgentIds: speakerAgentConfigIds,
        threadDiscussionTurnIndex: turn,
        ...(threadContextImageNodeIds.length > 0 ? { threadContextImageNodeIds } : {}),
        ...aiGeneratingPatch(),
      };

      if (reuseNodeId) {
        await db.nodes.update(newNodeId, {
          ...aiGeneratingPatch(),
          content: '',
          thinkingTrace: undefined,
          userTurn: speakerName,
        });
      } else {
        await db.nodes.add(stampNewCard(cardRow));
        await db.edges.add({
          id: edgeId,
          canvasId: activeCanvasId,
          from: prevAiId ?? fromNodeId,
          to: newNodeId,
        });
      }
      setStreamingAiNodeId(newNodeId);

      const systemInstruction = askSpeaker
        ? combineSystemParts(
            getLocaleDirective(),
            t('ai.prompts.askCharacterIdentity', { name: t('ask.character_name') }),
            t('ai.prompts.toolbarBarePersona'),
            drawSystemAppendix(),
          )
        : buildAgentSystemInstruction(agentConfig!, {
            fallbackPrompt: t('agents.studio.fallback_assistant'),
            extraParts: [drawSystemAppendix()],
          });

      try {
        const text = await runStreamingWithDraw({
          nodeId: newNodeId,
          callAi: (onStreamChunk) =>
            callUniversalAI({
              config: aiConfig,
              systemInstruction,
              prompt: t('ai.prompts.agentDiscussionTurn', {
                speakerName,
                otherSpeakers: otherSpeakers || '—',
                initialContext,
                dialogueHistory,
                turnNumber: turn - startTurnIndex + 1,
                turnTotal: DISCUSSION_TURN_COUNT,
              }),
              temperature: agentConfig?.temperature ?? 0.7,
              topP: agentConfig?.creativity ?? 0.4,
              images: images.length > 0 ? images : undefined,
              onStreamChunk,
              sessionId: spoorLlmSessionId('discuss', discussionId),
            }),
        });

        if (!text) {
          break;
        }

        const updated = await db.nodes.get(newNodeId);
        spawnedCards.push(updated ?? { ...cardRow, content: text });
        prevAiId = newNodeId;

        if (turn < batchEnd - 1) {
          await db.nodes.update(newNodeId, { followUpSent: true });
        }
      } catch (turnErr) {
        const msg = formatAiError(turnErr);
        try {
          await markAiCardFailed(newNodeId, msg);
        } catch {
          /* stream helper may already have marked the card */
        }
        throw turnErr;
      } finally {
        await settleAiCardGeneration(newNodeId);
      }
    }
  };

  const readDiscussionWorkZoneContext = (hubAgentNodeId: string, liveNodes: CanvasNode[]) => {
    const { contextText, payload: ctxPayload } = readWorkZoneContext(hubAgentNodeId, liveNodes);
    return { contextText, ctxPayload };
  };

  /**
   * One back-and-forth multi-agent discussion: hub agent + linked peer agents + one context note.
   * Spawns DISCUSSION_TURN_COUNT AI cards in a vertical thread.
   */
  const startAgentDiscussion = async (hubAgentNodeId: string) => {
    if (isAnyAiBusy) return;

    const { liveNodes, liveEdges } = await loadLiveCanvasGraph();
    const getContextText = (nodeId: string) => {
      const el = nodesRef.current[nodeId];
      if (el) return getCanvasNodeContextText(el);
      const n = liveNodes.find((x) => x.id === nodeId);
      return (n?.content ?? '').trim();
    };

    const participants = resolveAgentDiscussionParticipants(
      hubAgentNodeId,
      liveNodes,
      liveEdges,
      getContextText,
    );
    if (!participants) {
      void appAlert({ message: t('nodes.agent_discussion_need_peers') });
      return;
    }

    const { contextNodeId, speakerAgentConfigIds } = participants;
    const { contextText, ctxPayload } = readDiscussionWorkZoneContext(hubAgentNodeId, liveNodes);
    if (!contextText.trim()) {
      void appAlert({ message: t('nodes.agent_no_context') });
      return;
    }

    const hubNode = liveNodes.find((n) => n.id === hubAgentNodeId);
    setAnalyzingAgentNodeId(hubAgentNodeId);

    try {
      await spawnDiscussionTurns({
        discussionId: crypto.randomUUID(),
        contextNodeId,
        speakerAgentConfigIds,
        initialContext: contextText,
        threadContextImageNodeIds: ctxPayload.imageNodeIds,
        contextImageDataUrls: ctxPayload.imageDataUrls,
        historyCards: [],
        startTurnIndex: 0,
        prevAiId: null,
        cursorX: hubNode ? hubNode.x + 350 : window.innerWidth / 2,
        cursorY: hubNode ? hubNode.y : window.innerHeight / 2,
        fromNodeId: hubAgentNodeId,
      });
    } catch (e) {
      const msg = formatAiError(e);
      console.error('[Spoor] startAgentDiscussion failed', {
        error: msg,
        provider: aiConfig.provider,
        model: aiConfig.model,
        apiKey: maskApiKeyForLog(aiConfig.apiKey),
      });
    } finally {
      setStreamingAiNodeId(null);
      setAnalyzingAgentNodeId(null);
    }
  };

  /**
   * Another back-and-forth from the latest discussion reply, keeping the same speakers and transcript.
   */
  const continueAgentDiscussion = async (leafAiNodeId: string) => {
    if (isAnyAiBusy) return;

    const { liveNodes, liveEdges } = await loadLiveCanvasGraph();
    if (!isAgentDiscussionLeaf(leafAiNodeId, liveNodes, liveEdges)) return;

    const leaf = liveNodes.find((n) => n.id === leafAiNodeId);
    const speakerAgentConfigIds = leaf?.threadDiscussionAgentIds;
    const discussionId = leaf?.threadDiscussionId;
    const contextNodeId = leaf?.threadRootContextNodeId;
    if (!leaf || !speakerAgentConfigIds?.length || !discussionId || !contextNodeId) return;

    const chain = collectAiThreadChain(liveNodes, liveEdges, leafAiNodeId);
    const historyCards = chain.filter((n) => (n.content ?? '').trim());
    const hubId = findDiscussionHubAgentId(chain, liveNodes, liveEdges);
    if (hubId) setAnalyzingAgentNodeId(hubId);

    const hubContext = hubId
      ? readDiscussionWorkZoneContext(hubId, liveNodes)
      : { contextText: '', ctxPayload: { imageNodeIds: [] as string[], imageDataUrls: [] as string[] } };
    const { contextText, ctxPayload } = hubContext;
    const initialContext = contextText.trim()
      ? contextText
      : t('ai.prompts.agentThreadContextMissing');

    const storedImageIds = leaf.threadContextImageNodeIds ?? [];
    const threadContextImageNodeIds = storedImageIds.length > 0 ? storedImageIds : ctxPayload.imageNodeIds;
    const contextImageDataUrls =
      storedImageIds.length > 0
        ? resolveImageDataUrlsFromNodeIds(storedImageIds, liveNodes)
        : ctxPayload.imageDataUrls;

    const lastTurn = leaf.threadDiscussionTurnIndex ?? Math.max(0, historyCards.length - 1);

    try {
      await spawnDiscussionTurns({
        discussionId,
        contextNodeId,
        speakerAgentConfigIds,
        initialContext,
        threadContextImageNodeIds,
        contextImageDataUrls,
        historyCards,
        startTurnIndex: lastTurn + 1,
        prevAiId: leaf.id,
        cursorX: leaf.x,
        cursorY: leaf.y,
        fromNodeId: leaf.id,
      });
      await db.nodes.update(leaf.id, { followUpSent: true });
    } catch (e) {
      const msg = formatAiError(e);
      console.error('[Spoor] continueAgentDiscussion failed', {
        error: msg,
        provider: aiConfig.provider,
        model: aiConfig.model,
        apiKey: maskApiKeyForLog(aiConfig.apiKey),
      });
    } finally {
      setStreamingAiNodeId(null);
      setAnalyzingAgentNodeId(null);
    }
  };

  const generateAgentCover = async (agentConfigId: string) => {
    if (isAnyAiBusy) return;
    const agent = agentConfigs.find((a) => a.id === agentConfigId) ?? (await db.agents.get(agentConfigId));
    if (!agent) return;
    if (!canGenerateImages()) {
      void appAlert({ message: t('voice.flux_need_key') });
      return;
    }

    setGeneratingCoverAgentId(agentConfigId);
    try {
      const { url } = await generateGptImage2({
        ...imageKeys(),
        prompt: buildAgentCoverPrompt({
          name: resolveAgentLocalizedName(agent),
          role: resolveAgentLocalizedRole(agent),
          prompt: resolveAgentSystemPrompt(agent),
        }),
        size: GPT_IMAGE_SIZE.landscape,
        quality: 'high',
      });
      await db.agents.update(agentConfigId, { coverImageUrl: url });
      await syncAgentCanvasCardSize(agentConfigId, true);
    } catch (e) {
      const msg = formatAiError(e);
      console.error('[Spoor] generateAgentCover failed', { error: msg });
      void appAlert({ message: t('voice.flux_error', { message: formatImageGenerationError(msg, t) }) });
    } finally {
      setGeneratingCoverAgentId(null);
    }
  };

  /**
   * Note chrome: the model calls Metaso tools, reads hits, and only cards
   * that are actually about the current discussion (linked notes included).
   */
  const searchNoteWithMedia = async (noteNodeId: string) => {
    if (noteSearchGuardRef.current || isAnyAiBusy) return;

    const note = dynamicNodes.find((n) => n.id === noteNodeId);
    if (!note || (note.type !== 'note' && note.type !== 'text')) return;

    if (!hasMetasoAccess(aiConfig.metasoApiKey)) {
      void appAlert({ message: t('nodes.search_no_metaso_key') });
      return;
    }
    const key = (aiConfig.metasoApiKey || '').trim();

    const noteText = (note.content ?? '').trim();
    if (!noteText) {
      void appAlert({ message: t('nodes.search_need_note_text') });
      return;
    }

    noteSearchGuardRef.current = true;
    setSearchingNoteNodeId(noteNodeId);
    try {
      const linkedTexts = collectLinkedCardTextsForSearch(noteNodeId, dynamicNodes, edges);
      const linkedContext = formatLinkedCardContextForSearch(linkedTexts);
      const picks = await runNoteSearchAgent({
        noteText,
        linkedContext,
        metasoApiKey: key,
        aiConfig,
        t,
      });
      console.info('[Spoor] note search agent picks', {
        noteId: noteNodeId,
        linkedCards: linkedTexts.length,
        pickIds: picks.map((p) => p.id),
        kinds: picks.map((p) => p.kind),
      });
      if (picks.length === 0) {
        void appAlert({ message: t('nodes.search_no_media') });
        return;
      }

      const el = nodesRef.current[noteNodeId];
      const noteH = note.height && note.height > 0 ? note.height : el?.offsetHeight ?? 200;
      const base = { x: note.x, y: note.y };
      const pages = picks.filter((p) => p.kind === 'webpage').map((p) => p.raw as MetasoWebpage);
      const images = picks.filter((p) => p.kind === 'image').map((p) => p.raw as MetasoImage);
      const videos = picks.filter((p) => p.kind === 'video').map((p) => p.raw as MetasoMediaItem);
      const podcasts = picks.filter((p) => p.kind === 'podcast').map((p) => p.raw as MetasoMediaItem);
      const laneCount = pages.length + videos.length + podcasts.length;
      const relationContext = webSearchRelationContext(note, deriveSearchQueryFromNoteText(noteText));

      if (pages.length > 0) {
        await spawnWebSearchCardsFromPages(noteNodeId, base, pages, activeCanvasId, {
          anchorHeight: noteH,
          laneCount,
          staggerMs: 160,
        });
        const ogImages = await collectWebpageOgImages(pages);
        if (ogImages.length > 0) {
          await spawnWebSearchCardsFromImages(noteNodeId, base, ogImages, activeCanvasId, {
            anchorHeight: noteH,
            laneCount: ogImages.length,
            staggerMs: 160,
            relationContext,
          });
        }
      }
      if (images.length > 0) {
        await spawnWebSearchCardsFromImages(noteNodeId, base, images, activeCanvasId, {
          anchorHeight: noteH,
          laneCount: images.length,
          staggerMs: 160,
          relationContext,
        });
      }
      if (videos.length > 0) {
        await spawnWebSearchCardsFromMedia(noteNodeId, base, videos, activeCanvasId, 'video', {
          anchorHeight: noteH,
          indexOffset: pages.length,
          laneCount,
          staggerMs: 160,
          relationContext,
        });
      }
      if (podcasts.length > 0) {
        await spawnWebSearchCardsFromMedia(noteNodeId, base, podcasts, activeCanvasId, 'podcast', {
          anchorHeight: noteH,
          indexOffset: pages.length + videos.length,
          laneCount,
          staggerMs: 160,
          relationContext,
        });
      }
    } catch (e) {
      const msg = formatAiError(e);
      console.error('[Spoor] searchNoteWithMedia failed', { error: msg });
      void appAlert({ message: `${t('nodes.search_failed')}\n\n${msg}` });
    } finally {
      noteSearchGuardRef.current = false;
      setSearchingNoteNodeId(null);
    }
  };

  /** Turn a book/AI selection into a plain text note linked to the source card (no AI). */
  const extractBookSelectionToCard = async (
    sourceNodeId: string,
    quote: string,
    _sourceLabel?: string,
  ) => {
    const passage = normalizeExtractedPassage(quote);
    if (!passage) return;

    const sourceNode = dynamicNodes.find((n) => n.id === sourceNodeId);
    if (!sourceNode || (sourceNode.type !== 'book' && sourceNode.type !== 'ai')) return;

    const { x, y } = findOpenCanvasPosition({
      transform: transformRef.current,
      obstacles: dynamicNodes,
      size: DEFAULT_NODE_SIZE,
      preferBeside: sourceNode,
    });
    const noteId = crypto.randomUUID();
    const [note] = await stampWorkZoneScopeOnNewNodes(
      [
        stampNewCard({
          id: noteId,
          canvasId: activeCanvasId,
          type: 'text',
          content: passage,
          x,
          y,
        }),
      ],
      activeCanvasId,
    );
    await db.transaction('rw', db.nodes, db.edges, async () => {
      await db.nodes.add(note);
      await db.edges.add({
        id: crypto.randomUUID(),
        canvasId: activeCanvasId,
        from: sourceNodeId,
        to: noteId,
      });
    });
  };

  const transcribeAudioCard = async (nodeId: string) => {
    if (transcribeAudioGuardRef.current) return;
    const sourceNode = dynamicNodes.find((n) => n.id === nodeId);
    if (!sourceNode || !isCanvasAudioCard(sourceNode)) return;

    const creds = {
      apiKey: aiConfig.volcAsrApiKey,
      appId: aiConfig.volcAsrAppId,
      accessToken: aiConfig.volcAsrAccessToken,
      resourceId: aiConfig.volcAsrResourceId,
    };
    if (!hasVolcAsrCredentials(creds)) {
      void appAlert({ message: t('voice.need_asr_keys') });
      return;
    }

    const src = (sourceNode.content || '').trim();
    if (!src) {
      void appAlert({ message: t('nodes.audio_transcribe_empty') });
      return;
    }

    transcribeAudioGuardRef.current = true;
    setTranscribingAudioNodeId(nodeId);
    try {
      const text = await transcribeAudioUrlWithVolcFlash(creds, src, {
        mime: sourceNode.fileType,
      });
      if (!text) {
        void appAlert({ message: t('nodes.audio_transcribe_empty') });
        return;
      }
      await spawnLinkedTranscriptNote({
        canvasId: activeCanvasId,
        sourceNode,
        obstacles: dynamicNodes.map((n) => placementObstacle(n, nodesRef)),
        transform: transformRef.current,
        text,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[Spoor] transcribeAudioCard failed', message);
      void appAlert({ message: t('voice.asr_error', { message }) });
    } finally {
      transcribeAudioGuardRef.current = false;
      setTranscribingAudioNodeId(null);
    }
  };

  const expandBookSelection = async (
    bookNodeId: string,
    quote: string,
    sourceLabel?: string,
  ) => {
    const passage = quote.replace(/\s+/g, ' ').trim();
    if (!passage || expandGuardRef.current || isAnyAiBusy) return;

    const bookNode = dynamicNodes.find((n) => n.id === bookNodeId);
    if (!bookNode || bookNode.type !== 'book') return;

    expandGuardRef.current = true;
    setExpandingBookNodeId(bookNodeId);
    try {
      const text = await callUniversalAI({
        config: aiConfig,
        systemInstruction: combineSystemParts(
          getLocaleDirective(),
          t('ai.prompts.bookExpandSystem'),
        ),
        prompt: t('ai.prompts.bookExpandUser', {
          source: sourceLabel?.trim() || bookNode.description || '',
          passage,
        }),
        sessionId: spoorLlmSessionId('book', bookNodeId),
      });
      const plan = parseBookExpandPlan(text ?? '');
      if (!plan) {
        void appAlert({ message: t('nodes.book_expand_parse_failed') });
        return;
      }
      const { hubId } = await spawnBookExpandCards({
        bookNodeId,
        canvasId: activeCanvasId,
        bookPos: {
          x: bookNode.x,
          y: bookNode.y,
          width: bookNode.width,
          height: bookNode.height,
        },
        plan,
      });
      if (plan.images.length > 0) {
        void fulfillDrawToolFromNode({
          nodeId: hubId,
          images: plan.images,
          ...imageKeys(),
          wireEdge: !isCanvasV2Enabled(),
          onMissingKey: () => {
            void appAlert({ message: t('voice.flux_need_key') });
          },
          onError: (message) => {
            void appAlert({ message: t('voice.flux_error', { message: formatImageGenerationError(message, t) }) });
          },
        });
      }
    } catch (e) {
      const msg = formatAiError(e);
      console.error('[Spoor] expandBookSelection failed', {
        error: msg,
        provider: aiConfig.provider,
        model: aiConfig.model,
        apiKey: maskApiKeyForLog(aiConfig.apiKey),
      });
      void notifyAiFailure(msg);
    } finally {
      expandGuardRef.current = false;
      setExpandingBookNodeId(null);
    }
  };

  /**
   * Hard cap on multi-turn history. Each round is two messages (user +
   * assistant); 20 rounds = 40 messages, leaving room for the system and
   * current user turn within a typical 32k–128k context window. Older
   * rounds are silently dropped — if a user wants them back they can
   * scroll the canvas to the historical AI card and re-quote.
   */
  const runAskCardGeneration = async (
    rootNodeId: string,
    request: string,
    options?: {
      onStreamChunk?: (accumulated: string) => void;
      /** Fires once the reply card exists, before the model stream starts. */
      onReplyNodeCreated?: (nodeId: string) => void;
      voiceBrief?: boolean;
      /** Toolbar mic pin: a node id pins that agent; `null` forces 阿狸. */
      preferredAgentNodeId?: string | null;
      /** Re-run a failed reply into this existing card instead of spawning another. */
      reuseNodeId?: string;
    },
  ): Promise<string | null> => {
    const root = dynamicNodes.find((n) => n.id === rootNodeId);
    if (!root) return null;
    if (root.type !== 'ask' && !canAskAiOnNode(root)) return null;

    if (root.type !== 'agent' && root.type !== 'ask') return null;

    return sendPersonaMessage(rootNodeId, request, {
      focusNodeIds: expandSelectionWithNotePiles([...selectedNodes], dynamicNodes),
      voiceBrief: options?.voiceBrief,
      onStreamChunk: options?.onStreamChunk,
      onReplyCreated: options?.onReplyNodeCreated,
    });
  };

  /** Rewrite a failed canvas AI card in place (`reuseNodeId`). Side-panel chat retry uses persona threads instead. */
  const retryAiCardGeneration = async (nodeId: string) => {
    if (isAnyAiBusy) return;
    const node = await db.nodes.get(nodeId);
    if (!node || node.type !== 'ai') return;
    if (node.aiStatus !== 'error' && node.aiStatus !== 'generating') return;

    const { liveNodes, liveEdges } = await loadLiveCanvasGraph();
    const live = liveNodes.find((n) => n.id === nodeId) ?? node;
    const incoming = liveEdges.find((e) => e.to === nodeId);

    if (live.threadDiscussionId && live.threadDiscussionAgentIds?.length && live.threadRootContextNodeId) {
      const chain = collectAiThreadChain(liveNodes, liveEdges, nodeId);
      const historyCards = chain.filter(
        (n) => n.id !== nodeId && Boolean((n.content ?? '').trim()),
      );
      const hubId = findDiscussionHubAgentId(chain, liveNodes, liveEdges);
      if (hubId) setAnalyzingAgentNodeId(hubId);
      const hubContext = hubId
        ? readDiscussionWorkZoneContext(hubId, liveNodes)
        : { contextText: '', ctxPayload: { imageNodeIds: [] as string[], imageDataUrls: [] as string[] } };
      const { contextText, ctxPayload } = hubContext;
      const initialContext = contextText.trim()
        ? contextText
        : t('ai.prompts.agentThreadContextMissing');
      const storedImageIds = live.threadContextImageNodeIds ?? [];
      const threadContextImageNodeIds =
        storedImageIds.length > 0 ? storedImageIds : ctxPayload.imageNodeIds;
      const contextImageDataUrls =
        storedImageIds.length > 0
          ? resolveImageDataUrlsFromNodeIds(storedImageIds, liveNodes)
          : ctxPayload.imageDataUrls;
      try {
        await spawnDiscussionTurns({
          discussionId: live.threadDiscussionId,
          contextNodeId: live.threadRootContextNodeId,
          speakerAgentConfigIds: live.threadDiscussionAgentIds,
          initialContext,
          threadContextImageNodeIds,
          contextImageDataUrls,
          historyCards,
          startTurnIndex: live.threadDiscussionTurnIndex ?? 0,
          prevAiId: incoming?.from ?? null,
          cursorX: live.x,
          cursorY: live.y,
          fromNodeId: incoming?.from ?? live.id,
          reuseNodeId: nodeId,
        });
      } catch (e) {
        const msg = formatAiError(e);
        console.error('[Spoor] retryAiCardGeneration discussion failed', { error: msg });
      } finally {
        setStreamingAiNodeId(null);
        setAnalyzingAgentNodeId(null);
      }
      return;
    }

    if (live.threadAgentConfigId && live.threadRootContextNodeId) {
      const agentNodeId =
        incoming && liveNodes.find((n) => n.id === incoming.from)?.type === 'agent'
          ? incoming.from
          : liveNodes.find(
              (n) => n.type === 'agent' && n.agentConfigId === live.threadAgentConfigId,
            )?.id;
      if (!agentNodeId) return;
      await triggerAgentAnalysis(
        live.threadAgentConfigId,
        agentNodeId,
        live.threadRootContextNodeId,
        { reuseNodeId: nodeId },
      );
    }
  };

  return {
    isPublishing,
    publishSequenceActive,
    publishSequenceCandidateIds,
    publishSequenceOrderedIds,
    setPublishSequenceOrderedIds,
    publishSequenceGenerating,
    cancelPublishSequence,
    confirmPublishSequence,
    analyzingAgentNodeId,
    streamingAiNodeId,
    setStreamingAiNodeId,
    streamingAskNodeId,
    streamingThought,
    setStreamingThought,
    isAnyAiBusy,
    isNonPersonaAiBusy,
    personaStreams,
    extractBookSelectionToCard,
    transcribeAudioCard,
    transcribingAudioNodeId,
    expandBookSelection,
    expandingBookNodeId,
    searchNoteWithMedia,
    searchingNoteNodeId,
    handlePublish,
    triggerAgentAnalysis,
    startAgentDiscussion,
    continueAgentDiscussion,
    generateAgentCover,
    generatingCoverAgentId,
    runAskCardGeneration,
    retryAiCardGeneration,
    sendPersonaMessage,
  };
}
