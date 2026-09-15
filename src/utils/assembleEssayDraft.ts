import type { AIConfig } from '../components/AISettingsModal';
import { db, type SourceCardSegment } from '../db';
import { callUniversalAI } from '../services/ai';
import { spoorLlmSessionId } from './openRouterPromptCache';
import {
  assemblePublishBody,
  filterSafeDeletions,
  parsePublishArticleResponse,
} from './parsePublishArticleResponse';

function sourceBlocksForPrompt(cards: SourceCardSegment[]): string {
  return cards
    .map((c) => `【cardId:${c.nodeId}】\n${(c.segmentText ?? '').trim()}`)
    .join('\n\n');
}

const MAX_OPENER_TRANSITIONS = 1;
const MAX_TRANSITIONS_PER_GAP = 2;

function mapAssemblyOntoSource(
  cards: SourceCardSegment[],
  parsedSegments: ReturnType<typeof parsePublishArticleResponse>['segments'],
): SourceCardSegment[] {
  const byId = new Map<string, (typeof parsedSegments)[number]>();
  for (const seg of parsedSegments) {
    if (seg.cardId) byId.set(seg.cardId, seg);
  }
  const usePositional = byId.size === 0 && parsedSegments.length === cards.length;
  return cards.map((sc, i) => {
    const seg = byId.get(sc.nodeId) ?? (usePositional ? parsedSegments[i] : undefined);
    const source = sc.segmentText ?? '';
    const cap = i === 0 ? MAX_OPENER_TRANSITIONS : MAX_TRANSITIONS_PER_GAP;
    return {
      ...sc,
      transitions: [...(seg?.transitions ?? [])].slice(0, cap),
      deletions: filterSafeDeletions(source, seg?.deletions ?? []),
    };
  });
}

/**
 * First-pass editorial assembly: bridges + safe deletion marks on verbatim cards.
 * Does not rewrite card text. Later in-editor chat is a separate "edit" role.
 */
export async function assembleEssayDraft({
  articleId,
  aiConfig,
  t,
}: {
  articleId: string;
  aiConfig: AIConfig;
  t: (key: string, opts?: Record<string, unknown>) => string;
}): Promise<void> {
  const article = await db.articles.get(articleId);
  if (!article) throw new Error('Article not found');
  const cards = article.sourceCards ?? [];
  if (cards.length === 0) {
    await db.articles.update(articleId, { generating: false });
    return;
  }

  const text = await callUniversalAI({
    config: aiConfig,
    systemInstruction: t('ai.prompts.publishEssayPolishSystem'),
    prompt: t('ai.prompts.publishEssayPolish', { content: sourceBlocksForPrompt(cards) }),
    sessionId: spoorLlmSessionId('essay-assemble', articleId),
  });

  const parsed = parsePublishArticleResponse(text || '', article.title || t('ai.generated_article_title'));
  const sourceCards = mapAssemblyOntoSource(cards, parsed.segments);
  const body = assemblePublishBody(
    sourceCards.map((sc) => ({
      text: sc.segmentText,
      transitions: sc.transitions ?? [],
      deletions: sc.deletions ?? [],
    })),
  );

  const nextTitle = parsed.title.trim();
  await db.articles.update(articleId, {
    ...(nextTitle ? { title: nextTitle } : {}),
    content: body || article.content,
    sourceCards,
    generating: false,
    contentDrivesBody: true,
  });
}
