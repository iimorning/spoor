/**
 * CanvasGraphView — relationship graph + neighborhood insight.
 *
 * Wired from the knowledge archive (`ArchiveLibrary`), not the live canvas.
 * Nodes are archived cards; edges come from original canvas links plus
 * same-folder chains. Insight is saved back into the archive.
 *
 * Companion files:
 *   src/utils/forceGraphSim.ts
 *   src/utils/graphNeighborhood.ts
 *   src/utils/archiveKnowledgeGraph.ts
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Moon, Network, Sparkles, Sun, X } from 'lucide-react';
import type { CanvasNode, Edge } from '../db';
import type { AIConfig } from './AISettingsModal';
import { callUniversalAI, formatAiError } from '../services/ai';
import { spoorLlmSessionId } from '../utils/openRouterPromptCache';
import { getCanvasNodeSearchText, canvasNodeTypeLabelKey } from '../utils/canvasNodeSearch';
import {
  buildGraphInsightCards,
  collectGraphNeighborhood,
  formatGraphInsightContext,
} from '../utils/graphNeighborhood';
import {
  buildForceGraph,
  graphNodeRadius,
  stepForceGraph,
  type ForceGraphNode,
} from '../utils/forceGraphSim';

export interface CanvasGraphViewProps {
  nodes: CanvasNode[];
  edges: Edge[];
  aiConfig: AIConfig;
  onClose: () => void;
  onFocusNode: (node: CanvasNode) => void;
  /** Persist an insight note (archive library saves it as a knowledge card). */
  onSaveInsight: (payload: {
    hubId: string;
    memberIds: string[];
    text: string;
  }) => void | Promise<void>;
  /** Extra archive cards to read for insight (e.g. same-folder mates). */
  expandInsightMemberIds?: (hubId: string, graphMemberIds: string[]) => string[];
}

type GraphTheme = 'light' | 'dark';

const GRAPH_THEME_KEY = 'spoor_graph_theme';

function readStoredTheme(): GraphTheme {
  try {
    const v = localStorage.getItem(GRAPH_THEME_KEY);
    if (v === 'dark' || v === 'light') return v;
  } catch {
    /* ignore */
  }
  return 'light';
}

function shortLabel(node: CanvasNode): string {
  const text = getCanvasNodeSearchText(node).replace(/\s+/g, ' ').trim();
  if (!text) return node.type || 'card';
  return text.length > 36 ? `${text.slice(0, 36)}…` : text;
}

function nodeFill(type: string, theme: GraphTheme): string {
  switch (type) {
    case 'theme':
      return '#C2410C';
    case 'ai':
      return theme === 'light' ? '#ea580c' : '#fb923c';
    case 'agent':
      return theme === 'light' ? '#16a34a' : '#4ade80';
    case 'book':
      return theme === 'light' ? '#2563eb' : '#60a5fa';
    case 'essay':
      return theme === 'light' ? '#b45309' : '#fbbf24';
    case 'document':
      return theme === 'light' ? '#3b82f6' : '#93c5fd';
    case 'image':
    case 'video':
      return theme === 'light' ? '#9333ea' : '#c084fc';
    case 'ask':
      return theme === 'light' ? '#db2777' : '#f472b6';
    default:
      return theme === 'light' ? '#57534e' : '#e7e5e4';
  }
}

const THEME_UI = {
  light: {
    shell: 'bg-[#F7F4F0] text-[#1a1a1a]',
    chip: 'bg-white border-[#E6E4DF] shadow-md',
    chipMuted: 'text-[#8c8a84]',
    button:
      'bg-white text-[#1a1a1a] border-[#E6E4DF] hover:border-[#C2410C] hover:text-[#C2410C]',
    empty: 'text-[#8c8a84]',
    hint: 'text-[#8c8a84]/70',
    tip: 'bg-white/95 border-[#E6E4DF] shadow-xl',
    tipMuted: 'text-[#8c8a84]',
    tipTitle: 'text-[#1a1a1a]',
    edge: 'rgba(28, 25, 23, 0.18)',
    edgeHot: 'rgba(194, 65, 12, 0.55)',
    ring: 'rgba(194, 65, 12, 0.75)',
    nodeStroke: 'rgba(28, 25, 23, 0.28)',
    nodeStrokeActive: '#ffffff',
    panel: 'bg-white/95 border-[#E6E4DF]',
    primaryBtn: 'bg-[#C2410C] text-white hover:bg-[#a0350a]',
    secondaryBtn: 'bg-[#F4F1ED] text-[#1a1a1a] hover:bg-[#EAE7E2]',
  },
  dark: {
    shell: 'bg-[#141414] text-[#e7e5e4]',
    chip: 'bg-[#1f1f1f] border-white/10 shadow-lg',
    chipMuted: 'text-white/40',
    button:
      'bg-[#1f1f1f] text-[#e7e5e4] border-white/10 hover:border-[#C2410C] hover:text-[#C2410C]',
    empty: 'text-white/45',
    hint: 'text-white/35',
    tip: 'bg-[#1f1f1f]/95 border-white/10 shadow-xl',
    tipMuted: 'text-white/40',
    tipTitle: 'text-[#f5f5f4]',
    edge: 'rgba(255, 255, 255, 0.14)',
    edgeHot: 'rgba(194, 65, 12, 0.55)',
    ring: 'rgba(194, 65, 12, 0.7)',
    nodeStroke: 'rgba(0, 0, 0, 0.35)',
    nodeStrokeActive: '#ffffff',
    panel: 'bg-[#1f1f1f]/95 border-white/10',
    primaryBtn: 'bg-[#C2410C] text-white hover:bg-[#a0350a]',
    secondaryBtn: 'bg-white/10 text-[#e7e5e4] hover:bg-white/15',
  },
} as const;

export function CanvasGraphView({
  nodes,
  edges,
  aiConfig,
  onClose,
  onFocusNode,
  onSaveInsight,
  expandInsightMemberIds,
}: CanvasGraphViewProps) {
  const { t, i18n } = useTranslation();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<GraphTheme>(readStoredTheme);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [insightText, setInsightText] = useState('');
  const [insightError, setInsightError] = useState<string | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const abortRef = useRef(0);
  const simRef = useRef<ReturnType<typeof buildForceGraph> | null>(null);
  const [, bump] = useState(0);
  const panRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);

  const ui = THEME_UI[theme];

  const signature = useMemo(
    () =>
      `${nodes.map((n) => n.id).sort().join(',')}|${edges.map((e) => `${e.from}-${e.to}`).sort().join(',')}`,
    [nodes, edges],
  );

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const neighborhood = useMemo(() => {
    if (!selectedId) return null;
    return collectGraphNeighborhood(selectedId, edges, { maxHops: 1, maxMembers: 12 });
  }, [selectedId, edges]);

  const clusterSet = useMemo(
    () => new Set(neighborhood?.memberIds ?? []),
    [neighborhood],
  );

  const selectedNode = selectedId ? nodeById.get(selectedId) : undefined;
  const selectedSim = selectedId
    ? (simRef.current?.nodes ?? []).find((n) => n.id === selectedId)
    : undefined;

  useEffect(() => {
    try {
      localStorage.setItem(GRAPH_THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      setSize({ w: Math.max(1, box.width), h: Math.max(1, box.height) });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth || 800, h: el.clientHeight || 600 });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    simRef.current = buildForceGraph(
      nodes.map((n) => ({
        id: n.id,
        type: n.type,
        label: shortLabel(n),
        seedX: n.x,
        seedY: n.y,
      })),
      edges.map((e) => ({ id: e.id, from: e.from, to: e.to })),
    );
    setHoverId(null);
    setSelectedId(null);
    setInsightText('');
    setInsightError(null);
    setView({ x: 0, y: 0, scale: 1 });
    bump((k) => k + 1);
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let frame = 0;
    let ticks = 0;
    const maxWarmup = 90;
    const loop = () => {
      const sim = simRef.current;
      if (sim && sim.nodes.length > 0) {
        stepForceGraph(sim.nodes, sim.edges);
        ticks += 1;
        if (ticks < maxWarmup || ticks % 2 === 0) bump((k) => k + 1);
      }
      frame = window.requestAnimationFrame(loop);
    };
    frame = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(frame);
  }, [signature]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedId) {
          setSelectedId(null);
          setInsightText('');
          setInsightError(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, selectedId]);

  useEffect(() => {
    setInsightText('');
    setInsightError(null);
  }, [selectedId]);

  const sim = simRef.current;
  const simNodes = sim?.nodes ?? [];
  const simEdges = sim?.edges ?? [];
  const cx = size.w / 2;
  const cy = size.h / 2;

  const hoverNode: ForceGraphNode | undefined = hoverId
    ? simNodes.find((n) => n.id === hoverId)
    : undefined;

  const toScreen = (n: ForceGraphNode) => ({
    x: cx + view.x + n.x * view.scale,
    y: cy + view.y + n.y * view.scale,
  });

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    setView((v) => ({
      ...v,
      scale: Math.min(3.5, Math.max(0.35, v.scale * factor)),
    }));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const target = e.target as Element;
    if (target.closest('[data-graph-node]')) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    panRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: view.x,
      originY: view.y,
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== e.pointerId) return;
    const dx = e.clientX - pan.startX;
    const dy = e.clientY - pan.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) pan.moved = true;
    setView((v) => ({ ...v, x: pan.originX + dx, y: pan.originY + dy }));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== e.pointerId) return;
    panRef.current = null;
    if (!pan.moved) {
      setSelectedId(null);
      setInsightText('');
      setInsightError(null);
    }
  };

  const toggleTheme = () => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));

  const runInsight = useCallback(async () => {
    if (!selectedId || !neighborhood) return;
    const memberIds = expandInsightMemberIds
      ? expandInsightMemberIds(selectedId, neighborhood.memberIds)
      : neighborhood.memberIds;
    const cards = buildGraphInsightCards(memberIds, selectedId, nodeById);
    if (cards.length === 0) {
      setInsightError(t('canvas.graph_insight_no_text'));
      return;
    }
    const token = ++abortRef.current;
    setInsightLoading(true);
    setInsightError(null);
    setInsightText('');
    try {
      const context = formatGraphInsightContext(cards, neighborhood.edgeNotes);
      const lang = i18n.language?.startsWith('zh') ? 'zh' : 'en';
      const text = await callUniversalAI({
        config: aiConfig,
        temperature: 0.55,
        topP: 0.4,
        systemInstruction: t('canvas.graph_insight_system'),
        prompt: t('canvas.graph_insight_user', { context, lang }),
        sessionId: spoorLlmSessionId('graph', selectedId),
      });
      if (token !== abortRef.current) return;
      setInsightText(text.trim());
    } catch (e) {
      if (token !== abortRef.current) return;
      setInsightError(formatAiError(e));
    } finally {
      if (token === abortRef.current) setInsightLoading(false);
    }
  }, [selectedId, neighborhood, nodeById, aiConfig, t, i18n.language, expandInsightMemberIds]);

  const saveInsight = useCallback(async () => {
    if (!selectedId || !insightText.trim()) return;
    setSaving(true);
    try {
      await onSaveInsight({
        hubId: selectedId,
        memberIds: neighborhood?.memberIds ?? [selectedId],
        text: insightText.trim(),
      });
    } finally {
      setSaving(false);
    }
  }, [selectedId, insightText, neighborhood, onSaveInsight]);

  const structuralHint = useMemo(() => {
    if (!selectedSim || !neighborhood) return '';
    const degree = selectedSim.degree;
    const n = Math.max(0, neighborhood.memberIds.length - 1);
    const notes = neighborhood.edgeNotes.length;
    if (degree >= 4) return t('canvas.graph_insight_hub', { degree, neighbors: n, notes });
    if (degree === 0) return t('canvas.graph_insight_orphan');
    return t('canvas.graph_insight_cluster', { neighbors: n, notes });
  }, [selectedSim, neighborhood, t]);

  return (
    <div
      ref={wrapRef}
      className={`absolute inset-0 z-50 flex flex-col ${ui.shell}`}
      data-testid="canvas-graph-view"
      data-theme={theme}
      onWheel={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="absolute top-6 left-6 z-10 flex items-center gap-2 pointer-events-none">
        <div
          className={`pointer-events-auto flex items-center gap-2 h-11 px-4 rounded-full border ${ui.chip}`}
        >
          <Network className="w-4 h-4 text-[#C2410C]" aria-hidden />
          <span className="text-xs font-semibold tracking-wide">
            {t('canvas.graph_view')}
          </span>
          <span className={`text-[10px] font-mono ${ui.chipMuted}`}>
            {simNodes.length} · {simEdges.length}
          </span>
        </div>
      </div>

      <div className="absolute top-6 right-6 z-10 flex items-center gap-2">
        <button
          type="button"
          onClick={toggleTheme}
          className={`p-3 rounded-full shadow-md border transition-all ${ui.button}`}
          title={theme === 'light' ? t('canvas.graph_theme_dark') : t('canvas.graph_theme_light')}
          aria-label={theme === 'light' ? t('canvas.graph_theme_dark') : t('canvas.graph_theme_light')}
          data-testid="canvas-graph-theme"
        >
          {theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
        </button>
        <button
          type="button"
          onClick={onClose}
          className={`p-3 rounded-full shadow-md border transition-all ${ui.button}`}
          title={t('canvas.graph_back')}
          aria-label={t('canvas.graph_back')}
          data-testid="canvas-graph-close"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {simNodes.length === 0 ? (
        <div className={`flex-1 flex items-center justify-center text-sm px-6 text-center ${ui.empty}`}>
          {t('canvas.graph_empty')}
        </div>
      ) : (
        <svg
          className="flex-1 w-full h-full cursor-grab active:cursor-grabbing touch-none"
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {simEdges.map((e) => {
            const a = simNodes.find((n) => n.id === e.from);
            const b = simNodes.find((n) => n.id === e.to);
            if (!a || !b) return null;
            const sa = toScreen(a);
            const sb = toScreen(b);
            const inCluster =
              !!selectedId && clusterSet.has(a.id) && clusterSet.has(b.id);
            const hot =
              hoverId === a.id ||
              hoverId === b.id ||
              selectedId === a.id ||
              selectedId === b.id ||
              inCluster;
            return (
              <line
                key={e.id}
                x1={sa.x}
                y1={sa.y}
                x2={sb.x}
                y2={sb.y}
                stroke={hot ? ui.edgeHot : ui.edge}
                strokeWidth={inCluster || hot ? 1.6 : 1}
                opacity={selectedId && !inCluster && !hot ? 0.28 : 1}
              />
            );
          })}

          {simNodes.map((n) => {
            const s = toScreen(n);
            const r = graphNodeRadius(n.degree) * Math.min(1.35, 0.75 + view.scale * 0.25);
            const active = hoverId === n.id || selectedId === n.id;
            const inCluster = !!selectedId && clusterSet.has(n.id);
            const dimmed = !!selectedId && !inCluster;
            return (
              <g
                key={n.id}
                data-graph-node={n.id}
                transform={`translate(${s.x}, ${s.y})`}
                className="cursor-pointer"
                opacity={dimmed ? 0.22 : 1}
                onPointerEnter={() => setHoverId(n.id)}
                onPointerLeave={() => setHoverId((id) => (id === n.id ? null : id))}
                onClick={(ev) => {
                  ev.stopPropagation();
                  setSelectedId(n.id);
                }}
                onDoubleClick={(ev) => {
                  ev.stopPropagation();
                  const node = nodeById.get(n.id);
                  if (node) onFocusNode(node);
                }}
              >
                {active || inCluster ? (
                  <circle
                    r={r + (selectedId === n.id ? 6 : 4)}
                    fill="none"
                    stroke={ui.ring}
                    strokeWidth={selectedId === n.id ? 1.75 : 1.15}
                    opacity={selectedId === n.id ? 1 : 0.55}
                  />
                ) : null}
                <circle
                  r={r}
                  fill={nodeFill(n.type, theme)}
                  opacity={active ? 1 : 0.92}
                  stroke={active ? ui.nodeStrokeActive : ui.nodeStroke}
                  strokeWidth={active ? 1.5 : 0.75}
                />
              </g>
            );
          })}
        </svg>
      )}

      {selectedNode && selectedSim ? (
        <div
          className={`pointer-events-auto absolute bottom-6 left-1/2 -translate-x-1/2 w-[min(92vw,440px)] rounded-2xl border shadow-xl backdrop-blur-sm ${ui.panel}`}
          data-testid="canvas-graph-insight-panel"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="px-4 pt-3.5 pb-3 border-b border-black/5 dark:border-white/10">
            <div className={`text-[10px] uppercase tracking-wider font-mono mb-1 ${ui.tipMuted}`}>
              {t(canvasNodeTypeLabelKey(selectedSim.type))}
              {selectedSim.degree > 0 ? ` · ${selectedSim.degree}` : ''}
              {neighborhood ? ` · ${Math.max(0, neighborhood.memberIds.length - 1)} ${t('canvas.graph_insight_neighbors')}` : ''}
            </div>
            <div className={`text-sm font-semibold leading-snug ${ui.tipTitle}`}>
              {selectedSim.label}
            </div>
            {structuralHint ? (
              <p className={`text-[11px] mt-1.5 leading-relaxed ${ui.tipMuted}`}>{structuralHint}</p>
            ) : null}
          </div>

          <div className="px-4 py-3 space-y-2.5">
            {!insightText && !insightLoading && !insightError ? (
              <p className={`text-[12px] leading-relaxed ${ui.tipMuted}`}>
                {t('canvas.graph_insight_blurb')}
              </p>
            ) : null}
            {insightLoading ? (
              <div className={`flex items-center gap-2 text-xs ${ui.tipMuted}`}>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#C2410C]" />
                {t('canvas.graph_insight_loading')}
              </div>
            ) : null}
            {insightError ? (
              <p className="text-xs text-red-600/90 leading-relaxed whitespace-pre-wrap">{insightError}</p>
            ) : null}
            {insightText ? (
              <div
                className={`text-[13px] leading-relaxed whitespace-pre-wrap max-h-[28vh] overflow-y-auto scrollbar-hide ${ui.tipTitle}`}
              >
                {insightText}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => void runInsight()}
                disabled={insightLoading}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors disabled:opacity-50 ${ui.primaryBtn}`}
                data-testid="canvas-graph-insight-run"
              >
                <Sparkles className="w-3.5 h-3.5" aria-hidden />
                {insightText ? t('canvas.graph_insight_rerun') : t('canvas.graph_insight_run')}
              </button>
              {insightText ? (
                <button
                  type="button"
                  onClick={() => void saveInsight()}
                  disabled={saving}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors disabled:opacity-50 ${ui.secondaryBtn}`}
                  data-testid="canvas-graph-insight-save"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  {t('canvas.graph_insight_save')}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => onFocusNode(selectedNode)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${ui.secondaryBtn}`}
              >
                {t('canvas.graph_click_hint')}
              </button>
            </div>
          </div>
        </div>
      ) : hoverNode ? (
        <div
          className={`pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 max-w-[min(90vw,420px)] px-4 py-3 rounded-2xl border backdrop-blur-sm ${ui.tip}`}
        >
          <div className={`text-[10px] uppercase tracking-wider font-mono mb-1 ${ui.tipMuted}`}>
            {t(canvasNodeTypeLabelKey(hoverNode.type))}
            {hoverNode.degree > 0 ? ` · ${hoverNode.degree}` : ''}
          </div>
          <div className={`text-sm font-medium leading-snug ${ui.tipTitle}`}>{hoverNode.label}</div>
          <div className={`text-[11px] mt-1.5 ${ui.tipMuted}`}>{t('canvas.graph_select_hint')}</div>
        </div>
      ) : (
        <div
          className={`pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 text-[11px] ${ui.hint}`}
        >
          {t('canvas.graph_hint')}
        </div>
      )}
    </div>
  );
}
