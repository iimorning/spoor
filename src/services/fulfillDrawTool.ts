import { generateGptImage2, hasFlux302Credentials } from './flux302';
import { db } from '../db';
import { DRAW_TOOL_MAX_IMAGES, type DrawToolSpec } from '../utils/drawTool';
import {
  inferImageOrientation,
  orientationFromCardSize,
  type ImageOrientation,
} from '../utils/imageOrientation';
import {
  FLUX_IMAGE_CARD_HEIGHT,
  FLUX_IMAGE_CARD_WIDTH,
  fluxImageCardSize,
  placeFluxImageBesideLiveAnchor,
  spawnFluxImageCard,
} from './spawnFluxImageCards';
import { clipImageSourceNote, collectDrawReferenceImageContents, prepareLlmVisionImages } from '../utils/canvasContextImages';
import {
  GPT_IMAGE_TIMEOUT_MS,
  IMAGE_GEN_ERROR,
  imageGenerationStartedAt,
  isImageGenerationTimeoutError,
  isImageSafetyRejection,
} from '../utils/imageGenerationWait';

/** One in-flight request per card so Retry can cancel a hung generate. */
const inflightByNodeId = new Map<string, AbortController>();

function beginImageJob(nodeId: string): AbortController {
  inflightByNodeId.get(nodeId)?.abort();
  const ac = new AbortController();
  inflightByNodeId.set(nodeId, ac);
  return ac;
}

function endImageJob(nodeId: string, ac: AbortController) {
  if (inflightByNodeId.get(nodeId) === ac) inflightByNodeId.delete(nodeId);
}

function imageJobErrorMessage(err: unknown): string {
  if (isImageGenerationTimeoutError(err)) return IMAGE_GEN_ERROR.timeout;
  if (err instanceof Error) {
    if (isImageSafetyRejection(err.message) || err.message === IMAGE_GEN_ERROR.blocked) {
      return IMAGE_GEN_ERROR.blocked;
    }
    return err.message;
  }
  return String(err);
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  );
}

export async function resolveDrawInputReferences(
  anchorId: string,
  excludeIds: string[] = [],
  extraImageNodeIds: Iterable<string> = [],
): Promise<string[]> {
  try {
    const anchor = await db.nodes.get(anchorId);
    if (!anchor) return [];
    const canvasId = anchor.canvasId ?? '';
    const nodes = canvasId
      ? await db.nodes.where('canvasId').equals(canvasId).toArray()
      : await db.nodes.toArray();
    const edges = canvasId
      ? await db.edges.where('canvasId').equals(canvasId).toArray()
      : await db.edges.toArray();
    const extra = [...extraImageNodeIds];
    const raw = collectDrawReferenceImageContents(anchor, nodes, edges, excludeIds, extra);
    if (raw.length === 0) return [];
    return await prepareLlmVisionImages(raw);
  } catch (err) {
    console.warn('[Spoor] draw input_references skipped', err);
    return [];
  }
}

async function resolveImageJob(options: {
  nodeId: string;
  prompt: string;
  apiKey: string;
  openrouterApiKey?: string;
  orientation: ImageOrientation;
  inputReferences?: string[];
}): Promise<void> {
  const ac = beginImageJob(options.nodeId);
  try {
    const { url } = await generateGptImage2({
      apiKey: options.apiKey,
      openrouterApiKey: options.openrouterApiKey,
      prompt: options.prompt,
      orientation: options.orientation,
      inputReferences: options.inputReferences,
      signal: ac.signal,
    });
    if (inflightByNodeId.get(options.nodeId) !== ac) return;
    await db.nodes.update(options.nodeId, {
      content: url,
      imageStatus: undefined,
      imageError: undefined,
    });
  } catch (err) {
    if (inflightByNodeId.get(options.nodeId) !== ac) return;
    if (isAbortError(err) && !isImageGenerationTimeoutError(err)) return;
    const msg = imageJobErrorMessage(err);
    console.error('[Spoor] draw tool failed', { prompt: options.prompt.slice(0, 80), error: msg });
    await db.nodes.update(options.nodeId, { imageStatus: 'error', imageError: msg });
    throw err;
  } finally {
    endImageJob(options.nodeId, ac);
  }
}

/**
 * Ghosts only resolve while the generate call is alive. Refresh / close leaves
 * `imageStatus: generating` behind — mark those older than the client timeout
 * so the card shows Retry instead of spinning forever.
 */
export async function recoverStaleGeneratingImages(now = Date.now()): Promise<number> {
  const stuck = await db.nodes.filter((n) => n.type === 'image' && n.imageStatus === 'generating').toArray();
  let marked = 0;
  for (const node of stuck) {
    const started = imageGenerationStartedAt(node);
    if (started != null && now - started < GPT_IMAGE_TIMEOUT_MS) continue;
    await db.nodes.update(node.id, {
      imageStatus: 'error',
      imageError: IMAGE_GEN_ERROR.stale,
    });
    marked += 1;
  }
  return marked;
}

/**
 * Generate GPT-Image-2 illustrations for draw-tool specs and pin them beside an AI / hub card.
 * Does not throw; reports missing key / per-image errors via callbacks.
 */
export async function fulfillDrawToolFromNode(options: {
  nodeId: string;
  images: DrawToolSpec[];
  apiKey?: string;
  openrouterApiKey?: string;
  onMissingKey?: () => void;
  onError?: (message: string) => void;
  /** When false, skip auto-drawn edges (V2 book expand). Default true. */
  wireEdge?: boolean;
}): Promise<void> {
  const specs = options.images.slice(0, DRAW_TOOL_MAX_IMAGES);
  if (specs.length === 0) return;
  if (!hasFlux302Credentials(options.apiKey, options.openrouterApiKey)) {
    options.onMissingKey?.();
    return;
  }
  const node = await db.nodes.get(options.nodeId);
  if (!node) return;
  const apiKey = (options.apiKey ?? '').trim();
  const openrouterApiKey = (options.openrouterApiKey ?? '').trim();
  const errors: string[] = [];
  const canvasId = node.canvasId ?? '';

  // Place every ghost up front so the canvas shows the pending cards immediately.
  // Sequential on purpose: each pass re-reads the obstacles, so ghost 2 sees ghost 1
  // and lands beside it instead of on top.
  const placeholders: Array<{
    id: string;
    spec: DrawToolSpec;
    orientation: ImageOrientation;
  }> = [];
  for (const spec of specs) {
    const live = (await db.nodes.get(options.nodeId)) ?? node;
    const others = canvasId
      ? await db.nodes.where('canvasId').equals(canvasId).toArray()
      : await db.nodes.toArray();
    const orientation = inferImageOrientation(spec.prompt, spec.orientation);
    const card = fluxImageCardSize(orientation);
    const pos = placeFluxImageBesideLiveAnchor(
      {
        type: live.type,
        x: live.x,
        y: live.y,
        width: live.width && live.width > 0 ? live.width : FLUX_IMAGE_CARD_WIDTH,
        height: live.height && live.height > 0 ? live.height : FLUX_IMAGE_CARD_HEIGHT,
      },
      others,
      card,
    );
    const sourceNote = clipImageSourceNote(
      [(node.userTurn ?? '').trim(), (node.content ?? '').trim()].filter(Boolean).join('\n'),
    );
    const id = await spawnFluxImageCard({
      canvasId: live.canvasId ?? canvasId,
      imageUrl: '',
      description: spec.title,
      x: pos.x,
      y: pos.y,
      ...(options.wireEdge === false ? {} : { linkFromId: options.nodeId }),
      imageStatus: 'generating',
      imagePrompt: spec.prompt,
      ...(sourceNote ? { imageSourceNote: sourceNote } : {}),
      width: card.width,
      height: card.height,
      ...(live.contextScopeAgentId
        ? { contextScopeAgentId: live.contextScopeAgentId }
        : {}),
    });
    placeholders.push({ id, spec, orientation });
  }

  const inputReferences = await resolveDrawInputReferences(
    options.nodeId,
    placeholders.map((p) => p.id),
  );

  // Each image resolves into its own ghost, so a slow one never holds up a fast one.
  await Promise.all(
    placeholders.map(async ({ id, spec, orientation }) => {
      try {
        await resolveImageJob({
          nodeId: id,
          prompt: spec.prompt,
          apiKey,
          openrouterApiKey,
          orientation,
          inputReferences,
        });
      } catch (err) {
        errors.push(imageJobErrorMessage(err));
      }
    }),
  );

  if (errors.length > 0 && errors.length === placeholders.length) {
    options.onError?.(errors[0]!);
  }
}

export type ChatDrawImage = {
  id: string;
  title: string;
  prompt: string;
  url?: string;
  status: 'generating' | 'ready' | 'error';
  error?: string;
  orientation: ImageOrientation;
};

async function patchChatDrawImage(
  threadId: string,
  messageId: string,
  imageId: string,
  patch: Partial<ChatDrawImage>,
): Promise<void> {
  const row = await db.canvasPersonaThreads.get(threadId);
  if (!row) return;
  const messages = row.messages.map((m) => {
    if (m.id !== messageId) return m;
    return {
      ...m,
      images: (m.images ?? []).map((img) => (img.id === imageId ? { ...img, ...patch } : img)),
    };
  });
  await db.canvasPersonaThreads.put({ ...row, messages, updatedAt: Date.now() });
}

/** Re-run one failed chat illustration in place. Does not spawn a canvas card. */
export async function retryChatDrawImage(options: {
  threadId: string;
  messageId: string;
  imageId: string;
  apiKey?: string;
  openrouterApiKey?: string;
  inputReferences?: string[];
  onMissingKey?: () => void;
  onError?: (message: string) => void;
}): Promise<void> {
  if (!hasFlux302Credentials(options.apiKey, options.openrouterApiKey)) {
    options.onMissingKey?.();
    return;
  }
  const row = await db.canvasPersonaThreads.get(options.threadId);
  const message = row?.messages.find((m) => m.id === options.messageId);
  const slot = message?.images?.find((img) => img.id === options.imageId);
  const prompt = slot?.prompt.trim();
  if (!slot || !prompt) return;
  if (slot.status === 'generating') return;

  await patchChatDrawImage(options.threadId, options.messageId, options.imageId, {
    status: 'generating',
    error: undefined,
    url: undefined,
  });

  const orientation = slot.orientation ?? inferImageOrientation(prompt);
  try {
    const { url } = await generateGptImage2({
      apiKey: (options.apiKey ?? '').trim(),
      openrouterApiKey: (options.openrouterApiKey ?? '').trim(),
      prompt,
      orientation,
      inputReferences: options.inputReferences,
    });
    await patchChatDrawImage(options.threadId, options.messageId, options.imageId, {
      status: 'ready',
      url,
      error: undefined,
    });
  } catch (err) {
    if (isAbortError(err) && !isImageGenerationTimeoutError(err)) return;
    const error = imageJobErrorMessage(err);
    options.onError?.(error);
    await patchChatDrawImage(options.threadId, options.messageId, options.imageId, {
      status: 'error',
      error,
    });
  }
}

/** Generate draw-tool images without spawning canvas cards (side-panel chat). */
export async function fulfillDrawToolIntoChat(options: {
  images: DrawToolSpec[];
  apiKey?: string;
  openrouterApiKey?: string;
  inputReferences?: string[];
  onMissingKey?: () => void;
  onError?: (message: string) => void;
  onUpdate: (images: ChatDrawImage[]) => void | Promise<void>;
}): Promise<void> {
  const specs = options.images.slice(0, DRAW_TOOL_MAX_IMAGES);
  if (specs.length === 0) return;
  if (!hasFlux302Credentials(options.apiKey, options.openrouterApiKey)) {
    options.onMissingKey?.();
    return;
  }
  const apiKey = (options.apiKey ?? '').trim();
  const openrouterApiKey = (options.openrouterApiKey ?? '').trim();
  const slots: ChatDrawImage[] = specs.map((spec) => ({
    id: crypto.randomUUID(),
    title: spec.title,
    prompt: spec.prompt,
    status: 'generating',
    orientation: inferImageOrientation(spec.prompt, spec.orientation),
  }));
  await options.onUpdate(slots.map((s) => ({ ...s })));

  let publishChain = Promise.resolve();
  const publish = () => {
    const snapshot = slots.map((s) => ({ ...s }));
    publishChain = publishChain.then(() => Promise.resolve(options.onUpdate(snapshot)));
    return publishChain;
  };

  await Promise.all(
    slots.map(async (slot) => {
      try {
        const { url } = await generateGptImage2({
          apiKey,
          openrouterApiKey,
          prompt: slot.prompt,
          orientation: slot.orientation,
          inputReferences: options.inputReferences,
        });
        slot.url = url;
        slot.status = 'ready';
      } catch (err) {
        if (isAbortError(err) && !isImageGenerationTimeoutError(err)) return;
        slot.status = 'error';
        slot.error = imageJobErrorMessage(err);
        options.onError?.(slot.error);
      }
      await publish();
    }),
  );
}

/**
 * Re-run generation for a card left in the `error` / hung `generating` state,
 * reusing its own id so the card updates in place instead of spawning a second one.
 */
export async function retryImageGeneration(options: {
  nodeId: string;
  apiKey?: string;
  openrouterApiKey?: string;
  onMissingKey?: () => void;
}): Promise<void> {
  if (!hasFlux302Credentials(options.apiKey, options.openrouterApiKey)) {
    options.onMissingKey?.();
    return;
  }
  const node = await db.nodes.get(options.nodeId);
  if (!node) return;
  const prompt = (node.imagePrompt ?? '').trim();
  if (!prompt) return;

  await db.nodes.update(options.nodeId, {
    imageStatus: 'generating',
    imageError: undefined,
    imageStartedAt: Date.now(),
  });
  try {
    const orientation =
      orientationFromCardSize(node.width, node.height) ?? inferImageOrientation(prompt);
    await resolveImageJob({
      nodeId: options.nodeId,
      prompt,
      apiKey: (options.apiKey ?? '').trim(),
      openrouterApiKey: (options.openrouterApiKey ?? '').trim(),
      orientation,
      inputReferences: await resolveDrawInputReferences(options.nodeId, [options.nodeId]),
    });
  } catch {
    // Card already stores imageError inside resolveImageJob.
  }
}
