import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

export const NOTE_CJK_STORAGE_KEY = 'note_cjk';
const LEGACY_APP_SERIF_STORAGE_KEY = 'app_serif';
const LEGACY_CJK_SERIF_STORAGE_KEY = 'cjk_serif';

/** Local trial faces (large OFL files). Fetch with: npm run setup:note-hand-fonts */
export const NOTE_CJK_IDS = [
  'system',
  'zhuque',
  'yozai',
  'xiaolai',
  'wenkai',
  'nanifont',
  'liyu',
  'marker',
  'qingsong',
] as const;

export type NoteCjkId = (typeof NOTE_CJK_IDS)[number];

const NOTE_CJK_ID_SET = new Set<string>(NOTE_CJK_IDS);

/** Handwriting faces: put the CJK face first so Latin also follows the sketch look. */
export const NOTE_CJK_HAND_IDS = [
  'yozai',
  'xiaolai',
  'wenkai',
  'nanifont',
  'liyu',
  'marker',
  'qingsong',
] as const;

const NOTE_CJK_HAND_SET = new Set<string>(NOTE_CJK_HAND_IDS);

export const NOTE_CJK_CSS_FAMILY: Record<NoteCjkId, string> = {
  zhuque: "'Zhuque Fangsong'",
  system: "'Songti SC', 'Source Han Serif SC', 'Noto Serif SC', 'STSong', 'SimSun'",
  wenkai: "'LXGW WenKai Lite'",
  yozai: 'Yozai',
  xiaolai: 'Xiaolai',
  nanifont: 'NaniFont',
  liyu: "'Liyu Shoushu'",
  marker: "'LXGW Marker Gothic'",
  qingsong: "'Jason Handwriting 1'",
};

/** Files for faces we self-host. System uses OS fonts. */
export const NOTE_CJK_FONT_FILES: Partial<Record<NoteCjkId, { woff2: string; ttf: string }>> = {
  zhuque: { woff2: '/fonts/ZhuqueFangsong-Regular.woff2', ttf: '/fonts/ZhuqueFangsong-Regular.ttf' },
  wenkai: { woff2: '/fonts/LXGWWenKaiLite-Regular.woff2', ttf: '/fonts/LXGWWenKaiLite-Regular.ttf' },
  yozai: { woff2: '/fonts/Yozai-Regular.woff2', ttf: '/fonts/Yozai-Regular.ttf' },
  xiaolai: { woff2: '/fonts/Xiaolai-Regular.woff2', ttf: '/fonts/Xiaolai-Regular.ttf' },
  nanifont: { woff2: '/fonts/NaniFont-Regular.woff2', ttf: '/fonts/NaniFont-Regular.ttf' },
  liyu: { woff2: '/fonts/LiyuShoushu.woff2', ttf: '/fonts/LiyuShoushu.ttf' },
  marker: { woff2: '/fonts/LXGWMarkerGothic-Regular.woff2', ttf: '/fonts/LXGWMarkerGothic-Regular.ttf' },
  qingsong: { woff2: '/fonts/JasonHandwriting1.woff2', ttf: '/fonts/JasonHandwriting1.ttf' },
};

export function noteCjkFaceName(id: NoteCjkId): string {
  const raw = NOTE_CJK_CSS_FAMILY[id];
  if (raw.startsWith("'") && raw.endsWith("'") && !raw.includes(',')) return raw.slice(1, -1);
  return raw;
}

export type CjkFontProgress = {
  active: boolean;
  percent: number;
  indeterminate: boolean;
};

const progressListeners = new Set<() => void>();
const progressJobs = new Map<string, { loaded: number; total: number }>();
let progressHideTimer: ReturnType<typeof setTimeout> | undefined;
let progressSnapshot: CjkFontProgress = { active: false, percent: 0, indeterminate: false };

function emitCjkFontProgress() {
  let loaded = 0;
  let total = 0;
  let missingLength = false;
  for (const job of progressJobs.values()) {
    loaded += job.loaded;
    if (job.total > 0) total += job.total;
    else missingLength = true;
  }
  const active = progressJobs.size > 0;
  progressSnapshot = {
    active,
    percent: total > 0 ? Math.min(100, Math.round((100 * loaded) / total)) : active ? 0 : 100,
    indeterminate: active && (missingLength || total === 0),
  };
  progressListeners.forEach((fn) => fn());
}

function setProgressJob(id: string, loaded: number, total: number) {
  if (progressHideTimer) {
    clearTimeout(progressHideTimer);
    progressHideTimer = undefined;
  }
  progressJobs.set(id, { loaded, total });
  emitCjkFontProgress();
}

function clearProgressJob(id: string) {
  progressJobs.delete(id);
  emitCjkFontProgress();
  if (progressJobs.size === 0) {
    progressSnapshot = { active: true, percent: 100, indeterminate: false };
    progressListeners.forEach((fn) => fn());
    progressHideTimer = setTimeout(() => {
      progressSnapshot = { active: false, percent: 100, indeterminate: false };
      progressListeners.forEach((fn) => fn());
    }, 220);
  }
}

export function getCjkFontProgress(): CjkFontProgress {
  return progressSnapshot;
}

export function subscribeCjkFontProgress(fn: () => void) {
  progressListeners.add(fn);
  return () => {
    progressListeners.delete(fn);
  };
}

export function useCjkFontProgress(): CjkFontProgress {
  return useSyncExternalStore(subscribeCjkFontProgress, getCjkFontProgress, getCjkFontProgress);
}

const noteCjkFontLoads = new Map<string, Promise<void>>();

async function readBodyWithProgress(
  res: Response,
  onProgress: (loaded: number, total: number) => void,
): Promise<ArrayBuffer> {
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body) {
    const buf = await res.arrayBuffer();
    onProgress(buf.byteLength, buf.byteLength);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

async function fetchFontBuffer(url: string, jobId: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return readBodyWithProgress(res, (loaded, total) => setProgressJob(jobId, loaded, total));
}

/** Fetch the selected self-hosted face (woff2, then ttf) and report download progress. */
export function loadNoteCjkFont(id: NoteCjkId): Promise<void> {
  const files = NOTE_CJK_FONT_FILES[id];
  if (!files) return Promise.resolve();
  if (typeof FontFace === 'undefined' || !document.fonts) return Promise.resolve();
  const pending = noteCjkFontLoads.get(id);
  if (pending) return pending;

  const run = (async () => {
    const family = noteCjkFaceName(id);
    setProgressJob(id, 0, 0);
    try {
      let buf: ArrayBuffer;
      try {
        buf = await fetchFontBuffer(files.woff2, id);
      } catch {
        buf = await fetchFontBuffer(files.ttf, id);
      }
      const face = new FontFace(family, buf, { weight: '400', style: 'normal', display: 'swap' });
      document.fonts.add(await face.load());
    } catch {
      noteCjkFontLoads.delete(id);
    } finally {
      clearProgressJob(id);
    }
  })();

  noteCjkFontLoads.set(id, run);
  return run;
}

export function isNoteCjkHand(id: NoteCjkId): boolean {
  return NOTE_CJK_HAND_SET.has(id);
}

function isNoteCjkId(value: string | null): value is NoteCjkId {
  return value != null && NOTE_CJK_ID_SET.has(value);
}

/** Stack used on the settings picker so the closed control previews the face. */
export function noteCjkPreviewFamily(id: NoteCjkId): string {
  const face = NOTE_CJK_CSS_FAMILY[id];
  if (isNoteCjkHand(id)) return `${face}, 'Newsreader', Georgia, serif`;
  return `'Newsreader', Georgia, ${face}, serif`;
}

function readStoredNoteCjk(): NoteCjkId {
  try {
    const stored = localStorage.getItem(NOTE_CJK_STORAGE_KEY);
    if (isNoteCjkId(stored)) return stored;
    const legacyApp = localStorage.getItem(LEGACY_APP_SERIF_STORAGE_KEY);
    if (legacyApp === 'zhuque') return 'zhuque';
    const legacyCjk = localStorage.getItem(LEGACY_CJK_SERIF_STORAGE_KEY);
    if (legacyCjk === 'zhuque') return 'zhuque';
  } catch {
    /* private mode */
  }
  return 'system';
}

function applyNoteCjk(id: NoteCjkId, loadFont = false) {
  document.documentElement.dataset.noteCjk = id;
  if (isNoteCjkHand(id)) {
    document.documentElement.dataset.noteHand = '1';
  } else {
    delete document.documentElement.dataset.noteHand;
  }
  if (loadFont) void loadNoteCjkFont(id);
}

/** Call once at startup (before React renders) so the stored note face is applied without downloading. */
export function initNoteCjk() {
  const stored = readStoredNoteCjk();
  applyNoteCjk(stored, false);
}

/** Apply the stored font choice synchronously. Self-hosted faces download only from settings. */
export function initNoteCjkAfterFirstPaint() {
  const stored = readStoredNoteCjk();
  applyNoteCjk(stored, false);
}

export function useNoteCjk() {
  const [id, setId] = useState<NoteCjkId>(() => readStoredNoteCjk());
  const pendingUserFontLoadRef = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem(NOTE_CJK_STORAGE_KEY, id);
      localStorage.removeItem(LEGACY_APP_SERIF_STORAGE_KEY);
      localStorage.removeItem(LEGACY_CJK_SERIF_STORAGE_KEY);
    } catch {
      /* private mode */
    }
    applyNoteCjk(id, false);
    if (pendingUserFontLoadRef.current) {
      pendingUserFontLoadRef.current = false;
      void loadNoteCjkFont(id);
    }
  }, [id]);

  const setNoteCjk = useCallback((next: NoteCjkId) => {
    pendingUserFontLoadRef.current = true;
    setId(next);
  }, []);

  return { id, setNoteCjk };
}
