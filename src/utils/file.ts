import { encodeBookContent } from './bookPayload';

export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function dataUrlFromBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** 角色卡封面：压到这个长边以内就够卡片用（卡片最长边约 320px）。 */
export const COVER_IMAGE_MAX_EDGE_PX = 1600;
/** WebP 有损质量：0.82 在封面上基本看不出差别，体积能小一个数量级。 */
export const COVER_IMAGE_WEBP_QUALITY = 0.82;
/** 已经这么小的图不再重编码：省一次有损处理，也避免小图反而变大。 */
const COVER_IMAGE_SKIP_BELOW_BYTES = 256 * 1024;
/** 这些格式已经是压缩过的位图，小图直接原样存。 */
const ALREADY_COMPACT_TYPES = new Set(['image/jpeg', 'image/webp', 'image/avif']);

export interface EncodedImage {
  /** 压缩后的 data URL（压不动时就是原图）。 */
  dataUrl: string;
  /**
   * 像素尺寸，解码不了时两维都是 0。
   *
   * 注意一个不对称：解码成功但**没能重编码**（不支持 WebP / 压完反而更大）时，
   * dataUrl 是全尺寸原图，而这里报的是"本来会缩到多少"的尺寸。比例是准的，
   * 绝对值不是——现存调用方只用比例（给卡片定框），所以没问题，但别拿它当原图尺寸用。
   */
  width: number;
  height: number;
  /** data URL 自带的 mime。重编码过就是 image/webp。 */
  mime: string;
  /** false = 原图原样返回，没有重编码过。 */
  reencoded: boolean;
}

function mimeFromDataUrl(dataUrl: string, fallback: string): string {
  return /^data:([^;,]+)/i.exec(dataUrl)?.[1] ?? fallback;
}

/**
 * 图片转 WebP 的公共内核：长边限到 `maxEdge`，有损压缩，取更小的那个。
 *
 * 不适合压的情况一律**原样返回**（不报错）：已经很小 / 已经很紧凑的格式 / 浏览器不支持
 * WebP 编码（`toBlob` 会退回 png，那种情况别用）/ 解码失败 / 压完反而更大。
 * 另外会用 imageOrientation: 'from-image' 尊重手机相片的 EXIF 方向，不然竖拍会躺下。
 *
 * 走"原样返回"的短路分支时不解码，所以 {@link EncodedImage} 的宽高是 0——调用方要是需要
 * 尺寸，得自己再探一次（见 {@link toCanvasImageDataUrl}）。
 */
async function encodeImageFile(
  file: File,
  options: { maxEdge: number; quality: number; skipBelowBytes: number },
): Promise<EncodedImage> {
  const original = async (): Promise<EncodedImage> => {
    const dataUrl = await readFileAsDataURL(file);
    return { dataUrl, width: 0, height: 0, mime: mimeFromDataUrl(dataUrl, file.type), reencoded: false };
  };

  if (file.size <= options.skipBelowBytes && ALREADY_COMPACT_TYPES.has(file.type)) {
    return original();
  }
  if (typeof createImageBitmap !== 'function') return original();

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, options.maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    // 解码成功就把原始尺寸记下来：重编码失败时尺寸信息也不丢。
    const dims = { width, height };

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { ...(await original()), ...dims };
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/webp', options.quality);
    });
    // 不支持 WebP 编码的环境会退回 png：那就别用它换掉原图。
    if (!blob || blob.type !== 'image/webp') return { ...(await original()), ...dims };

    const encoded = await dataUrlFromBlob(blob);
    if (!encoded) return { ...(await original()), ...dims };
    const raw = await readFileAsDataURL(file);
    if (encoded.length >= raw.length) {
      return { dataUrl: raw, ...dims, mime: mimeFromDataUrl(raw, file.type), reencoded: false };
    }
    return { dataUrl: encoded, ...dims, mime: 'image/webp', reencoded: true };
  } catch {
    return original();
  } finally {
    bitmap?.close?.();
  }
}

/** 画布图片卡片的压缩目标：比封面大不少，卡片可以被放大看。 */
export const CANVAS_IMAGE_MAX_EDGE_PX = 2000;
export const CANVAS_IMAGE_WEBP_QUALITY = 0.8;

/**
 * data URL → Blob。createImageBitmap 收 Blob，不收 data-URL 字符串。
 * 事后（而不是拍照当时）触发 OCR 时，要从存下来的 data URL 还原出 Blob 走这条路。
 *
 * 两种 data URL 都要认：`;base64,...` 和百分号编码的 `,...`（SVG 那类会走后者）。
 * 早先这里只按 base64 解，碰上百分号编码的会直接抛 atob 的 InvalidCharacterError，
 * 而那句话完全指不出真正的问题——排查时非常误导。现在两种都处理，
 * 实在认不出来时抛一条说清楚"这是什么格式"的信息。
 */
export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) {
    throw new Error(`dataUrlToBlob: 不是 data URL（没有逗号），开头是 "${dataUrl.slice(0, 40)}"`);
  }
  const meta = dataUrl.slice(5, comma); // 去掉 "data:"
  const payload = dataUrl.slice(comma + 1);
  const mime = /^([^;,]+)/i.exec(meta)?.[1] ?? '';

  if (!/;base64/i.test(meta)) {
    // 百分号编码：直接解 URI 序列化成 UTF-8 字节。
    const text = decodeURIComponent(payload);
    return new Blob([new TextEncoder().encode(text)], mime ? { type: mime } : undefined);
  }

  let binary: string;
  try {
    binary = atob(payload);
  } catch {
    throw new Error(
      `dataUrlToBlob: base64 解不开（${mime || '未知类型'}，载荷 ${payload.length} 字符，开头 "${payload.slice(0, 40)}"）`,
    );
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], mime ? { type: mime } : undefined);
}

/** 只为拿尺寸走一次解码，不重编码（encodeImageFile 走了短路返回时补这一刀）。 */
async function probeImageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap !== 'function') return { width: 0, height: 0 };
  try {
    const bitmap = await createImageBitmap(await dataUrlToBlob(dataUrl));
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return size;
  } catch {
    return { width: 0, height: 0 };
  }
}

/**
 * 把手机相片转成画布图片卡片能用的 data URL，并一起给出像素尺寸。
 *
 * 为什么要压：整条 data URL 会存进 IndexedDB 再同步到云端。手机相片动辄几 MB，
 * 既把本地库撑大，也超过云端单次 upsert 的分批上限（512KB，supabaseSync 的 UPSERT_MAX_BYTES），
 * 表现为"本机存住了但同步不过去"。压成 WebP 后通常只剩几十到几百 KB。
 * 尺寸要一并拿到：画布卡片按图片自身比例定框，不然 ImageNode 的 object-cover 会把照片裁掉。
 */
export async function toCanvasImageDataUrl(
  file: File,
  options?: { maxEdge?: number; quality?: number },
): Promise<EncodedImage> {
  const encoded = await encodeImageFile(file, {
    maxEdge: options?.maxEdge ?? CANVAS_IMAGE_MAX_EDGE_PX,
    quality: options?.quality ?? CANVAS_IMAGE_WEBP_QUALITY,
    skipBelowBytes: COVER_IMAGE_SKIP_BELOW_BYTES,
  });
  if (encoded.width > 0 && encoded.height > 0) return encoded;
  const probed = await probeImageSize(encoded.dataUrl);
  return { ...encoded, ...probed };
}

/**
 * 把角色卡封面转成 WebP 的 data URL：长边限到 {@link COVER_IMAGE_MAX_EDGE_PX}，有损压缩。
 *
 * 为什么要压：封面是整条 data URL 存进 IndexedDB 再同步到云端的，同 {@link toCanvasImageDataUrl}。
 * 不适合压的情况一律原样返回，原因见 {@link encodeImageFile}。
 */
export async function toCoverImageDataUrl(
  file: File,
  options?: { maxEdge?: number; quality?: number },
): Promise<string> {
  const encoded = await encodeImageFile(file, {
    maxEdge: options?.maxEdge ?? COVER_IMAGE_MAX_EDGE_PX,
    quality: options?.quality ?? COVER_IMAGE_WEBP_QUALITY,
    skipBelowBytes: COVER_IMAGE_SKIP_BELOW_BYTES,
  });
  return encoded.dataUrl;
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

export interface FileNodeData {
  type: string;
  content: string;
  description?: string;
  fileType: string;
  width?: number;
  height?: number;
}

const BOOK_NODE_SIZE = { width: 380, height: 520 };

function isPdfFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
}

function isEpubFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith('.epub') ||
    file.type === 'application/epub+zip' ||
    file.type === 'application/epub'
  );
}

const AUDIO_EXT_MIME: Record<string, string> = {
  wav: 'audio/wav',
  wave: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
};

function audioExtension(name: string): string | null {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return ext && AUDIO_EXT_MIME[ext] ? ext : null;
}

function isAudioFile(file: File): boolean {
  return file.type.startsWith('audio/') || audioExtension(file.name) !== null;
}

function audioMimeForFile(file: File): string {
  if (file.type.startsWith('audio/')) return file.type;
  const ext = audioExtension(file.name);
  return (ext && AUDIO_EXT_MIME[ext]) || 'audio/wav';
}

export async function processFileToNode(file: File): Promise<FileNodeData> {
  if (file.type.startsWith('video/')) {
    return {
      type: 'video',
      content: await readFileAsDataURL(file),
      fileType: file.type,
    };
  }

  if (isAudioFile(file)) {
    const mime = audioMimeForFile(file);
    const typed = file.type.startsWith('audio/')
      ? file
      : new File([file], file.name, { type: mime });
    return {
      type: 'video',
      content: await readFileAsDataURL(typed),
      description: file.name,
      fileType: mime,
    };
  }

  if (file.type.startsWith('image/')) {
    return {
      type: 'image',
      content: await readFileAsDataURL(file),
      fileType: file.type,
    };
  }

  if (isPdfFile(file)) {
    const arrayBuffer = await file.arrayBuffer();
    const { parsePdfBook } = await import('./parsePdfBook');
    const book = await parsePdfBook(arrayBuffer, file.name);
    return {
      type: 'book',
      content: encodeBookContent(book),
      description: file.name,
      fileType: 'pdf',
      ...BOOK_NODE_SIZE,
    };
  }

  if (isEpubFile(file)) {
    const arrayBuffer = await file.arrayBuffer();
    const { parseEpubBook } = await import('./parseEpubBook');
    const book = await parseEpubBook(arrayBuffer, file.name);
    return {
      type: 'book',
      content: encodeBookContent(book),
      description: file.name,
      fileType: 'epub',
      ...BOOK_NODE_SIZE,
    };
  }

  if (file.name.endsWith('.docx') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const arrayBuffer = await file.arrayBuffer();
    const { default: mammoth } = await import('mammoth');
    const result = await mammoth.convertToHtml({ arrayBuffer });
    return {
      type: 'document',
      content: result.value || '<p>(空文档)</p>',
      description: file.name,
      fileType: 'docx',
      ...BOOK_NODE_SIZE,
    };
  }

  if (file.name.endsWith('.txt') || file.type === 'text/plain') {
    const text = await readFileAsText(file);
    return {
      type: 'text',
      content: text,
      description: file.name,
      fileType: 'text/plain',
    };
  }

  if (file.name.endsWith('.md') || file.type === 'text/markdown') {
    const text = await readFileAsText(file);
    return {
      type: 'text',
      content: text,
      description: file.name,
      fileType: 'text/markdown',
    };
  }

  throw new Error(`Unsupported file type: ${file.type || file.name}`);
}

/**
 * 把一条图片卡的 `content` 变成可交给 OCR 的二进制。
 *
 * 为什么不能只认 data URL：**登录同步之后 content 会被换成云端存储的公网地址**
 * （见 utils/cloudSyncMedia，data URL 会被抬到 canvas-media 桶）。而原图只在内存里
 * 留最近几张，重开应用就没了——这时 OCR 唯一的输入就是那个远程 URL。
 * 早先这里直接 dataUrlToBlob(https://…) 会在 atob 里炸成一句完全指不出问题的
 * InvalidCharacterError，用户只看到"点了没反应"。
 */
export async function imageBlobFromContent(content: string): Promise<Blob> {
  const trimmed = (content ?? '').trim();
  if (!trimmed) throw new Error('这张图没有内容（content 是空的）');
  if (trimmed.startsWith('data:')) return dataUrlToBlob(trimmed);
  if (/^https?:\/\//i.test(trimmed)) {
    let res: Response;
    try {
      res = await fetch(trimmed);
    } catch (e) {
      throw new Error(`取不到云端图片（离线或跨域被拦）：${(e as Error)?.message ?? e}`);
    }
    if (!res.ok) throw new Error(`取云端图片失败：HTTP ${res.status}`);
    return res.blob();
  }
  throw new Error(
    `不认识的图片内容格式，开头是 "${trimmed.slice(0, 40)}"（既不是 data URL 也不是 http(s)）`,
  );
}
