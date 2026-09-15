import { useCallback, useState } from 'react';
import type { AIConfig } from '../components/AISettingsModal';
import {
  liveSearchMissingKeyI18nKey,
  liveSearchToolsPromptKey,
  liveSearchUsesImmediateUserQuestion,
} from '../constants/webSearchBackend';
import {
  db,
  type CanvasChatGeneratedImage,
  type EssayChatMessage,
  type EssayChatSession,
} from '../db';
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
import { combineSystemParts } from '../utils/aiI18n';
import { flushArticleChatWrites, runEssayStreamingCall } from '../utils/essayStreamingAi';
import { spoorLlmSessionId } from '../utils/openRouterPromptCache';
import { userTurnRequestsLiveSearch } from '../utils/webSearchCommand';

function newId(): string {
  return `ec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useEssayChat({
  articleId,
  articleTitle,
  messages,
  aiConfig,
  t,
  getBodyMarkdown,
  getSelectedText,
  applyChatEdits,
}: {
  articleId: string;
  articleTitle: string;
  messages: EssayChatMessage[];
  aiConfig: AIConfig | null;
  t: (key: string, opts?: Record<string, unknown>) => string;
  getBodyMarkdown: () => string;
  getSelectedText: () => string;
  applyChatEdits: (
    edits: { find: string; replace: string }[],
    options?: { replaceDocument?: boolean },
  ) => { applied: number; missed: string[] };
}) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const persistMessages = useCallback(
    async (next: EssayChatMessage[]) => {
      await db.articles.update(articleId, { chatMessages: next });
    },
    [articleId],
  );

  const patchAssistant = useCallback(
    async (assistantId: string, fallback: EssayChatMessage[], partial: Partial<EssayChatMessage>) => {
      const row = await db.articles.get(articleId);
      const current =
        row?.chatMessages && row.chatMessages.length > 0 ? row.chatMessages : fallback;
      const next = current.map((m) => (m.id === assistantId ? { ...m, ...partial } : m));
      await persistMessages(next);
    },
    [articleId, persistMessages],
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

      const assistantMsg: EssayChatMessage = {
        id: newId(),
        role: 'assistant',
        text: '',
        createdAt: Date.now(),
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
        const systemInstruction = combineSystemParts(
          t('ai.prompts.essayChatSystem'),
          canDraw ? t('ai.prompts.drawToolAvailable') : '',
          canSearch ? t(liveSearchToolsPromptKey()) : '',
          userWantsLiveSearch ? t('ai.prompts.askWebSearchRequired') : '',
          canDraw || canSearch ? t('ai.prompts.essayChatToolsAfterJson') : '',
        );

        const { parsed, extracted, reply: modelReply } = await runEssayStreamingCall({
          articleId,
          messageId: assistantMsg.id,
          ...(canSearch && liveSearchUsesImmediateUserQuestion() && requestText.trim()
            ? { immediateSearchQuery: requestText.trim() }
            : {}),
          callAi: (onStreamChunk) =>
            callUniversalAI({
              config: aiConfig,
              systemInstruction,
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

        await flushArticleChatWrites(articleId);
        const row = await db.articles.get(articleId);
        const latestAssistant = row?.chatMessages?.find((m) => m.id === assistantMsg.id);

        await patchAssistant(assistantMsg.id, row?.chatMessages ?? withAssistant, {
          text: reply,
          editCount: applied || undefined,
          ...(latestAssistant?.searchHits?.length
            ? { searchHits: latestAssistant.searchHits }
            : {}),
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
      const row = await db.articles.get(articleId);
      const current = row?.chatMessages ?? messages;
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
          const latest = await db.articles.get(articleId);
          const thread = latest?.chatMessages ?? current;
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
    [aiConfig, articleId, messages, persistMessages, t],
  );

  const startNewChat = useCallback(async () => {
    if (sending) return;
    setError(null);
    const row = await db.articles.get(articleId);
    const current = row?.chatMessages ?? [];
    if (current.length === 0) return;
    const session = buildEssayChatSession(current);
    await db.articles.update(articleId, {
      chatMessages: [],
      chatSessionArchive: prependEssayChatArchive(row?.chatSessionArchive, session),
    });
  }, [articleId, sending]);

  const restoreChatSession = useCallback(
    async (sessionId: string) => {
      if (sending) return false;
      setError(null);
      const row = await db.articles.get(articleId);
      const plan = restoreEssayChatSessionPlan(
        row?.chatMessages ?? [],
        row?.chatSessionArchive,
        sessionId,
      );
      if (!plan) return false;
      await db.articles.update(articleId, {
        chatMessages: plan.nextMessages,
        chatSessionArchive: plan.nextArchive,
      });
      return true;
    },
    [articleId, sending],
  );

  return { sending, error, send, retryChatImage, startNewChat, restoreChatSession };
}
