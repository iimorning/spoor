/** Frame shape for generated illustrations (maps to Gemini Flash Image aspect ratios). */
export type ImageOrientation =
  | 'landscape'
  | 'portrait'
  | 'square'
  /** 9:16 — tall poster / mobile cover */
  | 'poster'
  /** 1:8 — vertical scroll / infographic strip */
  | 'strip'
  /** 4:1 — wide banner */
  | 'banner-mid'
  /** 8:1 — ultra-wide panorama banner */
  | 'banner';

export type GeminiAspectRatio =
  | '1:1'
  | '2:3'
  | '3:2'
  | '9:16'
  | '16:9'
  | '1:8'
  | '8:1'
  | '1:4'
  | '4:1';

export type GeminiImageResolution = '1K' | '2K';

/** Legacy 302 size tokens kept for backward-compatible callers. */
export const GPT_IMAGE_SIZE = {
  landscape: '1536x1024',
  portrait: '1024x1536',
  square: '1024x1024',
  poster: 'aspect:9:16',
  strip: 'aspect:1:8',
  'banner-mid': 'aspect:4:1',
  banner: 'aspect:8:1',
} as const satisfies Record<ImageOrientation, string>;

const EXTENDED_ORIENTATIONS = new Set<ImageOrientation>(['poster', 'strip', 'banner-mid', 'banner']);

export function usesExtendedGeminiAspect(orientation: ImageOrientation): boolean {
  return EXTENDED_ORIENTATIONS.has(orientation);
}

export function gptImageSizeForOrientation(orientation: ImageOrientation): string {
  return GPT_IMAGE_SIZE[orientation];
}

export function geminiAspectRatioForOrientation(orientation: ImageOrientation): GeminiAspectRatio {
  switch (orientation) {
    case 'square':
      return '1:1';
    case 'portrait':
      return '2:3';
    case 'poster':
      return '9:16';
    case 'strip':
      return '1:8';
    case 'banner-mid':
      return '4:1';
    case 'banner':
      return '8:1';
    default:
      return '3:2';
  }
}

/** Poster / banner / strip benefit from 2K on Nano Banana 2. */
export function geminiResolutionForOrientation(orientation: ImageOrientation): GeminiImageResolution {
  return usesExtendedGeminiAspect(orientation) ? '2K' : '1K';
}

/** 302.AI gpt-image-2 only accepts legacy WxH sizes — map exotic presets to nearest fit. */
export function gptImage302FallbackSize(orientation: ImageOrientation): string {
  switch (orientation) {
    case 'square':
      return GPT_IMAGE_SIZE.square;
    case 'portrait':
    case 'poster':
    case 'strip':
      return GPT_IMAGE_SIZE.portrait;
    case 'banner-mid':
    case 'banner':
      return GPT_IMAGE_SIZE.landscape;
    default:
      return GPT_IMAGE_SIZE.landscape;
  }
}

export function orientationFromGptImageSize(size?: string | null): ImageOrientation | null {
  const s = (size ?? '').trim();
  if (!s) return null;
  if (s === GPT_IMAGE_SIZE.square) return 'square';
  if (s === GPT_IMAGE_SIZE.portrait) return 'portrait';
  if (s === GPT_IMAGE_SIZE.landscape) return 'landscape';
  if (s === GPT_IMAGE_SIZE.poster) return 'poster';
  if (s === GPT_IMAGE_SIZE.strip) return 'strip';
  if (s === GPT_IMAGE_SIZE['banner-mid']) return 'banner-mid';
  if (s === GPT_IMAGE_SIZE.banner) return 'banner';
  return null;
}

/** Parse an explicit orientation from draw-tool JSON (`orientation` / `aspect` / `size`). */
export function parseImageOrientation(raw: unknown): ImageOrientation | null {
  if (typeof raw === 'number') return null;
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
  if (!s) return null;

  if (
    /^(strip|long|scroll|长图|竖长图|信息长图|营销长图)$/.test(s) ||
    s === '1:8'
  ) {
    return 'strip';
  }
  if (/^(banner-mid|wide-banner|宽横幅)$/.test(s) || s === '4:1') {
    return 'banner-mid';
  }
  if (/^(banner|panorama|横幅|超宽横幅|全景横幅)$/.test(s) || s === '8:1') {
    return 'banner';
  }
  if (
    /^(poster|cover|海报|竖版海报|活动海报|宣传海报)$/.test(s) ||
    s === '9:16'
  ) {
    return 'poster';
  }
  if (
    /^(portrait|vertical|vert|tall|竖|竖图|竖构图|竖版|竖屏|竖幅)$/.test(s) ||
    s === '3:4' ||
    s === '4:5' ||
    s === '1024x1536'
  ) {
    return 'portrait';
  }
  if (
    /^(landscape|horizontal|horiz|wide|横|横图|横构图|横版|横屏)$/.test(s) ||
    s === '16:9' ||
    s === '21:9' ||
    s === '3:2' ||
    s === '1536x1024'
  ) {
    return 'landscape';
  }
  if (/^(square|1:1|方|方图|方构图|1024x1024)$/.test(s)) return 'square';
  return null;
}

/** Infer orientation from a visual prompt when the model omitted the field. */
export function inferImageOrientation(
  prompt: string,
  explicit?: ImageOrientation | null,
): ImageOrientation {
  if (explicit) return explicit;
  const text = (prompt || '').toLowerCase();
  if (!text.trim()) return 'landscape';

  const strip =
    /长图|竖长图|信息长图|营销长图|一图流|scroll\s+poster|vertical\s+(scroll|strip|infographic)/.test(
      text,
    ) || /\b1\s*[:：]\s*8\b/.test(text);

  const banner =
    /超宽横幅|全景横幅|网页横幅|web\s+banner|ultra[-\s]?wide\s+banner/.test(text) ||
    /\b8\s*[:：]\s*1\b/.test(text);

  const bannerMid =
    /宽横幅|横幅海报|横版横幅|wide\s+banner/.test(text) || /\b4\s*[:：]\s*1\b/.test(text);

  const poster =
    /海报|活动海报|宣传海报|cover\s+poster|promotional\s+poster|event\s+poster/.test(text) ||
    /\b9\s*[:：]\s*16\b/.test(text);

  const portrait =
    /竖\s*(图|构图|版|屏|幅)|竖构图/.test(text) ||
    /\b(3\s*[:：]\s*4|4\s*[:：]\s*5)\b/.test(text) ||
    /portrait\s+orientation|vertical\s+(shot|composition|frame|format|image)/.test(text) ||
    /立绘|全身立绘|全身像|全身照|手机壁纸|竖屏壁纸/.test(text) ||
    /full[-\s]?body\s+(portrait|shot|standing)|standing\s+full[-\s]?body/.test(text) ||
    /tall\s+(portrait|narrow\s+frame)/.test(text);

  const landscape =
    /横\s*(图|构图|版|屏|幅)|横构图/.test(text) ||
    /\b(16\s*[:：]\s*9|21\s*[:：]\s*9|3\s*[:：]\s*2)\b/.test(text) ||
    /landscape\s+orientation|wide(?:screen)?\s+(shot|composition|frame)|cinematic\s+widescreen/.test(
      text,
    ) ||
    /全景|横屏/.test(text);

  const square =
    /方\s*(图|构图)|1\s*[:：]\s*1/.test(text) || /square\s+(format|crop|frame|image)/.test(text);

  if (strip && !banner && !bannerMid) return 'strip';
  if (banner && !strip) return 'banner';
  if (bannerMid && !strip && !banner) return 'banner-mid';
  if (poster && !portrait && !strip) return 'poster';
  if (portrait && !landscape && !poster) return 'portrait';
  if (landscape && !portrait && !poster) return 'landscape';
  if (square && !portrait && !landscape) return 'square';
  return 'landscape';
}

/** Read orientation back from an already-sized canvas card (retry / resize). */
export function orientationFromCardSize(
  width?: number,
  height?: number,
): ImageOrientation | null {
  if (!(typeof width === 'number' && width > 0 && typeof height === 'number' && height > 0)) {
    return null;
  }
  const ratio = height / width;
  if (ratio >= 6) return 'strip';
  if (ratio >= 1.45) return ratio >= 1.7 ? 'poster' : 'portrait';
  if (ratio <= 0.2) return 'banner';
  if (ratio <= 0.32) return 'banner-mid';
  if (width > height * 1.12) return 'landscape';
  return 'square';
}
