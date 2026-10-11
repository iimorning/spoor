import { useCallback, useMemo, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import type { AIConfig } from '../components/AISettingsModal';
import {
  liveSearchMissingKeyI18nKey,
  liveSearchToolsPromptKey,
  liveSearchUsesImmediateUserQuestion,
} from '../constants/webSearchBackend';
import { type AgentConfig, type CanvasChatGeneratedImage, type EssayChatMessage } from '../db';
import {
  buildEssayChatSession,
  prependEssayChatArchive,
  restoreEssayChatSessionPlan,
} from '../utils/essayChatSessions';
import { callUniversalAI, formatAiError, type ChatMessage } from '../services/ai';
import { fulfillDrawToolIntoChat } from '../services/fulfillDrawTool';
import { fulfillSearchToolFromNode } from '../services/fulfillSearchTool';
import { hasFlux302Credentials, imageKeysFromAiConfig } from '../services/flux302';
import { synthesizeAskFromSearch } from '../services/synthesizeAskFromSearch';
import { hasLiveWebSearchAccess } from '../lib/serverConfig';
import { prepareEssayChatAttachments } from '../utils/essayChatAttachments';
import { buildAgentSystemInstruction, combineSystemParts, resolveAgentLocalizedName } from '../utils/aiI18n';
import { runChatStreamingCall } from '../utils/chatStreamingAi';
import { articleChatThreadStore } from '../utils/chatThreadStore';
import { spoorLlmSessionId } from '../utils/openRouterPromptCache';
import { buildAskPersona } from '../utils/askPersona';
import { userTurnRequestsLiveSearch } from '../utils/webSearchCommand';
import { generateSuggestedFollowUps } from '../utils/suggestedFollowUps';
import {
  buildSurfaceTurnCue,
  EMPTY_SURFACE_ROOM,
  formatSurfaceHistoryForSpeaker,
  resolveSurfaceSpeakers,
  surfaceAnswerer,
  surfaceGuests,
  type SurfaceRoomState,
} from '../utils/surfacePersonaRoom';

function newId(): string {
  return `ec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useEssayChat({
  articleId,
  articleTitle,
  messages,
  aiConfig,
  room,
  agents,
  t,
  getBodyMarkdown,
  getSelectedText,
  applyChatEdits,
}: {
  articleId: string;
  articleTitle: string;
  messages: EssayChatMessage[];
  aiConfig: AIConfig | null;
  /** 侧栏房间里的人。缺省 = 沿用内置助手，行为与加这个功能之前逐字节一致。 */
  room?: SurfaceRoomState;
  agents?: AgentConfig[];
  // 下面要把 t 传给按 TFunction 收参数的服务（filterWebpages / synthesizeAskFromSearch），
  // 自己写窄签名会让它们报 "缺少 $TFunctionBrand"。
  t: TFunction<'translation', undefined>;
  getBodyMarkdown: () => string;
  getSelectedText: () => string;
  applyChatEdits: (
    edits: { find: string; replace: string }[],
    options?: { replaceDocument?: boolean },
  ) => { applied: number; missed: string[] };
}) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 讨论进行中。它不能拿 `sending` 顶替：用户在提问时 sending 也是 true，
  // 那样讨论按钮会显示成"正在轮流发言"，还顺手把角色条整个禁用了。
  const [discussing, setDiscussing] = useState(false);
  // 真正拦重入的东西。`sending` 来自渲染闭包，连点两下会读到同一个 false，
  // 于是两轮讨论并发写同一段对话。
  const discussingRef = useRef(false);
  // 缺省成"空房间"而不是让调用方都必须传：不传就是没有角色，行为与从前一致。
  const activeRoom = useMemo(() => room ?? EMPTY_SURFACE_ROOM, [room]);
  const activeAgents = useMemo(() => agents ?? [], [agents]);
  // 阿狸恒在：空房间不代表"没有角色"，而是"只有阿狸"。这是和画布上的一致性——
  // 同一个伴读对象，书房和长文里也是他。
  const askPersona = useMemo(() => buildAskPersona(t), [t]);

  const store = useMemo(() => articleChatThreadStore(articleId), [articleId]);

  const persistMessages = useCallback(
    async (next: EssayChatMessage[]) => {
      await store.saveMessages(next);
    },
    [store],
  );

  const patchAssistant = useCallback(
    async (assistantId: string, fallback: EssayChatMessage[], partial: Partial<EssayChatMessage>) => {
      await store.updateMessage(assistantId, fallback, (m) => ({ ...m, ...partial }));
    },
    [store],
  );

  const send = useCallback(
    async (text: string, files?: File[]): Promise<string | null> => {
      const trimmed = text.trim();
      const hasFiles = Boolean(files?.length);
      if ((!trimmed && !hasFiles) || sending) return null;
      if (!aiConfig) {
        setError(t('reference.essay_chat_no_ai'));
        return null;
      }
      setError(null);
      setSending(true);

      let attachmentContext = '';
      let imageDataUrls: string[] = [];
      let attachmentMeta: EssayChatMessage['attachments'];
      if (hasFiles) {
        const prepared = await prepareEssayChatAttachments(files!);
        attachmentContext = prepared.attachmentContext;
        imageDataUrls = prepared.imageDataUrls;
        attachmentMeta = prepared.attachments.length > 0 ? prepared.attachments : undefined;
        if (prepared.failures.length > 0) {
          setError(
            t('canvas.upload_fail', {
              count: prepared.failures.length,
              names: prepared.failures.map((f) => f.name).join(', '),
            }),
          );
        }
        if (!trimmed && !attachmentContext && imageDataUrls.length === 0) {
          setSending(false);
          return null;
        }
      }

      const requestText =
        trimmed ||
        t('reference.essay_chat_attachment_only', {
          defaultValue: 'Please read the attached file(s) and help with this article.',
        });
      const userMsg: EssayChatMessage = {
        id: newId(),
        role: 'user',
        text: requestText,
        createdAt: Date.now(),
        attachments: attachmentMeta,
      };
      const pending = [...messages, userMsg];
      await persistMessages(pending);

      // 这一轮由谁答话：房间里第一个没被禁言的人。没人 = 内置助手。
      const answerer = surfaceAnswerer(activeRoom, activeAgents, askPersona);
      const assistantMsg: EssayChatMessage = {
        id: newId(),
        role: 'assistant',
        text: '',
        createdAt: Date.now(),
        // 房间里有人时给这一条署上名：气泡要分得出这是谁说的话。
        ...(answerer
          ? { speakerAgentId: answerer.id, speakerName: resolveAgentLocalizedName(answerer) }
          : {}),
      };
      const withAssistant = [...pending, assistantMsg];
      await persistMessages(withAssistant);

      try {
        const body = getBodyMarkdown();
        const selected = getSelectedText();
        const history: ChatMessage[] = pending.slice(-12).map((m) => ({
          role: m.role,
          content: m.text,
        }));
        const requestWithAttachments = attachmentContext
          ? `${requestText}\n\n---\n${attachmentContext}`
          : requestText;
        const canDraw = (() => {
          const keys = imageKeysFromAiConfig(aiConfig);
          return hasFlux302Credentials(keys.apiKey, keys.openrouterApiKey);
        })();
        const canSearch = hasLiveWebSearchAccess({
          metasoApiKey: aiConfig.metasoApiKey,
          provider: aiConfig.provider,
          llmApiKey: aiConfig.apiKey,
        });
        const userWantsLiveSearch =
          canSearch &&
          !liveSearchUsesImmediateUserQuestion() &&
          userTurnRequestsLiveSearch(requestText);
        const featurePrompt = combineSystemParts(
          t('ai.prompts.essayChatSystem'),
          canDraw ? t('ai.prompts.drawToolAvailable') : '',
          canSearch ? t(liveSearchToolsPromptKey()) : '',
          userWantsLiveSearch ? t('ai.prompts.askWebSearchRequired') : '',
          canDraw || canSearch ? t('ai.prompts.essayChatToolsAfterJson') : '',
        );
        // 房间里没人时这段提示词一个字都不动；有人选时，角色的提示词拼在功能契约前面。
        // 功能契约管的是 JSON 信封和占位符这类硬格式，模型对靠后的指令依从得更好，
        // 所以它留在最后。
        const systemInstruction = answerer
          ? buildAgentSystemInstruction(answerer, { extraParts: [featurePrompt] })
          : featurePrompt;
        const sampling = answerer
          ? {
              temperature: answerer.temperature ?? 0.7,
              topP: answerer.creativity ?? 0.4,
            }
          : {};

        const { parsed, extracted, reply: modelReply } = await runChatStreamingCall({
          store,
          messageId: assistantMsg.id,
          ...(canSearch && liveSearchUsesImmediateUserQuestion() && requestText.trim()
            ? { immediateSearchQuery: requestText.trim() }
            : {}),
          callAi: (onStreamChunk) =>
            callUniversalAI({
              config: aiConfig,
              systemInstruction,
              ...sampling,
              messages: [
                {
                  role: 'user',
                  content: t('ai.prompts.essayChatUser', {
                    title: articleTitle,
                    body,
                    selection: selected || t('reference.essay_chat_no_selection'),
                    history: history
                      .slice(0, -1)
                      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
                      .join('\n\n'),
                    request: requestWithAttachments,
                  }),
                },
              ],
              images: imageDataUrls.length > 0 ? imageDataUrls : undefined,
              onStreamChunk,
              sessionId: spoorLlmSessionId('essay-chat', articleId),
            }),
          onSearchTools: canSearch
            ? async (searches) =>
                fulfillSearchToolFromNode({
                  nodeId: `essay:${articleId}`,
                  searches,
                  userQuestion: requestText,
                  apiKey: aiConfig.metasoApiKey,
                  openRouterApiKey: aiConfig.provider === 'openrouter' ? aiConfig.apiKey : '',
                  llmProvider: aiConfig.provider,
                  reportEmpty: false,
                  placeOnCanvas: false,
                  onMissingKey: () => {
                    setError(t(liveSearchMissingKeyI18nKey()));
                  },
                  onError: (message) => {
                    setError(`${t('nodes.search_failed')}\n\n${message}`);
                  },
                  filterWebpages: {
                    config: aiConfig,
                    t,
                    sessionId: spoorLlmSessionId('essay-web-filter', articleId),
                  },
                })
            : undefined,
          onSearchNoResults: canSearch
            ? () => {
                setError(t('nodes.search_no_results'));
              }
            : undefined,
          synthesizeFromSearch:
            canSearch && requestText.trim()
              ? ({ draftAnswer, hits, onStreamChunk }) =>
                  synthesizeAskFromSearch({
                    config: aiConfig,
                    t,
                    userQuestion: requestText,
                    draftAnswer,
                    hits,
                    onStreamChunk,
                    sessionId: spoorLlmSessionId('essay-ask-synth', articleId),
                  })
              : undefined,
        });

        let applied = 0;
        let missed: string[] = [];
        if (parsed.replaceDocument || parsed.edits.length > 0) {
          const result = applyChatEdits(parsed.edits, { replaceDocument: parsed.replaceDocument });
          applied = result.applied;
          missed = result.missed;
        }

        let reply = modelReply.trim() || parsed.reply.trim();
        if (!reply) {
          reply = applied
            ? t('reference.essay_chat_edits_ready')
            : t('reference.essay_chat_no_edits');
        }
        if (missed.length > 0) {
          reply = `${reply}\n\n${t('reference.essay_chat_missed')}`;
        }

        await store.flush();
        const latestMessages = await store.loadMessages([]);
        const latestAssistant = latestMessages.find((m) => m.id === assistantMsg.id);

        await patchAssistant(assistantMsg.id, latestMessages.length > 0 ? latestMessages : withAssistant, {
          text: reply,
          editCount: applied || undefined,
          ...(latestAssistant?.searchHits?.length
            ? { searchHits: latestAssistant.searchHits }
            : {}),
        });

        void generateSuggestedFollowUps({
          config: aiConfig,
          userQuestion: requestText,
          assistantReply: reply,
          t,
          sessionId: spoorLlmSessionId('essay-followups', articleId),
        }).then(async (followUps) => {
          if (followUps.length === 0) return;
          const messagesNow = await store.loadMessages([]);
          if (messagesNow[messagesNow.length - 1]?.id !== assistantMsg.id) return;
          await patchAssistant(assistantMsg.id, messagesNow, { suggestedFollowUps: followUps });
        });

        if (extracted.images.length > 0 && canDraw) {
          const keys = imageKeysFromAiConfig(aiConfig);
          await fulfillDrawToolIntoChat({
            images: extracted.images,
            ...keys,
            onMissingKey: () => {
              setError(t('voice.flux_need_key'));
            },
            onError: (message) => {
              setError(t('voice.flux_error', { message }));
            },
            onUpdate: async (images) => {
              await patchAssistant(assistantMsg.id, withAssistant, {
                images: images as CanvasChatGeneratedImage[],
              });
            },
          });
        }
        return reply;
      } catch (e) {
        const msg = formatAiError(e);
        setError(msg);
        await patchAssistant(assistantMsg.id, withAssistant, {
          text: t('reference.essay_chat_failed', { message: msg }),
        });
        return t('reference.essay_chat_failed', { message: msg });
      } finally {
        setSending(false);
      }
    },
    [
      aiConfig,
      articleId,
      applyChatEdits,
      articleTitle,
      getBodyMarkdown,
      getSelectedText,
      messages,
      patchAssistant,
      persistMessages,
      sending,
      t,
    ],
  );

  const retryChatImage = useCallback(
    async (messageId: string, imageId: string) => {
      if (!aiConfig) {
        setError(t('reference.essay_chat_no_ai'));
        return;
      }
      const current = await store.loadMessages(messages);
      const message = current.find((m) => m.id === messageId);
      const image = message?.images?.find((img) => img.id === imageId);
      if (!image) return;
      const keys = imageKeysFromAiConfig(aiConfig);
      await fulfillDrawToolIntoChat({
        images: [{ title: image.title, prompt: image.prompt, orientation: image.orientation }],
        ...keys,
        onMissingKey: () => {
          setError(t('voice.flux_need_key'));
        },
        onError: (messageText) => {
          setError(t('voice.flux_error', { message: messageText }));
        },
        onUpdate: async (images) => {
          const nextSlot = images[0];
          if (!nextSlot) return;
          const thread = await store.loadMessages(current);
          await persistMessages(
            thread.map((m) =>
              m.id === messageId
                ? {
                    ...m,
                    images: (m.images ?? []).map((img) =>
                      img.id === imageId ? { ...img, ...nextSlot, id: imageId } : img,
                    ),
                  }
                : m,
            ),
          );
        },
      });
    },
    [aiConfig, messages, persistMessages, store, t],
  );

  /**
   * 让房间里除答话者以外的人，挨个接一句。
   *
   * 嘉宾不做流式：这一栏是逐字进气泡的，两个声音同时往里写会互相打断，而打断之后
   * 留下的半句话没法收场。嘉宾也不带 edits——正文归主答话的人改，别人插进来改会
   * 和用户的编辑意图打架。
   *
   * 顺序在开场定一次，免得房间中途微调导致有人被跳过或重复。
   */
  const discuss = useCallback(async (): Promise<void> => {
    if (discussingRef.current || !aiConfig) return;
    const answerer = surfaceAnswerer(activeRoom, activeAgents, askPersona);
    // 没人选角色就没有别人可接。
    if (!answerer) return;
    const featurePrompt = t('ai.prompts.essayChatSystem');
    const answererName = resolveAgentLocalizedName(answerer);
    const ordered = surfaceGuests(activeRoom, activeAgents).filter((g) => g.id !== answerer.id);
    if (ordered.length === 0) return;

    setError(null);
    discussingRef.current = true;
    setDiscussing(true);
    setSending(true);
    try {
      for (const guest of ordered) {
        // 发言之前再确认这个人还在、没被禁言：讨论跑到一半有人被撤了，
        // 就不该再轮到他。
        if (!resolveSurfaceSpeakers(activeRoom, activeAgents).some((a) => a.id === guest.id)) {
          continue;
        }

        const history = await store.loadMessages([]);
        const cue = buildSurfaceTurnCue({ messages: history, hostNameFallback: answererName, t });
        const system = buildAgentSystemInstruction(guest, {
          extraParts: [
            featurePrompt,
            t('ai.prompts.personaGroupPresent', { others: answererName }),
          ],
        });
        const result = await callUniversalAI({
          config: aiConfig,
          systemInstruction: system,
          temperature: guest.temperature ?? 0.7,
          topP: guest.creativity ?? 0.4,
          messages: [
            ...formatSurfaceHistoryForSpeaker(history, guest.id, (name) => `${name}: `, 12),
            { role: 'user', content: cue },
          ],
          sessionId: spoorLlmSessionId('essay-chat', articleId),
        });
        const text = result.trim();
        if (!text) continue;
        await store.replaceThread(
          [
            ...history,
            {
              id: newId(),
              role: 'assistant' as const,
              text,
              createdAt: Date.now(),
              speakerAgentId: guest.id,
              speakerName: resolveAgentLocalizedName(guest),
            },
          ],
          await store.loadArchive(),
        );
      }
    } catch (e) {
      setError(formatAiError(e));
    } finally {
      discussingRef.current = false;
      setDiscussing(false);
      setSending(false);
    }
  }, [activeAgents, activeRoom, aiConfig, articleId, store, t]);

  const startNewChat = useCallback(async () => {
    if (sending) return;
    setError(null);
    const current = await store.loadMessages([]);
    if (current.length === 0) return;
    const session = buildEssayChatSession(current);
    const archive = await store.loadArchive();
    await store.replaceThread([], prependEssayChatArchive(archive, session));
  }, [sending, store]);

  const restoreChatSession = useCallback(
    async (sessionId: string) => {
      if (sending) return false;
      setError(null);
      const current = await store.loadMessages([]);
      const archive = await store.loadArchive();
      const plan = restoreEssayChatSessionPlan(current, archive, sessionId);
      if (!plan) return false;
      await store.replaceThread(plan.nextMessages, plan.nextArchive);
      return true;
    },
    [sending, store],
  );

  // `setError` 一并交出去：标注那一趟失败时要有个能说话的地方（和 useBookChat 一样，
  // 它那边的伴读标注就是借用读错误位报出来的）。这里只借这一格，不给别的。
  return {
    sending,
    discussing,
    error,
    setError,
    send,
    discuss,
    retryChatImage,
    startNewChat,
    restoreChatSession,
  };
}
