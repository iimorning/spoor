# Community gallery

Public `/community` on the website. Users publish **canvas templates** (starter cards + bundled agents). Anyone can apply a listing into local IndexedDB without signing in. Like / save / comment open a sign-in dialog.

This is **not** a dump of a live canvas (no image data URLs, essays, or sandbox chats). API keys never live on `AgentConfig`; prompts and knowledge Markdown *are* published — do not paste secrets into a persona.

## Schema

Run [`supabase/migrations/20260818010000_community.sql`](../supabase/migrations/20260818010000_community.sql) in the SQL Editor (after the sync + subscriptions migrations).

Tables:

- `community_listings` — public read when `published`; author writes
- `community_likes` / `community_favorites` — own rows only
- `community_comments` — public read on published listings; author insert/delete

Counts update via triggers. Apply count: `community_record_apply(listing uuid)`.

## Product flow

1. Sign in (same Supabase account as cloud sync).
2. Agents Studio → **Publish** on a user canvas template (personas in that template are included).
3. Gallery at `/community`. Detail at `/community/:id`.
4. **Use this canvas** clones agents (new UUIDs), materializes cards, sets `active_canvas_id`, opens `/app`. No account required.

Desktop (Tauri) has no marketing shell; Studio opens `https://spoor.ink/community` in the system browser.

## Limits

Prompts, knowledge files, and data-URL covers are truncated on publish (`src/utils/communityPayload.ts`). Keep covers as https URLs when possible.
