import type { Article, SourceCardSegment } from '../db';
import type { AIConfig } from '../components/AISettingsModal';
import { callUniversalAI } from '../services/ai';
import { getLocaleDirective, combineSystemParts } from '../utils/aiI18n';
import {
  assemblePublishBody,
  parsePublishArticleResponse,
  validateSourceCardFidelity,
  type ParsedPublishSegment,
} from './parsePublishArticleResponse';
import {
  ensurePublishMediaInBody,
  normalizePublishMediaPlaceholders,
  remapOutlineAttachedVisuals,
  type PublishMediaAsset,
  type PublishSourceCardMeta,
} from './publishSourceMaterial';
import { serializeOutlineForPrompt, type PublishOutline } from './parsePublishOutlineResponse';
import { createArticleMedia } from './articleMedia';
import { prepareLlmVisionImageSlots } from './canvasContextImages';
import { OPENROUTER_OUTLINE_MODEL } from '../constants/openrouter';
import { spoorLlmSessionId } from './openRouterPromptCache';

export function withPublishOutlineModel(aiConfig: AIConfig): {
  config: AIConfig;
  lockModel: true;
} {
  return {
    config: {
      ...aiConfig,
      provider: 'openrouter',
      model: OPENROUTER_OUTLINE_MODEL,
    },
    lockModel: true,
  };
}

async function callPublishOutlineModel({
  aiConfig,
  systemInstruction,
  prompt,
  onStreamChunk,
  imageHrefs,
  sessionId,
}: {
  aiConfig: AIConfig;
  systemInstruction: string;
  prompt: string;
  onStreamChunk?: (accumulatedText: string) => void;
  imageHrefs?: string[];
  sessionId?: string;
}): Promise<string> {
  const slots = await prepareLlmVisionImageSlots(imageHrefs ?? []);
  const remapped = remapOutlineAttachedVisuals(prompt, slots);
  return callUniversalAI({
    ...withPublishOutlineModel(aiConfig),
    systemInstruction,
    prompt: remapped.prompt,
    onStreamChunk,
    sessionId,
    ...(remapped.images.length > 0 ? { images: remapped.images } : {}),
  });
}

export interface GenerateArticleFromOutlineParams {
  aiConfig: AIConfig;
  outline: PublishOutline;
  /** 来自 buildPublishSourceMaterial 的素材 */
  promptContent: string;
  mediaAssets: PublishMediaAsset[];
  cards: PublishSourceCardMeta[];
  activeCanvasId: string;
  /** i18n 的 t 函数；用于取 prompt 模板与媒体兜底标题 */
  t: (key: string, opts?: Record<string, unknown>) => string;
  /** 可选流式回调（用于 UI 显示生成进度） */
  onStreamChunk?: (accumulatedText: string) => void;
  /** Reuse a draft article already opened in the editor. */
  articleId?: string;
}

export function outlineEligibleCards(
  outline: PublishOutline,
  cards: PublishSourceCardMeta[],
): PublishSourceCardMeta[] {
  const outlineOrderedCardIds: string[] = [];
  const seen = new Set<string>();
  for (const s of outline.sections) {
    const id = (s.cardId || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    outlineOrderedCardIds.push(id);
  }
  const cardById = new Map(cards.map((c) => [c.nodeId, c]));
  return outlineOrderedCardIds
    .map((id) => cardById.get(id))
    .filter((c): c is PublishSourceCardMeta => c != null);
}

async function localMediaFromAssets(mediaAssets: PublishMediaAsset[]) {
  return Promise.all(
    mediaAssets
      .filter(
        (asset): asset is PublishMediaAsset & {
          localDataUrl: string;
          articleMediaId: string;
        } => Boolean(asset.localDataUrl && asset.articleMediaId),
      )
      .map((asset) =>
        createArticleMedia(asset.articleMediaId, asset.localDataUrl, asset.nodeId),
      ),
  );
}

/** Assemble the essay in outline order from source cards. No LLM. */
export async function draftArticleFromOutline({
  outline,
  cards,
  mediaAssets,
  activeCanvasId,
  articleId,
  relatedHeading = 'Related media',
  generating = false,
}: {
  outline: PublishOutline;
  cards: PublishSourceCardMeta[];
  mediaAssets: PublishMediaAsset[];
  activeCanvasId: string;
  articleId: string;
  relatedHeading?: string;
  /** True while a follow-up polish pass (transitions / deletions) is running. */
  generating?: boolean;
}): Promise<Article> {
  const eligibleCards = outlineEligibleCards(outline, cards);
  const mediaByNode = new Map(mediaAssets.map((asset) => [asset.nodeId, asset]));
  const sourceCards: SourceCardSegment[] | undefined =
    eligibleCards.length > 0
      ? eligibleCards.map((c) => ({
          nodeId: c.nodeId,
          canvasId: c.canvasId,
          kind: c.kind,
          title: c.title,
          segmentText: (mediaByNode.get(c.nodeId)?.articleMarkdown ?? c.markdown ?? '').trim(),
          transitions: [],
          deletions: [],
        }))
      : undefined;
  let body = sourceCards
    ? assemblePublishBody(
        sourceCards.map((sc) => ({
          text: sc.segmentText,
          transitions: sc.transitions ?? [],
          deletions: sc.deletions ?? [],
        })),
      )
    : '';
  body = normalizePublishMediaPlaceholders(body, mediaAssets);
  body = ensurePublishMediaInBody(body, mediaAssets, relatedHeading);
  const localMedia = await localMediaFromAssets(mediaAssets);
  const title = (outline.title || '').trim() || eligibleCards[0]?.title || '';
  return {
    id: articleId,
    title,
    content: body,
    date: new Date().getFullYear().toString(),
    type: 'GEN-' + Math.floor(Math.random() * 1000),
    tags: [],
    linkedCanvasIds: [activeCanvasId],
    author: '',
    generating,
    contentDrivesBody: true,
    ...(sourceCards ? { sourceCards } : {}),
    ...(localMedia.length > 0 ? { media: localMedia } : {}),
  };
}

/**
 * 按定稿大纲 + 原素材生成正文，落库为新 Article，返回新文章对象。
 * 抽自原 useAiActions.handlePublish 的后半段，保持 segments 对齐与媒体兜底逻辑不变。
 *
 * 关键约束（feature: preserve user voice）：
 * - AI 不得改写来源卡片文字。validateSourceCardFidelity 在解析后立即强制比对并覆盖 cardText。
 * - transitions 是 AI 唯一可以发挥的地方，且必须落在段间。editor 侧用 AiTransitionMark 高亮。
 */
export async function generateArticleFromOutline({
  aiConfig,
  outline,
  promptContent,
  mediaAssets,
  cards,
  activeCanvasId,
  t,
  onStreamChunk,
  articleId: existingId,
}: GenerateArticleFromOutlineParams): Promise<Article> {
  const outlineText = serializeOutlineForPrompt(outline);
  const text = await callUniversalAI({
    config: aiConfig,
    systemInstruction: getLocaleDirective(),
    prompt: t('ai.prompts.publishArticleFromOutline', {
      outline: outlineText,
      content: promptContent,
    }),
    onStreamChunk,
    sessionId: spoorLlmSessionId('article', activeCanvasId),
  });

  const parsed = parsePublishArticleResponse(text || '', t('ai.generated_article_title'));

  const eligibleCards = outlineEligibleCards(outline, cards);
  const outlineCardIds = new Set(eligibleCards.map((c) => c.nodeId));

  // 1. Fidelity gate：AI 改写了 cardText 就强制覆盖回源卡 markdown
  validateSourceCardFidelity(parsed.segments, eligibleCards);

  // 2. 媒体占位符还原：只动 cardText（transitions 按 prompt 规则不允许含媒体）
  for (const seg of parsed.segments) {
    seg.cardText = normalizePublishMediaPlaceholders(seg.cardText, mediaAssets);
  }
  // 重新组装 parsed.body，让后续 missingMedia 判断用的是媒体归一化后的文本
  parsed.body = assemblePublishBody(
    parsed.segments.map((s) => ({
      text: s.cardText,
      transitions: s.transitions,
      deletions: s.deletions,
    })),
  );

  // 3. 构建 sourceCards：按 cardId 匹配；模型漏 cardId 时按段顺序回退
  let sourceCards: SourceCardSegment[] | undefined;
  if (eligibleCards.length > 0) {
    const segByCardId = new Map<string, ParsedPublishSegment>();
    for (const seg of parsed.segments) {
      if (seg.cardId) segByCardId.set(seg.cardId, seg);
    }
    const usePositional =
      segByCardId.size === 0 && parsed.segments.length === eligibleCards.length;

    sourceCards = eligibleCards.map((c, i) => {
      const seg =
        segByCardId.get(c.nodeId) ??
        (usePositional ? parsed.segments[i] : undefined);
      const fromModel = (seg?.cardText ?? '').trim();
      const fromSource = (c.markdown ?? '').trim();
      return {
        nodeId: c.nodeId,
        canvasId: c.canvasId,
        kind: c.kind,
        title: c.title,
        segmentText: fromModel || fromSource,
        transitions: [...(seg?.transitions ?? [])],
        deletions: [...(seg?.deletions ?? [])],
      };
    });
  }

  // 4. 媒体兜底：把模型遗漏的媒体追加到对应卡的 segmentText（媒体来自源卡，fidelity 不受影响）
  const missingMedia = mediaAssets.filter((asset) => {
    // 若大纲明确删掉了该媒体所属卡片，则不再兜底（用户已主动剔除）
    if (outlineCardIds.size > 0 && !outlineCardIds.has(asset.nodeId)) return false;
    const md = asset.articleMarkdown;
    const urls = [...md.matchAll(/\(([^)\s]+)\)/g)].map((m) => m[1]!);
    if (urls.length === 0) {
      const title = md.replace(/[*\[\]]/g, '').trim();
      return title.length > 0 && !parsed.body.includes(title);
    }
    return urls.some((u) => u && !parsed.body.includes(u));
  });

  const relatedHeading = t('ai.publish_related_media').replace(/\s+/g, ' ').trim() || 'Related media';

  let body: string;
  if (sourceCards) {
    for (const asset of missingMedia) {
      const attach = `\n\n## ${relatedHeading}\n\n${asset.articleMarkdown}`;
      const idx = sourceCards.findIndex((sc) => sc.nodeId === asset.nodeId);
      const targetIdx = idx >= 0 ? idx : sourceCards.length - 1;
      if (targetIdx >= 0) {
        sourceCards[targetIdx] = {
          ...sourceCards[targetIdx],
          segmentText: `${sourceCards[targetIdx].segmentText}${attach}`.trim(),
        };
      }
    }
    body = assemblePublishBody(
      sourceCards.map((sc) => ({
        text: sc.segmentText,
        transitions: sc.transitions ?? [],
        deletions: sc.deletions ?? [],
      })),
    );

    // 兜底：所有 segmentText 都为空且 parsed.body 有内容时退回 parsed.body
    const hasAnySegment = sourceCards.some((sc) => sc.segmentText.trim());
    if (!hasAnySegment && parsed.body.trim()) {
      body = parsed.body.trim();
    }
  } else {
    // 非 sourceCards 链路：用 ensurePublishMediaInBody 把遗漏媒体补到正文末尾
    body = ensurePublishMediaInBody(parsed.body, mediaAssets, relatedHeading);
  }

  const articleId = existingId || `gen-${Date.now()}`;
  const localMedia = await localMediaFromAssets(mediaAssets);

  const newArticle: Article = {
    id: articleId,
    title: outline.title || parsed.title,
    content: body,
    date: new Date().getFullYear().toString(),
    type: 'GEN-' + Math.floor(Math.random() * 1000),
    tags: [],
    linkedCanvasIds: [activeCanvasId],
    author: '',
    generating: false,
    contentDrivesBody: true,
    ...(sourceCards ? { sourceCards } : {}),
    ...(localMedia.length > 0 ? { media: localMedia } : {}),
  };

  return newArticle;
}

/** 生成大纲（弹窗进入时调用） */
export async function generatePublishOutline({
  aiConfig,
  promptContent,
  fallbackTitle,
  t,
  onStreamChunk,
  imageHrefs,
}: {
  aiConfig: AIConfig;
  promptContent: string;
  fallbackTitle: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
  onStreamChunk?: (accumulatedText: string) => void;
  imageHrefs?: string[];
}) {
  const text = await callPublishOutlineModel({
    aiConfig,
    systemInstruction: combineSystemParts(
      getLocaleDirective(),
      t('ai.prompts.publishOutlineSystem'),
    ),
    prompt: t('ai.prompts.publishOutline', { content: promptContent }),
    onStreamChunk,
    imageHrefs,
    sessionId: spoorLlmSessionId('outline'),
  });
  const { asCardOrderOutline, parsePublishOutlineResponse } = await import('./parsePublishOutlineResponse');
  const parsed = parsePublishOutlineResponse(text || '', fallbackTitle);
  return parsed ? asCardOrderOutline(parsed) : null;
}

/** 按用户文字/语音指令修订大纲 */
export async function revisePublishOutline({
  aiConfig,
  outline,
  instruction,
  t,
  onStreamChunk,
  imageHrefs,
}: {
  aiConfig: AIConfig;
  outline: PublishOutline;
  instruction: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
  onStreamChunk?: (accumulatedText: string) => void;
  imageHrefs?: string[];
}) {
  const outlineText = serializeOutlineForPrompt(outline);
  const text = await callPublishOutlineModel({
    aiConfig,
    systemInstruction: combineSystemParts(
      getLocaleDirective(),
      t('ai.prompts.publishOutlineSystem'),
    ),
    prompt: t('ai.prompts.publishOutlineRevise', {
      outline: outlineText,
      instruction,
    }),
    onStreamChunk,
    imageHrefs,
    sessionId: spoorLlmSessionId('outline-revise'),
  });
  const { asCardOrderOutline, parsePublishOutlineResponse } = await import('./parsePublishOutlineResponse');
  const parsed = parsePublishOutlineResponse(text || '', outline.title);
  return parsed ? asCardOrderOutline(parsed) : null;
}
