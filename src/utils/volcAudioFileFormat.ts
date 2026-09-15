/** Map a canvas audio card to Volc flash `audio.format`. */
export function inferVolcAudioFormat(
  mime: string | undefined,
  bytes: Uint8Array,
  src: string,
): string {
  const fromMime = formatFromMime(mime);
  if (fromMime) return fromMime;
  const fromMagic = formatFromMagic(bytes);
  if (fromMagic) return fromMagic;
  const fromUrl = formatFromUrl(src);
  if (fromUrl) return fromUrl;
  return 'mp3';
}

function formatFromMime(mime: string | undefined): string | null {
  const m = (mime ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (!m) return null;
  if (m === 'audio/wav' || m === 'audio/x-wav' || m === 'audio/wave') return 'wav';
  if (m === 'audio/mpeg' || m === 'audio/mp3') return 'mp3';
  if (m === 'audio/mp4' || m === 'audio/m4a' || m === 'audio/x-m4a') return 'm4a';
  if (m === 'audio/aac') return 'aac';
  if (m === 'audio/ogg' || m === 'audio/opus') return 'ogg';
  if (m === 'audio/flac') return 'flac';
  if (m === 'audio/amr') return 'amr';
  return null;
}

function formatFromUrl(src: string): string | null {
  const path = src.split('?')[0]?.split('#')[0] ?? '';
  const ext = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1).toLowerCase() : '';
  if (ext === 'wav') return 'wav';
  if (ext === 'mp3') return 'mp3';
  if (ext === 'm4a') return 'm4a';
  if (ext === 'aac') return 'aac';
  if (ext === 'ogg' || ext === 'opus') return 'ogg';
  if (ext === 'flac') return 'flac';
  if (ext === 'amr') return 'amr';
  return null;
}

function formatFromMagic(bytes: Uint8Array): string | null {
  if (bytes.length >= 12) {
    const riff = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
    const wave = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);
    if (riff === 'RIFF' && wave === 'WAVE') return 'wav';
  }
  if (bytes.length >= 4) {
    const b0 = bytes[0]!;
    const b1 = bytes[1]!;
    if (b0 === 0x49 && b1 === 0x44 && bytes[2] === 0x33) return 'mp3'; // ID3
    if (b0 === 0xff && (b1 & 0xe0) === 0xe0) return 'mp3';
    const tag = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
    if (tag === 'OggS') return 'ogg';
    if (tag === 'fLaC') return 'flac';
  }
  if (bytes.length >= 8) {
    const ftyp = String.fromCharCode(bytes[4]!, bytes[5]!, bytes[6]!, bytes[7]!);
    if (ftyp === 'ftyp') return 'm4a';
  }
  return null;
}

export function uint8ToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return btoa(binary);
}
