/**
 * Community gallery on the public site: browse / apply canvas templates
 * (personas travel with the canvas). Likes, favorites, and comments
 * require a signed-in account.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Bookmark, Heart, Loader2, MessageCircle, Sparkles } from 'lucide-react';
import logoUrl from '../../LOGO.png';
import { useAuth } from '../contexts/AuthContext';
import { useAppEntryGate } from '../contexts/AppEntryGateContext';
import {
  addCommunityComment,
  deleteCommunityComment,
  deleteCommunityListing,
  getCommunityListing,
  listCommunityComments,
  listCommunityListings,
  recordCommunityApply,
  toggleCommunityFavorite,
  toggleCommunityLike,
  type CommunityComment,
  type CommunityListing,
} from '../services/community';
import { applyCommunityListing } from '../utils/applyCommunityListing';
import {
  builtinOfficialCommunityListings,
  localizeOfficialListing,
} from '../constants/officialCommunityListings';
import { isSupabaseConfigured } from '../lib/supabase';
import {
  GUIDES_PATH,
  communityListingId,
  navigateToCommunity,
  navigateToLanding,
} from '../utils/appRoute';
import { MarketingNavLink } from './MarketingNavLink';
import { useDocumentSeo } from '../hooks/useDocumentSeo';
import { useAppDialog } from './AppDialogProvider';
import { MarketingFooter } from './MarketingFooter';
import '../landing.css';
import './landing.community.css';
import './policy-modal.css';

type Filter = 'all' | 'favorites' | 'mine';
type CardVariant = 'polaroid' | 'note' | 'quote' | 'persona';
type Tilt = 'cm-card--tilt-l' | 'cm-card--tilt-r' | 'cm-card--tilt-h';

const TILTS: Tilt[] = ['cm-card--tilt-l', 'cm-card--tilt-r', 'cm-card--tilt-h', 'cm-card--tilt-l', 'cm-card--tilt-r'];

// Module-level cache of the most recent 'all' filter listings, keyed by user
// id (or 'anon'). Lets us render the gallery instantly on revisits instead of
// showing the spinner while Supabase fetches; a background refresh keeps the
// data fresh. Favorites/mine are user-specific and small — always fetched
// with a spinner.
const STALE_AFTER_MS = 30_000;
interface CacheEntry {
  data: CommunityListing[];
  ts: number;
}
const allListingsCache = new Map<string, CacheEntry>();
function readAllCache(userId: string | null): CacheEntry | undefined {
  return allListingsCache.get(userId ?? 'anon');
}
function writeAllCache(userId: string | null, data: CommunityListing[]): void {
  allListingsCache.set(userId ?? 'anon', { data, ts: Date.now() });
}

type CommunityPageProps = {
  pathname: string;
};

export function CommunityPage({ pathname }: CommunityPageProps) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { enterApp } = useAppEntryGate();
  const { alert: appAlert, confirm } = useAppDialog();
  const listingId = communityListingId(pathname);
  const isZh = i18n.language?.startsWith('zh') ?? false;

  const [filter, setFilter] = useState<Filter>('all');
  // Seed from the module-level cache so revisits render the gallery without a
  // "正在加载..." flash. The cache only applies to the default 'all' filter;
  // favorites/mine are user-specific and small — fetched with a spinner.
  const [listings, setListings] = useState<CommunityListing[]>(() => {
    if (!isSupabaseConfigured()) return builtinOfficialCommunityListings();
    return readAllCache(user?.id ?? null)?.data ?? [];
  });
  const [detail, setDetail] = useState<CommunityListing | null>(null);
  const [comments, setComments] = useState<CommunityComment[]>([]);
  const [loading, setLoading] = useState<boolean>(() => {
    if (!isSupabaseConfigured()) return false;
    return readAllCache(user?.id ?? null) === undefined;
  });
  const [busy, setBusy] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const pendingAfterAuth = useRef<(() => void) | null>(null);
  const userRef = useRef(user);
  userRef.current = user;
  // Tracks the filter currently rendered so background refreshes can detect
  // when the user has switched tabs and shouldn't paint their result.
  const filterRef = useRef(filter);
  useEffect(() => {
    filterRef.current = filter;
  }, [filter]);

  const configured = isSupabaseConfigured();

  useEffect(() => {
    if (!user) return;
    const pending = pendingAfterAuth.current;
    if (!pending) return;
    pendingAfterAuth.current = null;
    pending();
  }, [user]);

  const fetchAndStore = useCallback(async (filterArg: Filter, userId: string | null) => {
    const rows = await listCommunityListings({
      kind: 'canvas',
      authorId: filterArg === 'mine' ? (userId ?? undefined) : undefined,
      favoriteUserId: filterArg === 'favorites' ? (userId ?? undefined) : undefined,
      userId,
    });
    if (filterArg === 'all') writeAllCache(userId, rows);
    return rows;
  }, []);

  const loadList = useCallback(async () => {
    if (!configured) {
      setListings(builtinOfficialCommunityListings());
      setLoading(false);
      return;
    }
    const userId = user?.id ?? null;

    // Cache applies only to the default 'all' view.
    if (filter === 'all') {
      const cached = readAllCache(userId);
      if (cached) {
        setListings(cached.data);
        setLoading(false);
        // Stale-while-revalidate: refresh silently in the background if the
        // cache is older than STALE_AFTER_MS.
        if (Date.now() - cached.ts > STALE_AFTER_MS) {
          fetchAndStore('all', userId)
            .then((rows) => {
              if (filterRef.current === 'all') setListings(rows);
            })
            .catch(() => {
              /* swallow — keep stale cache */
            });
        }
        return;
      }
    }

    setLoading(true);
    setError(null);
    try {
      const rows = await fetchAndStore(filter, userId);
      setListings(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setListings([]);
    } finally {
      setLoading(false);
    }
  }, [configured, filter, user?.id, fetchAndStore]);

  const loadDetail = useCallback(async () => {
    if (!configured) {
      const local = listingId
        ? builtinOfficialCommunityListings().find((row) => row.id === listingId) ?? null
        : null;
      setDetail(local);
      setComments([]);
      setLoading(false);
      return;
    }
    if (!listingId) {
      setDetail(null);
      setComments([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const row = await getCommunityListing(listingId, user?.id ?? null);
      setDetail(row);
      setComments(row ? await listCommunityComments(row.id) : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [configured, listingId, user?.id]);

  useEffect(() => {
    if (listingId) void loadDetail();
    else void loadList();
  }, [listingId, loadDetail, loadList]);

  useEffect(() => {
    if (!user && filter !== 'all') setFilter('all');
  }, [user, filter]);

  const localizedListings = useMemo(
    () => listings.map((listing) => localizeOfficialListing(listing)),
    [listings, i18n.language],
  );

  const localizedDetail = useMemo(
    () => (detail ? localizeOfficialListing(detail) : null),
    [detail, i18n.language],
  );

  useDocumentSeo(pathname, {
    listingTitle: localizedDetail?.title,
    listingDescription: localizedDetail?.description,
  });

  const askSignIn = (_then: () => void) => {
    /* Cloud accounts are not part of the open-source build. */
  };

  const onApply = async (listing: CommunityListing) => {
    setBusy(true);
    try {
      await applyCommunityListing(listing);
      if (user) void recordCommunityApply(listing.id);
      enterApp();
    } catch (e) {
      await appAlert({
        title: t('community.error_title'),
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const onLike = async (listing: CommunityListing) => {
    const uid = userRef.current?.id;
    if (!uid) {
      askSignIn(() => void onLike(listing));
      return;
    }
    const next = await toggleCommunityLike(listing, uid);
    if (detail?.id === listing.id) setDetail(next);
    setListings((rows) => rows.map((r) => (r.id === next.id ? next : r)));
  };

  const onFavorite = async (listing: CommunityListing) => {
    const uid = userRef.current?.id;
    if (!uid) {
      askSignIn(() => void onFavorite(listing));
      return;
    }
    const next = await toggleCommunityFavorite(listing, uid);
    if (detail?.id === listing.id) setDetail(next);
    setListings((rows) => rows.map((r) => (r.id === next.id ? next : r)));
  };

  const onComment = async () => {
    if (!detail) return;
    if (!userRef.current) {
      askSignIn(() => void onComment());
      return;
    }
    const body = commentBody.trim();
    if (!body) return;
    setBusy(true);
    try {
      const created = await addCommunityComment(detail.id, body);
      setComments((rows) => [...rows, created]);
      setDetail({ ...detail, comment_count: detail.comment_count + 1 });
      setCommentBody('');
    } catch (e) {
      await appAlert({
        title: t('community.error_title'),
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const onDeleteListing = async (listing: CommunityListing) => {
    const ok = await confirm({
      title: t('community.delete_title'),
      message: t('community.delete_body'),
      variant: 'danger',
    });
    if (!ok) return;
    await deleteCommunityListing(listing.id);
    navigateToCommunity();
  };

  const filters: Filter[] = useMemo(
    () => (user ? ['all', 'favorites', 'mine'] : []),
    [user],
  );

  return (
    <div className="spoor-landing spoor-community flex flex-col" data-community>
      <header className="cm-topbar">
        <button type="button" className="cm-nav__brand" onClick={navigateToLanding}>
          <img src={logoUrl} alt="" />
          Spoor
        </button>
        <nav className="cm-nav__links">
          <MarketingNavLink href={GUIDES_PATH} className="cm-nav__link">
            {t('landing.nav_guides')}
          </MarketingNavLink>
          <button type="button" className="cm-nav__link is-active">
            {t('landing.nav_community')}
          </button>
          <button
            type="button"
            onClick={() => void i18n.changeLanguage(isZh ? 'en' : 'zh')}
            className="cm-nav__link"
          >
            {isZh ? 'EN' : '中文'}
          </button>
          <button type="button" className="lp-pricing-mini-cta" onClick={enterApp}>
            {t('pricing.cta_enter')}
          </button>
        </nav>
      </header>

      <main className="flex-grow pt-24 md:pt-28 pb-16 relative max-w-[1280px] mx-auto w-full px-6 md:px-10">
        {listingId ? null : (
          <header className="cm-hero">
            <h1>{t('community.title')}</h1>
            <p>{t('community.lede')}</p>
          </header>
        )}

        {error ? <p className="text-sm text-red-600 mb-4">{error}</p> : null}

        {listingId ? (
          <DetailView
            loading={loading}
            busy={busy}
            listing={localizedDetail}
            comments={comments}
            commentBody={commentBody}
            setCommentBody={setCommentBody}
            currentUserId={user?.id ?? null}
            onBack={() => navigateToCommunity()}
            onApply={() => detail && void onApply(detail)}
            onLike={() => detail && void onLike(detail)}
            onFavorite={() => detail && void onFavorite(detail)}
            onComment={() => void onComment()}
            onDeleteComment={(id) => void deleteCommunityComment(id).then(() => setComments((rows) => rows.filter((c) => c.id !== id)))}
            onDeleteListing={() => detail && void onDeleteListing(detail)}
          />
        ) : (
          <>
            {filters.length > 0 ? (
              <div className="cm-tabs" role="tablist">
                {filters.map((key) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={filter === key}
                    className="cm-tab"
                    onClick={() => setFilter(key)}
                  >
                    {t(`community.filter_${key}`)}
                  </button>
                ))}
              </div>
            ) : null}
            {loading ? (
              <div className="flex items-center gap-2 text-[color:var(--lp-on-surface-variant)]">
                <Loader2 className="w-4 h-4 animate-spin" />
                {t('community.loading')}
              </div>
            ) : listings.length === 0 ? (
              <p className="cm-empty">{configured ? t('community.empty') : t('community.not_configured')}</p>
            ) : (
              <div className="cm-grid">
                {localizedListings.map((listing, index) => (
                  <ListingCard
                    key={listing.id}
                    listing={listing}
                    index={index}
                    busy={busy}
                    onOpen={() => navigateToCommunity(listing.id)}
                    onApply={() => void onApply(listing)}
                    onLike={() => void onLike(listing)}
                    onFavorite={() => void onFavorite(listing)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      <MarketingFooter />
    </div>
  );
}

function listingVariant(listing: CommunityListing, index: number): CardVariant {
  if (listing.cover_url) return 'polaroid';
  if (listing.description && index % 3 === 1) return 'quote';
  if (listing.description) return 'note';
  return 'persona';
}

function ListingCard({
  listing,
  index,
  busy,
  onOpen,
  onApply,
  onLike,
  onFavorite,
}: {
  listing: CommunityListing;
  index: number;
  busy: boolean;
  onOpen: () => void;
  onApply: () => void;
  onLike: () => void;
  onFavorite: () => void;
}) {
  const { t } = useTranslation();
  const variant = listingVariant(listing, index);
  const tilt = TILTS[index % TILTS.length];
  const portrait = index % 3 === 1;

  return (
    <article
      className={`cm-card cm-card--${variant} ${tilt}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      role="link"
      tabIndex={0}
    >
      {variant === 'polaroid' ? (
        <>
          {listing.cover_url ? (
            <img
              className={`cm-card__cover${portrait ? ' cm-card__cover--portrait' : ''}`}
              src={listing.cover_url}
              alt=""
            />
          ) : null}
          <div className="cm-card__body">
            <h2 className="cm-card__title">{listing.title}</h2>
            <p className="cm-card__lede line-clamp-3">
              {listing.description || t('community.no_description')}
            </p>
            <p className="cm-card__byline">
              {t('community.by_author', { name: listing.author_name })} · {t('community.applies', { count: listing.apply_count })}
            </p>
            <span className="cm-view">
              {t('community.view')} <ArrowRight className="w-3.5 h-3.5" />
            </span>
          </div>
        </>
      ) : null}

      {variant === 'quote' ? (
        <>
          <p className="cm-card__quote">“{listing.title}”</p>
          <p className="cm-card__lede line-clamp-4">{listing.description}</p>
          <div className="cm-card__meta">
            <span>{t('community.kind_canvas')}</span>
            <button
              type="button"
              className={`cm-ghost${listing.favorited ? ' is-on' : ''}`}
              aria-label={t('community.filter_favorites')}
              onClick={(e) => {
                e.stopPropagation();
                onFavorite();
              }}
            >
              <Bookmark className="w-4 h-4" />
            </button>
          </div>
        </>
      ) : null}

      {variant === 'note' ? (
        <>
          <div className="cm-kicker">
            <Sparkles className="w-4 h-4" />
            {t('community.kind_canvas')}
          </div>
          <h2 className="cm-card__title">{listing.title}</h2>
          <p className="cm-card__lede line-clamp-6">{listing.description}</p>
        </>
      ) : null}

      {variant === 'persona' ? (
        <>
          <div className="cm-icon-mark" aria-hidden>
            <Sparkles className="w-6 h-6" />
          </div>
          <h2 className="cm-card__title">{listing.title}</h2>
          <p className="cm-card__lede line-clamp-3">
            {listing.description || t('community.no_description')}
          </p>
        </>
      ) : null}

      {variant !== 'quote' ? (
        <div className="cm-card__actions" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="lp-pricing-mini-cta" disabled={busy} onClick={onApply}>
            {t('community.apply')}
          </button>
          <button
            type="button"
            className={`cm-ghost${listing.liked ? ' is-on' : ''}`}
            onClick={onLike}
          >
            <Heart className="w-3.5 h-3.5" /> {listing.like_count}
          </button>
          <button
            type="button"
            className={`cm-ghost${listing.favorited ? ' is-on' : ''}`}
            onClick={onFavorite}
          >
            <Bookmark className="w-3.5 h-3.5" /> {listing.favorite_count}
          </button>
        </div>
      ) : (
        <div className="cm-card__actions" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="lp-pricing-mini-cta" disabled={busy} onClick={onApply}>
            {t('community.apply')}
          </button>
        </div>
      )}
    </article>
  );
}

function DetailView({
  loading,
  busy,
  listing,
  comments,
  commentBody,
  setCommentBody,
  currentUserId,
  onBack,
  onApply,
  onLike,
  onFavorite,
  onComment,
  onDeleteComment,
  onDeleteListing,
}: {
  loading: boolean;
  busy: boolean;
  listing: CommunityListing | null;
  comments: CommunityComment[];
  commentBody: string;
  setCommentBody: (v: string) => void;
  currentUserId: string | null;
  onBack: () => void;
  onApply: () => void;
  onLike: () => void;
  onFavorite: () => void;
  onComment: () => void;
  onDeleteComment: (id: string) => void;
  onDeleteListing: () => void;
}) {
  const { t } = useTranslation();
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[color:var(--lp-on-surface-variant)]">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t('community.loading')}
      </div>
    );
  }
  if (!listing) {
    return (
      <div>
        <p className="cm-empty">{t('community.missing')}</p>
        <button type="button" className="cm-back mt-6" onClick={onBack}>
          {t('community.back')}
        </button>
      </div>
    );
  }

  const isOfficial = listing.is_official === true;

  return (
    <article>
      <button type="button" className="cm-back" onClick={onBack}>
        ← {t('community.back')}
      </button>
      <div className="cm-detail">
        {listing.cover_url ? (
          <div className="cm-detail__cover-wrap">
            <img className="cm-detail__cover" src={listing.cover_url} alt="" />
          </div>
        ) : (
          <div className="cm-detail__cover-wrap">
            <div className="cm-card__cover cm-card__cover--fallback">
              <Sparkles className="w-10 h-10" />
            </div>
          </div>
        )}
        <div>
          <h2>{listing.title}</h2>
          <p className="cm-detail__author">{t('community.by_author', { name: listing.author_name })}</p>
          <p className="cm-card__lede mt-4">
            {listing.description || t('community.no_description')}
          </p>
          <p className="cm-card__lede mt-3">{t('community.how_to_use')}</p>
          <div className="cm-card__actions">
            <button type="button" className="lp-pricing-mini-cta" disabled={busy} onClick={onApply}>
              {t('community.apply')}
            </button>
            <button type="button" className={`cm-ghost${listing.liked ? ' is-on' : ''}`} onClick={onLike}>
              <Heart className="w-4 h-4" /> {listing.like_count}
            </button>
            <button
              type="button"
              className={`cm-ghost${listing.favorited ? ' is-on' : ''}`}
              onClick={onFavorite}
            >
              <Bookmark className="w-4 h-4" /> {listing.favorite_count}
            </button>
            {currentUserId === listing.author_id && !isOfficial ? (
              <button type="button" className="cm-ghost text-red-600" onClick={onDeleteListing}>
                {t('community.delete')}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <section className="cm-comments">
        <h3>
          <MessageCircle className="w-5 h-5" />
          {t('community.comments', { count: comments.length })}
        </h3>
        <div>
          {comments.map((c) => (
            <div key={c.id} className="cm-comment">
              <div className="flex justify-between gap-3">
                <p className="text-xs font-semibold tracking-wide uppercase">{c.author_name}</p>
                {currentUserId === c.user_id ? (
                  <button type="button" className="text-xs text-red-600" onClick={() => onDeleteComment(c.id)}>
                    {t('community.delete')}
                  </button>
                ) : null}
              </div>
              <p className="text-sm mt-1 whitespace-pre-wrap">{c.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-col gap-2">
          <textarea
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder={t('community.comment_placeholder')}
          />
          <button type="button" className="lp-pricing-mini-cta self-start" disabled={busy || !commentBody.trim()} onClick={onComment}>
            {t('community.comment_submit')}
          </button>
        </div>
      </section>
    </article>
  );
}
