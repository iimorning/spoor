import { looksLikeDirectAudio } from './mediaEmbed';

/** True when a canvas media card should show in-card audio playback (and transcribe). */
export function isCanvasAudioCard(node: { fileType?: string; content?: string }): boolean {
  const ft = (node.fileType || '').trim();
  if (ft === 'audio' || ft.startsWith('audio/')) return true;
  const src = (node.content || '').trim();
  if (src.startsWith('data:audio/')) return true;
  if (/^https?:\/\//i.test(src) && looksLikeDirectAudio(src)) return true;
  return false;
}
