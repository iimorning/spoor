import { db, type VoicePreviewClip } from '../db';

/**
 * 音色试听的缓存。
 *
 * 合成一句样句要一两秒（还带一次 WebSocket 握手），而"挑音色"这个动作天然是反复听的：
 * 听完御姐听沉稳高管，再回头对比。所以第一遍合成时把音频留一份，之后本地播放，
 * 换回同一个音色就是瞬间出声。
 *
 * 两级：内存 Map（本次会话内不用等 IndexedDB）+ Dexie 表（刷新/重开应用后仍然命中）。
 */
const MEMORY = new Map<string, Blob>();

/** 最多留多少条；一条几秒的样句约 100–200 KB。 */
export const VOICE_PREVIEW_CACHE_MAX = 60;

/**
 * 缓存键：音色 + 模型 + 那句样句。样句要进键——它变了（改了文案/换语言）就得重新合成，
 * 否则会播出一句跟现在文案不一致的旧音频。
 */
export function voicePreviewCacheKey(parts: {
  model: string;
  voiceId: string;
  line: string;
}): string {
  return `${parts.model}::${parts.voiceId}::${parts.line}`;
}

/**
 * 把缓存里读回来的东西统一成字节。结构化克隆在不同环境里给出的形状不完全一样
 * （TypedArray / ArrayBuffer / 带 byteLength 的对象），只要拿得到字节就认。
 */
function toBytes(value: unknown): Uint8Array | null {
  if (!value) return null;
  if (value instanceof Uint8Array) return value.byteLength > 0 ? value : null;
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return view.byteLength > 0
      ? new Uint8Array(view.buffer as ArrayBuffer, view.byteOffset, view.byteLength)
      : null;
  }
  const bufferish = value as { byteLength?: number; buffer?: ArrayBuffer; slice?: unknown };
  if (typeof bufferish.byteLength === 'number' && bufferish.byteLength > 0) {
    const buffer = bufferish.buffer ?? (bufferish.slice as ((a: number, b: number) => ArrayBuffer) | undefined)?.call(value, 0, bufferish.byteLength);
    if (buffer) return new Uint8Array(buffer, 0, bufferish.byteLength);
  }
  return null;
}

/** 取缓存的试听音频；没有就返回 null（调用方去合成）。 */
export async function readVoicePreviewClip(key: string): Promise<Blob | null> {
  const hit = MEMORY.get(key);
  if (hit) return hit;
  try {
    const row = await db.voicePreviewClips.get(key);
    // 读不到就当没缓存，去重新合成 —— 缓存只是省时间，不能挡住试听。
    const bytes = toBytes(row?.data);
    if (!bytes) return null;
    const blob = new Blob([bytes], { type: row!.type || 'audio/wav' });
    MEMORY.set(key, blob);
    return blob;
  } catch {
    return null;
  }
}

/**
 * 存一条试听音频（WAV 字节），并按 updatedAt 淘汰最老的几条。
 * 收字节而不是 Blob：存 Blob 就得先 `blob.arrayBuffer()`，而那个方法不是处处都在，
 * 一旦没有就会在 catch 里静默丢缓存 —— 表现是"缓存永远不生效"，很难查。
 */
export async function writeVoicePreviewClip(key: string, bytes: Uint8Array): Promise<void> {
  if (!bytes?.byteLength) return;
  MEMORY.set(key, new Blob([bytes], { type: 'audio/wav' }));
  try {
    await db.voicePreviewClips.put({
      id: key,
      data: bytes,
      type: 'audio/wav',
      updatedAt: Date.now(),
    } satisfies VoicePreviewClip);
    const all = await db.voicePreviewClips.orderBy('updatedAt').toArray();
    if (all.length <= VOICE_PREVIEW_CACHE_MAX) return;
    const stale = all.slice(0, all.length - VOICE_PREVIEW_CACHE_MAX);
    await db.voicePreviewClips.bulkDelete(stale.map((row) => row.id));
    for (const row of stale) MEMORY.delete(row.id);
  } catch {
    // 存不进去只影响速度，不影响这次试听：内存里那条还在。
  }
}

/** 测试用：清掉内存那一层（IndexedDB 由测试自己清）。 */
export function clearVoicePreviewMemoryCache(): void {
  MEMORY.clear();
}
