import React from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, FileText, Headphones, Loader2, Video } from 'lucide-react';
import type { VideoNodeProps } from './types';
import { MediaCardCaption } from './MediaCardCaption';
import { openExternalUrl } from '../../utils/openExternal';
import { looksLikeDirectAudio, type MediaPlaybackMode } from '../../utils/mediaEmbed';
import { isCanvasAudioCard } from '../../utils/canvasAudioCard';
import { parseSearchMediaDescription } from '../../utils/webSearchMediaCaption';

function asHttpUrl(raw: string | undefined): string {
  const s = (raw || '').trim();
  return /^https?:\/\//i.test(s) ? s : '';
}

function playbackMode(node: VideoNodeProps['node']): MediaPlaybackMode | 'none' {
  const ft = (node.fileType || '').trim();
  if (ft === 'iframe' || ft === 'video' || ft === 'audio') return ft;
  const src = (node.content || '').trim();
  if (ft.startsWith('audio/') || src.startsWith('data:audio/')) return 'audio';
  const href = asHttpUrl(src);
  if (href && looksLikeDirectAudio(href)) return 'audio';
  // Local uploads / legacy: treat content as a direct video file.
  if (href || src.startsWith('data:video/')) return 'video';
  return 'none';
}

export function VideoNode({ node, onTranscribeAudio, isTranscribingAudio }: VideoNodeProps) {
  const { t } = useTranslation();
  const href = asHttpUrl(node.sourceUrl) || asHttpUrl(node.content);
  const mode = playbackMode(node);
  const src = (node.content || '').trim();
  const isSearchCard = Boolean(node.webSearchParentId) || typeof node.webSearchIndex === 'number';
  const parsed = isSearchCard
    ? parseSearchMediaDescription(node.description)
    : { title: (node.description || '').trim(), relation: '' };
  const title = parsed.title;
  const relation = parsed.relation;

  const openSource = (e: React.MouseEvent | React.PointerEvent) => {
    e.stopPropagation();
    if (!href) return;
    void openExternalUrl(href).catch((err) =>
      console.error('[Spoor] open media source failed', err),
    );
  };

  const showTranscribe = isCanvasAudioCard(node) && Boolean(onTranscribeAudio);
  const transcribeLabel = isTranscribingAudio
    ? t('nodes.audio_transcribing')
    : t('nodes.audio_transcribe');
  const transcribeBtn = showTranscribe ? (
    <button
      type="button"
      data-testid="audio-transcribe"
      disabled={isTranscribingAudio}
      onClick={(e) => {
        e.stopPropagation();
        onTranscribeAudio?.(node.id);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      title={transcribeLabel}
      aria-label={transcribeLabel}
      className="shrink-0 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-sans font-medium text-[#C2410C] hover:bg-[#C2410C]/8 transition-colors disabled:opacity-50"
    >
      {isTranscribingAudio ? (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
      ) : (
        <FileText className="h-3 w-3" aria-hidden />
      )}
      <span>{t('nodes.audio_transcribe_short')}</span>
    </button>
  ) : null;

  const sourceBtn = href ? (
    <button
      type="button"
      onClick={openSource}
      onPointerDown={(e) => e.stopPropagation()}
      title={href}
      aria-label={t('nodes.image_open_source')}
      className="shrink-0 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-sans font-medium text-[#C2410C] hover:bg-[#C2410C]/8 transition-colors"
    >
      <ExternalLink className="h-3 w-3" aria-hidden />
      <span>{t('nodes.image_open_source_short')}</span>
    </button>
  ) : null;

  const trailing =
    transcribeBtn || sourceBtn ? (
      <div className="flex shrink-0 items-center gap-1">
        {transcribeBtn}
        {sourceBtn}
      </div>
    ) : undefined;

  const showCaption = Boolean(
    title || relation || (isSearchCard && href && mode !== 'none') || trailing,
  );

  return (
    <div
      className="w-full h-full bg-white p-2 shadow-lg border-2 border-[#E6E4DF] flex flex-col"
      style={{ outline: '1px solid transparent' }}
    >
      <div
        className="relative w-full bg-[#1a1a1a] rounded flex items-center justify-center border border-dashed border-[#d1cfca] overflow-hidden flex-1 min-h-0"
        onPointerDown={(e) => {
          // Keep scrubbing/controls from starting a canvas drag.
          if (mode !== 'none') e.stopPropagation();
        }}
      >
        {mode === 'iframe' && src ? (
          <iframe
            title={title || t('nodes.video')}
            src={src}
            className="h-full w-full border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="no-referrer-when-downgrade"
          />
        ) : mode === 'audio' && src ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-3">
            <Headphones className="h-8 w-8 text-white/50" aria-hidden />
            <audio className="w-full" controls preload="metadata" src={src} />
          </div>
        ) : mode === 'video' && src ? (
          <video className="h-full w-full object-contain" controls preload="metadata" src={src} />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center">
            <Video className="h-8 w-8 text-white/40" aria-hidden />
            <p className="text-[11px] font-sans text-white/55 leading-snug">
              {t('nodes.media_play_unavailable')}
            </p>
            {href ? (
              <button
                type="button"
                onClick={openSource}
                onPointerDown={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-sans font-medium text-[#FDBA74] hover:bg-white/10"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                {t('nodes.image_open_source_short')}
              </button>
            ) : null}
          </div>
        )}
      </div>

      {showCaption ? (
        <MediaCardCaption title={title} relation={relation} trailing={trailing} />
      ) : null}
    </div>
  );
}
