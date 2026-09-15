/** Default Volcengine Seed ASR 2.0 streaming resource (hourly billing). */
export const VOLC_ASR_DEFAULT_RESOURCE_ID = 'volc.seedasr.sauc.duration';

/** Upstream ASR WebSocket path (bidirectional bigmodel, optimized). */
export const VOLC_ASR_UPSTREAM_PATH = '/api/v3/sauc/bigmodel_async';

/** Same-origin Vite/Tauri proxy path for Volc ASR WebSocket. */
export const VOLC_ASR_PROXY_PATH = '/api/volc-asr';

/**
 * Volc **file** ASR (flash). Not the streaming SAUC resource used by Ask / mic.
 * Requires `volc.bigasr.auc_turbo` on the same speech console key.
 */
export const VOLC_ASR_FLASH_RESOURCE_ID = 'volc.bigasr.auc_turbo';

/** Same-origin Vite proxy for flash HTTP (Tauri uses `/volc-asr/recognize-flash`). */
export const VOLC_ASR_FLASH_PROXY_PATH = '/api/volc-asr/recognize-flash';

/** Docs: keep binary uploads around 20MB; base64 JSON is larger on the wire. */
export const VOLC_ASR_FLASH_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Silence (ms) before Volc ASR marks an utterance `definite` for transcript quality.
 * Turns are committed only when the user manually closes the mic — this does not end a turn.
 */
export const VOLC_ASR_END_WINDOW_MS = 2200;

/** MiniMax China OpenAPI host (proxied as /api/minimax). */
export const MINIMAX_API_ORIGIN = 'https://api.minimaxi.com';

export const MINIMAX_DEFAULT_TTS_MODEL = 'speech-2.6-turbo';

/** Common Mandarin system voice. */
export const MINIMAX_DEFAULT_VOICE_ID = 'Chinese (Mandarin)_Gentle_Senior';

/** MiniMax English system voice used when the app language is English. */
export const MINIMAX_ENGLISH_VOICE_ID = 'English_CalmWoman';

export const VOICE_NOTE_COLUMN_GAP_X = 360;
/** Vertical gap between rows in the two-column voice layout (card height + spacing). */
export const VOICE_NOTE_ROW_GAP_Y = 260;
