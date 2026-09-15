import { getSupabase } from '../lib/supabase';

export const CANVAS_MEDIA_BUCKET = 'canvas-media';

const DATA_URL_RE = /^data:([^;]+);base64,/i;

export function isDataUrl(value: string | undefined | null): boolean {
  return Boolean(value?.trim().startsWith('data:'));
}

export function mimeFromDataUrl(dataUrl: string): string {
  const match = DATA_URL_RE.exec(dataUrl.trim());
  return match?.[1]?.trim() || 'application/octet-stream';
}

export function extensionForMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  if (m.includes('avif')) return 'avif';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('wav')) return 'wav';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('webm') && m.startsWith('audio/')) return 'webm';
  if (m.includes('webm')) return 'webm';
  if (m.includes('mp4')) return 'mp4';
  return 'bin';
}

export function isCanvasMediaUrl(url: string | undefined | null): boolean {
  const value = (url ?? '').trim();
  return value.includes('/storage/v1/object/public/canvas-media/');
}

export function canvasMediaPublicUrl(storagePath: string): string {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase is not configured');
  const { data } = supabase.storage.from(CANVAS_MEDIA_BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  try {
    const response = await fetch(dataUrl);
    if (response.ok) return await response.blob();
  } catch {
    // fall through for test environments without data-URL fetch support
  }
  const match = /^data:([^;]+);base64,([\s\S]+)$/i.exec(dataUrl);
  if (!match) throw new Error('invalid_data_url');
  const binary = atob(match[2].replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: match[1] });
}

export async function uploadCanvasMedia(
  userId: string,
  storagePath: string,
  blob: Blob,
): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase is not configured');
  const { error } = await supabase.storage.from(CANVAS_MEDIA_BUCKET).upload(storagePath, blob, {
    upsert: true,
    contentType: blob.type || undefined,
  });
  if (error) throw error;
  return canvasMediaPublicUrl(storagePath);
}

export async function uploadDataUrl(
  userId: string,
  storagePath: string,
  dataUrl: string,
): Promise<string> {
  const blob = await dataUrlToBlob(dataUrl);
  return uploadCanvasMedia(userId, storagePath, blob);
}

/** Upload a data URL once; no-op for http(s) or existing canvas-media URLs. */
export async function inlineDataUrlForCloud(
  userId: string,
  storagePath: string,
  value: string | undefined,
): Promise<string | undefined> {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return value;
  if (!isDataUrl(trimmed) || isCanvasMediaUrl(trimmed)) return trimmed;
  const ext = extensionForMime(mimeFromDataUrl(trimmed));
  return uploadDataUrl(userId, `${storagePath}.${ext}`, trimmed);
}

export async function fetchUrlToBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`media_fetch_failed:${res.status}`);
  return res.blob();
}
