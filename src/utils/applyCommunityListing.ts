import { db } from '../db';
import type { CommunityListing } from '../services/community';
import { OFFICIAL_LISTINGS, resolveOfficialListingMeta } from '../constants/officialCommunityListings';
import { enrichTemplateDescriptionFromHowto, materilizeTemplateForCanvas } from './canvasTemplate';
import { ensureAmbienceNodeForCanvas } from './ensureAmbienceNode';
import {
  parseCommunityPayload,
  personaAsTemplate,
  remapAgents,
  remapTemplate,
} from './communityPayload';
import { resolveListingPersonaKey } from './agentPersonaSource';

export const PENDING_CANVAS_KEY = 'active_canvas_id';

export async function applyCommunityListing(listing: CommunityListing): Promise<string> {
  const overlay = listing.is_official
    ? OFFICIAL_LISTINGS.find((spec) => spec.listingId === listing.id)?.buildPayload()
    : undefined;
  const payload = overlay ?? parseCommunityPayload(listing.payload);
  if (!payload) throw new Error('invalid_payload');

  const existingAgents = await db.agents.toArray();
  const { agents, idMap } = remapAgents(payload.agents, {
    existingAgents,
    resolvePersonaKey: (agent) => resolveListingPersonaKey(listing.id, agent.id),
  });
  await db.transaction('rw', db.agents, async () => {
    for (const agent of agents) {
      await db.agents.put(agent);
    }
  });

  const sourceTemplate =
    payload.kind === 'persona'
      ? personaAsTemplate(agents[0]!)
      : remapTemplate(payload.template!, idMap);

  const canvasId = crypto.randomUUID();
  const officialMeta = listing.is_official ? resolveOfficialListingMeta(listing.id) : null;
  const name =
    officialMeta?.title ||
    listing.title.trim() ||
    sourceTemplate.name ||
    'Community';
  await db.canvases.add({
    id: canvasId,
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    template: 'blank',
  });
  const { nodes, edges } = materilizeTemplateForCanvas(sourceTemplate, canvasId);
  await db.transaction('rw', db.nodes, db.edges, async () => {
    await db.nodes.bulkPut(nodes);
    await db.edges.bulkPut(edges);
  });

  // Save the source template as a user-owned canvas template so the user can
  // find it under their own templates list and edit / re-apply it. We
  // overwrite createdAt/updatedAt with now() so the row reflects when the
  // user took ownership (the published template's timestamps are stale).
  const ownedTemplate = enrichTemplateDescriptionFromHowto({
    ...sourceTemplate,
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  await db.canvasTemplates.put(ownedTemplate);
  await ensureAmbienceNodeForCanvas({
    canvasId,
    // Official templates ship a complete cast (host + starter notes) and don't
    // need an ambience/audio fixture card; user-submitted listings still get one.
    skip: listing.is_official === true,
  });
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(PENDING_CANVAS_KEY, canvasId);
  }
  return canvasId;
}
