import React, { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { MessagesSquare, X } from 'lucide-react';
import { db, type CanvasNode, type Edge as DbEdge } from '../../db';
import { preventDefaultIfFileDrag } from '../../utils/dnd';

/** Grace period before a link loses its hover state (see armEdgeHover below). */
const EDGE_HOVER_LEAVE_MS = 200;

interface CanvasEdgeLinesProps {
  edges: DbEdge[];
  /**
   * V2 房间：主角色 ↔ 在场角色，由讨论名单推导出来的纯状态标识。
   * 不是存下来的连线，没有点击行为 —— 只为在画布上看出「这几个人正在一起聊」。
   */
  roomLinks?: Array<{ id: string; from: string; to: string }>;
  connectingFrom: string | null;
  svgRef: RefObject<SVGSVGElement | null>;
  edgeLabelsRef: RefObject<HTMLDivElement | null>;
  deleteEdge: (id: string) => void;
  /** V2: hide stored links until the user turns on “show reference links”. */
  hideReferenceEdges?: boolean;
}

function EdgeNoteChip({
  edge,
  hovered,
  onHover,
  onEditingChange,
}: {
  edge: DbEdge;
  hovered: boolean;
  onHover: (id: string | null) => void;
  onEditingChange: (editing: boolean) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(edge.note ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  const chipRef = useRef<HTMLDivElement>(null);
  // Mirror state into refs via effect, not during render — assigning to
  // refs mid-render violates React's purity contract and trips StrictMode.
  const draftRef = useRef(draft);
  const editingRef = useRef(editing);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  useEffect(() => {
    if (!editing) setDraft(edge.note ?? '');
  }, [edge.note, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const persist = useCallback(() => {
    if (!editingRef.current) return;
    const trimmed = draftRef.current.replace(/\r\n/g, '\n').trim();
    const prev = (edge.note ?? '').trim();
    if (trimmed !== prev) {
      void db.edges.update(edge.id, { note: trimmed || undefined });
    }
    setEditing(false);
    onEditingChange(false);
  }, [edge.id, edge.note, onEditingChange]);

  const cancel = useCallback(() => {
    if (!editingRef.current) return;
    setDraft(edge.note ?? '');
    setEditing(false);
    onEditingChange(false);
  }, [edge.note, onEditingChange]);

  // Click blank canvas (or anywhere outside the chip) to finish editing.
  useEffect(() => {
    if (!editing) return;
    const onPointerDown = (e: PointerEvent) => {
      if (chipRef.current?.contains(e.target as Node)) return;
      persist();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [editing, persist]);

  const hasNote = Boolean((edge.note ?? '').trim());
  const showIdle = hasNote || hovered || editing;

  return (
    <div
      ref={chipRef}
      data-edge-note={edge.id}
      /* 不淡入淡出：半透明的合成层会让 Chromium 重画画布层里的卡片文字（见文件内注释）。
         隐藏时也必须吃点击：两张卡挨得近时中点会被卡片挡住（卡片自带 z-index），
         这个 chip 是连线唯一还能被悬停到的地方——关掉它的 pointer-events，
         中点点上去只会命中卡片，连线的控件再也亮不起来。 */
      className={`absolute max-w-[11rem] pointer-events-auto z-[9] ${
        showIdle ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ top: -100, left: -100, transform: 'translate(-50%, -50%)' }}
      onMouseEnter={() => onHover(edge.id)}
      onMouseLeave={() => onHover(null)}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {editing ? (
        <input
          ref={inputRef}
          data-testid={`edge-note-input-${edge.id}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              persist();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
            }
          }}
          className="w-[10rem] px-1.5 py-0.5 text-[11px] leading-tight font-sans text-[#1a1a1a] bg-white/95 border border-[#C2410C]/50 rounded-sm shadow-sm outline-none focus:ring-1 focus:ring-[#C2410C]/35"
          placeholder={t('canvas.edge_note_placeholder')}
          aria-label={t('canvas.edge_note_aria')}
        />
      ) : (
        <button
          type="button"
          data-testid={`edge-note-chip-${edge.id}`}
          className={`block max-w-[11rem] px-0 py-0 text-[11px] leading-tight font-sans truncate bg-transparent border-none shadow-none transition-colors ${
            hasNote
              ? 'text-[#8c8a84] hover:text-[#C2410C]'
              : 'text-[#a8a6a0] hover:text-[#C2410C]'
          }`}
          title={hasNote ? edge.note : t('canvas.edge_note_add')}
          aria-label={t('canvas.edge_note_aria')}
          onClick={(e) => {
            e.stopPropagation();
            setDraft(edge.note ?? '');
            setEditing(true);
            onEditingChange(true);
          }}
        >
          {hasNote ? edge.note : t('canvas.edge_note_add')}
        </button>
      )}
    </div>
  );
}

export function CanvasEdgeLines({
  edges,
  roomLinks,
  connectingFrom,
  svgRef,
  edgeLabelsRef,
  deleteEdge,
  hideReferenceEdges = false,
}: CanvasEdgeLinesProps) {
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
  // Hover lives here, not in App: it only drives this component's chrome, and
  // lifting it up made every edge enter/leave re-render every card on the
  // canvas (~52-58ms of blocked main thread per transition, i.e. visible jank).
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);

  // Leaving is delayed so the chrome cannot flap. The link's hit band is ~20
  // world px and its note chip / × button sit on the midpoint, so aiming at
  // them keeps crossing in and out of that band: without hysteresis the chrome
  // toggles several times a second (measured 34 flips / 6s while hovering a
  // link between two cards that nearly touch), and every toggle re-rasterizes
  // the scaled canvas layer — which is what made nearby card text flicker.
  const hoverEndTimerRef = useRef<number | null>(null);
  const armEdgeHover = useCallback((id: string) => {
    if (hoverEndTimerRef.current != null) {
      window.clearTimeout(hoverEndTimerRef.current);
      hoverEndTimerRef.current = null;
    }
    setHoveredEdgeId(id);
  }, []);
  const releaseEdgeHover = useCallback(() => {
    if (hoverEndTimerRef.current != null) window.clearTimeout(hoverEndTimerRef.current);
    hoverEndTimerRef.current = window.setTimeout(() => {
      hoverEndTimerRef.current = null;
      setHoveredEdgeId(null);
    }, EDGE_HOVER_LEAVE_MS);
  }, []);
  useEffect(
    () => () => {
      if (hoverEndTimerRef.current != null) window.clearTimeout(hoverEndTimerRef.current);
    },
    [],
  );

  const { t } = useTranslation();

  const visibleEdges = hideReferenceEdges ? [] : edges;

  return (
    <>
      <svg ref={svgRef} data-connecting-from={connectingFrom || ''} className="absolute inset-0 overflow-visible z-10 w-[1px] h-[1px] pointer-events-none">
        {visibleEdges.map((edge) => (
          <g
            key={edge.id}
            data-edge-id={edge.id}
            data-edge-from={edge.from}
            data-edge-to={edge.to}
            className="group cursor-pointer pointer-events-auto"
            onDragEnter={(e) => preventDefaultIfFileDrag(e)}
            onDragOver={(e) => preventDefaultIfFileDrag(e)}
            onMouseEnter={() => armEdgeHover(edge.id)}
            onMouseLeave={releaseEdgeHover}
          >
            <line
              className="node-connector transition-colors group-hover:stroke-[#C2410C]"
              style={{ strokeWidth: 2, stroke: '#d1cfca', pointerEvents: 'none' }}
            />
            <line
              className="hit-area"
              style={{ strokeWidth: 20, stroke: 'transparent', pointerEvents: 'auto' }}
            />
          </g>
        ))}
        {/* 房间状态线：只画，不可点。由讨论名单推导，不写进 edges。 */}
        {(roomLinks ?? []).map((link) => (
          <g
            key={link.id}
            data-room-link={link.id}
            data-edge-id={link.id}
            data-edge-from={link.from}
            data-edge-to={link.to}
            data-edge-flowing="1"
            className="pointer-events-none"
          >
            <line className="node-connector" style={{ pointerEvents: 'none' }} />
          </g>
        ))}
        <line id="temp-edge" className="node-connector pointer-events-none" style={{ strokeWidth: 2, stroke: '#C2410C', strokeDasharray: '5,5', display: connectingFrom ? 'block' : 'none' }} />
      </svg>

      {/* z-40：连线控件要盖在卡片之上。卡片各自带 z-index（11–40 都有），原先这里
          是 z-20，于是窄缝里的 × 和备注会被相邻卡片压住——鼠标只能扫到一条 1px 的缝，
          悬停不停地断掉又接上，控件跟着闪，附近卡片的文字也被反复重画。 */}
      <div ref={edgeLabelsRef} className="absolute inset-0 pointer-events-none z-40 w-[1px] h-[1px]">
        {/* 房间状态线中点的小标识：只表示"这几个人正在一起讨论"，不可点。
            位置由 useCanvasInteraction 的动画循环统一摆（和备注/删除按钮同一套）。 */}
        {(roomLinks ?? []).map((link) => (
          <div
            key={`badge-${link.id}`}
            data-room-link-badge={link.id}
            data-testid={`room-link-discuss-${link.id}`}
            role="img"
            aria-label={t('canvas.v2.room_discussing')}
            className="pointer-events-none absolute flex h-5 w-5 items-center justify-center rounded-full bg-[#C2410C] text-white ring-2 ring-white"
            style={{ top: -100, left: -100, transform: 'translate(-50%, -50%)' }}
          >
            <MessagesSquare className="h-3 w-3" aria-hidden />
          </div>
        ))}
        {visibleEdges.map((edge) => {
          const showDelete = hoveredEdgeId === edge.id && editingEdgeId === null;
          return (
            <React.Fragment key={`labels-${edge.id}`}>
              <EdgeNoteChip
                edge={edge}
                hovered={hoveredEdgeId === edge.id}
                onHover={(id) => (id ? armEdgeHover(id) : releaseEdgeHover())}
                onEditingChange={(editing) => {
                  setEditingEdgeId((prev) => {
                    if (editing) return edge.id;
                    return prev === edge.id ? null : prev;
                  });
                }}
              />
              {/* 连线控件只做颜色过渡，不做 `scale-*` 缩放、也不淡入淡出。
                  画布是一整层带缩放的 transform，里面任何合成层面的变化
                  （缩放动画、半透明淡入）都可能让 Chromium 重新光栅化该层，
                  把附近卡片的字形重画一遍——表现为悬停连线时卡片文字闪烁。
                  颜色过渡是纯 paint，不创建合成层，所以留着。 */}
              <button
                data-edge-btn={edge.id}
                className={`absolute transform -translate-x-1/2 -translate-y-1/2 w-5 h-5 bg-white border border-[#C2410C] text-[#C2410C] hover:bg-[#C2410C] hover:text-white shadow-sm rounded-full flex items-center justify-center transition-colors z-10 ${
                  showDelete ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
                }`}
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); deleteEdge(edge.id); }}
                onMouseEnter={() => armEdgeHover(edge.id)}
                onMouseLeave={releaseEdgeHover}
                style={{ top: -100, left: -100 }}
                title={t('canvas.edge_note_remove')}
                aria-label={t('canvas.edge_note_remove')}
              >
                <X className="w-3 h-3" />
              </button>
            </React.Fragment>
          );
        })}
      </div>
    </>
  );
}
