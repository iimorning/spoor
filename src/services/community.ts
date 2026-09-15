import type { CommunityKind, CommunityPayload } from '../utils/communityPayload';
import { parseCommunityPayload } from '../utils/communityPayload';
import { getSupabase } from '../lib/supabase';

export type CommunityListing = {
  id: string;
  author_id: string;
  author_name: string;
  kind: CommunityKind;
  title: string;
  description: string;
  cover_url: string | null;
  payload: CommunityPayload;
  published: boolean;
  like_count: number;
  favorite_count: number;
  comment_count: number;
  apply_count: number;
  created_at: string;
  /** Curated by Spoor — seeded into the table, not user-submitted. */
  is_official?: boolean;
  liked?: boolean;
  favorited?: boolean;
};

export type CommunityComment = {
  id: string;
  listing_id: string;
  user_id: string;
  author_name: string;
  body: string;
  created_at: string;
};

function requireClient() {
  const supabase = getSupabase();
  if (!supabase) throw new Error('community_not_configured');
  return supabase;
}

function mapListing(row: Record<string, unknown>): CommunityListing | null {
  const payload = parseCommunityPayload(row.payload);
  if (!payload) return null;
  const kind = row.kind === 'persona' ? 'persona' : 'canvas';
  return {
    id: String(row.id),
    author_id: String(row.author_id ?? ''),
    author_name: String(row.author_name || 'Spoor'),
    kind,
    title: String(row.title ?? ''),
    description: String(row.description ?? ''),
    cover_url: typeof row.cover_url === 'string' ? row.cover_url : null,
    payload,
    published: row.published !== false,
    like_count: Number(row.like_count ?? 0),
    favorite_count: Number(row.favorite_count ?? 0),
    comment_count: Number(row.comment_count ?? 0),
    apply_count: Number(row.apply_count ?? 0),
    created_at: String(row.created_at ?? ''),
    is_official: row.is_official === true,
  };
}

async function attachViewerState(listings: CommunityListing[], userId: string | null): Promise<CommunityListing[]> {
  if (!userId || listings.length === 0) return listings;
  const supabase = requireClient();
  const ids = listings.map((l) => l.id);
  const [{ data: likes }, { data: favs }] = await Promise.all([
    supabase.from('community_likes').select('listing_id').eq('user_id', userId).in('listing_id', ids),
    supabase.from('community_favorites').select('listing_id').eq('user_id', userId).in('listing_id', ids),
  ]);
  const liked = new Set((likes ?? []).map((r) => String((r as { listing_id: string }).listing_id)));
  const favorited = new Set((favs ?? []).map((r) => String((r as { listing_id: string }).listing_id)));
  return listings.map((l) => ({ ...l, liked: liked.has(l.id), favorited: favorited.has(l.id) }));
}

export async function listCommunityListings(opts: {
  kind?: CommunityKind | 'all';
  authorId?: string;
  favoriteUserId?: string;
  userId?: string | null;
}): Promise<CommunityListing[]> {
  const supabase = requireClient();
  if (opts.favoriteUserId) {
    const { data: favs, error: favError } = await supabase
      .from('community_favorites')
      .select('listing_id, created_at')
      .eq('user_id', opts.favoriteUserId)
      .order('created_at', { ascending: false });
    if (favError) throw new Error(favError.message);
    const ids = (favs ?? []).map((r) => String((r as { listing_id: string }).listing_id));
    if (ids.length === 0) return [];
    const { data, error } = await supabase.from('community_listings').select('*').in('id', ids);
    if (error) throw new Error(error.message);
    const mapped = (data ?? []).map((row) => mapListing(row as Record<string, unknown>)).filter(Boolean) as CommunityListing[];
    const order = new Map(ids.map((id, i) => [id, i]));
    mapped.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    const scoped =
      opts.kind === 'canvas' || opts.kind === 'persona'
        ? mapped.filter((row) => row.kind === opts.kind)
        : mapped;
    return attachViewerState(scoped, opts.userId ?? null);
  }

  let query = supabase.from('community_listings').select('*').order('created_at', { ascending: false }).limit(60);
  if (opts.kind === 'canvas' || opts.kind === 'persona') query = query.eq('kind', opts.kind);
  if (opts.authorId) query = query.eq('author_id', opts.authorId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const mapped = (data ?? []).map((row) => mapListing(row as Record<string, unknown>)).filter(Boolean) as CommunityListing[];
  return attachViewerState(mapped, opts.userId ?? null);
}

export async function getCommunityListing(id: string, userId?: string | null): Promise<CommunityListing | null> {
  const supabase = requireClient();
  const { data, error } = await supabase.from('community_listings').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const mapped = mapListing(data as Record<string, unknown>);
  if (!mapped) return null;
  const [withState] = await attachViewerState([mapped], userId ?? null);
  return withState ?? mapped;
}

export async function publishCommunityListing(input: {
  kind: CommunityKind;
  title: string;
  description: string;
  payload: CommunityPayload;
  coverUrl?: string | null;
}): Promise<CommunityListing> {
  const supabase = requireClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error('not_signed_in');
  const { data, error } = await supabase
    .from('community_listings')
    .insert({
      author_id: userId,
      kind: input.kind,
      title: input.title,
      description: input.description,
      payload: input.payload,
      cover_url: input.coverUrl ?? null,
      published: true,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  const mapped = mapListing(data as Record<string, unknown>);
  if (!mapped) throw new Error('invalid_payload');
  return mapped;
}

export async function deleteCommunityListing(id: string): Promise<void> {
  const supabase = requireClient();
  const { error } = await supabase.from('community_listings').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function toggleCommunityLike(listing: CommunityListing, userId: string): Promise<CommunityListing> {
  const supabase = requireClient();
  if (listing.liked) {
    const { error } = await supabase.from('community_likes').delete().eq('listing_id', listing.id).eq('user_id', userId);
    if (error) throw new Error(error.message);
    return { ...listing, liked: false, like_count: Math.max(0, listing.like_count - 1) };
  }
  const { error } = await supabase.from('community_likes').insert({ listing_id: listing.id, user_id: userId });
  if (error) throw new Error(error.message);
  return { ...listing, liked: true, like_count: listing.like_count + 1 };
}

export async function toggleCommunityFavorite(listing: CommunityListing, userId: string): Promise<CommunityListing> {
  const supabase = requireClient();
  if (listing.favorited) {
    const { error } = await supabase.from('community_favorites').delete().eq('listing_id', listing.id).eq('user_id', userId);
    if (error) throw new Error(error.message);
    return { ...listing, favorited: false, favorite_count: Math.max(0, listing.favorite_count - 1) };
  }
  const { error } = await supabase.from('community_favorites').insert({ listing_id: listing.id, user_id: userId });
  if (error) throw new Error(error.message);
  return { ...listing, favorited: true, favorite_count: listing.favorite_count + 1 };
}

export async function listCommunityComments(listingId: string): Promise<CommunityComment[]> {
  const supabase = requireClient();
  const { data, error } = await supabase
    .from('community_comments')
    .select('*')
    .eq('listing_id', listingId)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      listing_id: String(r.listing_id),
      user_id: String(r.user_id),
      author_name: String(r.author_name || 'Spoor'),
      body: String(r.body ?? ''),
      created_at: String(r.created_at ?? ''),
    };
  });
}

export async function addCommunityComment(listingId: string, body: string): Promise<CommunityComment> {
  const supabase = requireClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error('not_signed_in');
  const { data, error } = await supabase
    .from('community_comments')
    .insert({ listing_id: listingId, user_id: userId, body: body.trim() })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  const r = data as Record<string, unknown>;
  return {
    id: String(r.id),
    listing_id: String(r.listing_id),
    user_id: String(r.user_id),
    author_name: String(r.author_name || 'Spoor'),
    body: String(r.body ?? ''),
    created_at: String(r.created_at ?? ''),
  };
}

export async function deleteCommunityComment(id: string): Promise<void> {
  const supabase = requireClient();
  const { error } = await supabase.from('community_comments').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function recordCommunityApply(listingId: string): Promise<void> {
  const supabase = requireClient();
  const { error } = await supabase.rpc('community_record_apply', { listing: listingId });
  if (error) console.warn('community apply count', error.message);
}
