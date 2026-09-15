import { db } from '../db';
import { findOpenCanvasPosition } from './canvas';
import {
  articleIdsFromEssayNodes,
  dedupeEssayNodesByArticle,
  placeEssayNode,
} from './essayNodes';
import { tryParseEssayContent } from './essayPayload';

const MIGRATION_FLAG = 'spoor-essay-nodes-migrated-v1';

/** Coalesce concurrent boots (React StrictMode double-mount) into one migration. */
let migrationInFlight: Promise<{ created: number; skipped: number }> | null = null;

/**
 * Idempotent: ensure every Article has an essay canvas card.
 * Safe to call on every app boot; skips articles that already have a matching node.
 * Concurrent callers share one run so StrictMode cannot create duplicate cards.
 */
export async function migrateArticlesToEssayNodes(opts?: {
  /** Preferred canvas when article has no linkedCanvasIds (e.g. current active). */
  preferredCanvasId?: string;
}): Promise<{ created: number; skipped: number }> {
  if (migrationInFlight) return migrationInFlight;
  migrationInFlight = runMigrateArticlesToEssayNodes(opts).finally(() => {
    migrationInFlight = null;
  });
  return migrationInFlight;
}

async function runMigrateArticlesToEssayNodes(opts?: {
  preferredCanvasId?: string;
}): Promise<{ created: number; skipped: number }> {
  // Clean up duplicates left by earlier StrictMode races before creating any more.
  await dedupeEssayNodesByArticle();

  const articles = await db.articles.toArray();
  if (articles.length === 0) {
    try {
      localStorage.setItem(MIGRATION_FLAG, '1');
    } catch {
      /* ignore */
    }
    return { created: 0, skipped: 0 };
  }

  const essayNodes = await db.nodes.where('type').equals('essay').toArray();
  const existingArticleIds = new Set(articleIdsFromEssayNodes(essayNodes));

  const canvases = await db.canvases.toArray();
  const fallbackCanvasId =
    opts?.preferredCanvasId ||
    canvases.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]?.id ||
    'default';

  let created = 0;
  let skipped = 0;

  for (const article of articles) {
    if (existingArticleIds.has(article.id)) {
      skipped += 1;
      continue;
    }

    // Also skip if any essay node payload matches (in case filter missed).
    const already = essayNodes.some((n) => tryParseEssayContent(n.content)?.articleId === article.id);
    if (already) {
      skipped += 1;
      continue;
    }

    const canvasId = article.linkedCanvasIds?.[0] || fallbackCanvasId;
    const existingOnCanvas = await db.nodes
      .filter((n) => (n.canvasId ?? 'default') === canvasId)
      .toArray();

    const { x, y } = findOpenCanvasPosition({
      transform: { x: 0, y: 0, scale: 1 },
      obstacles: existingOnCanvas,
      size: { width: 380, height: 520 },
      gap: 36,
      maxRings: 24,
    });

    await placeEssayNode({
      articleId: article.id,
      canvasId,
      x,
      y,
      title: article.title,
    });
    existingArticleIds.add(article.id);
    created += 1;
  }

  try {
    localStorage.setItem(MIGRATION_FLAG, '1');
  } catch {
    /* ignore */
  }

  return { created, skipped };
}

export function hasEssayNodesMigrationFlag(): boolean {
  try {
    return localStorage.getItem(MIGRATION_FLAG) === '1';
  } catch {
    return false;
  }
}

/** Test helper: clear the in-flight lock between cases. */
export function resetEssayNodesMigrationLockForTests(): void {
  migrationInFlight = null;
}
