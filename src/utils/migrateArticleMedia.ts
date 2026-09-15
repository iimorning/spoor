import { db } from '../db';
import {
  articleHasLegacyMedia,
  extractEmbeddedArticleMedia,
} from './articleMedia';
import { withoutSyncHooks } from './syncHookGuard';

let migrationInFlight: Promise<void> | null = null;

function waitForIdle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => resolve(), { timeout: 1500 });
    } else {
      window.setTimeout(resolve, 250);
    }
  });
}

/**
 * Migrate legacy Base64 articles one at a time while the app is idle.
 * Reading primary keys first avoids loading every large article into memory.
 */
export function scheduleLegacyArticleMediaMigration(): Promise<void> {
  if (migrationInFlight) return migrationInFlight;
  migrationInFlight = (async () => {
    const ids = await db.articles.toCollection().primaryKeys();
    for (const id of ids) {
      await waitForIdle();
      const article = await db.articles.get(String(id));
      if (!article || !articleHasLegacyMedia(article)) continue;
      await withoutSyncHooks(async () => {
        await db.articles.put(await extractEmbeddedArticleMedia(article));
      });
    }
  })()
    .catch((error) => {
      console.error('[Spoor] background article media migration failed', error);
    })
    .finally(() => {
      migrationInFlight = null;
    });
  return migrationInFlight;
}

export function resetArticleMediaMigrationForTests(): void {
  migrationInFlight = null;
}
