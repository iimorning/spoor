import { useCallback, useRef, useState, type RefObject } from 'react';
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
import { formatExcerptCardContent } from '../utils/bookExcerpts';
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
import type { CanvasChatMessage, CanvasPersonaThread } from '../db';
import { parseBookExpandPlan, spawnBookExpandCards } from '../services/spawnBookExpandCards';
import { transcribeAudioUrlWithVolcFlash } from '../services/volcAsrFlash';
import { spawnLinkedTranscriptNote } from '../services/spawnLinkedTranscriptNote';
import { attachSuggestedFollowUpsToThreadMessage } from '../utils/suggestedFollowUps';
import { isCanvasAudioCard } from '../utils/canvasAudioCard';
import { hasVolcAsrCredentials } from '../services/volcAsr';
import { GPT_IMAGE_SIZE } from '../utils/imageOrientation';
import { buildAgentCoverPrompt } from '../constants/agentCoverPrompt';
import { syncAgentCanvasCardSize } from '../utils/agentCoverCards';
import {
  DEFAULT_ROOM_DISCUSSION_ROUNDS,
  buildRoomTurnCue,
  clampRoomDiscussionRounds,
  formatRoomHistoryForSpeaker,
  personaNodeDisplayName,
  resolveRoomSpeakers,
  roomMessageSpeaker,
  sanitizeRoomRoster,
  type PersonaSpeakerStreamHandler,
} from '../utils/personaChatRoom';

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
  /**
   * 房间主动发言在途（`useRoomProactiveChat` 写进来）。
   *
   * 单独一个 Set，不复用 `personaBusyRef`：两边的生命周期不一样——用户发言
   * 是自己起的、结束必然清；主动发言由 8 秒定时器发起，还可能被侧边栏那个
   * 开关中途作废。合在一起的话，取消一次会把别人正持有的锁也松开。
   * 但 `sendPersonaMessage` 必须同时看这两个：thread 是整条 messages 数组
   * 读-改-写的，两条流同时写会互相覆盖。
   */
  const proactiveBusyRef = useRef(new Set<string>());
  const markProactiveBusy = useCallback((personaNodeId: string, busy: boolean) => {
    if (busy) proactiveBusyRef.current.add(personaNodeId);
    else proactiveBusyRef.current.delete(personaNodeId);
  }, []);
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

  /**
   * 房间里的发言人的 system：人设 + 共享材料 + 房间附录。
   * 主人和参与者走同一份材料（就是主人的房间背景）——见 runRoomSpeakerTurn 的说明。
   */
  const buildRoomSpeakerSystem = (speakerNode: CanvasNode, opts: {
    contextBlock: string;
    /** 材料是否非空：决定阿狸走"带笔记"还是"裸人设"提示词 */
    hasContext: boolean;
    appendix: string;
  }): string => {
    const speakerAgent =
      speakerNode.type === 'agent' && speakerNode.agentConfigId
        ? agentConfigs.find((a) => a.id === speakerNode.agentConfigId)
        : undefined;
    if (speakerAgent) {
      return buildAgentSystemInstruction(speakerAgent, {
        extraParts: [opts.contextBlock, opts.appendix],
      });
    }
    return combineSystemParts(
      getLocaleDirective(),
      t('ai.prompts.askCharacterIdentity', { name: t('ask.character_name') }),
      opts.hasContext ? t('ai.prompts.toolbarWithNotesSystem') : t('ai.prompts.toolbarBarePersona'),
      opts.contextBlock,
      opts.appendix,
    );
  };

  /** 一轮房间发言的结局：说了、跳过（卡没了/没绑人设）、失败（接口出错）。 */
  type RoomTurnOutcome = 'spoken' | 'skipped' | 'failed';

  /**
   * 让房间里的一个角色说一轮：追加一条带署名的回复卡，流式写完就返回。
   * 用户的轮次和自动讨论都走这里 —— 它不碰 user turn，也不给参与者联网/生图工具
   * （检索由主 Agent 负责，否则一轮会打出好几份请求）。
   */
  const runRoomSpeakerTurn = async (input: {
    speakerNodeId: string;
    threadId: string;
    liveNodes: CanvasNode[];
    /** 已含人设 + 房间规则 + 共享材料，由 buildRoomSpeakerSystem 造 */
    systemInstruction: string;
    /** 没有署名的旧回复都归主人：参与者接入前的老对话也要能分清谁说的 */
    hostNameFallback: string;
    /** 这一轮附带的图片（用户 chip 的卡）；自动讨论没有用户输入，传空 */
    images?: string[];
    maxMessages: number;
    /** 这一轮的流式文本（累积）。语音模式据此按发言人各念各的。 */
    onSpeakerStream?: PersonaSpeakerStreamHandler;
  }): Promise<RoomTurnOutcome> => {
    const {
      speakerNodeId, threadId, liveNodes, systemInstruction,
      hostNameFallback, images, maxMessages, onSpeakerStream,
    } = input;
    const speakerNode = liveNodes.find((n) => n.id === speakerNodeId);
    if (!speakerNode || (speakerNode.type !== 'agent' && speakerNode.type !== 'ask')) {
      return 'skipped';
    }
    const speakerAgent =
      speakerNode.type === 'agent' && speakerNode.agentConfigId
        ? agentConfigs.find((a) => a.id === speakerNode.agentConfigId)
        : undefined;
    if (speakerNode.type === 'agent' && !speakerAgent) return 'skipped';

    const speakerName = personaNodeDisplayName(
      speakerNode,
      agentConfigs,
      t('ask.character_name'),
      t('nodes.agent_fallback_name'),
    );
    const row = await db.canvasPersonaThreads.get(threadId);
    if (!row) return 'skipped';
    const speakerMsg: CanvasChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      text: '',
      createdAt: Date.now(),
      speakerNodeId,
      speakerName,
    };
    await db.canvasPersonaThreads.put({
      ...row,
      messages: [...row.messages, speakerMsg],
      updatedAt: Date.now(),
    });
    const history = formatRoomHistoryForSpeaker(
      row.messages,
      speakerNodeId,
      (name) => t('canvas.v2.room_history_speaker', { name }),
      maxMessages,
      hostNameFallback,
    );
    // cue 从刚读出来的 transcript 造：这样"上一位是谁、说了什么"永远和真实历史一致，
    // 即使中途有人被禁言或删卡而跳过了发言。
    const turnCue = buildRoomTurnCue({
      speakerNodeId,
      messages: row.messages,
      hostNameFallback,
      t,
    });

    setPersonaStreams((prev) => ({
      ...prev,
      [speakerNodeId]: { messageId: speakerMsg.id, thought: '' },
    }));
    // 这一个声音在说话期间算忙：别人（含它自己的侧栏）不能再让它同时答第二件事。
    personaBusyRef.current.add(speakerNodeId);
    try {
      await runPersonaStreamingCall({
        threadId,
        messageId: speakerMsg.id,
        onThinking: (thought) => {
          setPersonaStreams((prev) => {
            // 只更新自己那一格：用户可能同时在这个角色自己的侧栏里发消息。
            const slot = prev[speakerNodeId];
            if (slot?.messageId !== speakerMsg.id) return prev;
            return { ...prev, [speakerNodeId]: { ...slot, thought } };
          });
        },
        callAi: async (onStreamChunk) =>
          callUniversalAI({
            config: aiConfig,
            messages: [...history, { role: 'user' as const, content: turnCue }],
            systemInstruction,
            temperature: speakerAgent?.temperature ?? 0.7,
            topP: speakerAgent?.creativity ?? 0.4,
            images: images && images.length > 0 ? images : undefined,
            onStreamChunk,
            sessionId: spoorLlmSessionId('persona', speakerNodeId),
          }),
        // 只有语音模式要：这一轮谁在说、说到哪儿了。
        onStreamChunk: onSpeakerStream
          ? (accumulated) => onSpeakerStream({ messageId: speakerMsg.id, speakerNodeId, accumulated })
          : undefined,
      });
      return 'spoken';
    } catch (speakerErr) {
      const msg = formatAiError(speakerErr);
      console.error('[Spoor] room speaker turn failed', { speaker: speakerNodeId, error: msg });
      const failed = await db.canvasPersonaThreads.get(threadId);
      if (failed) {
        await db.canvasPersonaThreads.put({
          ...failed,
          messages: failed.messages.map((m) =>
            m.id === speakerMsg.id ? { ...m, text: msg } : m,
          ),
          updatedAt: Date.now(),
        });
      }
      return 'failed';
    } finally {
      setPersonaStreams((prev) => {
        // 只清自己那一格：用户可能同时在那个角色自己的侧栏里发消息。
        if (prev[speakerNodeId]?.messageId !== speakerMsg.id) return prev;
        const next = { ...prev };
        delete next[speakerNodeId];
        return next;
      });
      personaBusyRef.current.delete(speakerNodeId);
    }
  };

  /**
   * 一次房间发言所需的全部输入：校准过的名单、房间附录、共享材料由调用方再取。
   * 用户轮次和自动讨论都从这里取 —— 各拼一份名单/附录迟早会漂移。
   */
  const buildRoomTurnContext = (args: {
    hostNodeId: string;
    hostSpeakerName: string;
    liveNodes: CanvasNode[];
    thread: CanvasPersonaThread;
  }) => {
    const { hostNodeId, hostSpeakerName, liveNodes, thread } = args;
    // thread 上存的是参与者的节点 id，实际名单要对着活节点重新校准（角色卡可能已被删除）。
    const room = sanitizeRoomRoster(
      hostNodeId,
      thread.participantNodeIds,
      thread.mutedNodeIds,
      liveNodes,
    );
    const nameOf = (id: string) => {
      const node = liveNodes.find((n) => n.id === id);
      return node
        ? personaNodeDisplayName(
            node,
            agentConfigs,
            t('ask.character_name'),
            t('nodes.agent_fallback_name'),
          )
        : '';
    };
    const roomPeerIds = room.participantNodeIds;
    // 这一轮真正会接话的人：主 Agent 先，然后是没被禁言的参与者。
    const roomPeerSpeakerIds = resolveRoomSpeakers(
      hostNodeId,
      room.participantNodeIds,
      room.mutedNodeIds,
      liveNodes,
    ).filter((id) => id !== hostNodeId);
    // 按节点 id（而不是名字）判断"除了我还有谁"——两张阿狸卡的显示名会重名。
    const roomMembers = [
      { nodeId: hostNodeId, name: hostSpeakerName },
      ...roomPeerIds.map((id) => ({ nodeId: id, name: nameOf(id) })),
    ].filter((m) => Boolean(m.name));
    const mutedNames = room.mutedNodeIds.map(nameOf).filter(Boolean);
    const roomAppendixFor = (selfNodeId: string) =>
      combineSystemParts(
        // 主人和参与者的处境不同：主人这一轮是在回答用户（答完别人再接），
        // 参与者才是在回应其他角色。规则分开写，免得主人被告知"你不是在回答用户的新问题"。
        t(
          selfNodeId === hostNodeId
            ? 'ai.prompts.personaGroupRoomHost'
            : 'ai.prompts.personaGroupRoomGuest',
        ),
        t('ai.prompts.personaGroupPresent', {
          others:
            roomMembers
              .filter((m) => m.nodeId !== selfNodeId)
              .map((m) => m.name)
              .join('、') || '—',
        }),
        mutedNames.length > 0
          ? t('ai.prompts.personaGroupRoomMuted', { muted: mutedNames.join('、') })
          : '',
      );
    return {
      room,
      roomPeerSpeakerIds,
      roomAppendixFor,
      roomIsActive: roomMembers.length > 1,
      // 主角色也能被禁言：这一轮它不出声，只有参与者接话。
      hostMuted: room.mutedNodeIds.includes(hostNodeId),
    };
  };

  /** 一轮讨论的默认轮数（跑完按钮变成"继续讨论"，想继续就再点）。 */
  const ROOM_DISCUSSION_TURNS_PER_BATCH = DEFAULT_ROOM_DISCUSSION_ROUNDS;

  /**
   * 自动讨论的运行态：token 用于取消（每次开始/停止都自增，陈旧批次看到不一致就退出），
   * batchToken 记录"这一批的进度归谁清"（被顶替的批次不能抹掉新批次的进度），
   * currentTurn 用于让"插话"等正在说的那一轮收尾。
   */
  const roomDiscussionRef = useRef<{
    token: number;
    /** 拥有当前进度的那一批的令牌：只有它自己能清 roomDiscussion。 */
    batchToken: number;
    currentTurn: Promise<unknown> | null;
    /** 正在讨论的房间，用于"别的房间在聊就别插一脚"以及停止时只停自己。 */
    hostNodeId: string | null;
  }>({
    token: 0,
    batchToken: 0,
    currentTurn: null,
    hostNodeId: null,
  });
  const [roomDiscussion, setRoomDiscussion] = useState<{
    hostNodeId: string;
    /** 当前第几轮（1-based）与这一批总共几轮，用于侧栏的进度显示。 */
    round: number;
    rounds: number;
  } | null>(null);

  /**
   * 停掉自动讨论，并等当前那一轮写完。
   *
   * 等它写完是必须的：thread 是按整条 messages 数组读-改-写的，如果用户的消息和
   * 那一轮的流式写入交错，两边会互相覆盖。所以"插话"的表现是：正在说的那一位
   * 先把这一句说完，然后轮到你。
   *
   * 只停属于这个房间的讨论：别的房间在聊，不该被这里的发言打断。
   */
  const stopRoomDiscussion = async (hostNodeId?: string) => {
    const run = roomDiscussionRef.current;
    if (hostNodeId && run.hostNodeId && run.hostNodeId !== hostNodeId) return;
    run.token += 1;
    run.hostNodeId = null;
    // 进度不在这里清：批次自己的 finally 会清，那之前侧栏还要知道"有讨论在进行"，
    // 否则插话等待期间合成器会被误判成忙而禁用。
    const inFlight = run.currentTurn;
    if (inFlight) await inFlight.catch(() => {});
  };

  /**
   * 让房间里的角色自己聊下去：一轮 = 每个未禁言的声音各说一次，按名单顺序（主人先）。
   *
   * 每一轮、每一次发言前都重新读名单和材料 —— 这一条同时保证：停止指令立刻生效、
   * 讨论中途删掉的角色卡下一轮就不再出现、禁言状态的改变立刻生效，以及一个陈旧批次
   * 不会在新批次开始后继续往同一个 thread 里写。
   *
   * 轮内顺序每轮都从主人重新开始，但"回应谁"由 transcript 决定（见 runRoomSpeakerTurn），
   * 所以跨轮的话茬照样接得上：第二轮的主人回应的是上一轮最后说话的那个人。
   */
  const advanceRoomDiscussion = async (
    hostNodeId: string,
    rounds: number = DEFAULT_ROOM_DISCUSSION_ROUNDS,
  ) => {
    if (isNonPersonaAiBusy) return;
    const run = roomDiscussionRef.current;
    if (run.currentTurn || run.hostNodeId) {
      // 一次只跑一场讨论。别的房间在聊时给个明示 —— 按钮看起来可点却没反应最糟。
      if (run.hostNodeId && run.hostNodeId !== hostNodeId) {
        void appAlert({ message: t('canvas.v2.room_discussion_other_room') });
      }
      return;
    }
    // 这个角色自己正在说话（侧栏手动发送、语音那一轮，或画布上的分析）：
    // 等它说完再开始，否则两条流会对同一条 thread 做读-改-写，先读的那一边被覆盖。
    if (personaBusyRef.current.has(hostNodeId)) {
      void appAlert({ message: t('canvas.v2.send_busy') });
      return;
    }

    const totalRounds = clampRoomDiscussionRounds(rounds);
    // 令牌与房间占用必须在第一个 await 之前落定：否则两次快速开始都能通过上面的检查，
    // 后一批的 finally 会把前一批还在跑的进度清掉（侧栏只剩"开始讨论"，停不下来）。
    const token = ++run.token;
    run.batchToken = token;
    run.hostNodeId = hostNodeId;
    try {
      const { liveNodes: startNodes } = await loadLiveCanvasGraph();
      const hostNode = startNodes.find((n) => n.id === hostNodeId);
      if (!hostNode || !isPersonaAnchorNode(hostNode)) return;
      const hostAgent =
        hostNode.type === 'agent' && hostNode.agentConfigId
          ? agentConfigs.find((a) => a.id === hostNode.agentConfigId)
          : undefined;
      if (hostAgent && isTurtleSoupHostAgent(hostAgent)) {
        // 海龟汤是单人玩法（出题/裁判两段式），自动讨论不适用。
        void appAlert({ message: t('canvas.v2.room_discussion_turtle') });
        return;
      }

      setRoomDiscussion({ hostNodeId, round: 1, rounds: totalRounds });
      let stopped = false;
      for (let round = 1; round <= totalRounds && !stopped; round++) {
        if (run.token !== token) break;
        setRoomDiscussion({ hostNodeId, round, rounds: totalRounds });

        const hostSpeakerName = personaNodeDisplayName(
          hostNode,
          agentConfigs,
          t('ask.character_name'),
          t('nodes.agent_fallback_name'),
        );
        const opening = await loadRoomTurnSnapshot(hostNodeId, hostSpeakerName);
        if (!opening || !opening.ctx.roomIsActive) break; // 房间里只剩主人，没什么可聊的
        if (opening.speakers.length === 0) {
          void appAlert({ message: t('canvas.v2.room_all_muted') });
          break;
        }

        // 一轮内每个声音各说一次。每一句之前都重新读一次名单：中途被禁言或删卡的人
        // 在这一轮里就不会再拿到麦克风（不是等到下一轮才生效）。
        const spokenThisRound = new Set<string>();
        for (const planned of opening.speakers) {
          if (run.token !== token) {
            stopped = true;
            break;
          }
          const snapshot = await loadRoomTurnSnapshot(hostNodeId, hostSpeakerName);
          // 读快照是一个 await：这期间用户可能已经按了停止（或这一批被顶替）。
          // 不在这里再查一次，就会在"停止"之后还多跑一整轮。
          if (run.token !== token) {
            stopped = true;
            break;
          }
          if (!snapshot || !snapshot.speakers.includes(planned)) continue;
          if (spokenThisRound.has(planned)) continue;

          const turn = runRoomSpeakerTurn({
            speakerNodeId: planned,
            threadId: personaThreadId(activeCanvasId, hostNodeId),
            liveNodes: snapshot.liveNodes,
            systemInstruction: buildRoomSpeakerSystem(snapshot.speakerNode(planned), {
              contextBlock: snapshot.contextBlock,
              hasContext: snapshot.hasContext,
              appendix: snapshot.ctx.roomAppendixFor(planned),
            }),
            hostNameFallback: hostSpeakerName,
            maxMessages: ASK_THREAD_MAX_ROUNDS * 2,
          });
          run.currentTurn = turn;
          let outcome: RoomTurnOutcome;
          try {
            outcome = await turn;
          } catch (turnErr) {
            // 轮次本身应该自己吞掉模型错误并返回 'failed'；这里兜住读数/写库这类意外，
            // 否则会变成 unhandled rejection（调用方是 void 的）。
            console.error('[Spoor] room turn crashed', { speaker: planned, error: turnErr });
            outcome = 'failed';
          }
          run.currentTurn = null;
          spokenThisRound.add(planned);
          if (outcome === 'failed') {
            stopped = true;
            break;
          }
        }
      }
    } finally {
      // 只有还持有这一批令牌的批次才清状态：被顶替的批次不能抹掉新批次的进度。
      if (run.batchToken === token) {
        run.currentTurn = null;
        run.hostNodeId = null;
        // 进度由批次自己清（而不是 stop 提前清）：插话那条消息要等这一轮写完才发出去，
        // 那段时间侧栏还得知道"有讨论在进行"，否则合成器会被误判成忙。
        setRoomDiscussion(null);
      }
    }
  };

  /** 改这个房间的讨论轮数（写进 thread，跟着房间走）。 */
  const setRoomDiscussionRounds = async (hostNodeId: string, rounds: number) => {
    const row = await getOrCreatePersonaThread(activeCanvasId, hostNodeId);
    await db.canvasPersonaThreads.put({
      ...row,
      roomDiscussionRounds: clampRoomDiscussionRounds(rounds),
      updatedAt: Date.now(),
    });
  };

  /**
   * 自动讨论里"该谁说话、读什么"的即时快照。每一次发言前都重新取一份 ——
   * 禁言与删卡因此在这一轮内就生效，而不是等到下一轮。
   */
  const loadRoomTurnSnapshot = async (hostNodeId: string, hostSpeakerName: string) => {
    const { liveNodes } = await loadLiveCanvasGraph();
    const thread = await getOrCreatePersonaThread(activeCanvasId, hostNodeId);
    const ctx = buildRoomTurnContext({ hostNodeId, hostSpeakerName, liveNodes, thread });
    // 自动讨论没有用户输入，所以没有本轮重点：整个房间背景都是材料。
    const { contextText } = readWorkZoneContext(hostNodeId, liveNodes, [], true);
    return {
      liveNodes,
      ctx,
      speakers: resolveRoomSpeakers(
        hostNodeId,
        ctx.room.participantNodeIds,
        ctx.room.mutedNodeIds,
        liveNodes,
      ),
      hasContext: Boolean(contextText),
      contextBlock: contextText
        ? `---\n\nWorkspace context (applies to every turn):\n${contextText}`
        : '',
      speakerNode: (nodeId: string) => liveNodes.find((n) => n.id === nodeId),
    };
  };

  const sendPersonaMessage = async (
    personaNodeId: string,
    request: string,
    options?: {
      composerSegments?: ComposerSegment[];
      focusNodeIds?: string[];
      voiceBrief?: boolean;
      onStreamChunk?: (accumulated: string) => void;
      /**
       * 每个发言人（主人 + 房间里的参与者）各自的流式文本。语音模式照这个给每个人
       * 用自己的音色朗读；房间轮次是串行的，所以回调顺序就是说话顺序。
       */
      onSpeakerStream?: PersonaSpeakerStreamHandler;
      onReplyCreated?: (messageId: string) => void;
      /** Fired once the user turn is stored. Composer can clear only after this. */
      onAccepted?: () => void;
    },
  ): Promise<string | null> => {
    const trimmed = request.trim();
    if (isNonPersonaAiBusy || personaBusyRef.current.has(personaNodeId) || proactiveBusyRef.current.has(personaNodeId)) {
      void appAlert({ message: t('canvas.v2.send_busy') });
      return null;
    }
    // 先占住这个角色再等：插话要等正在说的那一轮写完（可能好几秒），
    // 如果先 await 再占，两次发送会双双通过上面的检查、各写一份 user turn 互相覆盖。
    personaBusyRef.current.add(personaNodeId);
    // 插话接管：只停这个房间自己的讨论，别的房间在聊不受影响。
    await stopRoomDiscussion(personaNodeId);

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

    // 多角色房间：名单要从 thread 上存的 id 对着活节点重新校准。
    // 单人房间下这些都是空的，下面的逻辑全部跳过。
    const hostSpeakerName = personaNodeDisplayName(
      personaNode,
      agentConfigs,
      t('ask.character_name'),
      t('nodes.agent_fallback_name'),
    );
    const {
      roomPeerSpeakerIds,
      roomAppendixFor,
      roomIsActive,
      hostMuted,
    } = buildRoomTurnContext({
      hostNodeId: personaNodeId,
      hostSpeakerName,
      liveNodes,
      thread,
    });
    if (roomIsActive && hostMuted && roomPeerSpeakerIds.length === 0) {
      // 没有人在发言，就别往 thread 里写一条永远没有回复的用户消息。
      void appAlert({ message: t('canvas.v2.room_all_muted') });
      return null;
    }
    if (roomIsActive && !hostMuted) {
      systemInstruction = combineSystemParts(systemInstruction, roomAppendixFor(personaNodeId));
    }
    const roomHistoryPrefix = (name: string) => t('canvas.v2.room_history_speaker', { name });
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
    const assistantMsg: CanvasChatMessage | null = hostMuted
      ? null
      : {
          id: crypto.randomUUID(),
          role: 'assistant',
          text: '',
          createdAt: turnAt + 1,
          // 房间里有别人时主 Agent 的回复也署名，参与者才分得清谁说了什么。
          ...roomMessageSpeaker(roomIsActive, personaNodeId, hostSpeakerName),
          ...(turtleHost && priorTurtleRound && !turtleSetter
            ? { turtleSoupRound: priorTurtleRound }
            : {}),
        };
    await db.canvasPersonaThreads.put({
      ...thread,
      messages: assistantMsg
        ? [...thread.messages, userMsg, assistantMsg]
        : [...thread.messages, userMsg],
      composerDraft: undefined,
      composerSegments: [{ type: 'text', content: '' }],
      updatedAt: Date.now(),
    });
    if (assistantMsg) options?.onReplyCreated?.(assistantMsg.id);
    options?.onAccepted?.();

    const maxMessages = ASK_THREAD_MAX_ROUNDS * 2;
    // 房间里别人说过的话带署名，主 Agent 自己的保持裸文本；
    // 单人对话没有任何消息带发言人，结果与旧版逐字相同。
    const trimmedHistory = formatRoomHistoryForSpeaker(
      thread.messages,
      personaNodeId,
      roomHistoryPrefix,
      maxMessages,
    );

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

    if (assistantMsg) {
      setPersonaStreams((prev) => ({
        ...prev,
        [personaNodeId]: { messageId: assistantMsg.id, thought: '' },
      }));
    }

    try {
      if (assistantMsg && turtleSetter) {
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
          },          sessionId: spoorLlmSessionId('persona', personaNodeId),
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
        // 出题这一段不走流式朗读那条路（上面只把思考推给了界面），所以在这里把可见的
        // 汤面交给朗读：念的和写下来的都是这一份，汤底不在里面。
        options?.onSpeakerStream?.({
          messageId: assistantMsg.id,
          speakerNodeId: personaNodeId,
          accumulated: visible,
        });
        return assistantMsg.id;
      }

      if (turtleHost) {
        temperature = turtleSoupJudgeTemperature();
        topP = 0.2;
      }

      const focusImages = collectFocusImageDataUrls(composerSegments, liveNodes);

      // 主角色被禁言时它这一轮不出声：整段跳过，只跑下面的参与者轮次。
      if (assistantMsg) {
        const images =
          turtleHost || focusImages.dataUrls.length === 0
            ? []
            : await materializeImageDataUrls(focusImages.dataUrls);
        // 海龟汤主持人的汤底不能进朗读（也不能进"可见回复"）：念出来的那份先过一遍过滤，
        // 念的和写下来的保持一致。
        const speakableHostChunk = (accumulated: string) =>
          turtleHost
            ? sanitizeTurtleSoupPlayerText(stripThinking(accumulated), 'judge', turtlePlayerFallback)
            : accumulated;

        await runPersonaStreamingCall({
          threadId,
          messageId: assistantMsg.id,
          onThinking: patchPersonaThought,
          onStreamChunk:
            options?.onStreamChunk || options?.onSpeakerStream
              ? (accumulated) => {
                  const text = speakableHostChunk(accumulated);
                  options?.onStreamChunk?.(text);
                  options?.onSpeakerStream?.({
                    messageId: assistantMsg.id,
                    speakerNodeId: personaNodeId,
                    accumulated: text,
                  });
                }
              : undefined,
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
      }
      if (assistantMsg && !turtleHost) {
        // 房间轮次里主 Agent 的回复后面还会接着参与者的话，
        // 生成"相关问题"的请求必然被丢弃（它要求回复是最后一条），所以别发。
        if (!roomIsActive) {
          void attachSuggestedFollowUpsToThreadMessage({
            threadId,
            messageId: assistantMsg.id,
            config: aiConfig,
            userQuestion,
            t,
            sessionId: spoorLlmSessionId('persona-followups', personaNodeId),
          });
        }
      }

      // 多角色房间：主 Agent 说完后，未禁言的参与者依次接话。
      if (roomIsActive) {
        const roomImages =
          focusImages.dataUrls.length > 0
            ? await materializeImageDataUrls(focusImages.dataUrls)
            : [];
        for (const peerId of roomPeerSpeakerIds) {
          const peerNode = liveNodes.find((n) => n.id === peerId);
          if (!peerNode) continue;
          const outcome = await runRoomSpeakerTurn({
            speakerNodeId: peerId,
            threadId,
            liveNodes,
            systemInstruction: buildRoomSpeakerSystem(peerNode, {
              contextBlock,
              hasContext: Boolean(contextText),
              appendix: roomAppendixFor(peerId),
            }),
            hostNameFallback: hostSpeakerName,
            images: roomImages,
            maxMessages,
            onSpeakerStream: options?.onSpeakerStream,
          });
          // 接口出错就不再挨个往下打请求。
          if (outcome === 'failed') break;
        }
      }
      return assistantMsg?.id ?? null;
    } catch (e) {
      const msg = formatAiError(e);
      console.error('[Spoor] sendPersonaMessage failed', { error: msg });
      void notifyAiFailure(msg);
      const row = await db.canvasPersonaThreads.get(threadId);
      // 主角色被禁言时没有它的回复卡，错误只能报出来（比如参与者轮次整体失败）。
      if (row && assistantMsg) {
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

  /**
   * Turn a book/AI selection into a plain text note linked to the source card (no AI).
   * `thought` is what the user wrote under a book excerpt; the card carries both,
   * so the canvas keeps the passage and the reason they kept it.
   */
  const extractBookSelectionToCard = async (
    sourceNodeId: string,
    quote: string,
    _sourceLabel?: string,
    thought?: string,
  ) => {
    const passage = formatExcerptCardContent(
      normalizeExtractedPassage(quote),
      thought,
      t('reference.book_excerpt_note_label'),
    );
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
      /** 每个发言人各自的流式文本（语音模式按发言人的音色朗读）。 */
      onSpeakerStream?: PersonaSpeakerStreamHandler;
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
      onSpeakerStream: options?.onSpeakerStream,
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
    markProactiveBusy,
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
    /** 正在自动讨论的房间与进度（没有则为 null），侧栏据此显示进度与停止。 */
    roomDiscussion,
    advanceRoomDiscussion,
    stopRoomDiscussion,
    setRoomDiscussionRounds,
  };
}
