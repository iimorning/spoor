/** Built-in canvas templates, served as data (single source of truth). */
import type { CanvasTemplateDoc } from '../db';

/**
 * Trauma Inner Cosmos — the only built-in template for now.
 *
 * Position fractions are of a 1200×800 design canvas. At instantiate time
 * `materilizeTemplateForCanvas` scales them to the active canvas viewport
 * (around its current center) and mints fresh UUIDs for nodes / edges.
 *
 * Content uses i18n keys under `canvas.templates.cosmos.*` that already
 * ship in both `en` and `zh` resource bundles.
 */
export const BUILTIN_CANVAS_TEMPLATE_COSMOS: CanvasTemplateDoc = {
  id: 'builtin:cortex_cosmos',
  builtinKey: 'cosmos',
  origin: 'system',
  listed: false,
  name: 'canvas.new_cosmos_canvas',
  personaIds: ['cosmos_weaver', 'character_atelier'],
  nodes: [
    {
      key: 'theme-world',
      type: 'theme',
      contentKey: 'canvas.templates.cosmos.theme_world',
      xFrac: 520 / 1200,
      yFrac: 80 / 800,
    },
    {
      key: 'theme-cast',
      type: 'theme',
      contentKey: 'canvas.templates.cosmos.theme_cast',
      xFrac: 920 / 1200,
      yFrac: 80 / 800,
    },
    {
      key: 'note-four',
      type: 'note',
      contentKey: 'canvas.templates.cosmos.note_four_questions',
      xFrac: 100 / 1200,
      yFrac: 360 / 800,
      wFrac: 320 / 1200,
      hFrac: 260 / 800,
    },
    {
      key: 'note-pain',
      type: 'note',
      contentKey: 'canvas.templates.cosmos.note_pain',
      xFrac: 100 / 1200,
      yFrac: 660 / 800,
      wFrac: 320 / 1200,
      hFrac: 200 / 800,
    },
    {
      key: 'agent-weaver',
      type: 'agent',
      agentConfigId: 'cosmos_weaver',
      xFrac: 480 / 1200,
      yFrac: 220 / 800,
    },
    {
      key: 'agent-atelier',
      type: 'agent',
      agentConfigId: 'character_atelier',
      xFrac: 880 / 1200,
      yFrac: 220 / 800,
    },
    {
      key: 'ask',
      type: 'ask',
      xFrac: 80 / 1200,
      yFrac: 80 / 800,
      wFrac: 320 / 1200,
      hFrac: 180 / 800,
    },
  ],
  edges: [
    { fromKey: 'note-four', toKey: 'agent-weaver' },
    {
      fromKey: 'note-pain',
      toKey: 'agent-weaver',
      noteKey: 'canvas.templates.cosmos.edge_pain_to_weaver',
    },
    { fromKey: 'agent-weaver', toKey: 'theme-world' },
    { fromKey: 'agent-weaver', toKey: 'agent-atelier' },
    { fromKey: 'agent-atelier', toKey: 'theme-cast' },
  ],
  createdAt: 0,
  updatedAt: 0,
};

/** All built-in canvas templates; consumer iterates this list. */
export const BUILTIN_CANVAS_TEMPLATES: readonly CanvasTemplateDoc[] = [
  BUILTIN_CANVAS_TEMPLATE_COSMOS,
];
