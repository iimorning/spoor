import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CommunityListing } from '../../src/services/community';
import type { CommunityPayload } from '../../src/utils/communityPayload';

const getSupabaseMock = vi.hoisted(() => vi.fn(() => null));
const isSupabaseConfiguredMock = vi.hoisted(() => vi.fn(() => true));

vi.mock('../../src/lib/supabase', () => ({
  getSupabase: getSupabaseMock,
  isSupabaseConfigured: isSupabaseConfiguredMock,
}));

// Imported lazily so the mock above is in place before module init.
const svc = await import('../../src/services/community');

type ListingRow = {
  id: string;
  author_id: string;
  author_name: string;
  kind: 'canvas' | 'persona';
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
};

type LikeRow = { listing_id: string; user_id: string };
type FavoriteRow = { listing_id: string; user_id: string; created_at: string };
type CommentRow = {
  id: string;
  listing_id: string;
  user_id: string;
  author_name: string;
  body: string;
  created_at: string;
};

const SESSION_USER_ID = '11111111-1111-4111-8111-111111111111';

function buildPayload(): CommunityPayload {
  return {
    version: 1,
    kind: 'canvas',
    template: {
      id: 'official:test',
      name: 'Test',
      description: '',
      origin: 'user',
      builtinKey: null,
      listed: true,
      personaIds: ['p1'],
      nodes: [
        {
          key: 'note-start',
          type: 'note',
          contentText: '开始',
          xFrac: 0.1,
          yFrac: 0.5,
        },
        {
          key: 'agent-host',
          type: 'agent',
          agentConfigId: 'p1',
          xFrac: 0.5,
          yFrac: 0.3,
        },
      ],
      edges: [{ fromKey: 'note-start', toKey: 'agent-host' }],
      createdAt: 0,
      updatedAt: 0,
    },
    agents: [
      {
        id: 'p1',
        name: 'Host',
        role: 'helper',
        prompt: 'help',
        temperature: 0.5,
        creativity: 0.5,
      },
    ],
  };
}

function buildListingRow(overrides: Partial<ListingRow> = {}): ListingRow {
  return {
    id: 'listing-1',
    author_id: 'author-1',
    author_name: 'Alice',
    kind: 'canvas',
    title: 'Test listing',
    description: 'desc',
    cover_url: null,
    payload: buildPayload(),
    published: true,
    like_count: 0,
    favorite_count: 0,
    comment_count: 0,
    apply_count: 0,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/**
 * Minimal Supabase chain mock tailored to community.ts. Supports:
 *   .from(name).select(...).eq(col, val).in(col, ids)  → rows[] thenable
 *   .from(name).select(...).eq().in().order().limit() → rows[] thenable
 *   .from(name).select(...).eq().maybeSingle()        → single row
 *   .from(name).select(...).single()                  → single row
 *   .from(name).insert(row).select().single()         → inserted row
 *   .from(name).delete().eq()                        → delete
 *   .rpc(name, args)                                 → thenable
 *   .auth.getUser()                                  → { data: { user } }
 */
function makeSupabaseMock(opts: {
  listings?: ListingRow[];
  likes?: LikeRow[];
  favorites?: FavoriteRow[];
  comments?: CommentRow[];
  user?: { id: string } | null;
} = {}) {
  const tables: Record<string, { rows: unknown[] }> = {
    community_listings: { rows: opts.listings ?? [] },
    community_likes: { rows: opts.likes ?? [] },
    community_favorites: { rows: opts.favorites ?? [] },
    community_comments: { rows: opts.comments ?? [] },
  };

  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];

  const filter = <T extends Record<string, unknown>>(rows: T[], filters: Array<{ col: string; op: string; val: unknown }>): T[] => {
    return rows.filter((row) =>
      filters.every((f) => {
        const cell = row[f.col];
        if (f.op === 'eq') return cell === f.val;
        if (f.op === 'in') return Array.isArray(f.val) && f.val.includes(cell);
        return true;
      }),
    );
  };

  const chainFor = (name: string) => {
    const table = tables[name] ?? { rows: [] };
    const filters: Array<{ col: string; op: string; val: unknown }> = [];
    let orderCol: string | null = null;
    let orderAsc = true;
    let limit: number | null = null;
    let pendingInsert: unknown = null;
    let pendingDelete = false;
    let terminal: 'rows' | 'first' | 'single' | 'empty' = 'rows';
    let pendingRpc = false;

    const query: any = {
      select: vi.fn(() => query),
      eq: vi.fn((col: string, val: unknown) => {
        filters.push({ col, op: 'eq', val });
        return query;
      }),
      in: vi.fn((col: string, val: unknown[]) => {
        filters.push({ col, op: 'in', val });
        return query;
      }),
      order: vi.fn((col: string, opts?: { ascending?: boolean }) => {
        orderCol = col;
        orderAsc = opts?.ascending !== false;
        return query;
      }),
      limit: vi.fn((n: number) => {
        limit = n;
        return query;
      }),
      insert: vi.fn((rows: unknown) => {
        pendingInsert = rows;
        terminal = 'single';
        return query;
      }),
      delete: vi.fn(() => {
        pendingDelete = true;
        return query;
      }),
      update: vi.fn(() => query),
      maybeSingle: vi.fn(() => {
        terminal = 'first';
        return query;
      }),
      single: vi.fn(() => {
        terminal = 'single';
        return query;
      }),
      upsert: vi.fn(() => query),
      then: (resolve: (v: unknown) => void) => {
        calls.push({ table: name, method: 'then', args: [filters, orderCol, limit, terminal] });
        if (pendingRpc) {
          resolve({ data: null, error: null });
          return;
        }
        const rows = (table.rows as Record<string, unknown>[]).slice();

        if (pendingInsert) {
          const inserted = Array.isArray(pendingInsert) ? pendingInsert : [pendingInsert];
          for (const row of inserted) table.rows.push(row);
          const data = inserted[0] ?? null;
          if (terminal === 'first' || terminal === 'single') {
            resolve({ data, error: null });
            return;
          }
          resolve({ data: inserted, error: null });
          return;
        }

        if (pendingDelete) {
          // .delete().eq(...) applies via filters below; we treat empty as success.
          if (terminal === 'empty') {
            resolve({ data: null, error: null });
            return;
          }
        }

        let result = filter(rows, filters);
        if (orderCol) {
          const c = orderCol;
          result = result.slice().sort((a, b) => {
            const av = a[c] as string | number;
            const bv = b[c] as string | number;
            if (av < bv) return orderAsc ? -1 : 1;
            if (av > bv) return orderAsc ? 1 : -1;
            return 0;
          });
        }
        if (limit !== null) result = result.slice(0, limit);

        if (terminal === 'first') {
          resolve({ data: result[0] ?? null, error: null });
          return;
        }
        if (terminal === 'single') {
          resolve({ data: result[0] ?? null, error: null });
          return;
        }
        resolve({ data: result, error: null });
      },
    };
    return query;
  };

  const client: any = {
    from: vi.fn((name: string) => {
      calls.push({ table: name, method: 'from', args: [] });
      return chainFor(name);
    }),
    rpc: vi.fn((name: string) => {
      calls.push({ table: name, method: 'rpc', args: [] });
      const query = chainFor(name);
      query.then = (resolve: (v: unknown) => void) => {
        resolve({ data: null, error: null });
      };
      return query;
    }),
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: opts.user ?? null },
      })),
    },
  };

  return { client, calls, tables };
}

beforeEach(() => {
  getSupabaseMock.mockReset();
  isSupabaseConfiguredMock.mockReturnValue(true);
});

describe('listCommunityListings — kind filter on the favorites path (d93449c regression)', () => {
  it('when kind="canvas" + favoriteUserId, only canvas listings are returned', async () => {
    const canvasA = buildListingRow({ id: 'c1', kind: 'canvas', created_at: '2026-01-02T00:00:00Z' });
    const canvasB = buildListingRow({ id: 'c2', kind: 'canvas', created_at: '2026-01-01T00:00:00Z' });
    const personaA = buildListingRow({
      id: 'p1',
      kind: 'persona',
      payload: { ...buildPayload(), kind: 'persona', template: null },
      created_at: '2026-01-03T00:00:00Z',
    });
    const personaB = buildListingRow({
      id: 'p2',
      kind: 'persona',
      payload: { ...buildPayload(), kind: 'persona', template: null },
      created_at: '2026-01-04T00:00:00Z',
    });

    const mock = makeSupabaseMock({
      favorites: [
        { listing_id: 'c1', user_id: 'me', created_at: '2026-02-01T00:00:00Z' },
        { listing_id: 'c2', user_id: 'me', created_at: '2026-02-02T00:00:00Z' },
        { listing_id: 'p1', user_id: 'me', created_at: '2026-02-03T00:00:00Z' },
        { listing_id: 'p2', user_id: 'me', created_at: '2026-02-04T00:00:00Z' },
      ],
      listings: [canvasA, canvasB, personaA, personaB],
    });
    getSupabaseMock.mockReturnValue(mock.client);

    const rows = await svc.listCommunityListings({ kind: 'canvas', favoriteUserId: 'me' });

    expect(rows.map((r) => r.id).sort()).toEqual(['c1', 'c2']);
    expect(rows.every((r) => r.kind === 'canvas')).toBe(true);
  });

  it('when kind="persona" + favoriteUserId, only persona listings are returned', async () => {
    const canvasA = buildListingRow({ id: 'c1', kind: 'canvas' });
    const personaA = buildListingRow({
      id: 'p1',
      kind: 'persona',
      payload: { ...buildPayload(), kind: 'persona', template: null },
    });
    const personaB = buildListingRow({
      id: 'p2',
      kind: 'persona',
      payload: { ...buildPayload(), kind: 'persona', template: null },
    });

    const mock = makeSupabaseMock({
      favorites: [
        { listing_id: 'c1', user_id: 'me', created_at: '2026-02-01T00:00:00Z' },
        { listing_id: 'p1', user_id: 'me', created_at: '2026-02-02T00:00:00Z' },
        { listing_id: 'p2', user_id: 'me', created_at: '2026-02-03T00:00:00Z' },
      ],
      listings: [canvasA, personaA, personaB],
    });
    getSupabaseMock.mockReturnValue(mock.client);

    const rows = await svc.listCommunityListings({ kind: 'persona', favoriteUserId: 'me' });

    expect(rows.map((r) => r.id).sort()).toEqual(['p1', 'p2']);
    expect(rows.every((r) => r.kind === 'persona')).toBe(true);
  });

  it('when kind is omitted + favoriteUserId, both kinds are returned', async () => {
    const canvasA = buildListingRow({ id: 'c1', kind: 'canvas' });
    const personaA = buildListingRow({
      id: 'p1',
      kind: 'persona',
      payload: { ...buildPayload(), kind: 'persona', template: null },
    });
    const mock = makeSupabaseMock({
      favorites: [
        { listing_id: 'c1', user_id: 'me', created_at: '2026-02-01T00:00:00Z' },
        { listing_id: 'p1', user_id: 'me', created_at: '2026-02-02T00:00:00Z' },
      ],
      listings: [canvasA, personaA],
    });
    getSupabaseMock.mockReturnValue(mock.client);

    const rows = await svc.listCommunityListings({ favoriteUserId: 'me' });

    expect(rows.map((r) => r.id).sort()).toEqual(['c1', 'p1']);
  });

  it('when kind="all" + favoriteUserId, both kinds are returned (no scope)', async () => {
    const canvasA = buildListingRow({ id: 'c1', kind: 'canvas' });
    const personaA = buildListingRow({
      id: 'p1',
      kind: 'persona',
      payload: { ...buildPayload(), kind: 'persona', template: null },
    });
    const mock = makeSupabaseMock({
      favorites: [
        { listing_id: 'c1', user_id: 'me', created_at: '2026-02-01T00:00:00Z' },
        { listing_id: 'p1', user_id: 'me', created_at: '2026-02-02T00:00:00Z' },
      ],
      listings: [canvasA, personaA],
    });
    getSupabaseMock.mockReturnValue(mock.client);

    const rows = await svc.listCommunityListings({ kind: 'all', favoriteUserId: 'me' });

    expect(rows.map((r) => r.id).sort()).toEqual(['c1', 'p1']);
  });

  it('favorite path returns [] when the user has no favorites', async () => {
    const mock = makeSupabaseMock({
      favorites: [],
      listings: [buildListingRow()],
    });
    getSupabaseMock.mockReturnValue(mock.client);

    const rows = await svc.listCommunityListings({ kind: 'canvas', favoriteUserId: 'me' });

    expect(rows).toEqual([]);
    // We must NOT have queried the listings table on the empty path.
    expect(mock.calls.filter((c) => c.table === 'community_listings')).toHaveLength(0);
  });
});

describe('listCommunityListings — non-favorite path', () => {
  it('passes eq("kind", "canvas") through to supabase when kind is set', async () => {
    const mock = makeSupabaseMock({
      listings: [buildListingRow({ id: 'c1', kind: 'canvas' })],
    });
    getSupabaseMock.mockReturnValue(mock.client);

    const rows = await svc.listCommunityListings({ kind: 'canvas' });

    expect(rows.map((r) => r.id)).toEqual(['c1']);
    const calls = mock.calls.filter((c) => c.table === 'community_listings');
    expect(calls.length).toBeGreaterThan(0);
    // Verify the eq() filter was applied with kind='canvas'.
    const eqCall = calls.find((c) => c.method === 'then');
    const filters = (eqCall?.args[0] ?? []) as Array<{ col: string; op: string; val: unknown }>;
    expect(filters.some((f) => f.col === 'kind' && f.op === 'eq' && f.val === 'canvas')).toBe(true);
  });

  it('does not add a kind filter when kind is omitted', async () => {
    const mock = makeSupabaseMock({
      listings: [
        buildListingRow({ id: 'c1', kind: 'canvas' }),
        buildListingRow({ id: 'p1', kind: 'persona', payload: { ...buildPayload(), kind: 'persona', template: null } }),
      ],
    });
    getSupabaseMock.mockReturnValue(mock.client);

    const rows = await svc.listCommunityListings({});

    expect(rows.map((r) => r.id).sort()).toEqual(['c1', 'p1']);
    const eqCall = mock.calls.find((c) => c.method === 'then');
    const filters = (eqCall?.args[0] ?? []) as Array<{ col: string; op: string; val: unknown }>;
    expect(filters.some((f) => f.col === 'kind')).toBe(false);
  });
});

describe('listCommunityListings — viewer state (attachViewerState)', () => {
  it('short-circuits and does not query likes/favorites when userId is null', async () => {
    const mock = makeSupabaseMock({
      listings: [buildListingRow({ id: 'c1' })],
      likes: [{ listing_id: 'c1', user_id: 'someone-else' }],
      favorites: [{ listing_id: 'c1', user_id: 'someone-else', created_at: '2026-01-01T00:00:00Z' }],
    });
    getSupabaseMock.mockReturnValue(mock.client);

    const rows = await svc.listCommunityListings({ userId: null });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.liked).toBeUndefined();
    expect(rows[0]?.favorited).toBeUndefined();
    expect(mock.calls.filter((c) => c.table === 'community_likes')).toHaveLength(0);
    expect(mock.calls.filter((c) => c.table === 'community_favorites')).toHaveLength(0);
  });

  it('annotates liked/favorited from community_likes/community_favorites', async () => {
    const mock = makeSupabaseMock({
      listings: [
        buildListingRow({ id: 'c1', like_count: 2, favorite_count: 1 }),
        buildListingRow({ id: 'c2', like_count: 5 }),
      ],
      likes: [{ listing_id: 'c1', user_id: SESSION_USER_ID }],
      favorites: [{ listing_id: 'c1', user_id: SESSION_USER_ID, created_at: '2026-01-01T00:00:00Z' }],
    });
    getSupabaseMock.mockReturnValue(mock.client);

    const rows = await svc.listCommunityListings({ userId: SESSION_USER_ID });

    const c1 = rows.find((r) => r.id === 'c1')!;
    const c2 = rows.find((r) => r.id === 'c2')!;
    expect(c1.liked).toBe(true);
    expect(c1.favorited).toBe(true);
    expect(c2.liked).toBe(false);
    expect(c2.favorited).toBe(false);
  });
});

describe('addCommunityComment — auth gate', () => {
  it('throws "not_signed_in" when auth.getUser returns no user', async () => {
    const mock = makeSupabaseMock({ user: null });
    getSupabaseMock.mockReturnValue(mock.client);

    await expect(svc.addCommunityComment('listing-1', 'hi')).rejects.toThrow('not_signed_in');

    // We must NOT have attempted to insert when unauthenticated.
    const commentCalls = mock.calls.filter((c) => c.table === 'community_comments');
    expect(commentCalls).toHaveLength(0);
  });

  it('inserts a comment row when a user is signed in', async () => {
    const mock = makeSupabaseMock({ user: { id: SESSION_USER_ID } });
    getSupabaseMock.mockReturnValue(mock.client);

    const inserted = await svc.addCommunityComment('listing-1', '  hello world  ');

    expect(inserted.listing_id).toBe('listing-1');
    expect(inserted.user_id).toBe(SESSION_USER_ID);
    // Service trims body before insert.
    expect(mock.tables.community_comments.rows[0]).toMatchObject({
      listing_id: 'listing-1',
      user_id: SESSION_USER_ID,
      body: 'hello world',
    });
  });
});

describe('publishCommunityListing — auth gate', () => {
  it('throws "not_signed_in" when auth.getUser returns no user', async () => {
    const mock = makeSupabaseMock({ user: null });
    getSupabaseMock.mockReturnValue(mock.client);

    await expect(
      svc.publishCommunityListing({
        kind: 'canvas',
        title: 'A title',
        description: 'desc',
        payload: buildPayload(),
        coverUrl: null,
      }),
    ).rejects.toThrow('not_signed_in');

    expect(mock.calls.filter((c) => c.table === 'community_listings')).toHaveLength(0);
  });

  it('returns a mapped CommunityListing when signed in', async () => {
    const mock = makeSupabaseMock({ user: { id: SESSION_USER_ID } });
    getSupabaseMock.mockReturnValue(mock.client);

    const result = await svc.publishCommunityListing({
      kind: 'canvas',
      title: 'My template',
      description: 'A cool template',
      payload: buildPayload(),
      coverUrl: null,
    });

    expect(result.id).toBeTruthy();
    expect(result.title).toBe('My template');
    expect(result.description).toBe('A cool template');
    expect(result.kind).toBe('canvas');
    expect(result.like_count).toBe(0);
  });
});

describe('toggleCommunityLike', () => {
  it('inserts a like when the listing is not yet liked', async () => {
    const mock = makeSupabaseMock();
    getSupabaseMock.mockReturnValue(mock.client);

    const listing: CommunityListing = {
      id: 'l1',
      author_id: 'a',
      author_name: 'A',
      kind: 'canvas',
      title: 't',
      description: 'd',
      cover_url: null,
      payload: buildPayload(),
      published: true,
      like_count: 3,
      favorite_count: 0,
      comment_count: 0,
      apply_count: 0,
      created_at: '2026-01-01T00:00:00Z',
    };

    const next = await svc.toggleCommunityLike(listing, SESSION_USER_ID);

    expect(next.liked).toBe(true);
    expect(next.like_count).toBe(4);
    const insertCall = mock.calls.find((c) => c.table === 'community_likes');
    expect(insertCall).toBeTruthy();
  });

  it('removes the like when the listing is already liked', async () => {
    const mock = makeSupabaseMock();
    getSupabaseMock.mockReturnValue(mock.client);

    const listing: CommunityListing = {
      id: 'l1',
      author_id: 'a',
      author_name: 'A',
      kind: 'canvas',
      title: 't',
      description: 'd',
      cover_url: null,
      payload: buildPayload(),
      published: true,
      like_count: 3,
      favorite_count: 0,
      comment_count: 0,
      apply_count: 0,
      created_at: '2026-01-01T00:00:00Z',
      liked: true,
    };

    const next = await svc.toggleCommunityLike(listing, SESSION_USER_ID);

    expect(next.liked).toBe(false);
    expect(next.like_count).toBe(2);
  });

  it('clamps like_count to 0 when already 0 and the user unlikes (defensive)', async () => {
    const mock = makeSupabaseMock();
    getSupabaseMock.mockReturnValue(mock.client);

    const listing: CommunityListing = {
      id: 'l1',
      author_id: 'a',
      author_name: 'A',
      kind: 'canvas',
      title: 't',
      description: 'd',
      cover_url: null,
      payload: buildPayload(),
      published: true,
      like_count: 0,
      favorite_count: 0,
      comment_count: 0,
      apply_count: 0,
      created_at: '2026-01-01T00:00:00Z',
      liked: true,
    };

    const next = await svc.toggleCommunityLike(listing, SESSION_USER_ID);

    expect(next.like_count).toBe(0);
    expect(next.liked).toBe(false);
  });
});

describe('toggleCommunityFavorite', () => {
  it('inserts a favorite row when not yet favorited', async () => {
    const mock = makeSupabaseMock();
    getSupabaseMock.mockReturnValue(mock.client);

    const listing: CommunityListing = {
      id: 'l1',
      author_id: 'a',
      author_name: 'A',
      kind: 'canvas',
      title: 't',
      description: 'd',
      cover_url: null,
      payload: buildPayload(),
      published: true,
      like_count: 0,
      favorite_count: 0,
      comment_count: 0,
      apply_count: 0,
      created_at: '2026-01-01T00:00:00Z',
    };

    const next = await svc.toggleCommunityFavorite(listing, SESSION_USER_ID);

    expect(next.favorited).toBe(true);
    expect(next.favorite_count).toBe(1);
  });

  it('removes the favorite when already favorited', async () => {
    const mock = makeSupabaseMock();
    getSupabaseMock.mockReturnValue(mock.client);

    const listing: CommunityListing = {
      id: 'l1',
      author_id: 'a',
      author_name: 'A',
      kind: 'canvas',
      title: 't',
      description: 'd',
      cover_url: null,
      payload: buildPayload(),
      published: true,
      like_count: 0,
      favorite_count: 2,
      comment_count: 0,
      apply_count: 0,
      created_at: '2026-01-01T00:00:00Z',
      favorited: true,
    };

    const next = await svc.toggleCommunityFavorite(listing, SESSION_USER_ID);

    expect(next.favorited).toBe(false);
    expect(next.favorite_count).toBe(1);
  });
});

describe('recordCommunityApply', () => {
  it('calls the community_record_apply rpc and swallows rpc errors', async () => {
    const mock = makeSupabaseMock();
    // Override rpc to return an error to verify the service swallows it.
    mock.client.rpc.mockImplementation(() => {
      const q: any = {};
      q.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: { message: 'boom' } });
      return q;
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    getSupabaseMock.mockReturnValue(mock.client);

    await expect(svc.recordCommunityApply('listing-1')).resolves.toBeUndefined();
    expect(mock.client.rpc).toHaveBeenCalledWith('community_record_apply', { listing: 'listing-1' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('deleteCommunityListing / getCommunityListing', () => {
  it('getCommunityListing maps a single row and attaches viewer state', async () => {
    const mock = makeSupabaseMock({
      listings: [buildListingRow({ id: 'l1' })],
      likes: [{ listing_id: 'l1', user_id: SESSION_USER_ID }],
      favorites: [{ listing_id: 'l1', user_id: SESSION_USER_ID, created_at: '2026-01-01T00:00:00Z' }],
    });
    getSupabaseMock.mockReturnValue(mock.client);

    const row = await svc.getCommunityListing('l1', SESSION_USER_ID);

    expect(row?.id).toBe('l1');
    expect(row?.liked).toBe(true);
    expect(row?.favorited).toBe(true);
  });

  it('getCommunityListing returns null when the row does not exist', async () => {
    const mock = makeSupabaseMock({ listings: [] });
    getSupabaseMock.mockReturnValue(mock.client);

    const row = await svc.getCommunityListing('missing', SESSION_USER_ID);
    expect(row).toBeNull();
  });

  it('deleteCommunityListing issues a delete with the id', async () => {
    const mock = makeSupabaseMock();
    getSupabaseMock.mockReturnValue(mock.client);

    await svc.deleteCommunityListing('l1');

    const deleteCall = mock.calls.find((c) => c.table === 'community_listings');
    expect(deleteCall).toBeTruthy();
  });
});