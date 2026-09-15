/**
 * Legacy cosmos workspace identifiers — kept here so the legacy essay article
 * (the only piece still cleaned up by `useSeedData`) can be removed on startup.
 *
 * This file no longer builds a default canvas. First-run cards now come from
 * `src/constants/defaultWorkspace.ts` (ask + theme + note). The Trauma Inner
 * Cosmos layout is a separate built-in template in
 * `src/constants/builtInCanvasTemplates.ts`, spawned via
 * `spawnCosmosCanvasTemplate`. Existing cosmos canvases (on the default
 * canvas or created manually) are left untouched per the user-data policy.
 */

export const LEGACY_DEFAULT_ESSAY_ARTICLE_ID = 'ref-042';
