import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Download, ExternalLink, Loader2, RefreshCw, X } from 'lucide-react';
import type { ImageNodeProps } from './types';
import { MediaCardCaption } from './MediaCardCaption';
import { openExternalUrl } from '../../utils/openExternal';
import { useOverlayDismiss } from '../../hooks/useOverlayDismiss';
import {
  downloadImageUrl,
  illustrationDownloadFilename,
  isAiGeneratedImageNode,
} from '../../utils/aiGeneratedImage';
import { parseSearchMediaDescription } from '../../utils/webSearchMediaCaption';
import { useSearchImageDisplaySrc } from '../../services/searchImageSrc';
import { removeBrokenSearchImageCard } from '../../services/removeBrokenSearchImageCard';
import {
  GPT_IMAGE_TIMEOUT_MS,
  IMAGE_GEN_ERROR,
  IMAGE_GEN_SLOW_MS,
  formatImageGenerationError,
  formatImageWaited,
  imageGenerationStartedAt,
} from '../../utils/imageGenerationWait';

function asHttpUrl(raw: string | undefined): string {
  const s = (raw || '').trim();
  return /^https?:\/\//i.test(s) ? s : '';
}

function useElapsedMs(startedAt: number | undefined, enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled || startedAt == null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [enabled, startedAt]);
  if (!enabled || startedAt == null) return 0;
  return Math.max(0, now - startedAt);
}

function RetryButton({
  nodeId,
  onRetry,
  label,
}: {
  nodeId: string;
  onRetry?: (id: string) => void;
  label: string;
}) {
  if (!onRetry) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onRetry(nodeId);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      title={label}
      aria-label={label}
      data-testid="image-retry"
      className="shrink-0 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-sans font-medium text-[#C2410C] hover:bg-[#C2410C]/8 transition-colors"
    >
      <RefreshCw className="h-3 w-3" aria-hidden />
      <span>{label}</span>
    </button>
  );
}

export function ImageNode({ node, onRetry }: ImageNodeProps) {
  const { t } = useTranslation();
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [droppedBroken, setDroppedBroken] = useState(false);
  const closeLightbox = useCallback(() => setLightboxOpen(false), []);
  const { onBackdropMouseDown } = useOverlayDismiss(lightboxOpen, closeLightbox);
  const generated = isAiGeneratedImageNode(node);
  const isSearchCard = Boolean(node.webSearchParentId) || typeof node.webSearchIndex === 'number';
  const parsed = isSearchCard
    ? parseSearchMediaDescription(node.description)
    : { title: (node.description || '').trim(), relation: '' };
  const title = parsed.title;
  const relation = parsed.relation;
  const startedAt = imageGenerationStartedAt(node);
  const elapsedMs = useElapsedMs(startedAt, node.imageStatus === 'generating');
  const generatingTimedOut = node.imageStatus === 'generating' && elapsedMs >= GPT_IMAGE_TIMEOUT_MS;
  const generatingSlow = node.imageStatus === 'generating' && elapsedMs >= IMAGE_GEN_SLOW_MS;
  const href = generated ? '' : asHttpUrl(node.sourceUrl) || asHttpUrl(node.content);
  const downloadUrl = (node.content || '').trim();
  const proxySearchImage = isSearchCard && !generated && /^https?:\/\//i.test(downloadUrl);
  const displaySrc = useSearchImageDisplaySrc(downloadUrl, node.sourceUrl, proxySearchImage);

  const dropBrokenSearchCard = useCallback(() => {
    if (!isSearchCard || generated || droppedBroken) return;
    setDroppedBroken(true);
    setLightboxOpen(false);
    void removeBrokenSearchImageCard(node.id);
  }, [droppedBroken, generated, isSearchCard, node.id]);

  const retry = (
    <RetryButton nodeId={node.id} onRetry={onRetry} label={t('nodes.image_retry')} />
  );

  // Generation in flight: a ghost card holding the final slot, styled like the
  // link-note ghost so it reads as "not real yet". After the client timeout,
  // show the same failure chrome so the user can retry without waiting forever.
  if (node.imageStatus === 'generating' && !generatingTimedOut) {
    return (
      <div
        className="w-full h-full p-2 flex flex-col opacity-70 border-2 border-dashed border-[#C2410C]/55 bg-[#C2410C]/10"
        style={{ outline: '1px solid transparent' }}
        data-testid="image-generating"
      >
        <div className="w-full flex-1 min-h-0 rounded flex flex-col items-center justify-center gap-1.5 px-3 text-center border border-dashed border-[#C2410C]/40">
          <Loader2 className="h-5 w-5 animate-spin text-[#C2410C]" aria-hidden />
          <span className="text-[10px] font-sans font-medium text-[#C2410C]">
            {t('nodes.image_generating')}
          </span>
          {startedAt != null ? (
            <span className="text-[10px] font-sans text-[#C2410C]/70" data-testid="image-generating-waited">
              {formatImageWaited(elapsedMs, t)}
            </span>
          ) : null}
          {generatingSlow ? (
            <span className="text-[10px] font-sans text-[#C2410C]/80 leading-snug" data-testid="image-generating-slow">
              {t('nodes.image_generating_slow')}
            </span>
          ) : null}
        </div>
        <MediaCardCaption title={title} trailing={generatingSlow ? retry : undefined} />
      </div>
    );
  }

  if (node.imageStatus === 'error' || generatingTimedOut) {
    const errorText = formatImageGenerationError(
      generatingTimedOut ? IMAGE_GEN_ERROR.timeout : node.imageError,
      t,
    );
    return (
      <div
        className="w-full h-full p-2 flex flex-col border-2 border-dashed border-[#C2410C]/45 bg-[#C2410C]/5"
        style={{ outline: '1px solid transparent' }}
        data-testid="image-error"
      >
        <div className="w-full flex-1 min-h-0 rounded flex flex-col items-center justify-center gap-1 px-3 text-center border border-dashed border-[#C2410C]/35">
          <AlertTriangle className="h-4 w-4 text-[#C2410C]" aria-hidden />
          <span className="text-[10px] font-sans font-medium text-[#C2410C]">
            {t('nodes.image_generation_failed')}
          </span>
          <span
            className="text-[10px] font-sans text-[#C2410C]/70 line-clamp-3"
            title={errorText}
          >
            {errorText}
          </span>
        </div>
        <MediaCardCaption title={title} trailing={retry} />
      </div>
    );
  }
  if (droppedBroken) return null;

  const openLightbox = (e: React.MouseEvent) => {
    if (!downloadUrl) return;
    e.stopPropagation();
    e.preventDefault();
    setLightboxOpen(true);
  };

  const trailing = generated && downloadUrl ? (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void downloadImageUrl(downloadUrl, illustrationDownloadFilename(title)).catch((err) =>
          console.error('[Spoor] download generated image failed', err),
        );
      }}
      onPointerDown={(e) => e.stopPropagation()}
      title={t('nodes.image_download')}
      aria-label={t('nodes.image_download')}
      className="shrink-0 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-sans font-medium text-[#C2410C] hover:bg-[#C2410C]/8 transition-colors"
    >
      <Download className="h-3 w-3" aria-hidden />
      <span>{t('nodes.image_download_short')}</span>
    </button>
  ) : !generated && href ? (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void openExternalUrl(href).catch((err) =>
          console.error('[Spoor] open image source failed', err),
        );
      }}
      onPointerDown={(e) => e.stopPropagation()}
      title={href}
      aria-label={t('nodes.image_open_source')}
      className="shrink-0 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-sans font-medium text-[#C2410C] hover:bg-[#C2410C]/8 transition-colors"
    >
      <ExternalLink className="h-3 w-3" aria-hidden />
      <span>{t('nodes.image_open_source_short')}</span>
    </button>
  ) : undefined;

  return (
    <div
      className="w-full h-full bg-white p-2 shadow-lg border-2 border-[#E6E4DF] flex flex-col"
      style={{ outline: '1px solid transparent' }}
    >
      <div
        className="w-full bg-[#EAE7E2] rounded flex items-center justify-center border border-dashed border-[#d1cfca] overflow-hidden flex-1 min-h-0 cursor-zoom-in"
        data-testid="image-frame"
        onDoubleClick={openLightbox}
        title={t('nodes.image_lightbox_hint')}
      >
        <img
          alt={title || t('nodes.image_lightbox')}
          className="w-full h-full object-cover shadow-inner pointer-events-none"
          src={displaySrc}
          referrerPolicy="no-referrer"
          draggable={false}
          onError={dropBrokenSearchCard}
        />
      </div>
      <MediaCardCaption title={title} relation={relation} trailing={trailing} />
      {lightboxOpen && downloadUrl
        ? createPortal(
            <div
              className="fixed inset-0 z-[80] flex items-center justify-center bg-[#1a1a1a]/88 p-6"
              data-testid="image-lightbox"
              role="dialog"
              aria-modal="true"
              aria-label={title || t('nodes.image_lightbox')}
              onMouseDown={onBackdropMouseDown}
              onPointerDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                data-testid="image-lightbox-close"
                onClick={closeLightbox}
                className="absolute top-4 right-4 inline-flex items-center justify-center w-9 h-9 rounded-full bg-white/95 border border-[#E6E4DF] text-[#5a5a54] shadow-md hover:text-[#1a1a1a] hover:border-[#C2410C]/45 transition-colors"
                title={t('nodes.image_lightbox_close')}
                aria-label={t('nodes.image_lightbox_close')}
              >
                <X className="w-4 h-4" aria-hidden />
              </button>
              <img
                alt={title || t('nodes.image_lightbox')}
                className="max-h-[92vh] max-w-[92vw] object-contain shadow-2xl"
                src={displaySrc}
                referrerPolicy="no-referrer"
                draggable={false}
                onError={dropBrokenSearchCard}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  closeLightbox();
                }}
              />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
