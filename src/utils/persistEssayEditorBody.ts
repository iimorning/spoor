import { db } from '../db';

export const ESSAY_BODY_PERSIST_MS = 450;

/** Canonical body write from the unified editor. */
export async function persistEssayEditorBody(articleId: string, markdown: string): Promise<void> {
  await db.articles.update(articleId, {
    content: markdown,
    contentDrivesBody: true,
  });
}
