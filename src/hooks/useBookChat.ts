import { useCallback, useMemo, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import type { AIConfig } from '../components/AISettingsModal';
import {
  liveSearchMissingKeyI18nKey,
  liveSearchToolsPromptKey,
  liveSearchUsesImmediateUserQuestion,
} from '../constants/webSearchBackend';
import type { AgentConfig, BookChatMessage, BookChatSession, BookExcerpt } from '../db';
import { callUniversalAI, formatAiError, type ChatMessage } from '../services/ai';
import { fulfillSearchToolFromNode } from '../services/fulfillSearchTool';
import { synthesizeAskFromSearch } from '../services/synthesizeAskFromSearch';
import { hasLiveWebSearchAccess } from '../lib/serverConfig';
import { combineSystemParts, buildAgentSystemInstruction, resolveAgentLocalizedName } from '../utils/aiI18n';
import {
  buildBookChatContext,
  bookChatOpenExcerptCount,
  formatBookChatExcerpts,
  BOOK_CHAT_EXCERPT_OPEN_LIMIT,
} from '../utils/bookChatContext';
import type { BookUnit } from '../utils/bookPayload';
import { runChatStreamingCall } from '../utils/chatStreamingAi';
import { bookChatThreadStore } from '../utils/chatThreadStore';
import {
  buildChatSession,
  buildRestoreChatSessionPlan,
  prependChatArchive,
} from '../utils/chatSessionArchive';
import { spoorLlmSessionId } from '../utils/openRouterPromptCache';
import { buildAskPersona } from '../utils/askPersona';
import { userTurnRequestsLiveSearch } from '../utils/webSearchCommand';
import { generateSuggestedFollowUps } from '../utils/suggestedFollowUps';
import { withBookModel } from '../utils/bookAiModel';
import {
  buildSurfaceTurnCue,
  EMPTY_SURFACE_ROOM,
  formatSurfaceHistoryForSpeaker,
  resolveSurfaceSpeakers,
  surfaceAnswerer,
  surfaceGuests,
  type SurfaceRoomState,
} from '../utils/surfacePersonaRoom';

const BOOK_CHAT_ID_PREFIX = 'bcs';

function newId(): string {
  return `bc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type Copy = (key: string, opts?: Record<string, unknown>) => string;

/**
 * 书籍卡右侧栏的伴读对话。
 *
 * 与 `useEssayChat` 的差别：书籍正文只读（没有 edits / 占位符），
 * 也不做生图与附件。线程存在卡片行上（`bookChatThreadStore`）。
 */
export function useBookChat({
  nodeId,
  bookTitle,
  unit,
  unitLabel,
  currentSelection,
  excerpts,
  focusedExcerpts,
  messages,
  aiConfig,
  room,
  agents,
  t,
  copy,
}: {
  nodeId: string;
  bookTitle: string;
  unit: BookUnit | null | undefined;
  /** 当前章节的位置标签，随 prompt 一起发给模型。 */
  unitLabel: string;
  /** 用户在书里选中的那段（送进 prompt 的上下文）。 */
  currentSelection: string;
  excerpts: BookExcerpt[];
  /**
   * 用户在摘抄本里手动勾出来的那几条。勾了它们，这一轮就只递这几条——
   * 模型再怎么发围栏要整本也不给：用户挑过就是定论。
   */
  focusedExcerpts: BookExcerpt[];
  messages: BookChatMessage[];
  aiConfig: AIConfig | null;
  /** 侧栏房间里的人。缺省 = 沿用内置助手，行为与加这个功能之前逐字节一致。 */
  room?: SurfaceRoomState;
  agents?: AgentConfig[];
  t: TFunction<'translation', undefined>;
  /** 面板与报错文案；走 `reference.book_chat_*`。 */
  copy: Copy;
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

  const store = useMemo(() => bookChatThreadStore(nodeId), [nodeId]);

  const persistMessages = useCallback(
    async (next: BookChatMessage[]) => {
      await store.saveMessages(next);
    },
    [store],
  );

  const patchAssistant = useCallback(
    async (assistantId: string, fallback: BookChatMessage[], partial: Partial<BookChatMessage>) => {
      await store.updateMessage(assistantId, fallback, (m) => ({ ...m, ...partial }));
    },
    [store],
  );

  const send = useCallback(
    async (text: string): Promise<string | null> => {
      const trimmed = text.trim();
      if (!trimmed || sending) return null;
      if (!aiConfig) {
        setError(copy('no_ai'));
        return null;
      }
      setError(null);
      setSending(true);

      // 这一轮由谁答话：房间里第一个没被禁言的人。没人 = 内置助手。
      const answerer = surfaceAnswerer(activeRoom, activeAgents, askPersona);

      const userMsg: BookChatMessage = {
        id: newId(),
        role: 'user',
        text: trimmed,
        createdAt: Date.now(),
      };
      const pending = [...messages, userMsg];
      await persistMessages(pending);

        const assistantMsg: BookChatMessage = {
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
        const noteLabel = t('reference.book_excerpt_note_label');
        // 摘抄本平时整本锁着不上桌——正文加上一堆摘抄是每次问答都要付的钱，
        // 而多数问题跟摘抄没关系。摘抄有三种进 prompt 的方式：
        //   focused——用户在摘抄本里手动勾了几条（最可靠的一条路，见 focusedExcerpts）
        //   opened —— 模型自己发了 ```excerpts 围栏要（见 resolvePrivateContext）
        //   none   —— 都不成立，只报一句"存了几条"
        // 书籍这一路换模型：全局默认是为代码调的，读书用上一代更说人话。
        const bookModel = withBookModel(aiConfig);
        const { chapterText } = buildBookChatContext({
          unit,
          selection: currentSelection,
          excerpts: [],
          noteLabel,
        });
        const history: ChatMessage[] = pending.slice(-12).map((m) => ({
          role: m.role,
          content: m.text,
        }));
        const canSearch = hasLiveWebSearchAccess({
          metasoApiKey: aiConfig.metasoApiKey,
          provider: aiConfig.provider,
          llmApiKey: aiConfig.apiKey,
        });
        const userWantsLiveSearch =
          canSearch &&
          !liveSearchUsesImmediateUserQuestion() &&
          userTurnRequestsLiveSearch(trimmed);
        const featurePrompt = combineSystemParts(
          t('ai.prompts.bookChatSystem'),
          canSearch ? t(liveSearchToolsPromptKey()) : '',
          userWantsLiveSearch ? t('ai.prompts.askWebSearchRequired') : '',
          canSearch ? t('ai.prompts.bookChatToolsAfterJson') : '',
        );
        // 房间里没人时这段提示词一个字都不动；有人选时，角色的提示词拼在功能契约前面。
        // 功能契约管的是 JSON 信封和摘录围栏这类硬格式，模型对靠后的指令依从得更好，
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

        /** 用户勾了就是勾了：这一轮以他挑的为准，模型再怎么要也不给整本。 */
        const hasFocus = focusedExcerpts.length > 0;

        const buildUserPrompt = (withPrivateContext: boolean) => {
          // 勾选本身就算"已经打开了"——用户手动挑的那些第一趟就带上，
          // 不必等模型发围栏再白跑一趟。
          const withExcerpts = withPrivateContext || hasFocus;
          const rows = hasFocus ? focusedExcerpts : excerpts;
          return t('ai.prompts.bookChatUser', {
            title: bookTitle,
            chapter: unitLabel,
            chapterText: chapterText || t('nodes.book_page_no_text'),
            selection: currentSelection.trim() || copy('no_selection'),
            excerptStatus: withExcerpts
              ? hasFocus
                // 挑的是其中几条，说的却是整本多大——照实说，模型才知道自己没看到什么。
                ? t('ai.prompts.bookExcerptsFocused', {
                    shown: rows.length,
                    count: excerpts.length,
                  })
                : t('ai.prompts.bookExcerptsOpened', {
                    shown: bookChatOpenExcerptCount(excerpts.length),
                    count: excerpts.length,
                  })
              : excerpts.length > 0
                ? t('ai.prompts.bookExcerptsClosed', { count: excerpts.length })
                : t('ai.prompts.bookExcerptsNone'),
            excerpts: withExcerpts
              ? formatBookChatExcerpts(rows, noteLabel, BOOK_CHAT_EXCERPT_OPEN_LIMIT)
              : '',
            history: history
              .slice(0, -1)
              .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
              .join('\n\n'),
            request: trimmed,
          });
        };

        const { parsed, reply: modelReply } = await runChatStreamingCall({
          store,
          messageId: assistantMsg.id,
          ...(canSearch && liveSearchUsesImmediateUserQuestion() && trimmed
            ? { immediateSearchQuery: trimmed }
            : {}),
          // 摘抄本被锁着的时候其实没什么可"解"的，所以直接按有没有摘抄来答；
          // 一条摘抄都没有还硬要，白跑一趟模型。用户已经手动挑过就更别跑第二趟。
          resolvePrivateContext: () => excerpts.length > 0 && focusedExcerpts.length === 0,
          callAi: (onStreamChunk, withPrivateContext) =>
            callUniversalAI({
              config: bookModel.config,
              lockModel: bookModel.lockModel,
              systemInstruction,
              ...sampling,
              messages: [
                {
                  role: 'user',
                  content: buildUserPrompt(withPrivateContext === true),
                },
              ],
              onStreamChunk,
              sessionId: spoorLlmSessionId('book-chat', nodeId),
            }),
          onSearchTools: canSearch
            ? async (searches) =>
                fulfillSearchToolFromNode({
                  nodeId,
                  searches,
                  userQuestion: trimmed,
                  apiKey: aiConfig.metasoApiKey,
                  openRouterApiKey: aiConfig.provider === 'openrouter' ? aiConfig.apiKey : '',
                  llmProvider: aiConfig.provider,
                  reportEmpty: false,
                  // 对话里的检索结果只进右栏，不在画布上生成来源卡。
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
                    sessionId: spoorLlmSessionId('book-web-filter', nodeId),
                  },
                })
            : undefined,
          onSearchNoResults: canSearch
            ? () => {
                setError(t('nodes.search_no_results'));
              }
            : undefined,
          synthesizeFromSearch:
            canSearch && trimmed
              ? ({ draftAnswer, hits, onStreamChunk }) =>
                  synthesizeAskFromSearch({
                    config: aiConfig,
                    t,
                    userQuestion: trimmed,
                    draftAnswer,
                    hits,
                    onStreamChunk,
                    sessionId: spoorLlmSessionId('book-ask-synth', nodeId),
                  })
              : undefined,
        });

        const reply =
          modelReply.trim() || parsed.reply.trim() || copy('empty_reply');

        await store.flush();
        const latestMessages = await store.loadMessages([]);

        await patchAssistant(
          assistantMsg.id,
          latestMessages.length > 0 ? latestMessages : withAssistant,
          { text: reply },
        );

        void generateSuggestedFollowUps({
          config: aiConfig,
          userQuestion: trimmed,
          assistantReply: reply,
          t,
          sessionId: spoorLlmSessionId('book-followups', nodeId),
        }).then(async (followUps) => {
          if (followUps.length === 0) return;
          const messagesNow = await store.loadMessages([]);
          if (messagesNow[messagesNow.length - 1]?.id !== assistantMsg.id) return;
          await patchAssistant(assistantMsg.id, messagesNow, { suggestedFollowUps: followUps });
        });

        return reply;
      } catch (e) {
        const msg = formatAiError(e);
        setError(msg);
        const failure = copy('failed', { message: msg });
        await patchAssistant(assistantMsg.id, withAssistant, { text: failure });
        return failure;
      } finally {
        setSending(false);
      }
    },
    [
      agents,
      aiConfig,
      bookTitle,
      copy,
      currentSelection,
      excerpts,
      focusedExcerpts,
      messages,
      nodeId,
      patchAssistant,
      persistMessages,
      room,
      sending,
      store,
      t,
      unit,
      unitLabel,
    ],
  );

  /**
   * 让房间里除答话者以外的人，挨个接一句。
   *
   * 嘉宾不做流式：书里这一栏是逐字进气泡的，两个声音同时往里写会互相打断，而打断
   * 之后留下的半句话没法收场。画布那间房也不流式。
   *
   * 名单在**每一轮之前重新取一次**：讨论跑到一半有人被移出或禁言，要立刻生效，
   * 不能把这一轮剩下的人照着开头的名单跑完。
   */
  const discuss = useCallback(async (): Promise<void> => {
    if (discussingRef.current || !aiConfig) return;
    const answerer = surfaceAnswerer(activeRoom, activeAgents, askPersona);
    // 没人选角色就没有别人可接。
    if (!answerer) return;
    const bookModel = withBookModel(aiConfig);
    const featurePrompt = t('ai.prompts.bookChatSystem');
    const answererName = resolveAgentLocalizedName(answerer);
    // 顺序在开场定一次，免得每轮重算时房间微调导致有人被跳过或重复。
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
        if (!resolveSurfaceSpeakers(activeRoom, activeAgents).some((a) => a.id === guest.id)) continue;

        const history = await store.loadMessages([]);
        const cue = buildSurfaceTurnCue({ messages: history, hostNameFallback: answererName, t });
        const system = buildAgentSystemInstruction(guest, {
          extraParts: [
            featurePrompt,
            t('ai.prompts.personaGroupPresent', { others: answererName }),
          ],
        });
        const result = await callUniversalAI({
          config: bookModel.config,
          lockModel: bookModel.lockModel,
          systemInstruction: system,
          temperature: guest.temperature ?? 0.7,
          topP: guest.creativity ?? 0.4,
          messages: [
            ...formatSurfaceHistoryForSpeaker(history, guest.id, (name) => `${name}: `, 12),
            { role: 'user', content: cue },
          ],
          sessionId: spoorLlmSessionId('book-chat', nodeId),
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
  }, [agents, aiConfig, nodeId, room, store, t]);

  const startNewChat = useCallback(async () => {
    if (sending) return;
    setError(null);
    const current = await store.loadMessages([]);
    if (current.length === 0) return;
    const session = buildChatSession(current, BOOK_CHAT_ID_PREFIX) as BookChatSession;
    const archive = await store.loadArchive();
    await store.replaceThread([], prependChatArchive(archive, session));
  }, [sending, store]);

  const restoreChatSession = useCallback(
    async (sessionId: string) => {
      if (sending) return false;
      setError(null);
      const current = await store.loadMessages([]);
      const archive = await store.loadArchive();
      const plan = buildRestoreChatSessionPlan(
        current,
        archive,
        sessionId,
        BOOK_CHAT_ID_PREFIX,
      );
      if (!plan) return false;
      await store.replaceThread(plan.nextMessages, plan.nextArchive);
      return true;
    },
    [sending, store],
  );

  // setError 一并交出去：伴读标注是在这个组件外面发起的（BookFullscreen 自己管防抖），
  // 它失败时得有个能说话的地方。静默失败会让"模型调不动"和"这一章没什么值得标的"
  // 在界面上长得一模一样，两者就再也分不开了。
  return { sending, discussing, error, setError, send, discuss, startNewChat, restoreChatSession };
}
