/** Built-in "official" community listings served as code (single source of truth).
 *
 * These are also seeded into the `community_listings` table by
 * `supabase/migrations/20260818020000_community_official.sql` so that likes /
 * favorites / comments / apply counts work end-to-end. Frontend uses the
 * builders to (a) generate the JSON for the migration and (b) keep the
 * canvas-template data shape honest in tests.
 *
 * Add a new official entry by:
 *   1. Adding a `communityOfficialEn/<lang>.my_id` block in
 *      `src/i18n/communityOfficialContent.ts`.
 *   2. Adding a builder factory below that returns `CommunityPayload`
 *      from those i18n keys.
 *   3. Registering it in `OFFICIAL_LISTINGS`.
 */
import i18n from '../i18n';
import type { CommunityPayload } from '../utils/communityPayload';
import type {
  AgentConfig,
  CanvasTemplateDoc,
  TemplateEdge,
  TemplateNode,
} from '../db';
import { enrichTemplateDescriptionFromHowto } from '../utils/canvasTemplate';
import { cosmosNarrativeKnowledgeFile } from './agentKnowledge/cosmosNarrativeGrammar';
import { BUILTIN_CANVAS_TEMPLATE_COSMOS } from './builtInCanvasTemplates';
import { SYSTEM_AGENT_TUNING } from './defaultAgents';
import { officialPersonaCoverUrl, officialPersonaThumbUrl } from './officialPersonaCovers';

// On the /community gallery and detail pages we use the bundled thumbnail
// (800×450 webp, ~50KB) so official listings don't paint a 3MB cover
// every time the user scrolls the gallery. The full-resolution cover is still
// available via `officialPersonaCoverUrl` for canvas-side persona cards where
// the larger source is shown.

/** Fixed system author UUID used by every official listing. Matches the row
 *  inserted into `auth.users` by the community_official migration. */
export const OFFICIAL_AUTHOR_UID = '00000000-0000-0000-0000-000000000001';

const DESIGN_WIDTH = 1200;
const DESIGN_HEIGHT = 800;

function t(key: string): string {
  const v = i18n.t(key);
  return v && v !== key ? String(v) : '';
}

interface BaseLayout {
  howto: { xFrac: number; yFrac: number; wFrac: number; hFrac: number };
  start: { xFrac: number; yFrac: number; wFrac: number; hFrac: number };
  agent: { xFrac: number; yFrac: number };
}

/** How-to theme + start note on the left, host in the middle. No ask/Ali card —
 *  these canvases are one-persona games and do not need the built-in 阿狸 node. */
const STANDARD_LAYOUT: BaseLayout = {
  howto: { xFrac: 80 / DESIGN_WIDTH, yFrac: 90 / DESIGN_HEIGHT, wFrac: 340 / DESIGN_WIDTH, hFrac: 300 / DESIGN_HEIGHT },
  start: { xFrac: 80 / DESIGN_WIDTH, yFrac: 440 / DESIGN_HEIGHT, wFrac: 340 / DESIGN_WIDTH, hFrac: 150 / DESIGN_HEIGHT },
  agent: { xFrac: 560 / DESIGN_WIDTH, yFrac: 250 / DESIGN_HEIGHT },
};

function splitTitleBody(raw: string): { title: string; body: string } {
  const text = raw.replace(/\r\n/g, '\n').trim();
  const nl = text.indexOf('\n');
  if (nl < 0) return { title: text, body: '' };
  return { title: text.slice(0, nl).trim(), body: text.slice(nl).trim() };
}

function buildStandardTemplate(opts: {
  templateId: string;
  personaId: string;
  i18nPrefix: string;
  layout?: BaseLayout;
  includeStartNote?: boolean;
}): CanvasTemplateDoc {
  const layout = opts.layout ?? STANDARD_LAYOUT;
  const howto = splitTitleBody(t(`${opts.i18nPrefix}.note_howto`));
  const includeStartNote = opts.includeStartNote !== false;
  const nodes: TemplateNode[] = [
    {
      key: 'theme-howto',
      type: 'theme',
      contentText: howto.title,
      descriptionText: howto.body,
      ...layout.howto,
    },
    ...(includeStartNote
      ? [
          {
            key: 'note-start',
            type: 'note' as const,
            contentText: t(`${opts.i18nPrefix}.note_start`),
            ...layout.start,
          },
        ]
      : []),
    {
      key: 'agent-host',
      type: 'agent',
      agentConfigId: opts.personaId,
      ...layout.agent,
    },
  ];

  const edges: TemplateEdge[] = includeStartNote
    ? [
        {
          fromKey: 'note-start',
          toKey: 'agent-host',
          noteText: t(`${opts.i18nPrefix}.edge_start`),
        },
      ]
    : [];

  const now = Date.now();
  return enrichTemplateDescriptionFromHowto({
    id: opts.templateId,
    name: t(`${opts.i18nPrefix}.title`),
    description: t(`${opts.i18nPrefix}.description`),
    origin: 'user',
    builtinKey: null,
    listed: true,
    personaIds: [opts.personaId],
    nodes,
    edges,
    createdAt: now,
    updatedAt: now,
  });
}

function buildStandardPayload(opts: {
  templateId: string;
  personaId: string;
  i18nPrefix: string;
  temperature: number;
  creativity: number;
  layout?: BaseLayout;
  includeStartNote?: boolean;
}): CommunityPayload {
  const host: AgentConfig = {
    id: opts.personaId,
    name: t(`${opts.i18nPrefix}.persona_name`),
    role: t(`${opts.i18nPrefix}.persona_role`),
    prompt: t(`${opts.i18nPrefix}.persona_prompt`),
    temperature: opts.temperature,
    creativity: opts.creativity,
    coverImageUrl: officialPersonaCoverUrl(opts.personaId),
  };

  return {
    version: 1,
    kind: 'canvas',
    template: buildStandardTemplate(opts),
    agents: [host],
  };
}

export function buildOfficialTurtleSoupPayload(): CommunityPayload {
  return buildStandardPayload({
    templateId: 'official:turtle-soup-template',
    personaId: 'turtle_soup_host',
    i18nPrefix: 'community.official.turtle_soup',
    temperature: 0.85,
    creativity: 0.75,
    includeStartNote: false,
  });
}

export function buildOfficialTraumaInnerCosmosPayload(): CommunityPayload {
  const weaver: AgentConfig = {
    id: 'cosmos_weaver',
    name: i18n.t('agents.defaults.cosmos_weaver.name'),
    role: i18n.t('agents.defaults.cosmos_weaver.role'),
    prompt: i18n.t('agents.defaults.cosmos_weaver.prompt'),
    ...SYSTEM_AGENT_TUNING.cosmos_weaver,
    coverImageUrl: officialPersonaCoverUrl('cosmos_weaver'),
    knowledgeMarkdownFiles: [cosmosNarrativeKnowledgeFile(i18n.language)],
  };
  const atelier: AgentConfig = {
    id: 'character_atelier',
    name: i18n.t('agents.defaults.character_atelier.name'),
    role: i18n.t('agents.defaults.character_atelier.role'),
    prompt: i18n.t('agents.defaults.character_atelier.prompt'),
    ...SYSTEM_AGENT_TUNING.character_atelier,
    coverImageUrl: officialPersonaCoverUrl('character_atelier'),
    knowledgeMarkdownFiles: [cosmosNarrativeKnowledgeFile(i18n.language)],
  };
  const now = Date.now();
  const nodes: TemplateNode[] = BUILTIN_CANVAS_TEMPLATE_COSMOS.nodes.map((n) => ({
    key: n.key,
    type: n.type,
    contentText: n.contentKey ? t(n.contentKey) : n.contentText,
    ...(n.descriptionText ? { descriptionText: n.descriptionText } : {}),
    agentConfigId: n.agentConfigId,
    xFrac: n.xFrac,
    yFrac: n.yFrac,
    ...(n.wFrac !== undefined ? { wFrac: n.wFrac } : {}),
    ...(n.hFrac !== undefined ? { hFrac: n.hFrac } : {}),
  }));
  const template = enrichTemplateDescriptionFromHowto({
    id: 'official:trauma-inner-cosmos-template',
    name: t('community.official.trauma_inner_cosmos.title'),
    description: t('community.official.trauma_inner_cosmos.description'),
    origin: 'user',
    builtinKey: null,
    listed: true,
    personaIds: ['cosmos_weaver', 'character_atelier'],
    nodes,
    edges: BUILTIN_CANVAS_TEMPLATE_COSMOS.edges.map((e) => ({
      fromKey: e.fromKey,
      toKey: e.toKey,
      noteText: e.noteKey ? t(e.noteKey) : e.noteText,
    })),
    createdAt: now,
    updatedAt: now,
  });
  return {
    version: 1,
    kind: 'canvas',
    template,
    agents: [weaver, atelier],
  };
}

export function buildOfficialIntuitionPumpPayload(): CommunityPayload {
  return buildStandardPayload({
    templateId: 'official:intuition-pump-template',
    personaId: 'intuition_pump_expert',
    i18nPrefix: 'community.official.intuition_pump',
    temperature: 0.8,
    creativity: 0.7,
    // The "Start one" note is replaced by a canvas onboarding tour
    // (see `src/onboarding/intuitionPumpTourSteps.ts`) that points at the
    // theme-howto card and the agent's Run wand. Removing the note keeps the
    // canvas uncluttered for returning users who already saw the tour.
    includeStartNote: false,
  });
}

export interface OfficialListingSpec {
  /** Stable id used as the slug key in i18n and the dump output. */
  key: string;
  /** Hardcoded UUID for the seeded `community_listings` row. */
  listingId: string;
  /** Primary persona id used inside the seeded template; remapped on apply. */
  personaId: string;
  /** Extra bundled personas (e.g. 创伤内宇宙 ships Weaver + Atelier). */
  extraPersonaIds?: readonly string[];
  /** i18n key prefix under which title/description/prompt/notes live. */
  i18nPrefix: string;
  /** Build the CommunityPayload for the current i18n language. */
  buildPayload: () => CommunityPayload;
}

export const OFFICIAL_LISTINGS: readonly OfficialListingSpec[] = [
  {
    key: 'turtle_soup',
    listingId: '11111111-1111-4111-8111-111111111111',
    personaId: 'turtle_soup_host',
    i18nPrefix: 'community.official.turtle_soup',
    buildPayload: buildOfficialTurtleSoupPayload,
  },
  {
    key: 'intuition_pump',
    listingId: '22222222-2222-4222-8222-222222222222',
    personaId: 'intuition_pump_expert',
    i18nPrefix: 'community.official.intuition_pump',
    buildPayload: buildOfficialIntuitionPumpPayload,
  },
  {
    key: 'trauma_inner_cosmos',
    listingId: '33333333-3333-4333-8333-333333333333',
    personaId: 'cosmos_weaver',
    extraPersonaIds: ['character_atelier'],
    i18nPrefix: 'community.official.trauma_inner_cosmos',
    buildPayload: buildOfficialTraumaInnerCosmosPayload,
  },
] as const;

/** Backwards-compatible exports for tests / external callers. */
export const OFFICIAL_TURTLE_SOUP_ID = OFFICIAL_LISTINGS[0]!.listingId;
export const OFFICIAL_TURTLE_SOUP_PERSONA_ID = OFFICIAL_LISTINGS[0]!.personaId;
export const OFFICIAL_INTUITION_PUMP_ID = OFFICIAL_LISTINGS[1]!.listingId;
export const OFFICIAL_INTUITION_PUMP_PERSONA_ID = OFFICIAL_LISTINGS[1]!.personaId;
export const OFFICIAL_TRAUMA_INNER_COSMOS_ID = OFFICIAL_LISTINGS[2]!.listingId;
export const OFFICIAL_TRAUMA_INNER_COSMOS_PERSONA_IDS = [
  OFFICIAL_LISTINGS[2]!.personaId,
  ...(OFFICIAL_LISTINGS[2]!.extraPersonaIds ?? []),
] as const;

export function officialListingPersonaIds(spec: OfficialListingSpec): string[] {
  return [spec.personaId, ...(spec.extraPersonaIds ?? [])];
}

/** Localized title + description for an official listing row (community gallery). */
export function resolveOfficialListingMeta(listingId: string): {
  title: string;
  description: string;
} | null {
  const spec = OFFICIAL_LISTINGS.find((entry) => entry.listingId === listingId);
  if (!spec) return null;
  return {
    title: t(`${spec.i18nPrefix}.title`),
    description: t(`${spec.i18nPrefix}.description`),
  };
}

/** Bundled persona cover for an official listing detail/card preview. */
export function resolveOfficialListingCoverUrl(listingId: string): string | undefined {
  const spec = OFFICIAL_LISTINGS.find((entry) => entry.listingId === listingId);
  if (!spec) return undefined;
  return officialPersonaCoverUrl(spec.personaId);
}

/** Smaller webp variant of the listing cover, for landing/community thumbnails. */
export function resolveOfficialListingThumbUrl(listingId: string): string | undefined {
  const spec = OFFICIAL_LISTINGS.find((entry) => entry.listingId === listingId);
  if (!spec) return undefined;
  return officialPersonaThumbUrl(spec.personaId) ?? officialPersonaCoverUrl(spec.personaId);
}

/** Overlay i18n title/description onto official listings for the active locale. */
export function localizeOfficialListing<
  T extends {
    id: string;
    is_official?: boolean;
    title: string;
    description: string | null;
    cover_url?: string | null;
  },
// 返回值带上 cover_url：函数内部会在封面缺失时补上一张打包的图（见下面的 cover_url），
// 但返回类型原本写的是 T（与入参同型），于是调用方读 `listing.cover_url` 会被判成
// 「这个类型上没有这个属性」。只有早退那两条路不保证有，所以是可选。
>(listing: T): T & { cover_url?: string | null } {
  if (listing.is_official !== true) return listing;
  const meta = resolveOfficialListingMeta(listing.id);
  // The /community gallery shows large cards in a masonry — use the bundled
  // full-resolution cover so detail-view imagery stays crisp. The landing-page
  // community section reads cover_url via resolveOfficialListingThumbUrl
  // separately and stays light.
  const cover_url = listing.cover_url ?? resolveOfficialListingCoverUrl(listing.id) ?? null;
  if (!meta && !cover_url) return listing;
  return {
    ...listing,
    ...(meta ? { title: meta.title, description: meta.description } : {}),
    cover_url,
  };
}

/** Bundled official canvases for the local-only / OSS gallery (no cloud backend). */
export function builtinOfficialCommunityListings(): import('../services/community').CommunityListing[] {
  return OFFICIAL_LISTINGS.map((spec) => {
    const meta = resolveOfficialListingMeta(spec.listingId);
    return {
      id: spec.listingId,
      author_id: OFFICIAL_AUTHOR_UID,
      author_name: 'Spoor',
      kind: 'canvas' as const,
      title: meta?.title || spec.key,
      description: meta?.description || '',
      cover_url: resolveOfficialListingCoverUrl(spec.listingId) ?? null,
      payload: spec.buildPayload(),
      published: true,
      like_count: 0,
      favorite_count: 0,
      comment_count: 0,
      apply_count: 0,
      created_at: '',
      is_official: true,
    };
  });
}

/**
 * Dump every official listing's payload for both locales (zh + en) as
 * pretty-printed JSON strings. The caller (a `tsx` script) pipes stdout into
 * the migration SQL. See `npm run dump:official`.
 */
export async function dumpOfficialPayloadsForMigration(): Promise<void> {
  const { default: i18next } = await import('../i18n');
  const langs: Array<'zh' | 'en'> = ['zh', 'en'];
  for (const lang of langs) {
    await i18next.changeLanguage(lang);
    console.log(`=== ${lang} ===`);
    for (const spec of OFFICIAL_LISTINGS) {
      console.log(`--- ${spec.key} (${spec.listingId}) ---`);
      console.log(JSON.stringify(spec.buildPayload(), null, 2));
    }
  }
}