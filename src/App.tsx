import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { db, type CanvasNode, type AgentConfig, type CanvasWorkZone } from './db';
import {
  Maximize2,
  Minimize2,
  NotebookPen,
} from 'lucide-react';
import { commitCanvasInlineEditing } from './utils/commitCanvasInlineEditing';
import { registerCanvasUnloadFlush } from './utils/registerCanvasUnloadFlush';
import { getCanvasNodeContextText } from './utils/canvasNodeContextText';
import { canStartAgentDiscussion, isAgentDiscussionLeaf } from './utils/agentDiscussion';
import { askAiRequiresLinkedPersona, canAskAiOnNode, nodeIdsLinkedToAskPersona } from './utils/canvasAskAi';
import { spokenFallbackFromWritten } from './utils/voiceSpokenBrief';
import { visibleAiReplyText } from './utils/visibleAiReply';
import { nodeSupportsCycleLayout } from './constants/nodeCapabilities';
import { NOTE_LAYOUT_COUNT } from './constants/noteLayouts';
import { CanvasEdgeLines } from './components/canvas/CanvasEdgeLines';
import { WorkZoneRegionsLayer } from './components/canvas/WorkZoneRegionsLayer';
import { CanvasChatPanel } from './components/canvas/CanvasChatPanel';
import { resolveAgentLocalizedName } from './utils/aiI18n';
import { isCanvasV2Enabled } from './utils/canvasV2';
import {
  applyWorkZoneOnDragEnd,
  collectWorkZoneContextPayload,
  defaultExcerptNoteSize,
  isPersonaAnchorNode,
  personaBlockedByForeignWorkZone,
  personaThreadId,
  pickPersonaToClaimUnboundZone,
} from './utils/agentWorkZone';
import { reconcileNodeScopesFromZones, stampWorkZoneScopeOnNewNodes } from './utils/syncWorkZoneScopes';
import { planSourceSelectionAsk } from './utils/sourceSelectionAsk';
import {
  hitTestWorkZoneBody,
  hitTestWorkZoneResize,
  personaIdForEmptyCanvasClick,
  resizeWorkZoneRect,
  translateWorkZoneRect,
  workZoneRectsEqual,
  workZoneResizeCursor,
  worldRectFromPoints,
} from './utils/workZoneGeometry';
import { migrateCanvasToWorkZones } from './utils/migrateCanvasToWorkZones';
import {
  EMPTY_COMPOSER,
  focusNodeIdsFromSegments,
  mergeSelectionIntoComposer,
  normalizeComposerSegments,
  userTextFromSegments,
  type ComposerSegment,
} from './utils/chatComposer';

function logWorkZone(event: string, payload?: Record<string, unknown>) {
  console.info(`[Spoor WorkZone] ${event}`, payload ?? {});
}
import { DraggableNode } from './components/canvas/DraggableNode';
import { PublishSequenceMode, PublishSequenceBadge } from './components/PublishSequenceMode';
import { useAuth } from './contexts/AuthContext';
import { useBilling } from './contexts/BillingContext';
import { setServerConfig, isServerManaged } from './lib/serverConfig';
import { Sidebar } from './components/Sidebar';
import { PocketView } from './components/PocketView';
import { CanvasHistoryPopover } from './components/CanvasHistoryPopover';
import { POCKET_CANVAS_ID, pocketNotePreview } from './utils/pocketNotes';
import { useOnboarding, ONBOARDING_INTUITION_PUMP_STORAGE_KEY, ONBOARDING_TURTLE_SOUP_STORAGE_KEY } from './onboarding/useOnboarding';
import { useOnboardingGates } from './onboarding/useOnboardingGates';
import { OnboardingOverlay } from './onboarding/OnboardingOverlay';
import { resolveOnboardingHighlightRect, resolveOnboardingHighlightRects, resolveOnboardingDragArrowRects, resolveOnboardingTooltipAnchorRect, transformToFitOnboardingStep } from './onboarding/onboardingHighlight';
import { TOUR_STEPS } from './onboarding/tourSteps';
import { INTUITION_PUMP_TOUR_STEPS } from './onboarding/intuitionPumpTourSteps';
import { TURTLE_SOUP_TOUR_STEPS } from './onboarding/turtleSoupTourSteps';
import { writeVoiceListenHintSeen } from './utils/voiceListenHint';
import { CanvasNoteSearch } from './components/CanvasNoteSearch';
import { CanvasToolbar } from './components/CanvasToolbar';
import { transformToFocusNode } from './utils/voiceNoteLayout';
import { transformToFitNodes } from './utils/canvasViewport';
import {
  applyOnboardingWorkroomLayout,
  onboardingOutsideMaterialNodes,
  ONBOARDING_MATERIAL_TEMPLATE_KEY,
} from './utils/onboardingWorkroomLayout';
import { spawnOnboardingTourCanvas } from './utils/spawnOnboardingTourCanvas';
import { OFFICIAL_DEFAULT_STARTER_NODE_IDS } from './constants/defaultWorkspace';
import { clearNodeDragOffset, setNodeDragOffset } from './utils/nodeDragVisual';
import {
  applyPalettePatchToAppliers,
  paletteTargetIds,
  type NodePaletteApplier,
  type NodePalettePatch,
} from './utils/nodePaletteStyle';
import { AISettingsModal, type AIConfig } from './components/AISettingsModal';
import { createLatestWinsWriter } from './utils/latestWinsWriter';
import { callUniversalAI } from './services/ai';
import { resolveDrawInputReferences, retryChatDrawImage, retryImageGeneration } from './services/fulfillDrawTool';
import { fluxImageCardSize, spawnFluxImageCard } from './services/spawnFluxImageCards';
import { imageKeysFromAiConfig } from './services/flux302';
import { formatImageGenerationError } from './utils/imageGenerationWait';
import { MIMO_TOKEN_PLAN_BASE_URL } from './constants/mimo';
import { DOUBAO_ARK_BASE_URL, DOUBAO_DEFAULT_MODEL, resolveDoubaoChatModel } from './constants/doubao';
import { NodeRenderer } from './components/nodes/NodeRenderer';
import { useSeedData } from './hooks/useSeedData';
import { useUserProfile } from './hooks/useUserProfile';
import { useFullscreen } from './hooks/useFullscreen';
import { useCanvasInteraction } from './hooks/useCanvasInteraction';
import { useNodeActions } from './hooks/useNodeActions';
import { useAiActions } from './hooks/useAiActions';
import { useVoiceWritingMode } from './hooks/useVoiceWritingMode';
import { useAppDialog } from './components/AppDialogProvider';
import { detectAdaptiveLayout, useAdaptiveLayout } from './hooks/useAdaptiveLayout';
import { ASK_NODE_SIZE, DEFAULT_NODE_SIZE, estimateNodeRect, findOpenCanvasPosition, getCanvasCenterPosition, THEME_NODE_SIZE } from './utils/canvas';
import {
  clientToWorld,
  isNearMarqueeEdge,
  marqueeEdgePanDelta,
  marqueeScreenRect,
} from './utils/marqueeEdgePan';
import { listCanvasVoicePersonas, resolveToolbarVoiceThreadRoot, readStoredVoicePin, writeStoredVoicePin, shouldClearVoicePin, hasCanvasAskCard, coerceToolbarVoicePin } from './utils/canvasAskContext';
import { isTurtleSoupHostAgent } from './utils/agentPersonaSource';
import { ingestFilesToCanvas } from './utils/canvasFileIngest';
import { personaChatUploadOrigin } from './utils/chatPanelFileUpload';
import { excerptSearchHitToCanvas, excerptToCanvas, readChatExcerptDrag } from './utils/excerptToCanvas';
import { normalizePastedCanvasText, spawnNoteFromPastedText } from './utils/spawnPastedTextNote';
import { scheduleLegacyArticleMediaMigration } from './utils/migrateArticleMedia';
import { dataTransferHasFiles, preventDefaultIfFileDrag } from './utils/dnd';
import {
  buildCanvasClipboardPayload,
  isTextEditingTarget,
  materializeCanvasPaste,
  parseCanvasClipboardPayload,
  recenterNodesToViewport,
  snapshotNodesAndTouchingEdges,
} from './utils/canvasClipboard';
import { shouldDeferToNativeClipboard } from './utils/noteClipboard';
import { applyCanvasUndo, createCanvasUndoStack, isWorkZoneUndoEntry } from './utils/canvasUndoStack';
import {
  listWebSearchSourcesForParent,
  setWebSearchSourcesCollapsed,
  SOURCE_CARD_HEIGHT,
  SOURCE_CARD_WIDTH,
  sourceImageScatterTiltDeg,
  sourceStackTiltDeg,
  sourceStackZIndex,
  webSearchSourceIndex,
} from './services/spawnWebSearchNoteCards';
import {
  enrichUrlNoteFromPage,
  parseLoneHttpUrl,
  spawnCardFromPastedUrl,
} from './services/spawnUrlPasteCard';
import {
  bookExpandBranchIndex,
  bookExpandStackZIndex,
  resolveBookExpandBranches,
  setBookExpandBranchesCollapsed,
} from './services/spawnBookExpandCards';
import {
  askThreadStackFrontIndex,
  askThreadStackTiltDeg,
  askThreadStackZIndex,
  expandCollapsedAskThreads,
  listAskThreadReplies,
  setAskThreadCollapsed,
} from './services/askThreadStack';
import {
  backfillEssaySourceNodeIds,
  essaySourceStackIndex,
  essaySourceStackPos,
  essaySourceStackZIndex,
  listEssaySourceNodes,
  setEssaySourcesCollapsed,
} from './services/essaySourceStack';
import {
  collapsedNotePilePeerIds,
  expandSelectionWithNotePiles,
  listNotePileMembers,
  maybeLeaveNotePile,
  notePileStackZIndex,
  notePileVisualIndex,
  notePileWritingIndex,
  pickNotePileSnapTarget,
  resolveNotePileHubId,
  setNotePileCollapsed,
  shiftNotePileOrigin,
  snapNodeOntoNode,
} from './services/notePile';
import { collectNodesIntoEssay, pickEssayCollectTarget } from './services/essayCollect';
import { resolveEssayRelatedNodeIds } from './utils/essayRelatedHighlight';
import { isArchivableNodeType } from './utils/archiveCards';
import { stampNewCard, stampNewCards } from './utils/stampNewCard';
import { ensureAmbienceNodeForCanvas, isAmbienceFixtureNode, setAmbienceHiddenForCanvas } from './utils/ensureAmbienceNode';
import { disposeAmbienceMixer } from './services/ambienceMixer';
import { isTauriRuntime } from './utils/isTauriRuntime';
import { preloadUiSfx } from './utils/uiSfx';

const BookFullscreen = React.lazy(() =>
  import('./components/BookFullscreen').then((module) => ({ default: module.BookFullscreen })),
);
const EssayFullscreen = React.lazy(() =>
  import('./components/EssayFullscreen').then((module) => ({ default: module.EssayFullscreen })),
);
const ArchiveLibrary = React.lazy(() =>
  import('./components/ArchiveLibrary').then((module) => ({ default: module.ArchiveLibrary })),
);
const AgentsStudio = React.lazy(() =>
  import('./components/AgentsStudio').then((module) => ({ default: module.AgentsStudio })),
);

/** 控制台执行 localStorage.setItem('SCRIBE_DEBUG_DND','1') 并刷新；桌面打包版也可用（不设 DEV 门槛）。 */
const DEBUG_DND =
  typeof localStorage !== 'undefined' &&
  localStorage.getItem('SCRIBE_DEBUG_DND') === '1';

/** tp- Token 套餐密钥须走 token-plan-cn；旧版默认 api.xiaomimimo.com 会导致 401 */
function migrateStoredAiConfig(raw: unknown): AIConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  let p = raw as AIConfig;
  if (p.provider === 'mimo') {
    const b = (p.baseUrl ?? '').trim();
    if (!b || /api\.xiaomimimo\.com/i.test(b)) {
      p = { ...p, baseUrl: MIMO_TOKEN_PLAN_BASE_URL };
    }
    const keyEmpty = !(p.apiKey ?? '').trim();
    const defaultMimoModel = !p.model?.trim() || p.model === 'mimo-v2.5-pro';
    if (keyEmpty && defaultMimoModel) {
      return {
        ...p,
        provider: 'doubao',
        apiKey: '',
        baseUrl: DOUBAO_ARK_BASE_URL,
        model: DOUBAO_DEFAULT_MODEL,
      };
    }
    return p;
  }
  if (p.provider === 'doubao') {
    const b = (p.baseUrl ?? '').trim();
    const nextModel = resolveDoubaoChatModel(p.model);
    const modelChanged = nextModel !== (p.model ?? '').trim();
    if (!b || modelChanged) {
      return {
        ...p,
        baseUrl: b || DOUBAO_ARK_BASE_URL,
        ...(modelChanged ? { model: nextModel } : {}),
      };
    }
  }
  if (p.provider === 'openrouter' && /glm-5\.3/i.test(p.model ?? '')) {
    return { ...p, model: 'openai/gpt-5.6-terra' };
  }
  return p;
}
export default function App() {
  const { t, i18n } = useTranslation();
  const { alert: appAlert } = useAppDialog();
  const { touchChrome, phone } = useAdaptiveLayout();
  const nodesRef = useRef<Record<string, HTMLElement | null>>({});
  const svgRef = useRef<SVGSVGElement>(null);
  const edgeLabelsRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const contentContainerRef = useRef<HTMLDivElement>(null);

  // Local-only UI states
  const [activeCanvasId, setActiveCanvasId] = useState<string>(() => {
    const saved = localStorage.getItem('active_canvas_id') || 'default';
    return saved === POCKET_CANVAS_ID ? 'default' : saved;
  });

  // Database-backed states
  const agentConfigs = useLiveQuery(() => db.agents.toArray()) || [];
  const persistAgentConfigs = useRef(
    createLatestWinsWriter(async (newConfigs: AgentConfig[]) => {
      const nextIds = new Set(newConfigs.map((c) => c.id));
      const existing = await db.agents.toArray();
      await Promise.all(existing.filter((row) => !nextIds.has(row.id)).map((row) => db.agents.delete(row.id)));
      await Promise.all(newConfigs.map((config) => db.agents.put(config)));
    }),
  ).current;
  const dynamicNodesQuery = useLiveQuery(() => 
    db.nodes.filter(node => {
      if (node.canvasId === POCKET_CANVAS_ID) return false;
      return (node.canvasId === activeCanvasId) || (!node.canvasId && activeCanvasId === 'default');
    }).toArray()
  , [activeCanvasId]);
  const pocketNodes = useLiveQuery(
    () => db.nodes.where('canvasId').equals(POCKET_CANVAS_ID).toArray(),
    [],
  ) ?? [];
  const pocketCount = pocketNodes.filter((node) => pocketNotePreview(node.content)).length;
  const dynamicNodes = dynamicNodesQuery ?? [];
  const edges = useLiveQuery(() => 
    db.edges.filter(edge => (edge.canvasId === activeCanvasId) || (!edge.canvasId && activeCanvasId === 'default')).toArray()
  , [activeCanvasId]) || [];
  const canvasWorkZones = useLiveQuery(
    () =>
      activeCanvasId
        ? db.canvasWorkZones.where('canvasId').equals(activeCanvasId).toArray()
        : [],
    [activeCanvasId],
  ) ?? [];
  const workZoneGestureRectRef = useRef<{
    id: string;
    rect: { x: number; y: number; width: number; height: number };
  } | null>(null);
  const workZoneDetachGestureRef = useRef<(() => void) | null>(null);
  const canvasWorkZonesRef = useRef(canvasWorkZones);
  const canvasUndoStackRef = useRef(createCanvasUndoStack());
  if (!workZoneGestureRectRef.current) {
    canvasWorkZonesRef.current = canvasWorkZones;
  }
  const canvases = useLiveQuery(() => db.canvases.toArray()) || [];

  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const selectedNodesRef = useRef(selectedNodes);
  selectedNodesRef.current = selectedNodes;
  const paletteAppliersRef = useRef(new Map<string, NodePaletteApplier>());
  const registerPaletteApplier = useCallback((id: string, apply: NodePaletteApplier | null) => {
    if (apply) paletteAppliersRef.current.set(id, apply);
    else paletteAppliersRef.current.delete(id);
  }, []);
  const applyPaletteStyle = useCallback((originId: string, patch: NodePalettePatch) => {
    applyPalettePatchToAppliers(
      paletteTargetIds(originId, selectedNodesRef.current),
      paletteAppliersRef.current,
      patch,
    );
  }, []);
  const dynamicNodesRef = useRef(dynamicNodes);
  dynamicNodesRef.current = dynamicNodes;
  /** Soft ring for essay card + its synthesize source cards (body click, not fullscreen). */
  const [relatedHighlightNodeIds, setRelatedHighlightNodeIds] = useState<Set<string>>(new Set());
  const [essayCollectHoverId, setEssayCollectHoverId] = useState<string | null>(null);
  const [essayCollectPulseId, setEssayCollectPulseId] = useState<string | null>(null);
  const essayCollectPulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const relatedHighlightReqRef = useRef(0);
  const [fullscreenEssay, setFullscreenEssay] = useState<{ articleId: string; nodeId: string } | null>(null);
  const [fullscreenBookNodeId, setFullscreenBookNodeId] = useState<string | null>(null);
  const canvasImmersive = Boolean(fullscreenEssay || fullscreenBookNodeId);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(() =>
    detectAdaptiveLayout().phone ? 'pocket' : 'personal',
  );
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [activeChatAgentNodeId, setActiveChatAgentNodeId] = useState<string | null>(null);
  const [workZoneDrawMode, setWorkZoneDrawMode] = useState(false);
  const [workZoneDraftRect, setWorkZoneDraftRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [workZoneResizePreview, setWorkZoneResizePreview] = useState<{
    id: string;
    rect: { x: number; y: number; width: number; height: number };
  } | null>(null);
  const [selectedWorkZoneId, setSelectedWorkZoneId] = useState<string | null>(null);

  useEffect(() => {
    if (!workZoneResizePreview) return;
    const live = canvasWorkZones.find((zone) => zone.id === workZoneResizePreview.id);
    if (!live) {
      logWorkZone('preview kept: live query missing zone', {
        previewId: workZoneResizePreview.id,
        liveCount: canvasWorkZones.length,
      });
      return;
    }
    if (workZoneRectsEqual(live, workZoneResizePreview.rect)) {
      logWorkZone('preview drop: live query caught up', { id: live.id, live });
      workZoneGestureRectRef.current = null;
      setWorkZoneResizePreview(null);
    }
  }, [canvasWorkZones, workZoneResizePreview]);
  const [scrollToChatMessageId, setScrollToChatMessageId] = useState<string | null>(null);
  const canvasV2Enabled = isCanvasV2Enabled();
  const linkGhostRef = useRef<HTMLDivElement | null>(null);
  // Onboarding tour — auto-opens for first-time users; settings modal has a "Restart tour" hook.
  const onboarding = useOnboarding(TOUR_STEPS, phone ? { initialActive: false } : {});
  // Canvas-specific tour for the official intuition-pump template. Mounted
  // silent — `autoStartIntuitionPumpTour` flips it on the first time the
  // user lands on a canvas stamped from that template.
  const intuitionPumpOnboarding = useOnboarding(INTUITION_PUMP_TOUR_STEPS, {
    storageKey: ONBOARDING_INTUITION_PUMP_STORAGE_KEY,
    initialActive: false,
  });
  // Canvas-specific tour for the official turtle-soup template.
  const turtleSoupOnboarding = useOnboarding(TURTLE_SOUP_TOUR_STEPS, {
    storageKey: ONBOARDING_TURTLE_SOUP_STORAGE_KEY,
    initialActive: false,
  });
  const restartTour = useCallback(() => {
    writeVoiceListenHintSeen(false);
    setIsSettingsOpen(false);
    if (!canvasV2Enabled) {
      onboarding.restart();
      return;
    }
    void spawnOnboardingTourCanvas({ name: t('onboarding.tour_canvas_name') })
      .then((canvasId) => {
        tourRestartCanvasIdRef.current = canvasId;
        setActiveCanvasId(canvasId);
      })
      .catch(() => {
        onboarding.restart();
      });
  }, [canvasV2Enabled, onboarding.restart, t]);

  useEffect(() => {
    if (!phone || activeTab !== 'personal') return;
    onboarding.startIfUnseen();
  }, [phone, activeTab, onboarding.startIfUnseen]);

  // Auto-start canvas-specific tours the first time this browser lands on a
  // matching official template. `startIfUnseen` stamps localStorage immediately
  // so switching canvases (which re-runs this effect as nodes swap) cannot
  // replay the walkthrough. Close an in-flight canvas tour when leaving that
  // canvas so leftover tooltips do not sit on the next board.
  const prevCanvasIdForTourRef = useRef(activeCanvasId);
  const tourRestartCanvasIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevCanvasIdForTourRef.current === activeCanvasId) return;
    prevCanvasIdForTourRef.current = activeCanvasId;
    if (turtleSoupOnboarding.isActive) turtleSoupOnboarding.skip();
    if (intuitionPumpOnboarding.isActive) intuitionPumpOnboarding.skip();
  }, [
    activeCanvasId,
    turtleSoupOnboarding.isActive,
    turtleSoupOnboarding.skip,
    intuitionPumpOnboarding.isActive,
    intuitionPumpOnboarding.skip,
  ]);
  useEffect(() => {
    if (activeTab !== 'personal') return;
    if (canvasImmersive) return;
    const hasTemplateCards = dynamicNodes.some(
      (n) =>
        (n.templateKey === 'theme-howto' && n.type === 'theme') ||
        (n.templateKey === 'agent-host' && n.type === 'agent'),
    );
    if (!hasTemplateCards) return;
    const hostNode = dynamicNodes.find(
      (n) => n.templateKey === 'agent-host' && n.type === 'agent' && n.agentConfigId,
    );
    const hostAgent = hostNode?.agentConfigId
      ? agentConfigs.find((a) => a.id === hostNode.agentConfigId)
      : undefined;
    if (hostAgent && isTurtleSoupHostAgent(hostAgent)) {
      turtleSoupOnboarding.startIfUnseen();
      return;
    }
    if (hostAgent && hostAgent.communityPersonaKey === 'official:intuition_pump_expert') {
      intuitionPumpOnboarding.startIfUnseen();
      return;
    }
    // Fallback: a template-stamped canvas whose persona we can't classify
    // (e.g. user-cloned template). Default to the intuition-pump tour since
    // it shares the same DOM targets and the copy still roughly fits.
    intuitionPumpOnboarding.startIfUnseen();
  }, [
    dynamicNodes,
    agentConfigs,
    activeTab,
    canvasImmersive,
    intuitionPumpOnboarding.startIfUnseen,
    turtleSoupOnboarding.startIfUnseen,
  ]);

  /** Filled after useNodeActions mounts — canvas blank-click spawn uses this. */
  const createLinkedNoteAtRef = useRef<
    (fromId: string, x: number, y: number) => Promise<string | null>
  >(async () => null);

  // User Profile (kept for persistence / future settings; not shown on canvas rail)
  useUserProfile();

  // Fullscreen
  const { isFullscreen, toggleFullscreen } = useFullscreen(mainRef);

  // Canvas interaction (transform, pan, zoom, edge lines)
  const { canvasTransform, setCanvasTransform, transformRef, handlePanStart, nudgeTransform, commitTransform } = useCanvasInteraction(
    mainRef,
    contentContainerRef,
    svgRef,
    edgeLabelsRef,
    nodesRef,
    connectingFrom,
    setConnectingFrom,
    activeCanvasId,
    activeTab === 'personal' && !canvasImmersive,
    linkGhostRef,
  );

  const fitCanvasToNodes = useCallback(() => {
    const host = mainRef.current;
    if (!host) return;
    setCanvasTransform(
      transformToFitNodes(dynamicNodesRef.current, {
        width: host.clientWidth,
        height: host.clientHeight,
      }),
    );
  }, [setCanvasTransform]);

  const persistWorkZoneRect = useCallback(async (
    origin: CanvasWorkZone,
    next: { x: number; y: number; width: number; height: number },
    reason: string,
  ) => {
    const preview = { id: origin.id, rect: next };
    workZoneGestureRectRef.current = preview;
    setWorkZoneResizePreview(preview);
    logWorkZone('persist start', {
      reason,
      id: origin.id,
      origin: { x: origin.x, y: origin.y, width: origin.width, height: origin.height },
      next,
    });
    try {
      const modified = await db.canvasWorkZones.update(origin.id, {
        x: next.x,
        y: next.y,
        width: next.width,
        height: next.height,
      });
      const stored = await db.canvasWorkZones.get(origin.id);
      logWorkZone('persist dexie', {
        reason,
        id: origin.id,
        modified,
        stored: stored
          ? { x: stored.x, y: stored.y, width: stored.width, height: stored.height }
          : null,
      });
      if (modified === 0) {
        await db.canvasWorkZones.put({ ...origin, ...next });
        logWorkZone('persist fallback put', { id: origin.id, next });
      }
      const zones = canvasWorkZonesRef.current.map((zone) =>
        zone.id === origin.id ? { ...zone, ...next } : zone,
      );
      canvasWorkZonesRef.current = zones;
      canvasUndoStackRef.current.push({ type: 'workZoneUpdate', before: { ...origin } });
      await reconcileNodeScopesFromZones(dynamicNodesRef.current, zones);
    } catch (error) {
      console.error('[Spoor WorkZone] persist failed', error);
      workZoneGestureRectRef.current = null;
      setWorkZoneResizePreview(null);
    }
  }, []);

  const handleCanvasPanPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const nodeRow = editingNodeId ? dynamicNodes.find((n) => n.id === editingNodeId) : undefined;
      commitCanvasInlineEditing({
        editingNodeId,
        nodesRef,
        nodeType: nodeRow?.type,
      });
      if (e.button === 1) {
        handlePanStart(e);
        return;
      }
      if (e.button !== 0) return;

      if (canvasV2Enabled && workZoneDrawMode) {
        e.preventDefault();
        const main = mainRef.current;
        if (!main) return;
        const bounds = main.getBoundingClientRect();
        const startWorld = clientToWorld(
          e.clientX,
          e.clientY,
          bounds.left,
          bounds.top,
          transformRef.current,
        );
        const resizeHit = hitTestWorkZoneResize(
          canvasWorkZonesRef.current,
          startWorld,
          transformRef.current.scale,
          selectedWorkZoneId,
        );
        if (resizeHit) {
          const origin = canvasWorkZonesRef.current.find((zone) => zone.id === resizeHit.zoneId);
          if (!origin) return;
          setSelectedWorkZoneId(origin.id);
          const pointerId = e.pointerId;
          workZoneDetachGestureRef.current?.();
          let finished = false;
          const detach = () => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerCancel);
            if (workZoneDetachGestureRef.current === detach) workZoneDetachGestureRef.current = null;
          };
          const onPointerMove = (moveEvent: PointerEvent) => {
            if (moveEvent.pointerId !== pointerId) return;
            const world = clientToWorld(
              moveEvent.clientX,
              moveEvent.clientY,
              bounds.left,
              bounds.top,
              transformRef.current,
            );
            const rect = resizeWorkZoneRect(origin, resizeHit.handle, world);
            workZoneGestureRectRef.current = { id: origin.id, rect };
            setWorkZoneResizePreview({ id: origin.id, rect });
          };
          const finish = (endEvent: PointerEvent, reason: string) => {
            if (endEvent.pointerId !== pointerId) return;
            if (finished) {
              logWorkZone('resize ignore duplicate end', { reason, pointerId });
              return;
            }
            finished = true;
            detach();
            const last = workZoneGestureRectRef.current;
            const next = last?.id === origin.id
              ? last.rect
              : resizeWorkZoneRect(
                  origin,
                  resizeHit.handle,
                  clientToWorld(
                    endEvent.clientX,
                    endEvent.clientY,
                    bounds.left,
                    bounds.top,
                    transformRef.current,
                  ),
                );
            logWorkZone('resize end', {
              reason,
              pointerId,
              client: { x: endEvent.clientX, y: endEvent.clientY },
              next,
              origin: { x: origin.x, y: origin.y, width: origin.width, height: origin.height },
            });
            if (workZoneRectsEqual(next, origin)) {
              logWorkZone('resize skip persist (unchanged)', { reason });
              workZoneGestureRectRef.current = null;
              setWorkZoneResizePreview(null);
              return;
            }
            void persistWorkZoneRect(origin, next, `resize:${reason}`);
          };
          const onPointerUp = (upEvent: PointerEvent) => finish(upEvent, 'pointerup');
          const onPointerCancel = (cancelEvent: PointerEvent) => {
            logWorkZone('resize pointercancel', {
              pointerId,
              client: { x: cancelEvent.clientX, y: cancelEvent.clientY },
            });
            finish(cancelEvent, 'pointercancel');
          };
          window.addEventListener('pointermove', onPointerMove);
          window.addEventListener('pointerup', onPointerUp);
          window.addEventListener('pointercancel', onPointerCancel);
          workZoneDetachGestureRef.current = detach;
          return;
        }
        const bodyHit = hitTestWorkZoneBody(
          canvasWorkZonesRef.current,
          startWorld,
          selectedWorkZoneId,
        );
        if (bodyHit) {
          const marqueeEl = e.currentTarget;
          setSelectedWorkZoneId(bodyHit.id);
          marqueeEl.style.cursor = 'grabbing';
          const pointerId = e.pointerId;
          workZoneDetachGestureRef.current?.();
          let finished = false;
          const detach = () => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerCancel);
            if (workZoneDetachGestureRef.current === detach) workZoneDetachGestureRef.current = null;
          };
          const onPointerMove = (moveEvent: PointerEvent) => {
            if (moveEvent.pointerId !== pointerId) return;
            const world = clientToWorld(
              moveEvent.clientX,
              moveEvent.clientY,
              bounds.left,
              bounds.top,
              transformRef.current,
            );
            const rect = translateWorkZoneRect(
              bodyHit,
              world.x - startWorld.x,
              world.y - startWorld.y,
            );
            workZoneGestureRectRef.current = { id: bodyHit.id, rect };
            setWorkZoneResizePreview({ id: bodyHit.id, rect });
          };
          const finish = (endEvent: PointerEvent, reason: string) => {
            if (endEvent.pointerId !== pointerId) return;
            if (finished) {
              logWorkZone('move ignore duplicate end', { reason, pointerId });
              return;
            }
            finished = true;
            detach();
            marqueeEl.style.cursor = '';
            const last = workZoneGestureRectRef.current;
            logWorkZone('move end', {
              reason,
              pointerId,
              type: endEvent.type,
              client: { x: endEvent.clientX, y: endEvent.clientY },
              startClient: { x: e.clientX, y: e.clientY },
              last,
              origin: { x: bodyHit.x, y: bodyHit.y, width: bodyHit.width, height: bodyHit.height },
            });
            if (!last || last.id !== bodyHit.id || workZoneRectsEqual(last.rect, bodyHit)) {
              logWorkZone('move skip persist (no delta from pointermove)', { reason, last });
              workZoneGestureRectRef.current = null;
              setWorkZoneResizePreview(null);
              return;
            }
            void persistWorkZoneRect(bodyHit, last.rect, `move:${reason}`);
          };
          const onPointerUp = (upEvent: PointerEvent) => finish(upEvent, 'pointerup');
          const onPointerCancel = (cancelEvent: PointerEvent) => {
            logWorkZone('move pointercancel', {
              pointerId,
              client: { x: cancelEvent.clientX, y: cancelEvent.clientY },
            });
            finish(cancelEvent, 'pointercancel');
          };
          window.addEventListener('pointermove', onPointerMove);
          window.addEventListener('pointerup', onPointerUp);
          window.addEventListener('pointercancel', onPointerCancel);
          workZoneDetachGestureRef.current = detach;
          return;
        }
        let dragged = false;
        const onPointerMove = (moveEvent: PointerEvent) => {
          const endWorld = clientToWorld(
            moveEvent.clientX,
            moveEvent.clientY,
            bounds.left,
            bounds.top,
            transformRef.current,
          );
          const rect = worldRectFromPoints(startWorld, endWorld, 1);
          if (rect && (rect.width > 4 || rect.height > 4)) dragged = true;
          setWorkZoneDraftRect(rect);
        };
        const onPointerUp = (upEvent: PointerEvent) => {
          window.removeEventListener('pointermove', onPointerMove);
          window.removeEventListener('pointerup', onPointerUp);
          const endWorld = clientToWorld(
            upEvent.clientX,
            upEvent.clientY,
            bounds.left,
            bounds.top,
            transformRef.current,
          );
          const rect = worldRectFromPoints(startWorld, endWorld);
          setWorkZoneDraftRect(null);
          if (!rect || !dragged) {
            setSelectedWorkZoneId(null);
            return;
          }
          void (async () => {
            const occupant = pickPersonaToClaimUnboundZone(dynamicNodesRef.current, {
              id: 'draft',
              canvasId: activeCanvasId,
              ...rect,
              createdAt: Date.now(),
            });
            const zone: CanvasWorkZone = {
              id: crypto.randomUUID(),
              canvasId: activeCanvasId,
              ...(occupant ? { personaNodeId: occupant.id } : {}),
              ...rect,
              createdAt: Date.now(),
            };
            await db.canvasWorkZones.add(zone);
            canvasUndoStackRef.current.push({ type: 'workZoneCreate', zoneId: zone.id });
            setSelectedWorkZoneId(zone.id);
            await reconcileNodeScopesFromZones(
              dynamicNodesRef.current,
              [...canvasWorkZonesRef.current, zone],
            );
          })();
        };
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        return;
      }

      // Keep connectingFrom until pointerup — blank click may spawn a linked note.
      e.preventDefault();
      const main = mainRef.current;
      if (!main) return;
      const bounds = main.getBoundingClientRect();
      const startWorld = clientToWorld(
        e.clientX,
        e.clientY,
        bounds.left,
        bounds.top,
        transformRef.current,
      );
      const additive = e.shiftKey;
      const linkFromId = connectingFrom;
      let dragged = false;
      let lastClientX = e.clientX;
      let lastClientY = e.clientY;
      let lastEdgeTs = 0;
      let edgeRaf = 0;

      const rectFrom = (clientX: number, clientY: number) =>
        marqueeScreenRect({
          startWorldX: startWorld.x,
          startWorldY: startWorld.y,
          clientX,
          clientY,
          viewportLeft: bounds.left,
          viewportTop: bounds.top,
          transform: transformRef.current,
        });
      const stopEdgePan = () => {
        if (edgeRaf) {
          cancelAnimationFrame(edgeRaf);
          edgeRaf = 0;
        }
      };
      const edgeTick = (now: number) => {
        edgeRaf = 0;
        const dt = lastEdgeTs === 0 ? 16 : Math.min(48, now - lastEdgeTs);
        lastEdgeTs = now;
        const delta = marqueeEdgePanDelta({
          localX: lastClientX - bounds.left,
          localY: lastClientY - bounds.top,
          width: bounds.width,
          height: bounds.height,
          dtMs: dt,
        });
        if (delta.x === 0 && delta.y === 0) return;
        const t = transformRef.current;
        nudgeTransform({ ...t, x: t.x + delta.x, y: t.y + delta.y });
        const rect = rectFrom(lastClientX, lastClientY);
        if (rect.width > 4 || rect.height > 4) dragged = true;
        setMarqueeRect(rect);
        edgeRaf = requestAnimationFrame(edgeTick);
      };
      const syncMarqueeFromPointer = (clientX: number, clientY: number) => {
        lastClientX = clientX;
        lastClientY = clientY;
        const rect = rectFrom(clientX, clientY);
        if (rect.width > 4 || rect.height > 4) dragged = true;
        setMarqueeRect(rect);
        const nearEdge =
          dragged &&
          isNearMarqueeEdge(clientX - bounds.left, clientY - bounds.top, bounds.width, bounds.height);
        if (!nearEdge) {
          stopEdgePan();
          return;
        }
        if (!edgeRaf) {
          lastEdgeTs = 0;
          edgeRaf = requestAnimationFrame(edgeTick);
        }
      };
      const onPointerMove = (moveEvent: PointerEvent) => {
        syncMarqueeFromPointer(moveEvent.clientX, moveEvent.clientY);
      };
      const onPointerUp = (upEvent: PointerEvent) => {
        stopEdgePan();
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        commitTransform(transformRef.current);
        const rect = rectFrom(upEvent.clientX, upEvent.clientY);
        setMarqueeRect(null);
        if (!dragged) {
          if (linkFromId) {
            const xf = transformRef.current;
            const x =
              (upEvent.clientX - bounds.left - xf.x) / xf.scale - DEFAULT_NODE_SIZE.width / 2;
            const y =
              (upEvent.clientY - bounds.top - xf.y) / xf.scale - DEFAULT_NODE_SIZE.height / 2;
            void (async () => {
              const newId = await createLinkedNoteAtRef.current(linkFromId, x, y);
              if (!newId) return;
              setSelectedNodes(new Set([newId]));
              setEditingNodeId(newId);
            })();
            return;
          }
          setSelectedNodes(new Set());
          relatedHighlightReqRef.current += 1;
          setRelatedHighlightNodeIds(new Set());
          if (canvasV2Enabled && !workZoneDrawMode) {
            const world = clientToWorld(
              upEvent.clientX,
              upEvent.clientY,
              bounds.left,
              bounds.top,
              transformRef.current,
            );
            setActiveChatAgentNodeId(
              personaIdForEmptyCanvasClick(
                canvasWorkZonesRef.current,
                world,
                selectedWorkZoneId,
              ),
            );
          }
          return;
        }
        if (linkFromId) setConnectingFrom(null);
        const left = bounds.left + rect.x;
        const top = bounds.top + rect.y;
        const right = left + rect.width;
        const bottom = top + rect.height;
        const ids = Object.entries(nodesRef.current)
          .filter(([, element]) => {
            if (!element) return false;
            const nodeRect = element.getBoundingClientRect();
            return nodeRect.right >= left && nodeRect.left <= right && nodeRect.bottom >= top && nodeRect.top <= bottom;
          })
          .map(([id]) => id);
        relatedHighlightReqRef.current += 1;
        setRelatedHighlightNodeIds(new Set());
        setSelectedNodes((previous) => additive ? new Set([...previous, ...ids]) : new Set(ids));
      };
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    },
    [activeCanvasId, activeChatAgentNodeId, appAlert, canvasV2Enabled, connectingFrom, dynamicNodes, editingNodeId, handlePanStart, nudgeTransform, persistWorkZoneRect, commitTransform, selectedWorkZoneId, t, workZoneDrawMode],
  );

  const handleCanvasPointerCapture = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 1) return;
    e.preventDefault();
    e.stopPropagation();
    handleCanvasPanPointerDown(e as React.PointerEvent<HTMLDivElement>);
  }, [handleCanvasPanPointerDown]);

  const [aiConfig, setAiConfig] = useState(() => {
    let parsed: AIConfig | null = null;
    try {
      const saved = localStorage.getItem('ai_config');
      parsed = saved ? migrateStoredAiConfig(JSON.parse(saved)) : null;
    } catch (error) {
      console.warn('[Spoor] Ignoring invalid stored AI config', error);
    }
    if (!parsed || (parsed.provider === 'gemini' && !parsed.apiKey?.trim())) {
      return {
        provider: 'doubao',
        apiKey: '',
        baseUrl: DOUBAO_ARK_BASE_URL,
        model: DOUBAO_DEFAULT_MODEL,
      };
    }
    return parsed;
  });

  // ─── Server-managed sync ──────────────────────────────────
  // When a Supabase session is present we force `useServerKeys = true` so
  // services route through the Edge Function proxy (the user doesn't need to
  // fill in any keys). The mirror into `serverConfig` lets non-React service
  // modules read it synchronously.
  // Hosted AI (Edge Function keys) is available to any signed-in user.
  // Free accounts are capped for life; Pro has monthly text/image caps.
  const authCtx = useAuth();
  const billing = useBilling();
  useEffect(() => {
    setServerConfig({
      session: authCtx.session,
      useServerKeys: aiConfig.useServerKeys !== false,
      isPro: billing.isPro,
    });
  }, [authCtx.session, aiConfig.useServerKeys, billing.isPro]);

  useEffect(() => {
    if (billing.loading) return;
    if (authCtx.session && aiConfig.useServerKeys !== true) {
      setAiConfig((prev) => ({ ...prev, useServerKeys: true }));
    }
    if (!authCtx.session && aiConfig.useServerKeys) {
      setAiConfig((prev) => ({ ...prev, useServerKeys: false }));
    }
  }, [authCtx.session, billing.loading, aiConfig.useServerKeys]);

  useEffect(() => {
    // When server-managed, strip key fields from localStorage so they never
    // sit in the browser. Non-key fields (provider/model/voiceId/resourceId)
    // are still persisted so the user's UI selections survive reloads.
    if (!isServerManaged()) {
      localStorage.setItem('ai_config', JSON.stringify(aiConfig));
      return;
    }
    const { apiKey: _k, metasoApiKey: _m, api302Key: _a, volcAsrApiKey: _va, volcAsrAppId: _vai, volcAsrAccessToken: _vat, minimaxApiKey: _mm, ...persisted } = aiConfig;
    void _k; void _m; void _a; void _va; void _vai; void _vat; void _mm;
    localStorage.setItem('ai_config', JSON.stringify(persisted));
  }, [aiConfig]);

  useEffect(() => {
    localStorage.setItem('active_canvas_id', activeCanvasId);
  }, [activeCanvasId]);

  useSeedData();

  useEffect(() => registerCanvasUnloadFlush(), []);

  useEffect(() => {
    void scheduleLegacyArticleMediaMigration();
  }, []);

  useEffect(() => {
    void backfillEssaySourceNodeIds();
  }, []);

  const lastStickyClickIdRef = useRef<string | null>(null);
  useEffect(() => {
    lastStickyClickIdRef.current = null;
    canvasUndoStackRef.current.clear();
  }, [activeCanvasId, activeTab]);

  /**
   * 捕获阶段放行文件拖放：子元素（连线粗命中区、video/img 等）若未调用 dragover.preventDefault，
   * 浏览器会禁止放置；在 main 上捕获可先放行整张画布。
   * Manual QA：Chrome vs Tauri；空白区 vs 连线附近 vs 节点上；参见 localStorage SCRIBE_DEBUG_DND='1'。
   */
  useLayoutEffect(() => {
    if (activeTab !== 'personal') return;
    const el = mainRef.current;
    if (!el) return;

    const handleCaptureDragEnter = (e: DragEvent) => {
      preventDefaultIfFileDrag(e);
      if (!DEBUG_DND || !dataTransferHasFiles(e.dataTransfer)) return;
      const t = e.target;
      const tag = t instanceof Element ? t.tagName : String(t);
      console.debug('[dnd:dragenter]', {
        tag,
        types: e.dataTransfer ? Array.from(e.dataTransfer.types) : [],
      });
    };

    const handleCaptureDragOver = (e: DragEvent) => {
      preventDefaultIfFileDrag(e);
    };

    el.addEventListener('dragenter', handleCaptureDragEnter, true);
    el.addEventListener('dragover', handleCaptureDragOver, true);
    return () => {
      el.removeEventListener('dragenter', handleCaptureDragEnter, true);
      el.removeEventListener('dragover', handleCaptureDragOver, true);
    };
  }, [activeTab]);

  // Node actions (CRUD, selection, linking)
  const clearRelatedHighlight = useCallback(() => {
    relatedHighlightReqRef.current += 1;
    setRelatedHighlightNodeIds(new Set());
  }, []);

  const handleEssayActivate = useCallback(
    (essayNodeId: string) => {
      const req = ++relatedHighlightReqRef.current;
      void (async () => {
        const ids = await resolveEssayRelatedNodeIds({
          essayNodeId,
          canvasId: activeCanvasId,
          canvasNodeIds: new Set(dynamicNodesRef.current.map((n) => n.id)),
        });
        if (req !== relatedHighlightReqRef.current) return;
        setRelatedHighlightNodeIds(ids);
      })();
    },
    [activeCanvasId],
  );

  useEffect(() => {
    clearRelatedHighlight();
  }, [activeCanvasId, clearRelatedHighlight]);

  // Every canvas keeps a compact ambience fixture (not created from the toolbar).
  useEffect(() => {
    if (!activeCanvasId || activeCanvasId === POCKET_CANVAS_ID) return;
    void ensureAmbienceNodeForCanvas({
      canvasId: activeCanvasId,
      transform: transformRef.current,
    });
  }, [activeCanvasId]);

  useEffect(() => {
    preloadUiSfx();
  }, []);

  const openEssayFullscreen = useCallback((articleId: string, nodeId: string) => {
    setFullscreenEssay({ articleId, nodeId });
    setFullscreenBookNodeId(null);
  }, []);

  const closeEssayFullscreen = useCallback(() => {
    setFullscreenEssay(null);
  }, []);

  const openBookFullscreen = useCallback((nodeId: string) => {
    setFullscreenBookNodeId(nodeId);
    setFullscreenEssay(null);
  }, []);

  const closeBookFullscreen = useCallback(() => {
    setFullscreenBookNodeId(null);
  }, []);

  const { handleLink, createLinkedNoteAt, deleteEdge, removeNodeId, removeNodeIds, archiveNodeId, addTextNode, addThemeNode, addEssayNode, addAskNode, addFileNode, toggleNodeSelection } = useNodeActions({
    activeCanvasId, nodesRef, connectingFrom, setConnectingFrom, edges, selectedNodes, setSelectedNodes, transformRef,
    onOpenEssay: openEssayFullscreen,
  });
  createLinkedNoteAtRef.current = createLinkedNoteAt;

  // Link mode: Esc / right-click cancels. Ghost position is a DOM write on the
  // canvas rAF path (see useCanvasInteraction) so pointermove does not re-render App.
  useEffect(() => {
    if (!connectingFrom) return;
    const cancelLinkMode = () => setConnectingFrom(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelLinkMode();
    };
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      cancelLinkMode();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('contextmenu', onContextMenu);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('contextmenu', onContextMenu);
    };
  }, [connectingFrom]);

  const canvasClipboardRef = useRef({
    dynamicNodes,
    edges,
    activeCanvasId,
    selectedNodes,
    removeNodeIds,
    transformRef,
  });
  canvasClipboardRef.current = {
    dynamicNodes,
    edges,
    activeCanvasId,
    selectedNodes,
    removeNodeIds,
    transformRef,
  };

  /** Trash / programmatic delete: same undo snapshot as Delete/Backspace & Cut. */
  const deleteNodesWithUndo = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const { dynamicNodes: nodes, edges: canvasEdges } = canvasClipboardRef.current;
      const snap = snapshotNodesAndTouchingEdges(ids, nodes, canvasEdges);
      if (snap.nodes.length === 0) return;
      void (async () => {
        const deleted = await canvasClipboardRef.current.removeNodeIds(ids);
        if (deleted.length === 0) return;
        setActiveChatAgentNodeId((current) =>
          current && deleted.includes(current) ? null : current,
        );
        const keptNodes = snap.nodes.filter((n) => deleted.includes(n.id));
        const keptIds = new Set(keptNodes.map((n) => n.id));
        const keptEdges = snap.edges.filter((e) => keptIds.has(e.from) || keptIds.has(e.to));
        canvasUndoStackRef.current.push({ type: 'delete', nodes: keptNodes, edges: keptEdges });
        if (editingNodeId && deleted.includes(editingNodeId)) setEditingNodeId(null);
      })();
    },
    [editingNodeId],
  );

  useEffect(() => {
    if (activeTab !== 'personal') return;

    const resolveTargetNodes = () => {
      const { dynamicNodes: nodes, selectedNodes: selected } = canvasClipboardRef.current;
      if (selected.size > 0) {
        return nodes.filter((n) => selected.has(n.id));
      }
      const focusId = lastStickyClickIdRef.current;
      if (!focusId) return [];
      return nodes.filter((n) => n.id === focusId);
    };

    const writeClipboard = (e: ClipboardEvent) => {
      const picked = resolveTargetNodes();
      if (picked.length === 0) return false;
      const payload = buildCanvasClipboardPayload(picked, canvasClipboardRef.current.edges);
      if (!payload) return false;
      e.preventDefault();
      e.clipboardData?.setData('text/plain', JSON.stringify(payload));
      return true;
    };

    const onCopy = (e: ClipboardEvent) => {
      // Book bodies use select-text (not contenteditable); don't steal Ctrl+C for card JSON.
      if (shouldDeferToNativeClipboard(e.target)) return;
      writeClipboard(e);
    };

    const onCut = (e: ClipboardEvent) => {
      if (shouldDeferToNativeClipboard(e.target)) return;
      if (!writeClipboard(e)) return;
      const picked = resolveTargetNodes();
      const ids = picked.map((n) => n.id);
      if (ids.length === 0) return;
      const snap = snapshotNodesAndTouchingEdges(
        ids,
        canvasClipboardRef.current.dynamicNodes,
        canvasClipboardRef.current.edges,
      );
      void (async () => {
        const deleted = await canvasClipboardRef.current.removeNodeIds(ids);
        if (deleted.length === 0) return;
        setActiveChatAgentNodeId((current) =>
          current && deleted.includes(current) ? null : current,
        );
        const keptNodes = snap.nodes.filter((n) => deleted.includes(n.id));
        const keptIds = new Set(keptNodes.map((n) => n.id));
        const keptEdges = snap.edges.filter((ed) => keptIds.has(ed.from) || keptIds.has(ed.to));
        canvasUndoStackRef.current.push({ type: 'delete', nodes: keptNodes, edges: keptEdges });
        if (editingNodeId && deleted.includes(editingNodeId)) setEditingNodeId(null);
      })();
    };

    const onPaste = (e: ClipboardEvent) => {
      if (isTextEditingTarget(e.target)) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      const payload = parseCanvasClipboardPayload(text);
      if (payload) {
        e.preventDefault();
        const { activeCanvasId: canvasId, transformRef: tRef } = canvasClipboardRef.current;
        void (async () => {
          const { nodes: rawRows, edges: newEdges } = materializeCanvasPaste(payload, canvasId);
          if (rawRows.length === 0) return;
          const recentered = recenterNodesToViewport(rawRows, tRef.current, {
            width: window.innerWidth,
            height: window.innerHeight,
          });
          const rows = await stampWorkZoneScopeOnNewNodes(recentered, canvasId);
          await db.transaction('rw', db.nodes, db.edges, async () => {
            await db.nodes.bulkAdd(stampNewCards(rows));
            if (newEdges.length > 0) await db.edges.bulkAdd(newEdges);
          });
          canvasUndoStackRef.current.push({
            type: 'paste',
            nodeIds: rows.map((n) => n.id),
            edgeIds: newEdges.map((ed) => ed.id),
          });
          setSelectedNodes(new Set(rows.map((n) => n.id)));
        })();
        return;
      }

      const pastedUrl = parseLoneHttpUrl(text);
      if (pastedUrl) {
        e.preventDefault();
        const { activeCanvasId: canvasId, transformRef: tRef } = canvasClipboardRef.current;
        void (async () => {
          const position = getCanvasCenterPosition(tRef.current);
          const { nodeId, kind } = await spawnCardFromPastedUrl({
            url: pastedUrl,
            canvasId,
            position,
          });
          canvasUndoStackRef.current.push({
            type: 'paste',
            nodeIds: [nodeId],
            edgeIds: [],
          });
          setSelectedNodes(new Set([nodeId]));
          if (kind === 'note' && isTauriRuntime()) {
            void enrichUrlNoteFromPage(nodeId, pastedUrl);
          }
        })();
        return;
      }

      const pastedText = normalizePastedCanvasText(text);
      if (!pastedText) return;
      e.preventDefault();
      const { activeCanvasId: canvasId, transformRef: tRef } = canvasClipboardRef.current;
      void (async () => {
        const nodeId = await spawnNoteFromPastedText({
          text: pastedText,
          canvasId,
          position: getCanvasCenterPosition(tRef.current),
        });
        if (!nodeId) return;
        canvasUndoStackRef.current.push({
          type: 'paste',
          nodeIds: [nodeId],
          edgeIds: [],
        });
        setSelectedNodes(new Set([nodeId]));
      })();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (activeTab !== 'personal') return;

      const mod = event.ctrlKey || event.metaKey;
      if (mod && (event.key === 'z' || event.key === 'Z') && !event.shiftKey) {
        if (isTextEditingTarget(event.target)) return;
        const entry = canvasUndoStackRef.current.pop();
        if (!entry) return;
        event.preventDefault();
        void applyCanvasUndo(entry).then(async () => {
          if (entry.type === 'delete') {
            setSelectedNodes(new Set(entry.nodes.map((n) => n.id)));
            if (entry.nodes.some((n) => isAmbienceFixtureNode(n.type))) {
              setAmbienceHiddenForCanvas(activeCanvasId, false);
            }
            return;
          }
          if (entry.type === 'paste') {
            setSelectedNodes(new Set());
            return;
          }
          if (!isWorkZoneUndoEntry(entry)) return;
          const zones = await db.canvasWorkZones.where('canvasId').equals(activeCanvasId).toArray();
          canvasWorkZonesRef.current = zones;
          await reconcileNodeScopesFromZones(dynamicNodesRef.current, zones);
          workZoneGestureRectRef.current = null;
          setWorkZoneResizePreview(null);
          if (entry.type === 'workZoneCreate') {
            setSelectedWorkZoneId((id) => (id === entry.zoneId ? null : id));
          } else if (entry.type === 'workZoneDelete') {
            setSelectedWorkZoneId(entry.zone.id);
          }
        });
        return;
      }

      if (event.key !== 'Backspace' && event.key !== 'Delete') return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      // Card edit / inputs keep native Backspace; selected cards delete only when not typing.
      if (editingNodeId || isTextEditingTarget(event.target)) return;
      const selected = canvasClipboardRef.current.selectedNodes;
      if (selected.size === 0) return;
      event.preventDefault();
      event.stopPropagation();
      deleteNodesWithUndo([...selected]);
    };

    window.addEventListener('copy', onCopy, true);
    window.addEventListener('cut', onCut, true);
    window.addEventListener('paste', onPaste, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('copy', onCopy, true);
      window.removeEventListener('cut', onCut, true);
      window.removeEventListener('paste', onPaste, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [activeTab, editingNodeId, activeCanvasId, deleteNodesWithUndo]);

  // AI actions (publish stroke-order, agent analysis, Ask-card submission)
  const {
    publishSequenceActive,
    publishSequenceCandidateIds,
    publishSequenceOrderedIds,
    setPublishSequenceOrderedIds,
    publishSequenceGenerating,
    cancelPublishSequence,
    confirmPublishSequence,
    analyzingAgentNodeId,
    streamingAiNodeId,
    setStreamingAiNodeId,
    streamingAskNodeId,
    streamingThought,
    setStreamingThought,
    isAnyAiBusy,
    isNonPersonaAiBusy,
    personaStreams,
    extractBookSelectionToCard,
    transcribeAudioCard,
    transcribingAudioNodeId,
    expandBookSelection,
    expandingBookNodeId,
    handlePublish: startPublishSequence,
    triggerAgentAnalysis,
    startAgentDiscussion,
    continueAgentDiscussion,
    generateAgentCover,
    generatingCoverAgentId,
    runAskCardGeneration,
    retryAiCardGeneration,
    sendPersonaMessage,
  } = useAiActions({
    aiConfig, agentConfigs, activeCanvasId, nodesRef, transformRef,
    dynamicNodes, edges, selectedNodes, setSelectedNodes,
    onOpenSettings: () => setIsSettingsOpen(true),
  });

  const handlePublish = useCallback(() => {
    setConnectingFrom(null);
    startPublishSequence();
  }, [startPublishSequence]);

  useEffect(() => {
    if (!canvasV2Enabled || activeTab !== 'personal' || !activeCanvasId) return;
    void migrateCanvasToWorkZones(activeCanvasId, dynamicNodes, edges);
  }, [canvasV2Enabled, activeTab, activeCanvasId, dynamicNodes, edges]);

  useEffect(() => {
    if (!canvasV2Enabled || activeTab !== 'personal' || !activeCanvasId) return;
    const collapsed = dynamicNodes.some((n) => n.type === 'ask' && n.askThreadCollapsed);
    if (!collapsed) return;
    void expandCollapsedAskThreads(dynamicNodes, edges);
  }, [canvasV2Enabled, activeTab, activeCanvasId, dynamicNodes, edges]);

  const activeChatPersona = activeChatAgentNodeId
    ? dynamicNodes.find((n) => n.id === activeChatAgentNodeId && isPersonaAnchorNode(n))
    : undefined;
  const activeChatPersonaConfig = activeChatPersona?.type === 'agent' && activeChatPersona.agentConfigId
    ? agentConfigs.find((a) => a.id === activeChatPersona.agentConfigId)
    : undefined;
  const activeChatPersonaName = activeChatPersona?.type === 'ask'
    ? t('ask.character_name')
    : activeChatPersonaConfig
      ? resolveAgentLocalizedName(activeChatPersonaConfig)
      : undefined;

  const onboardingAskNodeId = React.useMemo(
    () =>
      dynamicNodes.find((n) => n.type === 'ask')?.id
      ?? dynamicNodes.find((n) => n.type === 'agent' && isPersonaAnchorNode(n))?.id
      ?? null,
    [dynamicNodes],
  );
  const onboardingAskWorkZone = React.useMemo(
    () =>
      canvasWorkZones.find((z) => onboardingAskNodeId && z.personaNodeId === onboardingAskNodeId)
      ?? canvasWorkZones[0]
      ?? null,
    [canvasWorkZones, onboardingAskNodeId],
  );

  useEffect(() => {
    const pendingId = tourRestartCanvasIdRef.current;
    if (!pendingId || activeCanvasId !== pendingId) return;
    if (!onboardingAskWorkZone) return;
    const hasTourMaterials = dynamicNodes.some(
      (n) =>
        OFFICIAL_DEFAULT_STARTER_NODE_IDS.has(n.id)
        || n.templateKey === ONBOARDING_MATERIAL_TEMPLATE_KEY,
    );
    if (!hasTourMaterials) return;
    tourRestartCanvasIdRef.current = null;
    onboarding.restart();
  }, [activeCanvasId, dynamicNodes, onboarding.restart, onboardingAskWorkZone]);
  const onboardingPersonaThreadId = onboardingAskNodeId
    ? personaThreadId(activeCanvasId, onboardingAskNodeId)
    : null;
  const globalOnboardingVisible =
    activeTab !== 'pocket'
    && !intuitionPumpOnboarding.isActive
    && !turtleSoupOnboarding.isActive
    && onboarding.isActive;
  const { canAdvance: onboardingCanAdvance } = useOnboardingGates({
    onboarding,
    nodes: dynamicNodes,
    workZone: onboardingAskWorkZone,
    personaThreadId: onboardingPersonaThreadId,
    enabled: globalOnboardingVisible && canvasV2Enabled,
  });

  // Tour step 2 needs landscape + opinion cards outside the room — ensure even
  // when the default canvas also has user-created cards.
  useEffect(() => {
    if (!globalOnboardingVisible || activeCanvasId !== 'default' || !canvasV2Enabled) return;
    void applyOnboardingWorkroomLayout('default');
  }, [activeCanvasId, canvasV2Enabled, globalOnboardingVisible]);

  const onboardingHighlightRevision = React.useMemo(() => {
    const step = onboarding.currentStep;
    if (!step?.highlight) return '';
    const t = canvasTransform;
    let extra = '';
    if (step.highlight === 'work-zone-and-outside' || step.highlight === 'outside-material-handle') {
      extra = onboardingOutsideMaterialNodes(dynamicNodes)
        .map((n) => `${n.id}:${Math.round(n.x)}:${Math.round(n.y)}`)
        .join('|');
    }
    if (step.highlight === 'chat-reply-drag-handle') {
      const streaming = activeChatPersona
        ? Boolean(personaStreams[activeChatPersona.id])
        : false;
      extra = `${streaming ? 'stream' : 'idle'}:${document.querySelectorAll('[data-testid="chat-reply-drag-handle"]').length}`;
    }
    return `${onboarding.currentIndex}:${t.x}:${t.y}:${t.scale}:${extra}`;
  }, [
    activeChatPersona,
    canvasTransform,
    dynamicNodes,
    onboarding.currentIndex,
    onboarding.currentStep,
    personaStreams,
  ]);

  const resolveOnboardingHighlight = useCallback(
    (step: typeof onboarding.currentStep) => {
      if (!step) return null;
      return resolveOnboardingHighlightRect(step, {
        host: mainRef.current,
        transform: transformRef.current,
        workZone: onboardingAskWorkZone,
        nodes: dynamicNodesRef.current,
        nodesRef,
      });
    },
    [onboardingAskWorkZone],
  );

  const resolveOnboardingHighlights = useCallback(
    (step: typeof onboarding.currentStep) => {
      if (!step) return [];
      return resolveOnboardingHighlightRects(step, {
        host: mainRef.current,
        transform: transformRef.current,
        workZone: onboardingAskWorkZone,
        nodes: dynamicNodesRef.current,
        nodesRef,
      });
    },
    [onboardingAskWorkZone],
  );

  const onboardingDragArrowRects = React.useMemo(() => {
    if (!globalOnboardingVisible || onboarding.currentStep?.canvasArrow !== 'drag-in') return null;
    return resolveOnboardingDragArrowRects({
      host: mainRef.current,
      transform: transformRef.current,
      workZone: onboardingAskWorkZone,
      nodes: dynamicNodesRef.current,
    });
  }, [
    globalOnboardingVisible,
    onboarding.currentStep,
    onboardingAskWorkZone,
    onboardingHighlightRevision,
  ]);

  const resolveOnboardingTooltipAnchor = useCallback(
    (step: typeof onboarding.currentStep) => {
      if (!step) return null;
      return resolveOnboardingTooltipAnchorRect(step, {
        host: mainRef.current,
        transform: transformRef.current,
        workZone: onboardingAskWorkZone,
        nodes: dynamicNodesRef.current,
      });
    },
    [onboardingAskWorkZone],
  );

  const fitOnboardingTourView = useCallback(
    (step: NonNullable<typeof onboarding.currentStep>) => {
      const host = mainRef.current;
      if (!host || !step.highlight || !onboardingAskWorkZone) return;
      const next = transformToFitOnboardingStep(step, {
        workZone: onboardingAskWorkZone,
        nodes: dynamicNodesRef.current,
        viewport: { width: host.clientWidth, height: host.clientHeight },
      });
      if (!next) return;
      setCanvasTransform(next);
    },
    [onboardingAskWorkZone, setCanvasTransform],
  );

  const workZoneLabel = useCallback(
    (zone: CanvasWorkZone) => {
      if (!zone.personaNodeId) return t('canvas.v2.work_zone_empty');
      const persona = dynamicNodes.find((n) => n.id === zone.personaNodeId);
      if (!persona) return t('canvas.v2.work_zone_empty');
      const name = persona.type === 'ask'
        ? t('ask.character_name')
        : (() => {
            const cfg = persona.agentConfigId
              ? agentConfigs.find((a) => a.id === persona.agentConfigId)
              : undefined;
            return cfg
              ? resolveAgentLocalizedName(cfg)
              : t('nodes.agent_fallback_name', { defaultValue: '角色' });
          })();
      return t('canvas.v2.work_zone_room', { name });
    },
    [dynamicNodes, agentConfigs, t],
  );

  const handleSelectWorkZone = useCallback((zoneId: string) => {
    setSelectedWorkZoneId(zoneId);
    if (!canvasV2Enabled || workZoneDrawMode) return;
    const zone = canvasWorkZonesRef.current.find((item) => item.id === zoneId);
    setActiveChatAgentNodeId(zone?.personaNodeId ?? null);
  }, [canvasV2Enabled, workZoneDrawMode]);

  useEffect(() => {
    if (!canvasV2Enabled || !selectedWorkZoneId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      if (isTextEditingTarget(event.target)) return;
      event.preventDefault();
      const zoneId = selectedWorkZoneId;
      void (async () => {
        const zone = canvasWorkZonesRef.current.find((item) => item.id === zoneId);
        await db.canvasWorkZones.delete(zoneId);
        if (zone) {
          canvasUndoStackRef.current.push({ type: 'workZoneDelete', zone: { ...zone } });
        }
        setSelectedWorkZoneId(null);
        await reconcileNodeScopesFromZones(
          dynamicNodesRef.current,
          canvasWorkZonesRef.current.filter((z) => z.id !== zoneId),
        );
      })();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canvasV2Enabled, selectedWorkZoneId]);

  const [composerSegments, setComposerSegments] = useState<ComposerSegment[]>(EMPTY_COMPOSER);
  const composerSelectionRef = useRef<string[]>([]);

  useEffect(() => {
    if (!activeChatPersona) return;
    let cancelled = false;
    const personaId = activeChatPersona.id;
    void db.canvasPersonaThreads.get(personaThreadId(activeCanvasId, personaId)).then((row) => {
      if (cancelled) return;
      const rawSelected = [...selectedNodesRef.current];
      const chipIds = rawSelected.filter((id) => {
        const node = dynamicNodesRef.current.find((n) => n.id === id);
        return Boolean(node && !isPersonaAnchorNode(node));
      });
      const base = row?.composerSegments?.length
        ? normalizeComposerSegments(row.composerSegments)
        : [{ type: 'text' as const, content: row?.composerDraft ?? '' }];
      setComposerSegments((prev) => {
        const fromDraft = mergeSelectionIntoComposer(base, chipIds, []);
        const keepPrev =
          focusNodeIdsFromSegments(prev).length > focusNodeIdsFromSegments(fromDraft).length;
        return keepPrev
          ? mergeSelectionIntoComposer(prev, chipIds, [])
          : fromDraft;
      });
      composerSelectionRef.current = chipIds;
    });
    return () => {
      cancelled = true;
    };
  }, [activeCanvasId, activeChatPersona?.id]);

  useEffect(() => {
    const rawSelected = [...selectedNodes];
    if (!canvasV2Enabled || !activeChatPersona) return;
    const chipIds = rawSelected.filter((id) => {
      const node = dynamicNodes.find((n) => n.id === id);
      return Boolean(node && !isPersonaAnchorNode(node));
    });
    setComposerSegments((prev) =>
      mergeSelectionIntoComposer(prev, chipIds, composerSelectionRef.current),
    );
    composerSelectionRef.current = chipIds;
  }, [canvasV2Enabled, activeChatPersona, dynamicNodes, selectedNodes]);

  const publishSequenceCandidateSet = React.useMemo(
    () => new Set(publishSequenceCandidateIds),
    [publishSequenceCandidateIds],
  );
  const publishSequenceOrderIndex = React.useMemo(() => {
    const m = new Map<string, number>();
    publishSequenceOrderedIds.forEach((id, i) => m.set(id, i + 1));
    return m;
  }, [publishSequenceOrderedIds]);

  // Ask card currently anchoring voice writing (set when an Ask mic is clicked).
  // Kept in state for re-render-driven UI updates AND mirrored into a ref so the
  // voice hook can read the latest value inside the synchronous path of toggling
  // (React setState is async; the hook's startVoiceMode closure would otherwise
  // still see the previous render's value).
  const [voiceTargetAskCardId, setVoiceTargetAskCardId] = useState<string | null>(null);
  const voiceTargetAskCardIdRef = useRef<string | null>(null);
  const [pinnedVoiceAgentNodeId, setPinnedVoiceAgentNodeId] = useState<string | null>(() =>
    readStoredVoicePin(activeCanvasId),
  );
  const pinnedVoiceAgentNodeIdRef = useRef<string | null>(pinnedVoiceAgentNodeId);
  const submitAskFromVoiceRef = useRef<(askId: string, prompt: string) => void>(() => {});
  const [askComposerPrefill, setAskComposerPrefill] = useState<{
    nodeId: string;
    text: string;
    token: number;
  } | null>(null);
  const [chatComposerPrefill, setChatComposerPrefill] = useState<{
    personaNodeId: string;
    composerSegments: ComposerSegment[];
    token: number;
  } | null>(null);

  const {
    voiceModeActive,
    voicePhase,
    liveTranscript,
    ttsHighlight,
    toggleVoiceMode,
    stopVoiceMode,
    endTtsReply,
    pushTtsChunk,
    stopTts,
    markThinking,
  } =
    useVoiceWritingMode({
      aiConfig,
      activeCanvasId,
      transformRef,
      setCanvasTransform,
      editingNodeId,
      setStreamingAiNodeId,
      isAnyAiBusy,
      targetAskCardIdRef: voiceTargetAskCardIdRef,
      onTranscript: (text, askId) => {
        if (!askId) return;
        setAskComposerPrefill((prev) => ({
          nodeId: askId,
          text,
          token: (prev?.token ?? 0) + 1,
        }));
      },
      onCommit: (text, askId) => {
        const trimmed = text.trim();
        // Handshake MiniMax before the Ask request so first-sentence TTS is ready.
        markThinking();
        if (askId && trimmed) submitAskFromVoiceRef.current(askId, trimmed);
      },
      onOpenSettings: () => setIsSettingsOpen(true),
      onOpenLogin:
        authCtx.configured && !authCtx.session ? () => setIsSettingsOpen(true) : undefined,
      onStreamingThought: setStreamingThought,
    });

  const pinVoicePersona = useCallback((agentNodeId: string | null) => {
    pinnedVoiceAgentNodeIdRef.current = agentNodeId;
    setPinnedVoiceAgentNodeId(agentNodeId);
    writeStoredVoicePin(activeCanvasId, agentNodeId);
  }, [activeCanvasId]);

  // Keep the last spoken-to agent checked in the mic picker. If this turn was
  // on an agent card, restore that pin even if a Dexie refresh briefly dropped it.
  useEffect(() => {
    if (voiceModeActive) return;
    const target = voiceTargetAskCardIdRef.current;
    voiceTargetAskCardIdRef.current = null;
    if (!target) return;
    const node = dynamicNodesRef.current.find((n) => n.id === target);
    if (node?.type === 'agent') pinVoicePersona(target);
  }, [voiceModeActive, pinVoicePersona]);

  useEffect(() => {
    const saved = readStoredVoicePin(activeCanvasId);
    pinnedVoiceAgentNodeIdRef.current = saved;
    setPinnedVoiceAgentNodeId(saved);
  }, [activeCanvasId]);

  useEffect(() => {
    if (!shouldClearVoicePin(pinnedVoiceAgentNodeId, dynamicNodesQuery)) return;
    const saved = readStoredVoicePin(activeCanvasId);
    if (saved !== pinnedVoiceAgentNodeId) {
      pinnedVoiceAgentNodeIdRef.current = saved;
      setPinnedVoiceAgentNodeId(saved);
      return;
    }
    pinnedVoiceAgentNodeIdRef.current = null;
    setPinnedVoiceAgentNodeId(null);
    writeStoredVoicePin(activeCanvasId, null);
  }, [dynamicNodesQuery, pinnedVoiceAgentNodeId, activeCanvasId]);

  const canvasVoicePersonas = React.useMemo(
    () =>
      listCanvasVoicePersonas(dynamicNodes, agentConfigs).map((persona) => {
        const agent = agentConfigs.find((a) => a.id === persona.agentConfigId);
        return {
          ...persona,
          name: agent ? resolveAgentLocalizedName(agent) : persona.name,
        };
      }),
    [dynamicNodes, agentConfigs],
  );
  const showAskVoiceOption = hasCanvasAskCard(dynamicNodes);

  useEffect(() => {
    const next = coerceToolbarVoicePin(
      pinnedVoiceAgentNodeId,
      dynamicNodesQuery,
      canvasVoicePersonas,
    );
    if (next === pinnedVoiceAgentNodeId) return;
    pinVoicePersona(next);
  }, [canvasVoicePersonas, dynamicNodesQuery, pinVoicePersona, pinnedVoiceAgentNodeId]);

  const handleAskToggleVoice = useCallback(
    (askNodeId: string) => {
      // If this Ask card is the active anchor, the mic click toggles voice off.
      if (voiceModeActive && voiceTargetAskCardId === askNodeId) {
        setVoiceTargetAskCardId(null);
        toggleVoiceMode();
        return;
      }
      voiceTargetAskCardIdRef.current = askNodeId;
      setVoiceTargetAskCardId(askNodeId);
      toggleVoiceMode();
    },
    [voiceModeActive, voiceTargetAskCardId, toggleVoiceMode],
  );

  /** Toolbar mic: pin a persona (or 阿狸), then start/stop voice on that
   *  character's own thread — never a shared Ask-card history. */
  const activateVoiceOnCanvas = useCallback(async (agentNodeId?: string | null) => {
    if (agentNodeId !== undefined) {
      pinVoicePersona(agentNodeId);
    }

    if (voiceModeActive && agentNodeId === undefined) {
      const current = voiceTargetAskCardIdRef.current;
      if (current) handleAskToggleVoice(current);
      return;
    }

    const pin = pinnedVoiceAgentNodeIdRef.current;
    let { rootId, needsAskCard } = resolveToolbarVoiceThreadRoot(pin, dynamicNodes);
    if (needsAskCard) {
      const newId = crypto.randomUUID();
      await db.nodes.add(stampNewCard({
        id: newId,
        canvasId: activeCanvasId,
        type: 'ask',
        content: '',
        x: window.innerWidth / 2 - ASK_NODE_SIZE.width / 2,
        y: window.innerHeight / 2 - ASK_NODE_SIZE.height / 2,
        width: ASK_NODE_SIZE.width,
        height: ASK_NODE_SIZE.height,
      }));
      rootId = newId;
    }
    if (!rootId) return;

    voiceTargetAskCardIdRef.current = rootId;
    setVoiceTargetAskCardId(rootId);
    if (voiceModeActive) return;
    handleAskToggleVoice(rootId);
  }, [activeCanvasId, dynamicNodes, handleAskToggleVoice, pinVoicePersona, voiceModeActive]);

  /** Find the canvas's Ask card or spawn one beside `anchor`. Returns the
   *  position too so callers can pan/zoom to it without re-reading dynamicNodes
   *  (which lags behind the live write by one render). */
  const ensureAskCardIdForCanvas = useCallback(
    async (anchor?: CanvasNode): Promise<{ id: string; x: number; y: number }> => {
      const existing = dynamicNodes.find((n) => n.type === 'ask');
      if (existing) {
        return { id: existing.id, x: existing.x, y: existing.y };
      }
      const pos = anchor
        ? findOpenCanvasPosition({
            transform: transformRef.current,
            obstacles: dynamicNodes,
            size: ASK_NODE_SIZE,
            preferBeside: anchor,
          })
        : {
            x: window.innerWidth / 2 - ASK_NODE_SIZE.width / 2,
            y: window.innerHeight / 2 - ASK_NODE_SIZE.height / 2,
          };
      const newId = crypto.randomUUID();
      await db.nodes.add(stampNewCard({
        id: newId,
        canvasId: activeCanvasId,
        type: 'ask',
        content: '',
        x: pos.x,
        y: pos.y,
        width: ASK_NODE_SIZE.width,
        height: ASK_NODE_SIZE.height,
      }));
      return { id: newId, x: pos.x, y: pos.y };
    },
    [activeCanvasId, dynamicNodes],
  );

  /** Add an undirected edge between two nodes on the active canvas. No-op if
   *  one already exists in either direction. */
  const linkNodeToAskCard = useCallback(
    async (nodeId: string, askId: string) => {
      if (nodeId === askId) return;
      const exists = edges.some(
        (e) =>
          (e.from === nodeId && e.to === askId) ||
          (e.to === nodeId && e.from === askId),
      );
      if (exists) return;
      await db.edges.add({
        id: crypto.randomUUID(),
        canvasId: activeCanvasId,
        from: nodeId,
        to: askId,
      });
    },
    [activeCanvasId, edges],
  );

  const ingestChatPanelFiles = useCallback(
    async (files: File[]) => {
      if (!activeChatPersona || files.length === 0) return;
      const origin = personaChatUploadOrigin(activeChatPersona, dynamicNodes, nodesRef);
      const { addedIds, addedBookIds, failures } = await ingestFilesToCanvas({
        canvasId: activeCanvasId,
        files,
        origin,
        contextScopeAgentId: activeChatPersona.id,
      });
      if (addedBookIds.length > 0) {
        const newBookNodes = await db.nodes.bulkGet(addedBookIds);
        const newBooks = newBookNodes.filter(
          (n): n is CanvasNode => !!n && n.type === 'book',
        );
        if (newBooks.length > 0) {
          const ask = await ensureAskCardIdForCanvas(newBooks[0]);
          for (const book of newBooks) {
            await linkNodeToAskCard(book.id, ask.id);
          }
        }
      }
      if (addedIds.length > 0) {
        setSelectedNodes((prev) => {
          const next = new Set(prev);
          for (const id of addedIds) next.add(id);
          return next;
        });
      }
      if (failures.length > 0) {
        await appAlert({
          message: t('canvas.upload_fail', {
            count: failures.length,
            names: failures.map((f) => f.name).join(', '),
          }),
        });
      }
    },
    [
      activeCanvasId,
      activeChatPersona,
      appAlert,
      dynamicNodes,
      ensureAskCardIdForCanvas,
      linkNodeToAskCard,
      nodesRef,
      t,
    ],
  );

  /** Selection → V2 side-panel composer, or V1 inline Ask composer on the source card. */
  const askAboutBookSelection = useCallback(
    (quote: string, sourceLabel?: string, sourceNodeId?: string) => {
      const text = quote.replace(/\s+/g, ' ').trim();
      if (!text || !sourceNodeId) return;
      const sourceNode = dynamicNodes.find((n) => n.id === sourceNodeId);
      if (!sourceNode || !canAskAiOnNode(sourceNode)) return;

      if (canvasV2Enabled) {
        const plan = planSourceSelectionAsk({
          quote: text,
          sourceLabel,
          source: sourceNode,
          nodes: dynamicNodes,
          zones: canvasWorkZones,
        });
        if (!plan) {
          void appAlert({ message: t('canvas.v2.ask_need_room') });
          return;
        }
        setActiveChatAgentNodeId(plan.personaNodeId);
        setSelectedNodes(new Set([plan.focusNodeId]));
        setComposerSegments(plan.composerSegments);
        setChatComposerPrefill((prev) => ({
          personaNodeId: plan.personaNodeId,
          composerSegments: plan.composerSegments,
          token: (prev?.token ?? 0) + 1,
        }));
        return;
      }

      if (
        askAiRequiresLinkedPersona(sourceNode) &&
        !nodeIdsLinkedToAskPersona(dynamicNodes, edges).has(sourceNode.id)
      ) {
        return;
      }
      setAskComposerPrefill((prev) => ({
        nodeId: sourceNodeId,
        text,
        token: (prev?.token ?? 0) + 1,
      }));
    },
    [appAlert, canvasV2Enabled, canvasWorkZones, dynamicNodes, edges, t],
  );

  /** Voice: stream sentences into TTS while the side-panel reply is still being written. */
  const handleAskSubmitWithVoice = useCallback(
    async (askId: string, prompt: string) => {
      let lastRaw = '';
      let replyId: string | null = null;
      const generatedId = await runAskCardGeneration(askId, prompt, {
        voiceBrief: true,
        preferredAgentNodeId: pinnedVoiceAgentNodeIdRef.current,
        onReplyNodeCreated: (id) => {
          replyId = id;
        },
        onStreamChunk: (accumulated) => {
          lastRaw = accumulated;
          const id = replyId;
          if (id) pushTtsChunk(id, accumulated);
        },
      });
      if (voiceTargetAskCardIdRef.current !== askId) return;
      const id = generatedId || replyId;
      const thread = await db.canvasPersonaThreads.get(personaThreadId(activeCanvasId, askId));
      const threadText = id ? thread?.messages.find((m) => m.id === id)?.text ?? '' : '';
      const spoken =
        visibleAiReplyText(lastRaw).trim() || spokenFallbackFromWritten(threadText);
      await endTtsReply(id ?? '', spoken);
    },
    [activeCanvasId, runAskCardGeneration, endTtsReply, pushTtsChunk],
  );
  submitAskFromVoiceRef.current = (askId, prompt) => {
    void handleAskSubmitWithVoice(askId, prompt);
  };

  const askAiLinkedIds = React.useMemo(
    () => nodeIdsLinkedToAskPersona(dynamicNodes, edges),
    [dynamicNodes, edges],
  );

  const webSearchSourceCountByParent = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const node of dynamicNodes) {
      if (node.type !== 'ai' && node.type !== 'note' && node.type !== 'text') continue;
      const count = listWebSearchSourcesForParent(node.id, dynamicNodes, edges).length;
      if (count > 0) map.set(node.id, count);
    }
    return map;
  }, [dynamicNodes, edges]);

  const bookExpandBranchCountByHub = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const node of dynamicNodes) {
      if (node.type !== 'theme') continue;
      // Any theme with linked note/text cards can stack them (book-expand hubs included).
      const count = resolveBookExpandBranches(node.id, dynamicNodes, edges).length;
      if (count > 0) map.set(node.id, count);
    }
    return map;
  }, [dynamicNodes, edges]);

  /** Branch note id → collapsed theme hub (for stack chrome without relying only on parentId). */
  const bookExpandCollapsedHubByBranchId = React.useMemo(() => {
    const map = new Map<string, CanvasNode>();
    for (const hub of dynamicNodes) {
      if (hub.type !== 'theme' || !hub.bookExpandBranchesCollapsed) continue;
      if (!bookExpandBranchCountByHub.has(hub.id)) continue;
      for (const branch of resolveBookExpandBranches(hub.id, dynamicNodes, edges)) {
        map.set(branch.id, hub);
      }
    }
    return map;
  }, [dynamicNodes, edges, bookExpandBranchCountByHub]);

  const askThreadRepliesByAsk = React.useMemo(() => {
    const map = new Map<string, CanvasNode[]>();
    for (const node of dynamicNodes) {
      if (node.type !== 'ask') continue;
      const replies = listAskThreadReplies(node.id, dynamicNodes, edges);
      if (replies.length > 0) map.set(node.id, replies);
    }
    return map;
  }, [dynamicNodes, edges]);

  const essaySourcesByEssay = React.useMemo(() => {
    const map = new Map<string, CanvasNode[]>();
    for (const node of dynamicNodes) {
      if (node.type !== 'essay') continue;
      const sources = listEssaySourceNodes(node, dynamicNodes);
      if (sources.length > 0) map.set(node.id, sources);
    }
    return map;
  }, [dynamicNodes]);

  const essayHubBySourceId = React.useMemo(() => {
    const map = new Map<string, CanvasNode>();
    for (const essay of dynamicNodes) {
      if (essay.type !== 'essay') continue;
      const sources = essaySourcesByEssay.get(essay.id);
      if (!sources?.length) continue;
      for (const source of sources) map.set(source.id, essay);
    }
    return map;
  }, [dynamicNodes, essaySourcesByEssay]);

  const notePilesByHub = React.useMemo(() => {
    const map = new Map<string, CanvasNode[]>();
    for (const node of dynamicNodes) {
      if (!node.notePileMemberIds || node.notePileMemberIds.length < 2) continue;
      const members = listNotePileMembers(node, dynamicNodes);
      if (members.length >= 2) map.set(node.id, members);
    }
    return map;
  }, [dynamicNodes]);

  const notePileHubByMemberId = React.useMemo(() => {
    const map = new Map<string, CanvasNode>();
    for (const [hubId, members] of notePilesByHub) {
      const hub = dynamicNodes.find((n) => n.id === hubId);
      if (!hub) continue;
      for (const member of members) map.set(member.id, hub);
    }
    return map;
  }, [dynamicNodes, notePilesByHub]);

  const publishSelectionCount = React.useMemo(
    () => expandSelectionWithNotePiles([...selectedNodes], dynamicNodes).length,
    [selectedNodes, dynamicNodes],
  );

  const toggleAskThread = useCallback(
    (askId: string) => {
      const ask = dynamicNodes.find((n) => n.id === askId);
      if (!ask || ask.type !== 'ask') return;
      const el = nodesRef.current[askId];
      const anchorHeight =
        ask.height && ask.height > 0 ? ask.height : el?.offsetHeight || undefined;
      void setAskThreadCollapsed(askId, !ask.askThreadCollapsed, {
        nodes: dynamicNodes,
        edges,
        anchorHeight,
      });
    },
    [dynamicNodes, edges, nodesRef],
  );

  const toggleWebSearchSources = useCallback(
    (parentId: string) => {
      const parent = dynamicNodes.find((n) => n.id === parentId);
      if (!parent) return;
      const el = nodesRef.current[parentId];
      const anchorHeight = parent.height && parent.height > 0
        ? parent.height
        : el?.offsetHeight || undefined;
      void setWebSearchSourcesCollapsed(parentId, !parent.webSearchSourcesCollapsed, {
        nodes: dynamicNodes,
        edges,
        anchorHeight,
      });
    },
    [dynamicNodes, edges, nodesRef],
  );

  const toggleBookExpandBranches = useCallback(
    (hubId: string) => {
      const hub = dynamicNodes.find((n) => n.id === hubId);
      if (!hub || hub.type !== 'theme') return;
      const el = nodesRef.current[hubId];
      const hubHeight =
        hub.height && hub.height > 0 ? hub.height : el?.offsetHeight || undefined;
      // Read nodes/edges from IndexedDB inside the service so a just-added
      // link is never missed due to a briefly stale React snapshot.
      void setBookExpandBranchesCollapsed(hubId, !hub.bookExpandBranchesCollapsed, {
        hubHeight,
      });
    },
    [dynamicNodes, nodesRef],
  );

  const toggleEssaySources = useCallback(
    (essayId: string) => {
      const essay = dynamicNodes.find((n) => n.id === essayId);
      if (!essay || essay.type !== 'essay') return;
      const el = nodesRef.current[essayId];
      const anchorHeight =
        essay.height && essay.height > 0 ? essay.height : el?.offsetHeight || undefined;
      void setEssaySourcesCollapsed(essayId, !essay.essaySourcesCollapsed, {
        nodes: dynamicNodes,
        anchorHeight,
      });
    },
    [dynamicNodes, nodesRef],
  );

  const toggleNotePile = useCallback(
    (hubId: string) => {
      const hub = dynamicNodes.find((n) => n.id === hubId);
      if (!hub) return;
      void setNotePileCollapsed(hubId, !hub.notePileCollapsed, { nodes: dynamicNodes });
    },
    [dynamicNodes],
  );

  /** Retry button on a failed AI image card — regenerates into the same card. */
  const retryImageGenerationFromCard = useCallback(
    (nodeId: string) => {
      void retryImageGeneration({
        nodeId,
        ...imageKeysFromAiConfig(aiConfig),
        onMissingKey: () => {
          void appAlert({ message: t('voice.flux_need_key') });
        },
      });
    },
    [aiConfig, appAlert, t],
  );

  /** Retry a failed illustration sitting in the side-panel thread. Leaves the chat copy in place. */
  const retryChatImageFromThread = useCallback(
    (messageId: string, imageId: string) => {
      const personaId = activeChatPersona?.id;
      if (!personaId) return;
      void (async () => {
        const extraImageNodeIds = collectWorkZoneContextPayload(
          personaId,
          dynamicNodesRef.current,
        ).imageNodeIds;
        const refs = await resolveDrawInputReferences(personaId, [], extraImageNodeIds);
        await retryChatDrawImage({
          threadId: personaThreadId(activeCanvasId, personaId),
          messageId,
          imageId,
          ...imageKeysFromAiConfig(aiConfig),
          inputReferences: refs,
          onMissingKey: () => {
            void appAlert({ message: t('voice.flux_need_key') });
          },
          onError: (message) => {
            void appAlert({
              message: t('voice.flux_error', { message: formatImageGenerationError(message, t) }),
            });
          },
        });
      })();
    },
    [activeCanvasId, activeChatPersona, aiConfig, appAlert, t],
  );

  /** Retry button on a failed AI reply card — re-runs into the same card. */
  const retryAiGenerationFromCard = useCallback(
    (nodeId: string) => {
      void retryAiCardGeneration(nodeId);
    },
    [retryAiCardGeneration],
  );

  const contextTextForDiscussion = useCallback(
    (nodeId: string) => {
      const el = nodesRef.current[nodeId];
      if (el) return getCanvasNodeContextText(el);
      const n = dynamicNodes.find((x) => x.id === nodeId);
      return (n?.content ?? '').trim();
    },
    [dynamicNodes],
  );

  const runAgentAnalysisFromCard = (agentNodeId: string) => {
    if (isNonPersonaAiBusy || personaStreams[agentNodeId]) return;
    const agentNode = dynamicNodes.find(n => n.id === agentNodeId && n.type === 'agent');
    if (!agentNode?.agentConfigId) return;

    if (canvasV2Enabled) {
      setActiveChatAgentNodeId(agentNodeId);
      const agent = agentConfigs.find((a) => a.id === agentNode.agentConfigId);
      const starter = isTurtleSoupHostAgent(agent)
        ? t('community.official.turtle_soup.note_start')
        : t('canvas.v2.agent_analyze_starter', {
            defaultValue: '请结合工作区里的素材，给出你的分析与建议。',
          });
      void sendPersonaMessage(agentNodeId, starter);
      return;
    }

    const neighborIds: string[] = [];
    for (const edge of edges) {
      if (edge.from === agentNodeId) neighborIds.push(edge.to);
      else if (edge.to === agentNodeId) neighborIds.push(edge.from);
    }
    neighborIds.sort();

    for (const cid of neighborIds) {
      const n = dynamicNodes.find(x => x.id === cid);
      if (!n || n.type === 'agent') continue;
      const el = nodesRef.current[cid];
      if (!el) continue;
      const text = getCanvasNodeContextText(el);
      if (!text) continue;
      void triggerAgentAnalysis(agentNode.agentConfigId, agentNodeId, cid);
      return;
    }

    const agent = agentConfigs.find((a) => a.id === agentNode.agentConfigId);
    if (isTurtleSoupHostAgent(agent)) {
      void runAskCardGeneration(agentNodeId, t('community.official.turtle_soup.note_start'));
      return;
    }

    void appAlert({ message: t('nodes.agent_no_context') });
  };

  const runAgentDiscussionFromCard = (agentNodeId: string) => {
    if (isAnyAiBusy) return;
    void startAgentDiscussion(agentNodeId);
  };

  const runContinueDiscussionFromCard = (aiNodeId: string) => {
    if (isAnyAiBusy) return;
    void continueAgentDiscussion(aiNodeId);
  };

  const agentCanStartDiscussion = useCallback(
    (agentNodeId: string) =>
      canStartAgentDiscussion(agentNodeId, dynamicNodes, edges, contextTextForDiscussion),
    [dynamicNodes, edges, contextTextForDiscussion],
  );

  const agentCanContinueDiscussion = useCallback(
    (aiNodeId: string) => isAgentDiscussionLeaf(aiNodeId, dynamicNodes, edges),
    [dynamicNodes, edges],
  );

  const pulseEssayCollect = (essayId: string) => {
    if (essayCollectPulseTimerRef.current) clearTimeout(essayCollectPulseTimerRef.current);
    setEssayCollectHoverId(null);
    setEssayCollectPulseId(essayId);
    essayCollectPulseTimerRef.current = setTimeout(() => {
      setEssayCollectPulseId((cur) => (cur === essayId ? null : cur));
      essayCollectPulseTimerRef.current = null;
    }, 640);
  };

  const handleNodeDragMove = (draggedId: string, pos: { x: number; y: number }) => {
    const nodesSnapshot = dynamicNodesRef.current;
    const selected = selectedNodesRef.current;
    const pilePeers = collapsedNotePilePeerIds(draggedId, nodesSnapshot);
    const exclude = new Set(
      selected.size > 1 && selected.has(draggedId)
        ? [...selected]
        : pilePeers.length >= 2
          ? pilePeers
          : [draggedId],
    );
    const dragged = nodesSnapshot.find((n) => n.id === draggedId);
    if (!dragged) {
      setEssayCollectHoverId(null);
      return;
    }
    const target = pickEssayCollectTarget(
      draggedId,
      estimateNodeRect({ ...dragged, ...pos }),
      nodesSnapshot,
      exclude,
    );
    setEssayCollectHoverId(target?.id ?? null);
  };

  const handleNodeDragEnd = (
    draggedId: string,
    finalPos: { x: number; y: number },
    delta: { dx: number; dy: number } = { dx: 0, dy: 0 },
  ) => {
    const selected = selectedNodesRef.current;
    const nodesSnapshot = dynamicNodesRef.current;
    const isSelectionGroup = selected.size > 1 && selected.has(draggedId);
    const pilePeers = collapsedNotePilePeerIds(draggedId, nodesSnapshot);
    const isPileGroup = !isSelectionGroup && pilePeers.length >= 2;
    const groupIds = isSelectionGroup ? [...selected] : isPileGroup ? pilePeers : null;

    const runAgentSnap = () => {
      if (canvasV2Enabled) return;
      const draggedEl = nodesRef.current[draggedId];
      if (!draggedEl) return;
      const dRect = draggedEl.getBoundingClientRect();
      const dCenterX = dRect.left + dRect.width / 2;
      const dCenterY = dRect.top + dRect.height / 2;
      const SNAP_DISTANCE = 150;
      const isDraggedAgent = nodesSnapshot.find((n) => n.id === draggedId)?.type === 'agent';
      let snapped = false;
      Object.keys(nodesRef.current).forEach((otherId) => {
        if (otherId === draggedId || snapped) return;
        const otherEl = nodesRef.current[otherId];
        if (!otherEl) return;
        const isOtherAgent = nodesSnapshot.find((n) => n.id === otherId)?.type === 'agent';
        if ((isDraggedAgent && !isOtherAgent) || (!isDraggedAgent && isOtherAgent)) {
          const oRect = otherEl.getBoundingClientRect();
          const oCenterX = oRect.left + oRect.width / 2;
          const oCenterY = oRect.top + oRect.height / 2;
          const dist = Math.hypot(dCenterX - oCenterX, dCenterY - oCenterY);
          if (dist < SNAP_DISTANCE) {
            const agentId = isDraggedAgent ? draggedId : otherId;
            const contextId = isDraggedAgent ? otherId : draggedId;
            const agentConfigId = nodesSnapshot.find((n) => n.id === agentId)?.agentConfigId;
            if (agentConfigId && agentId && contextId) {
              snapped = true;
              if (!edges.find((e) => (e.from === agentId && e.to === contextId) || (e.from === contextId && e.to === agentId))) {
                db.edges.add({ id: crypto.randomUUID(), canvasId: activeCanvasId, from: agentId, to: contextId });
              }
            }
          }
        }
      });
    };

    const tryCollectOntoEssay = async (
      leaderId: string,
      leaderPos: { x: number; y: number },
      placed: CanvasNode[],
      sourceIds: string[],
    ) => {
      setEssayCollectHoverId(null);
      const leader = placed.find((n) => n.id === leaderId);
      if (!leader) return false;
      const essay = pickEssayCollectTarget(
        leaderId,
        estimateNodeRect({ ...leader, ...leaderPos }),
        placed,
        new Set(sourceIds),
      );
      if (!essay) return false;
      const collected = await collectNodesIntoEssay({
        essayNodeId: essay.id,
        sourceIds,
        nodes: placed,
      });
      if (collected.length === 0) return false;
      pulseEssayCollect(essay.id);
      return true;
    };

    return (async () => {
      if (canvasV2Enabled) {
        const ids = groupIds ?? [draggedId];
        const blocked = ids.some((id) => {
          const peer = nodesSnapshot.find((n) => n.id === id);
          if (!peer) return false;
          const pos = id === draggedId ? finalPos : { x: peer.x + delta.dx, y: peer.y + delta.dy };
          return personaBlockedByForeignWorkZone(
            peer,
            pos,
            canvasWorkZonesRef.current,
            nodesSnapshot,
          );
        });
        if (blocked) {
          for (const id of ids) {
            if (id === draggedId) continue;
            const peer = nodesSnapshot.find((n) => n.id === id);
            const el = nodesRef.current[id];
            if (peer && el) clearNodeDragOffset(el, { x: peer.x, y: peer.y });
          }
          return { revert: true };
        }
      }

      const syncBoundZone = async (result: { boundZoneId?: string; assigned?: string }) => {
        if (!result.boundZoneId || !result.assigned) return;
        canvasWorkZonesRef.current = canvasWorkZonesRef.current.map((zone) =>
          zone.id === result.boundZoneId ? { ...zone, personaNodeId: result.assigned } : zone,
        );
        await reconcileNodeScopesFromZones(dynamicNodesRef.current, canvasWorkZonesRef.current);
      };

      if (groupIds) {
        const updates: { id: string; x: number; y: number }[] = [];
        for (const id of groupIds) {
          if (id === draggedId) {
            updates.push({ id, x: finalPos.x, y: finalPos.y });
            continue;
          }
          const peer = nodesSnapshot.find((n) => n.id === id);
          if (!peer) continue;
          const next = { x: peer.x + delta.dx, y: peer.y + delta.dy };
          updates.push({ id, ...next });
          const el = nodesRef.current[id];
          if (el) clearNodeDragOffset(el, next);
        }
        await db.transaction('rw', db.nodes, async () => {
          for (const u of updates) {
            await db.nodes.update(u.id, { x: u.x, y: u.y });
          }
        });
        {
          const moved = new Map(updates.map((u) => [u.id, u]));
          const placed = nodesSnapshot.map((n) => {
            const next = moved.get(n.id);
            return next ? { ...n, x: next.x, y: next.y } : n;
          });
          const collected = await tryCollectOntoEssay(draggedId, finalPos, placed, groupIds);
          if (collected) return;
        }
        if (isPileGroup) {
          const draggedNode = nodesSnapshot.find((n) => n.id === draggedId);
          const hubId = draggedNode ? resolveNotePileHubId(draggedNode) : undefined;
          if (hubId) await shiftNotePileOrigin(hubId, delta);
          const moved = new Map(updates.map((u) => [u.id, u]));
          const placed = nodesSnapshot.map((n) => {
            const next = moved.get(n.id);
            return next ? { ...n, x: next.x, y: next.y } : n;
          });
          const dragged = placed.find((n) => n.id === draggedId);
          if (dragged) {
            const target = pickNotePileSnapTarget(
              draggedId,
              estimateNodeRect(dragged),
              placed,
              new Set(groupIds),
            );
            if (target) {
              await snapNodeOntoNode(draggedId, target.id, placed);
              return;
            }
          }
        }
        if (!isPileGroup) runAgentSnap();
        if (canvasV2Enabled) {
          for (const id of groupIds) {
            const peer = nodesSnapshot.find((n) => n.id === id);
            if (!peer) continue;
            const pos =
              id === draggedId
                ? finalPos
                : { x: peer.x + delta.dx, y: peer.y + delta.dy };
            const result = await applyWorkZoneOnDragEnd(id, pos, nodesSnapshot, canvasWorkZonesRef.current);
            await syncBoundZone(result);
          }
        }
        return;
      }

      await db.nodes.update(draggedId, { x: finalPos.x, y: finalPos.y });
      const dragged = nodesSnapshot.find((n) => n.id === draggedId);
      if (dragged) {
        const placed = nodesSnapshot.map((n) =>
          n.id === draggedId ? { ...n, ...finalPos } : n,
        );
        const collected = await tryCollectOntoEssay(draggedId, finalPos, placed, [draggedId]);
        if (collected) return;
        const target = pickNotePileSnapTarget(
          draggedId,
          estimateNodeRect({ ...dragged, ...finalPos }),
          placed,
          new Set(),
        );
        if (target) {
          await snapNodeOntoNode(draggedId, target.id, placed);
          return;
        }
        await maybeLeaveNotePile(draggedId, finalPos, placed);
      }
      runAgentSnap();
      if (canvasV2Enabled) {
        const draggedNode = nodesSnapshot.find((n) => n.id === draggedId);
        if (draggedNode) {
          const result = await applyWorkZoneOnDragEnd(
            draggedId,
            finalPos,
            nodesSnapshot,
            canvasWorkZonesRef.current,
          );
          await syncBoundZone(result);
        }
        if (
          delta.dx === 0 &&
          delta.dy === 0 &&
          draggedNode &&
          isPersonaAnchorNode(draggedNode)
        ) {
          setActiveChatAgentNodeId(draggedId);
        }
      }
    })();
  };

  return (
    <div className="bg-surface font-serif text-text h-screen max-h-screen overflow-hidden flex flex-col paper-texture">
      
      <div
        className="flex flex-1 min-h-0 overflow-hidden"
        onPointerDown={(e) => {
          if (!connectingFrom) return;
          // Cancel link mode when clicking outside the canvas (e.g. sidebar).
          if (mainRef.current?.contains(e.target as Node)) return;
          setConnectingFrom(null);
        }}
      >
        {/* Phone capture does not use the desktop rail. A home chip appears
            when the user is on the canvas tab (e.g. after archive restore). */}
        {phone ? (
          activeTab === 'personal' && !canvasImmersive ? (
            <button
              type="button"
              data-testid="phone-pocket-home"
              onClick={() => setActiveTab('pocket')}
              title={t('sidebar.pocket')}
              aria-label={t('sidebar.pocket')}
              className="fixed left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-50 h-11 px-3 rounded-full bg-white/70 backdrop-blur-md border border-[#E6E4DF] shadow-sm text-[#5a5a54] hover:text-[#C2410C] inline-flex items-center gap-1.5"
            >
              <NotebookPen className="w-5 h-5" />
              <span className="text-sm font-medium">{t('sidebar.pocket')}</span>
            </button>
          ) : null
        ) : (
          <Sidebar
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            setIsSettingsOpen={setIsSettingsOpen}
            pocketCount={pocketCount}
          />
        )}

        {/* Global onboarding tour — paused when any canvas-specific tour is
            active so the overlays don't fight for the same backdrop. */}
        <OnboardingOverlay
          step={
            activeTab === 'pocket' || intuitionPumpOnboarding.isActive || turtleSoupOnboarding.isActive
              ? null
              : onboarding.currentStep
          }
          currentIndex={onboarding.currentIndex}
          totalSteps={onboarding.totalSteps}
          onNext={onboarding.next}
          onSkip={onboarding.skip}
          canAdvance={onboardingCanAdvance}
          resolveHighlightRect={resolveOnboardingHighlight}
          resolveHighlightRects={resolveOnboardingHighlights}
          resolveTooltipAnchorRect={resolveOnboardingTooltipAnchor}
          highlightRevision={onboardingHighlightRevision}
          dragArrowRects={onboardingDragArrowRects}
          onBeforeShow={(step) => {
            step.beforeShow?.({
              setActiveTab: setActiveTab as (t: 'personal' | 'archive' | 'agents') => void,
            });
            if (step.highlight) {
              fitOnboardingTourView(step);
            }
            if (step.id === 'open-chat') {
              const ask =
                dynamicNodesRef.current.find((n) => n.type === 'ask')
                ?? dynamicNodesRef.current.find((n) => n.type === 'agent' && isPersonaAnchorNode(n));
              if (ask) setActiveChatAgentNodeId(ask.id);
            }
          }}
          returnFocusRef={mainRef}
        />

        {/* Canvas-specific tour for the official intuition-pump template.
            Mounted silently; only paints when `start()` has fired. */}
        <OnboardingOverlay
          step={intuitionPumpOnboarding.currentStep}
          currentIndex={intuitionPumpOnboarding.currentIndex}
          totalSteps={intuitionPumpOnboarding.totalSteps}
          onNext={intuitionPumpOnboarding.next}
          onSkip={intuitionPumpOnboarding.skip}
          returnFocusRef={mainRef}
        />

        {/* Canvas-specific tour for the official turtle-soup template. */}
        <OnboardingOverlay
          step={turtleSoupOnboarding.currentStep}
          currentIndex={turtleSoupOnboarding.currentIndex}
          totalSteps={turtleSoupOnboarding.totalSteps}
          onNext={turtleSoupOnboarding.next}
          onSkip={turtleSoupOnboarding.skip}
          returnFocusRef={mainRef}
        />

        {activeTab === 'personal' && !canvasImmersive && (
        <div className="flex flex-1 min-h-0 min-w-0">
        <main 
          ref={mainRef}
          data-testid="canvas-workspace-host"
          className="flex-1 min-h-0 min-w-0 relative overflow-hidden bg-surface paper-texture"
          onPointerDownCapture={handleCanvasPointerCapture}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (DEBUG_DND) {
              const t = e.target;
              console.debug('[dnd:drop]', {
                tag: t instanceof Element ? t.tagName : String(t),
                types: Array.from(e.dataTransfer.types),
                filesLength: e.dataTransfer.files?.length ?? 0,
              });
            }
            const chatExcerpt = readChatExcerptDrag(e.dataTransfer);
            if (chatExcerpt && chatExcerpt.canvasId === activeCanvasId) {
              const thread = await db.canvasPersonaThreads.get(chatExcerpt.threadId);
              const message = thread?.messages.find((m) => m.id === chatExcerpt.messageId);
              if (!message) return;
              const xf = transformRef.current;
              const rect = e.currentTarget.getBoundingClientRect();
              const dropX = ((e.clientX - rect.left) - xf.x) / xf.scale;
              const dropY = ((e.clientY - rect.top) - xf.y) / xf.scale;
              const size = defaultExcerptNoteSize();
              const liveNodes = dynamicNodesRef.current;
              const obstacles = liveNodes.map((n) => {
                const el = nodesRef.current[n.id];
                return {
                  type: n.type,
                  x: n.x,
                  y: n.y,
                  width: n.width && n.width > 0 ? n.width : el?.offsetWidth || undefined,
                  height: n.height && n.height > 0 ? n.height : el?.offsetHeight || undefined,
                };
              });
              await excerptToCanvas({
                canvasId: activeCanvasId,
                agentNodeId: chatExcerpt.agentNodeId,
                threadId: chatExcerpt.threadId,
                message,
                text: chatExcerpt.text,
                kind: chatExcerpt.role === 'assistant' ? 'full_message' : 'selection',
                nodes: liveNodes,
                obstacles,
                position: {
                  x: dropX - size.width / 2,
                  y: dropY - size.height / 2,
                },
              });
              return;
            }
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
              const xf = canvasTransform;
              const rect = e.currentTarget.getBoundingClientRect();
              const dropX = ((e.clientX - rect.left) - xf.x) / xf.scale;
              const dropY = ((e.clientY - rect.top) - xf.y) / xf.scale;
              const { failures } = await ingestFilesToCanvas({
                canvasId: activeCanvasId,
                files: e.dataTransfer.files,
                origin: {
                  x: dropX - DEFAULT_NODE_SIZE.width / 2,
                  y: dropY - DEFAULT_NODE_SIZE.height / 2,
                },
              });
              if (failures.length > 0) {
                await appAlert({
                  message: t('canvas.upload_fail', {
                    count: failures.length,
                    names: failures.map((f) => f.name).join(', '),
                  }),
                });
              }
            }
          }}
        >
          {/* Hairline grid borrowed from the landing page. Sits above the paper
              texture but below the marquee, and stays put while the canvas pans. */}
          <div aria-hidden className="canvas-grid absolute inset-0 z-0 pointer-events-none" />
          {/* Empty canvas: click clears selection; drag creates a marquee (edge-pans to grow the box). Middle button pans. */}
          <div
            data-testid="canvas-marquee-layer"
            className={`absolute inset-0 z-0 ${connectingFrom ? 'cursor-copy' : workZoneDrawMode ? 'cursor-crosshair' : 'cursor-default'}`}
            onPointerDown={handleCanvasPanPointerDown}
            onPointerMove={(e) => {
              if (!canvasV2Enabled || !workZoneDrawMode || connectingFrom) return;
              const main = mainRef.current;
              if (!main) return;
              const bounds = main.getBoundingClientRect();
              const world = clientToWorld(
                e.clientX,
                e.clientY,
                bounds.left,
                bounds.top,
                transformRef.current,
              );
              const resizeHit = hitTestWorkZoneResize(
                canvasWorkZonesRef.current,
                world,
                transformRef.current.scale,
                selectedWorkZoneId,
              );
              if (resizeHit) {
                e.currentTarget.style.cursor = workZoneResizeCursor(resizeHit.handle);
                return;
              }
              const bodyHit = hitTestWorkZoneBody(
                canvasWorkZonesRef.current,
                world,
                selectedWorkZoneId,
              );
              e.currentTarget.style.cursor = bodyHit ? 'grab' : 'crosshair';
            }}
            onPointerLeave={(e) => {
              if (workZoneDrawMode) e.currentTarget.style.cursor = '';
            }}
          />
          {marqueeRect && (
            <div
              className="absolute z-20 pointer-events-none border border-[#C2410C] bg-[#C2410C]/10"
              style={{
                left: marqueeRect.x,
                top: marqueeRect.y,
                width: marqueeRect.width,
                height: marqueeRect.height,
              }}
            />
          )}

          <PublishSequenceMode
            active={publishSequenceActive}
            candidateIds={publishSequenceCandidateIds}
            orderedIds={publishSequenceOrderedIds}
            setOrderedIds={setPublishSequenceOrderedIds}
            nodesRef={nodesRef}
            mainRef={mainRef}
            generating={publishSequenceGenerating}
            onCancel={cancelPublishSequence}
            onConfirm={() => {
              void confirmPublishSequence((articleId, nodeId) => {
                openEssayFullscreen(articleId, nodeId);
              });
            }}
          />

          <div className="fixed top-[max(1.5rem,env(safe-area-inset-top))] right-[max(1.5rem,env(safe-area-inset-right))] flex items-center z-40 gap-2">
            <CanvasHistoryPopover
              canvases={canvases}
              activeCanvasId={activeCanvasId}
              setActiveCanvasId={setActiveCanvasId}
            />
            <CanvasNoteSearch
              nodes={dynamicNodes}
              onFocusNode={(node) => {
                const scale = transformRef.current.scale;
                setCanvasTransform(
                  transformToFocusNode(
                    node.x,
                    node.y,
                    scale,
                    node.width ?? 320,
                    node.height ?? 200,
                  ),
                );
                setSelectedNodes(new Set([node.id]));
              }}
            />
            <button
              onClick={toggleFullscreen}
              data-testid="canvas-fullscreen-toggle"
              className={`bg-white text-[#1a1a1a] rounded-full shadow-md hover:scale-105 hover:bg-[#F4F1ED] hover:text-[#C2410C] focus-visible:text-[#C2410C] transition-all border border-[#E6E4DF] flex items-center justify-center ${
                touchChrome ? 'w-10 h-10' : 'p-2'
              }`}
              title={isFullscreen ? t('canvas.full_screen') : t('canvas.full_screen')}
            >
              {isFullscreen ? <Minimize2 className={touchChrome ? 'w-5 h-5' : 'w-4 h-4'} /> : <Maximize2 className={touchChrome ? 'w-5 h-5' : 'w-4 h-4'} />}
            </button>
          </div>

          {/* Toolbar: + (text / theme / essay / ask / agents), file upload, publish, zoom. */}
          <CanvasToolbar
            addTextNode={addTextNode}
            addThemeNode={addThemeNode}
            addEssayNode={addEssayNode}
            addAskNode={addAskNode}
            addFileNode={async (e) => {
              const addedBookIds = await addFileNode(e);
              if (addedBookIds.length === 0) return;
              const newBookNodes = await db.nodes.bulkGet(addedBookIds);
              const newBooks = newBookNodes.filter(
                (n): n is CanvasNode => !!n && n.type === 'book',
              );
              if (newBooks.length === 0) return;
              const ask = await ensureAskCardIdForCanvas(newBooks[0]);
              for (const book of newBooks) {
                await linkNodeToAskCard(book.id, ask.id);
              }
            }}
            onActivateVoice={() => void activateVoiceOnCanvas()}
            onSelectVoicePersona={(agentNodeId) => void activateVoiceOnCanvas(agentNodeId)}
            canvasVoicePersonas={canvasVoicePersonas}
            showAskVoiceOption={showAskVoiceOption}
            pinnedVoiceAgentNodeId={pinnedVoiceAgentNodeId}
            voiceModeActive={voiceModeActive}
            voicePhase={voicePhase}
            liveTranscript={liveTranscript}
            agentConfigs={agentConfigs}
            canvasTransform={canvasTransform}
            setCanvasTransform={setCanvasTransform}
            transformRef={transformRef}
            activeCanvasId={activeCanvasId}
            onFitCanvas={fitCanvasToNodes}
            onPublish={handlePublish}
            selectedCount={publishSelectionCount}
            publishDisabled={isAnyAiBusy && !publishSequenceActive}
            publishBusy={publishSequenceActive || publishSequenceGenerating}
            canvasV2Enabled={canvasV2Enabled}
            workZoneDrawMode={workZoneDrawMode}
            onToggleWorkZoneDraw={() => {
              setWorkZoneDrawMode((on) => !on);
              setSelectedWorkZoneId(null);
              setWorkZoneDraftRect(null);
              setWorkZoneResizePreview(null);
            }}
          />

          {/* Viewport transform is owned by useCanvasInteraction (DOM writes on pan/zoom hot path). */}
          <div
            ref={contentContainerRef}
            className="canvas-cjk absolute inset-0 origin-top-left z-0 pointer-events-none"
          >
            <CanvasEdgeLines
              edges={edges} nodes={dynamicNodes}
              connectingFrom={connectingFrom}
              svgRef={svgRef} edgeLabelsRef={edgeLabelsRef}
              hoveredEdgeId={hoveredEdgeId} setHoveredEdgeId={setHoveredEdgeId}
              deleteEdge={deleteEdge}
              canStartAgentDiscussion={agentCanStartDiscussion}
              onStartAgentDiscussion={runAgentDiscussionFromCard}
            />

            {canvasV2Enabled && (
              <WorkZoneRegionsLayer
                zones={canvasWorkZones}
                scale={canvasTransform.scale}
                draftRect={workZoneDraftRect}
                selectedZoneId={selectedWorkZoneId}
                zoneLabel={workZoneLabel}
                onSelectZone={handleSelectWorkZone}
                showResizeHandles={workZoneDrawMode}
                resizePreview={workZoneResizePreview}
              />
            )}

            {connectingFrom ? (
              <div
                ref={linkGhostRef}
                data-testid="link-note-ghost"
                className="absolute pointer-events-none z-20 rounded-md border-2 border-dashed border-[#C2410C]/55 bg-[#C2410C]/10 shadow-sm"
                style={{
                  left: 0,
                  top: 0,
                  width: DEFAULT_NODE_SIZE.width,
                  height: DEFAULT_NODE_SIZE.height,
                  transform: 'translate3d(-10000px, -10000px, 0px)',
                  willChange: 'transform',
                }}
                aria-hidden
              >
                <div className="h-full w-full flex flex-col p-4 opacity-70">
                  <div className="h-2.5 w-1/3 rounded bg-[#C2410C]/25 mb-3" />
                  <div className="h-2 w-full rounded bg-[#C2410C]/15 mb-2" />
                  <div className="h-2 w-5/6 rounded bg-[#C2410C]/15 mb-2" />
                  <div className="h-2 w-2/3 rounded bg-[#C2410C]/15" />
                </div>
              </div>
            ) : null}

            {publishSequenceActive
              ? publishSequenceOrderedIds.map((id, i) => {
                  const n = dynamicNodes.find((node) => node.id === id);
                  if (!n) return null;
                  const w = n.width && n.width > 0 ? n.width : DEFAULT_NODE_SIZE.width;
                  return (
                    <PublishSequenceBadge
                      key={`seq-${id}`}
                      index={i + 1}
                      x={n.x + w / 2}
                      y={n.y + 12}
                    />
                  );
                })
              : null}

            <div className="absolute inset-0 z-30 w-[1px] h-[1px] pointer-events-none"> 
              {/* All Nodes from Database */}
              {dynamicNodes.map((node) => {
                const essayHub = essayHubBySourceId.get(node.id);
                if (essayHub?.essaySourcesCollapsed) return null;

                const stackedParentId =
                  node.webSearchParentId ||
                  ((node.type === 'text' || node.type === 'note') && node.layout === 2
                    ? edges.find((e) => e.to === node.id)?.from
                    : undefined);
                const stackedParent = stackedParentId
                  ? dynamicNodes.find(
                      (n) =>
                        n.id === stackedParentId &&
                        (n.type === 'ai' || n.type === 'note' || n.type === 'text'),
                    )
                  : undefined;
                const webStacked =
                  !!stackedParent?.webSearchSourcesCollapsed &&
                  webSearchSourceCountByParent.has(stackedParent.id);
                const webImageScatter =
                  !webStacked &&
                  node.type === 'image' &&
                  !!stackedParent &&
                  webSearchSourceCountByParent.has(stackedParent.id);

                const bookHub =
                  (node.bookExpandParentId
                    ? dynamicNodes.find(
                        (n) => n.id === node.bookExpandParentId && n.type === 'theme',
                      )
                    : undefined) ?? bookExpandCollapsedHubByBranchId.get(node.id);
                const bookStacked =
                  !!bookHub?.bookExpandBranchesCollapsed &&
                  bookExpandBranchCountByHub.has(bookHub.id);

                const askThreadRootId =
                  node.type === 'ai' ? node.threadRootContextNodeId : undefined;
                const askThreadRoot = askThreadRootId
                  ? dynamicNodes.find((n) => n.id === askThreadRootId && n.type === 'ask')
                  : undefined;
                const askThreadReplies = askThreadRoot
                  ? askThreadRepliesByAsk.get(askThreadRoot.id)
                  : undefined;
                const askStacked =
                  !canvasV2Enabled &&
                  !!askThreadRoot?.askThreadCollapsed &&
                  !!askThreadReplies &&
                  askThreadReplies.length >= 1;

                const essaySourcesVisible =
                  !!essayHub &&
                  !essayHub.essaySourcesCollapsed &&
                  (essaySourcesByEssay.get(essayHub.id)?.length ?? 0) >= 1;
                const essayBesidePos =
                  essaySourcesVisible && essayHub
                    ? essaySourceStackPos(
                        { x: essayHub.x, y: essayHub.y, width: essayHub.width },
                        essaySourceStackIndex(essayHub, node.id),
                      )
                    : null;

                const notePileHub = notePileHubByMemberId.get(node.id);
                const notePileMembers = notePileHub ? notePilesByHub.get(notePileHub.id) : undefined;
                const notePileStacked =
                  !!notePileHub?.notePileCollapsed &&
                  !!notePileMembers &&
                  notePileMembers.length >= 2;
                const notePileTop =
                  !!notePileMembers &&
                  notePileMembers.length >= 2 &&
                  notePileMembers[notePileMembers.length - 1]?.id === node.id;

                let rotation =
                  typeof node.rotation === 'number'
                    ? node.rotation
                    : (node.type === 'note' || node.type === 'text') ? (node.layout === 0 || node.layout === undefined ? 1 : 0) :
                  (node.type === 'theme') ? (node.layout === 0 || node.layout === undefined ? -1 : 0) :
                  (node.type === 'image') ? -1 :
                  (node.type === 'video') ? 1 :
                  (node.type === 'document') ? 1 : 0;
                if (typeof node.rotation !== 'number') {
                  if (notePileStacked) {
                    rotation = 0;
                  } else if (essaySourcesVisible) {
                    rotation = 0;
                  } else if (webStacked) {
                    rotation = sourceStackTiltDeg(webSearchSourceIndex(node));
                  } else if (webImageScatter) {
                    rotation = sourceImageScatterTiltDeg(webSearchSourceIndex(node));
                  } else if (bookStacked) {
                    rotation = 0;
                  } else if (askStacked && askThreadReplies && askThreadRoot) {
                    rotation = askThreadStackTiltDeg(
                      askThreadStackFrontIndex(askThreadReplies, node.id, askThreadRoot),
                    );
                  }
                }

                const stackZ = notePileStacked && notePileHub && notePileMembers
                  ? notePileStackZIndex(
                      notePileVisualIndex(
                        notePileWritingIndex(notePileHub, node.id),
                        notePileMembers.length,
                      ),
                    )
                  : essaySourcesVisible && essayHub
                  ? essaySourceStackZIndex(essaySourceStackIndex(essayHub, node.id))
                  : webStacked || webImageScatter
                    ? sourceStackZIndex(webSearchSourceIndex(node))
                    : bookStacked
                      ? bookExpandStackZIndex(bookExpandBranchIndex(node))
                      : askStacked && askThreadReplies && askThreadRoot
                        ? askThreadStackZIndex(
                            askThreadStackFrontIndex(askThreadReplies, node.id, askThreadRoot),
                          )
                        : undefined;

                return (
                  <DraggableNode
                    key={node.id}
                    id={node.id} nodesRef={nodesRef} isConnecting={connectingFrom !== null} onLink={handleLink}
                    initialX={essayBesidePos?.x ?? node.x}
                    initialY={essayBesidePos?.y ?? node.y}
                    initialWidth={
                      node.type === 'theme'
                        ? Math.max(node.width ?? 0, THEME_NODE_SIZE.width)
                        : node.width
                    }
                    initialHeight={
                      node.type === 'theme'
                        ? Math.max(node.height ?? 0, THEME_NODE_SIZE.height)
                        : node.height
                    }
                    fixture={isAmbienceFixtureNode(node.type)}
                    onPersonaChatOpen={
                      canvasV2Enabled && isPersonaAnchorNode(node)
                        ? () => setActiveChatAgentNodeId(node.id)
                        : undefined
                    }
                    templateKey={node.templateKey}
                    className={
                      publishSequenceActive && !publishSequenceCandidateSet.has(node.id)
                        ? 'opacity-35'
                        : publishSequenceActive && publishSequenceOrderIndex.has(node.id)
                          ? 'ring-2 ring-[#C2410C] ring-offset-1'
                          : undefined
                    }
                    onDelete={
                      isAmbienceFixtureNode(node.type)
                        ? () => {
                            const snap = snapshotNodesAndTouchingEdges(
                              [node.id],
                              dynamicNodes,
                              edges,
                            );
                            void (async () => {
                              await db.transaction('rw', db.nodes, db.edges, async () => {
                                await db.nodes.delete(node.id);
                                await db.edges
                                  .where('from')
                                  .equals(node.id)
                                  .or('to')
                                  .equals(node.id)
                                  .delete();
                              });
                              setAmbienceHiddenForCanvas(activeCanvasId, true);
                              disposeAmbienceMixer(node.id);
                              canvasUndoStackRef.current.push({
                                type: 'delete',
                                nodes: snap.nodes,
                                edges: snap.edges,
                              });
                            })();
                          }
                        : () => deleteNodesWithUndo([node.id])
                    }
                    onArchive={
                      isArchivableNodeType(node.type)
                        ? (folderId) => {
                            void archiveNodeId(node.id, folderId);
                          }
                        : undefined
                    }
                    scale={canvasTransform.scale}
                    rotation={rotation}
                    zIndexOverride={stackZ}
                    onCycleLayout={
                      nodeSupportsCycleLayout(node.type)
                        ? () => {
                            const currentLayout = node.layout || 0;
                            const layoutCycleMod =
                              node.type === 'note' || node.type === 'text' ? NOTE_LAYOUT_COUNT : 4;
                            db.nodes.update(node.id, { layout: (currentLayout + 1) % layoutCycleMod });
                          }
                        : undefined
                    }
                    isSelected={selectedNodes.has(node.id)}
                    isRelatedHighlight={relatedHighlightNodeIds.has(node.id)}
                    isEditing={editingNodeId === node.id}
                    allowPalette={!isAmbienceFixtureNode(node.type)}
                    groupPaletteLocked={selectedNodes.size > 1 && selectedNodes.has(node.id)}
                    onRegisterPaletteApplier={registerPaletteApplier}
                    onPaletteStyleChange={applyPaletteStyle}
                    onToggleSelect={
                      isAmbienceFixtureNode(node.type) ? undefined : toggleNodeSelection
                    }
                    groupDragEnabled={
                      !isAmbienceFixtureNode(node.type) &&
                      ((selectedNodes.size > 1 && selectedNodes.has(node.id)) ||
                        collapsedNotePilePeerIds(node.id, dynamicNodes).length >= 2)
                    }
                    onGroupDragMove={(delta) => {
                      const selected = selectedNodesRef.current;
                      const peers =
                        selected.size > 1 && selected.has(node.id)
                          ? selected
                          : new Set(collapsedNotePilePeerIds(node.id, dynamicNodesRef.current));
                      for (const id of peers) {
                        if (id === node.id) continue;
                        const el = nodesRef.current[id];
                        if (!el) continue;
                        setNodeDragOffset(el, delta.dx, delta.dy);
                      }
                    }}
                    onDragEnd={handleNodeDragEnd}
                    onDragMove={handleNodeDragMove}
                    onResizeEnd={(size) => {
                      db.nodes.update(node.id, size);
                    }}
                    onRotateEnd={(nextRotation) => {
                      db.nodes.update(node.id, { rotation: nextRotation });
                    }}
                    glassSurface={
                      (node.type === 'note' || node.type === 'text') && (node.layout ?? 0) === 1
                    }
                    onStickyActivate={
                      node.type === 'note' || node.type === 'text'
                        ? (nid) => {
                            lastStickyClickIdRef.current = nid;
                          }
                        : undefined
                    }
                    onEssayActivate={
                      node.type === 'essay'
                        ? handleEssayActivate
                        : () => {
                            clearRelatedHighlight();
                          }
                    }
                    onAskAiSubmit={
                      canvasV2Enabled ||
                      !canAskAiOnNode(node) ||
                      isAmbienceFixtureNode(node.type)
                        ? undefined
                        : (prompt) => {
                            void runAskCardGeneration(node.id, prompt);
                          }
                    }
                    askComposerPrefill={
                      askComposerPrefill?.nodeId === node.id
                        ? { text: askComposerPrefill.text, token: askComposerPrefill.token }
                        : undefined
                    }
                    isAskAiSubmitting={
                      streamingAskNodeId === node.id || Boolean(personaStreams[node.id])
                    }
                    isAskAiDisabled={
                      (askAiRequiresLinkedPersona(node) && !askAiLinkedIds.has(node.id)) ||
                      isNonPersonaAiBusy ||
                      Boolean(personaStreams[node.id]) ||
                      (streamingAskNodeId != null && streamingAskNodeId !== node.id)
                    }
                    askAiHint={
                      canvasV2Enabled && node.type === 'agent'
                        ? t('nodes.agent_run_direct')
                        : askAiRequiresLinkedPersona(node) && !askAiLinkedIds.has(node.id)
                        ? t('nodes.ask_ai_need_persona')
                        : undefined
                    }
                    onAskAiRunAnalysis={
                      node.type === 'agent'
                        ? () => runAgentAnalysisFromCard(node.id)
                        : undefined
                    }
                    isAskAiAnalysisDisabled={
                      node.type === 'agent' &&
                      (isNonPersonaAiBusy ||
                        Boolean(personaStreams[node.id]) ||
                        analyzingAgentNodeId === node.id ||
                        Boolean(
                          node.agentConfigId && generatingCoverAgentId === node.agentConfigId,
                        ))
                    }
                    thinkingTrace={node.type === 'ai' ? node.thinkingTrace : undefined}
                >
                  <NodeRenderer
                    node={node}
                    editingNodeId={editingNodeId}
                    setEditingNodeId={setEditingNodeId}
                    agentConfigs={agentConfigs}
                    analyzingAgentNodeId={
                      node.type === 'agent' && personaStreams[node.id]
                        ? node.id
                        : analyzingAgentNodeId
                    }
                    generatingCoverAgentId={generatingCoverAgentId}
                    onContinueDiscussion={runContinueDiscussionFromCard}
                    canContinueDiscussion={agentCanContinueDiscussion}
                    isContinueDiscussionDisabled={isAnyAiBusy}
                    streamingAiNodeId={streamingAiNodeId}
                    streamingThought={streamingThought}
                    streamingAskNodeId={
                      personaStreams[node.id] ? node.id : streamingAskNodeId
                    }
                    webSearchSourceCount={webSearchSourceCountByParent.get(node.id) ?? 0}
                    webSearchSourcesCollapsed={!!node.webSearchSourcesCollapsed}
                    onToggleWebSearchSources={toggleWebSearchSources}
                    bookExpandBranchCount={bookExpandBranchCountByHub.get(node.id) ?? 0}
                    onToggleBookExpandBranches={toggleBookExpandBranches}
                    notePileCount={notePileTop ? notePileMembers?.length ?? 0 : 0}
                    onToggleNotePile={toggleNotePile}
                    askThreadReplyCount={
                      node.type === 'ask'
                        ? askThreadRepliesByAsk.get(node.id)?.length ?? 0
                        : 0
                    }
                    onToggleAskThread={canvasV2Enabled ? undefined : toggleAskThread}
                    essaySourceCount={
                      node.type === 'essay' ? essaySourcesByEssay.get(node.id)?.length ?? 0 : 0
                    }
                    onToggleEssaySources={toggleEssaySources}
                    essayCollectHover={node.type === 'essay' && essayCollectHoverId === node.id}
                    essayCollectPulse={node.type === 'essay' && essayCollectPulseId === node.id}
                    onStopTts={() => void stopTts()}
                    isTtsSpeaking={voicePhase === 'speaking' && ttsHighlight?.nodeId === node.id}
                    ttsHighlightSentence={
                      ttsHighlight?.nodeId === node.id ? ttsHighlight.sentence : null
                    }
                    onExtractBookSelectionToCard={(quote, sourceLabel, sourceNodeId) => {
                      void extractBookSelectionToCard(
                        sourceNodeId || node.id,
                        quote,
                        sourceLabel,
                      );
                    }}
                    onAskAboutBookSelection={
                      canvasV2Enabled ||
                      !askAiRequiresLinkedPersona(node) ||
                      askAiLinkedIds.has(node.id)
                        ? askAboutBookSelection
                        : undefined
                    }
                    onExpandBookSelection={(quote, sourceLabel) => {
                      void expandBookSelection(node.id, quote, sourceLabel);
                    }}
                    expandingBookNodeId={expandingBookNodeId}
                    onOpenEssay={openEssayFullscreen}
                    onOpenBookFullscreen={openBookFullscreen}
                    onRetryImageGeneration={
                      canvasV2Enabled ? undefined : retryImageGenerationFromCard
                    }
                    onRetryAiGeneration={
                      canvasV2Enabled ? undefined : retryAiGenerationFromCard
                    }
                    onTranscribeAudio={(nodeId) => {
                      void transcribeAudioCard(nodeId);
                    }}
                    transcribingAudioNodeId={transcribingAudioNodeId}
                  />
                </DraggableNode>
              );
            })}
            </div>

          </div>

          {activeChatPersona && (
            <CanvasChatPanel
              canvasId={activeCanvasId}
              agentNode={activeChatPersona}
              agentConfig={activeChatPersonaConfig}
              personaDisplayName={activeChatPersonaName}
              nodes={dynamicNodes}
              nodesRef={nodesRef}
              composerSegments={composerSegments}
              onComposerSegmentsChange={setComposerSegments}
              isStreaming={Boolean(personaStreams[activeChatPersona.id])}
              streamingMessageId={personaStreams[activeChatPersona.id]?.messageId ?? null}
              streamingThought={personaStreams[activeChatPersona.id]?.thought ?? ''}
              ttsHighlightMessageId={ttsHighlight?.nodeId ?? null}
              ttsHighlightSentence={ttsHighlight?.sentence ?? null}
              scrollToMessageId={scrollToChatMessageId}
              onClose={() => setActiveChatAgentNodeId(null)}
              onSend={(segments, onAccepted) =>
                sendPersonaMessage(activeChatPersona.id, userTextFromSegments(segments), {
                  composerSegments: segments,
                  onAccepted,
                })
              }
              onIngestFiles={ingestChatPanelFiles}
              onToggleVoice={() => {
                if (activeChatPersona.type === 'agent') pinVoicePersona(activeChatPersona.id);
                else pinVoicePersona(null);
                handleAskToggleVoice(activeChatPersona.id);
              }}
              voiceModeActive={voiceModeActive && voiceTargetAskCardId === activeChatPersona.id}
              voicePhase={voicePhase}
              liveTranscript={liveTranscript}
              composerPrefill={chatComposerPrefill}
              onRemoveFocus={(nodeId) => {
                setSelectedNodes((prev) => {
                  const next = new Set(prev);
                  next.delete(nodeId);
                  return next;
                });
              }}
              onDropSelectionAt={(messageId, text, clientX, clientY) => {
                void (async () => {
                  const snippet = text.trim();
                  if (!snippet) return;
                  const hit = document.elementFromPoint(clientX, clientY);
                  if (hit?.closest('[data-testid="canvas-chat-panel"]')) return;
                  const main = mainRef.current;
                  if (!main) return;
                  const bounds = main.getBoundingClientRect();
                  if (
                    clientX < bounds.left ||
                    clientX > bounds.right ||
                    clientY < bounds.top ||
                    clientY > bounds.bottom
                  ) {
                    return;
                  }
                  const thread = await db.canvasPersonaThreads.get(
                    personaThreadId(activeCanvasId, activeChatPersona.id),
                  );
                  const message = thread?.messages.find((m) => m.id === messageId);
                  if (!message) return;
                  const world = clientToWorld(
                    clientX,
                    clientY,
                    bounds.left,
                    bounds.top,
                    transformRef.current,
                  );
                  const size = defaultExcerptNoteSize();
                  const liveNodes = dynamicNodesRef.current;
                  const obstacles = liveNodes.map((n) => {
                    const el = nodesRef.current[n.id];
                    return {
                      type: n.type,
                      x: n.x,
                      y: n.y,
                      width: n.width && n.width > 0 ? n.width : el?.offsetWidth || undefined,
                      height: n.height && n.height > 0 ? n.height : el?.offsetHeight || undefined,
                    };
                  });
                  await excerptToCanvas({
                    canvasId: activeCanvasId,
                    agentNodeId: activeChatPersona.id,
                    threadId: personaThreadId(activeCanvasId, activeChatPersona.id),
                    message,
                    text: snippet,
                    kind: 'selection',
                    nodes: liveNodes,
                    obstacles,
                    position: {
                      x: world.x - size.width / 2,
                      y: world.y - size.height / 2,
                    },
                  });
                })();
              }}
              onDropReplyAt={(messageId, clientX, clientY) => {
                void (async () => {
                  const hit = document.elementFromPoint(clientX, clientY);
                  if (hit?.closest('[data-testid="canvas-chat-panel"]')) return;
                  const main = mainRef.current;
                  if (!main) return;
                  const bounds = main.getBoundingClientRect();
                  if (
                    clientX < bounds.left ||
                    clientX > bounds.right ||
                    clientY < bounds.top ||
                    clientY > bounds.bottom
                  ) {
                    return;
                  }
                  const thread = await db.canvasPersonaThreads.get(
                    personaThreadId(activeCanvasId, activeChatPersona.id),
                  );
                  const message = thread?.messages.find((m) => m.id === messageId);
                  if (!message?.text.trim()) return;
                  const world = clientToWorld(
                    clientX,
                    clientY,
                    bounds.left,
                    bounds.top,
                    transformRef.current,
                  );
                  const size = defaultExcerptNoteSize();
                  const liveNodes = dynamicNodesRef.current;
                  const obstacles = liveNodes.map((n) => {
                    const el = nodesRef.current[n.id];
                    return {
                      type: n.type,
                      x: n.x,
                      y: n.y,
                      width: n.width && n.width > 0 ? n.width : el?.offsetWidth || undefined,
                      height: n.height && n.height > 0 ? n.height : el?.offsetHeight || undefined,
                    };
                  });
                  await excerptToCanvas({
                    canvasId: activeCanvasId,
                    agentNodeId: activeChatPersona.id,
                    threadId: personaThreadId(activeCanvasId, activeChatPersona.id),
                    message,
                    text: message.text,
                    kind: message.role === 'assistant' ? 'full_message' : 'selection',
                    nodes: liveNodes,
                    obstacles,
                    position: {
                      x: world.x - size.width / 2,
                      y: world.y - size.height / 2,
                    },
                  });
                })();
              }}
              onDropThinkingAt={(messageId, clientX, clientY) => {
                void (async () => {
                  const hit = document.elementFromPoint(clientX, clientY);
                  if (hit?.closest('[data-testid="canvas-chat-panel"]')) return;
                  const main = mainRef.current;
                  if (!main) return;
                  const bounds = main.getBoundingClientRect();
                  if (
                    clientX < bounds.left ||
                    clientX > bounds.right ||
                    clientY < bounds.top ||
                    clientY > bounds.bottom
                  ) {
                    return;
                  }
                  const thread = await db.canvasPersonaThreads.get(
                    personaThreadId(activeCanvasId, activeChatPersona.id),
                  );
                  const message = thread?.messages.find((m) => m.id === messageId);
                  const thought = message?.thinkingTrace?.trim();
                  if (!message || !thought) return;
                  const world = clientToWorld(
                    clientX,
                    clientY,
                    bounds.left,
                    bounds.top,
                    transformRef.current,
                  );
                  const size = defaultExcerptNoteSize();
                  const liveNodes = dynamicNodesRef.current;
                  const obstacles = liveNodes.map((n) => {
                    const el = nodesRef.current[n.id];
                    return {
                      type: n.type,
                      x: n.x,
                      y: n.y,
                      width: n.width && n.width > 0 ? n.width : el?.offsetWidth || undefined,
                      height: n.height && n.height > 0 ? n.height : el?.offsetHeight || undefined,
                    };
                  });
                  await excerptToCanvas({
                    canvasId: activeCanvasId,
                    agentNodeId: activeChatPersona.id,
                    threadId: personaThreadId(activeCanvasId, activeChatPersona.id),
                    message,
                    text: thought,
                    kind: 'thinking',
                    nodes: liveNodes,
                    obstacles,
                    position: {
                      x: world.x - size.width / 2,
                      y: world.y - size.height / 2,
                    },
                  });
                })();
              }}
              onDropSearchHitAt={(messageId, searchHit, clientX, clientY) => {
                void (async () => {
                  const elHit = document.elementFromPoint(clientX, clientY);
                  if (elHit?.closest('[data-testid="canvas-chat-panel"]')) return;
                  const main = mainRef.current;
                  if (!main) return;
                  const bounds = main.getBoundingClientRect();
                  if (
                    clientX < bounds.left ||
                    clientX > bounds.right ||
                    clientY < bounds.top ||
                    clientY > bounds.bottom
                  ) {
                    return;
                  }
                  const thread = await db.canvasPersonaThreads.get(
                    personaThreadId(activeCanvasId, activeChatPersona.id),
                  );
                  const message = thread?.messages.find((m) => m.id === messageId);
                  if (!message) return;
                  const world = clientToWorld(
                    clientX,
                    clientY,
                    bounds.left,
                    bounds.top,
                    transformRef.current,
                  );
                  const liveNodes = dynamicNodesRef.current;
                  const obstacles = liveNodes.map((n) => {
                    const el = nodesRef.current[n.id];
                    return {
                      type: n.type,
                      x: n.x,
                      y: n.y,
                      width: n.width && n.width > 0 ? n.width : el?.offsetWidth || undefined,
                      height: n.height && n.height > 0 ? n.height : el?.offsetHeight || undefined,
                    };
                  });
                  await excerptSearchHitToCanvas({
                    canvasId: activeCanvasId,
                    agentNodeId: activeChatPersona.id,
                    threadId: personaThreadId(activeCanvasId, activeChatPersona.id),
                    message,
                    hit: searchHit,
                    nodes: liveNodes,
                    obstacles,
                    position: {
                      x: world.x - SOURCE_CARD_WIDTH / 2,
                      y: world.y - SOURCE_CARD_HEIGHT / 2,
                    },
                  });
                })();
              }}
              onDropChatImage={(image, clientX, clientY) => {
                void (async () => {
                  if (!image.url) return;
                  const hit = document.elementFromPoint(clientX, clientY);
                  if (hit?.closest('[data-testid="canvas-chat-panel"]')) return;
                  const main = mainRef.current;
                  if (!main) return;
                  const bounds = main.getBoundingClientRect();
                  if (
                    clientX < bounds.left ||
                    clientX > bounds.right ||
                    clientY < bounds.top ||
                    clientY > bounds.bottom
                  ) {
                    return;
                  }
                  const world = clientToWorld(
                    clientX,
                    clientY,
                    bounds.left,
                    bounds.top,
                    transformRef.current,
                  );
                  const size = fluxImageCardSize(image.orientation ?? 'square');
                  await spawnFluxImageCard({
                    canvasId: activeCanvasId,
                    imageUrl: image.url,
                    description: image.title,
                    imagePrompt: image.prompt,
                    x: world.x - size.width / 2,
                    y: world.y - size.height / 2,
                    width: size.width,
                    height: size.height,
                    contextScopeAgentId: activeChatPersona.id,
                  });
                })();
              }}
              onRetryChatImage={retryChatImageFromThread}
            />
          )}

        </main>
        </div>
        )}

        {activeTab === 'pocket' && (
          <PocketView
            onOpenLogin={authCtx.configured ? () => setIsSettingsOpen(true) : undefined}
            accountSignedIn={!!authCtx.session}
          />
        )}
        <React.Suspense fallback={null}>
          {activeTab === 'archive' && (
            <ArchiveLibrary
              activeCanvasId={activeCanvasId}
              transformRef={transformRef}
              aiConfig={aiConfig}
              onRestored={() => setActiveTab('personal')}
            />
          )}
          {/* Agents in Agents Studio need consistent write access */}
          {activeTab === 'agents' && <AgentsStudio agentConfigs={agentConfigs} setAgentConfigs={persistAgentConfigs} aiConfig={aiConfig} callAI={callUniversalAI} onGenerateCover={generateAgentCover} generatingCoverAgentId={generatingCoverAgentId} onActivateCanvas={setActiveCanvasId} />}
          {isSettingsOpen ? (
            <AISettingsModal isOpen onClose={() => setIsSettingsOpen(false)} config={aiConfig} setConfig={setAiConfig} onRestartTour={restartTour} />
          ) : null}
          {fullscreenEssay && (
            <EssayFullscreen
              articleId={fullscreenEssay.articleId}
              aiConfig={aiConfig}
              onClose={closeEssayFullscreen}
              onOpenCanvas={(canvasId) => {
                setActiveCanvasId(canvasId);
                setActiveTab('personal');
              }}
            />
          )}
          {fullscreenBookNodeId && (
            <BookFullscreen
              nodeId={fullscreenBookNodeId}
              onClose={closeBookFullscreen}
              isExpanding={expandingBookNodeId === fullscreenBookNodeId}
              onExtractSelectionToCard={(quote, sourceLabel, sourceNodeId) => {
                void extractBookSelectionToCard(
                  sourceNodeId || fullscreenBookNodeId,
                  quote,
                  sourceLabel,
                );
              }}
              onAskAboutSelection={askAboutBookSelection}
              onExpandSelection={(quote, sourceLabel) => {
                void expandBookSelection(fullscreenBookNodeId, quote, sourceLabel);
              }}
            />
          )}
        </React.Suspense>
      </div>
    </div>
  );
}
