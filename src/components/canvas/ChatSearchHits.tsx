import { useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, GripVertical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  isChatVisibleSearchHit,
  mergeAskSearchHits,
  searchHitHostname,
  type AskSearchHit,
} from '../../utils/askSearchHits';

export function ChatSearchHits({
  hits,
  onExcerptHit,
  onDropHitAt,
  dragHitLabel,
}: {
  hits: AskSearchHit[];
  onExcerptHit?: (hit: AskSearchHit) => void;
  onDropHitAt?: (hit: AskSearchHit, clientX: number, clientY: number) => void;
  dragHitLabel?: string;
}) {
  const { t } = useTranslation();
  const dragLabel =
    dragHitLabel ?? t('canvas.v2.drag_search_hit_to_canvas', { defaultValue: 'Drag this source onto the canvas' });
  const visible = mergeAskSearchHits([], hits).filter(isChatVisibleSearchHit);
  const [dragGhost, setDragGhost] = useState<{ x: number; y: number; hit: AskSearchHit } | null>(
    null,
  );
  if (visible.length === 0) return null;

  const images = visible.filter((h) => h.kind === 'image' && h.imageUrl);
  const rest = visible.filter((h) => h.kind !== 'image');
  const canPlace = Boolean(onExcerptHit);

  const beginHitDrag = (hit: AskSearchHit, originX: number, originY: number) => {
    if (!onDropHitAt) return;
    let armed = false;
    const onMove = (move: PointerEvent) => {
      const dx = move.clientX - originX;
      const dy = move.clientY - originY;
      if (!armed) {
        if (dx * dx + dy * dy < 16) return;
        armed = true;
      }
      setDragGhost({ x: move.clientX, y: move.clientY, hit });
    };
    const onUp = (up: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setDragGhost(null);
      if (!armed) return;
      onDropHitAt(hit, up.clientX, up.clientY);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  return (
    <div className="mt-2 w-full min-w-[16rem] self-stretch space-y-2" data-testid="chat-search-hits">
      <p className="px-0.5 text-[11px] tracking-[0.08em] text-[#aaa]">
        {t('canvas.v2.search_sources', { defaultValue: 'Sources' })}
      </p>
      {images.length > 0 ? (
        <div className="grid grid-cols-3 gap-1.5">
          {images.map((hit, i) => (
            <SearchHitTile
              key={hit.link || hit.imageUrl || `${hit.title}-${i}`}
              hit={hit}
              canPlace={canPlace}
              onExcerptHit={onExcerptHit}
              onBeginDrag={onDropHitAt ? beginHitDrag : undefined}
              dragLabel={dragLabel}
            >
              <SearchHitImage
                src={hit.imageUrl!}
                alt={hit.title || t('canvas.v2.search_kind_image')}
                className="h-16 w-full rounded-lg object-cover"
                fallback={
                  <span className="flex h-16 w-full items-center justify-center rounded-lg bg-[#f5f4f0] px-1 text-center text-[10px] leading-snug tracking-[0.02em] text-[#8a8a82]">
                    {(hit.title || searchHitHostname(hit.link)).slice(0, 40)}
                  </span>
                }
              />
            </SearchHitTile>
          ))}
        </div>
      ) : null}
      {rest.length > 0 ? (
        <ul className="space-y-1.5">
          {rest.map((hit, i) => {
            const host = searchHitHostname(hit.link);
            return (
              <li key={hit.link || `${hit.kind}-${hit.title}-${i}`}>
                <SearchHitRow
                  hit={hit}
                  canPlace={canPlace}
                  onExcerptHit={onExcerptHit}
                  onBeginDrag={onDropHitAt ? beginHitDrag : undefined}
                  dragLabel={dragLabel}
                >
                  <span className="flex items-center gap-2 rounded-xl border border-[#E6E4DF] bg-white px-2.5 py-2">
                    {hit.imageUrl ? (
                      <SearchHitImage
                        src={hit.imageUrl}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-md object-cover"
                      />
                    ) : null}
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-[13px] leading-snug tracking-[0.02em] text-[#2c2c28]">
                        {hit.title || host || hit.link}
                      </span>
                      {hit.date ? (
                        <span className="mt-0.5 block truncate text-[11px] tracking-[0.02em] text-[#8a8a82]">
                          {hit.date}
                        </span>
                      ) : null}
                    </span>
                    <SearchHitOpenLink hit={hit} />
                  </span>
                </SearchHitRow>
              </li>
            );
          })}
        </ul>
      ) : null}
      {dragGhost
        ? createPortal(
            <div
              aria-hidden
              className="pointer-events-none fixed z-[80] max-w-xs rounded-2xl border border-[#C2410C]/40 bg-white px-3 py-2 text-xs leading-relaxed text-[#2c2c28] shadow-lg"
              style={{
                left: dragGhost.x,
                top: dragGhost.y,
                transform: 'translate(-8px, -8px)',
              }}
            >
              {dragGhost.hit.imageUrl ? (
                <SearchHitImage
                  src={dragGhost.hit.imageUrl}
                  alt=""
                  className="max-h-24 max-w-[12rem] rounded-lg object-cover"
                />
              ) : (
                (dragGhost.hit.title || dragGhost.hit.link || '').slice(0, 80)
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function SearchHitRow({
  hit,
  children,
  canPlace,
  onExcerptHit,
  onBeginDrag,
  dragLabel,
}: {
  hit: AskSearchHit;
  children: ReactNode;
  canPlace: boolean;
  onExcerptHit?: (hit: AskSearchHit) => void;
  onBeginDrag?: (hit: AskSearchHit, originX: number, originY: number) => void;
  dragLabel: string;
}) {
  return (
    <div className="flex items-stretch gap-1">
      {onBeginDrag ? (
        <DragHandle
          label={dragLabel}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            onBeginDrag(hit, e.clientX, e.clientY);
          }}
        />
      ) : null}
      <div className="min-w-0 flex-1">{children}</div>
      {canPlace && onExcerptHit ? (
        <ExcerptHitButton hit={hit} onExcerptHit={onExcerptHit} />
      ) : null}
    </div>
  );
}

function SearchHitOpenLink({ hit }: { hit: AskSearchHit }) {
  const { t } = useTranslation();
  const href = (hit.link || hit.imageUrl || '').trim();
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="chat-search-hit-open"
      aria-label={t('canvas.v2.search_hit_open_link', { defaultValue: 'Open link' })}
      title={t('canvas.v2.search_hit_open_link', { defaultValue: 'Open link' })}
      className="shrink-0 self-center text-[#8a8a82] transition-colors hover:text-[#C2410C]"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
    </a>
  );
}

function SearchHitTile({
  hit,
  children,
  canPlace,
  onExcerptHit,
  onBeginDrag,
  dragLabel,
}: {
  hit: AskSearchHit;
  children: ReactNode;
  canPlace: boolean;
  onExcerptHit?: (hit: AskSearchHit) => void;
  onBeginDrag?: (hit: AskSearchHit, originX: number, originY: number) => void;
  dragLabel: string;
}) {
  return (
    <div className="relative">
      {onBeginDrag ? (
        <DragHandle
          label={dragLabel}
          className="absolute left-0.5 top-0.5 z-10 bg-white/90"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            onBeginDrag(hit, e.clientX, e.clientY);
          }}
        />
      ) : null}
      <SearchHitLink hit={hit}>{children}</SearchHitLink>
      {canPlace && onExcerptHit ? (
        <ExcerptHitButton
          hit={hit}
          onExcerptHit={onExcerptHit}
          className="absolute bottom-0.5 right-0.5 z-10"
        />
      ) : null}
    </div>
  );
}

function ExcerptHitButton({
  hit,
  onExcerptHit,
  className = '',
}: {
  hit: AskSearchHit;
  onExcerptHit: (hit: AskSearchHit) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      data-testid="chat-search-hit-excerpt"
      className={`shrink-0 self-center rounded-lg border border-[#E6E4DF] bg-white px-1.5 py-1 text-[10px] tracking-[0.04em] text-[#C2410C] hover:border-[#C2410C]/40 ${className}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onExcerptHit(hit);
      }}
    >
      {t('canvas.v2.excerpt_selection', { defaultValue: '摘录' })}
    </button>
  );
}

function DragHandle({
  label,
  onPointerDown,
  className = '',
}: {
  label: string;
  onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={`flex h-auto w-5 shrink-0 cursor-grab items-center justify-center rounded-md text-[#c4c0b6] hover:bg-[#C2410C]/10 hover:text-[#C2410C] active:cursor-grabbing ${className}`}
      onPointerDown={onPointerDown}
    >
      <GripVertical className="h-3 w-3" />
    </button>
  );
}

function SearchHitImage({
  src,
  alt,
  className,
  fallback = null,
}: {
  src: string;
  alt: string;
  className: string;
  fallback?: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return fallback;
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

function SearchHitLink({
  hit,
  children,
  className = 'block',
}: {
  hit: AskSearchHit;
  children: ReactNode;
  className?: string;
}) {
  const href = (hit.link || hit.imageUrl || '').trim();
  if (!href) {
    return <div className={className}>{children}</div>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {children}
    </a>
  );
}
