import React, { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { MessagesSquare, X } from 'lucide-react';
import { db, type CanvasNode, type Edge as DbEdge } from '../../db';
import { preventDefaultIfFileDrag } from '../../utils/dnd';
import { isDiscussionLinkEdge } from '../../utils/agentDiscussion';

interface CanvasEdgeLinesProps {
  edges: DbEdge[];
  /** All nodes on the current canvas — used to detect discussion-style edges. */
  nodes: CanvasNode[];
  /** True when the agent hub has a peer (persona or 阿狸) plus a context note. */
  canStartAgentDiscussion?: (agentNodeId: string) => boolean;
  /** Triggered when the user clicks the edge-mounted discuss button. */
  onStartAgentDiscussion?: (agentNodeId: string) => void;
  connectingFrom: string | null;
  svgRef: RefObject<SVGSVGElement | null>;
  edgeLabelsRef: RefObject<HTMLDivElement | null>;
  hoveredEdgeId: string | null;
  setHoveredEdgeId: (id: string | null) => void;
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
      className={`absolute max-w-[11rem] pointer-events-auto z-[9] transition-opacity ${
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
  nodes,
  canStartAgentDiscussion,
  onStartAgentDiscussion,
  connectingFrom,
  svgRef,
  edgeLabelsRef,
  hoveredEdgeId,
  setHoveredEdgeId,
  deleteEdge,
  hideReferenceEdges = false,
}: CanvasEdgeLinesProps) {
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);

  const { t } = useTranslation();

  // Agent↔agent and 阿狸↔agent edges get the flowing stroke + a midpoint discuss cluster.
  const nodeTypeById = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of nodes) m.set(n.id, n.type);
    return m;
  }, [nodes]);

  type EdgeViewModel = {
    edge: DbEdge;
    isDiscussionEdge: boolean;
    discussHubId: string | null;
  };
  const edgeViewModels: EdgeViewModel[] = useMemo(() => {
    return edges.map((edge) => {
      const fromType = nodeTypeById.get(edge.from);
      const toType = nodeTypeById.get(edge.to);
      const isDiscussionEdge = isDiscussionLinkEdge(fromType, toType);
      let discussHubId: string | null = null;
      if (isDiscussionEdge && onStartAgentDiscussion) {
        if (fromType === 'agent' && canStartAgentDiscussion?.(edge.from)) {
          discussHubId = edge.from;
        } else if (toType === 'agent' && canStartAgentDiscussion?.(edge.to)) {
          discussHubId = edge.to;
        } else if (fromType === 'agent') {
          discussHubId = edge.from;
        } else if (toType === 'agent') {
          discussHubId = edge.to;
        }
      }
      return { edge, isDiscussionEdge, discussHubId };
    });
  }, [edges, nodeTypeById, onStartAgentDiscussion, canStartAgentDiscussion]);

  const visibleEdges = hideReferenceEdges ? [] : edgeViewModels;

  return (
    <>
      <svg ref={svgRef} data-connecting-from={connectingFrom || ''} className="absolute inset-0 overflow-visible z-10 w-[1px] h-[1px] pointer-events-none">
        {visibleEdges.map(({ edge, isDiscussionEdge }) => (
          <g
            key={edge.id}
            data-edge-id={edge.id}
            data-edge-from={edge.from}
            data-edge-to={edge.to}
            data-edge-flowing={isDiscussionEdge ? '1' : undefined}
            className="group cursor-pointer pointer-events-auto"
            onDragEnter={(e) => preventDefaultIfFileDrag(e)}
            onDragOver={(e) => preventDefaultIfFileDrag(e)}
            onMouseEnter={() => setHoveredEdgeId(edge.id)}
            onMouseLeave={() => setHoveredEdgeId(null)}
          >
            <line
              className={`node-connector ${isDiscussionEdge ? '' : 'transition-colors group-hover:stroke-[#C2410C]'}`}
              style={
                isDiscussionEdge
                  ? { pointerEvents: 'none' }
                  : { strokeWidth: 2, stroke: '#d1cfca', pointerEvents: 'none' }
              }
            />
            <line
              className="hit-area"
              style={{ strokeWidth: 20, stroke: 'transparent', pointerEvents: 'auto' }}
            />
          </g>
        ))}
        <line id="temp-edge" className="node-connector pointer-events-none" style={{ strokeWidth: 2, stroke: '#C2410C', strokeDasharray: '5,5', display: connectingFrom ? 'block' : 'none' }} />
      </svg>

      <div ref={edgeLabelsRef} className="absolute inset-0 pointer-events-none z-20 w-[1px] h-[1px]">
        {visibleEdges.map(({ edge, isDiscussionEdge, discussHubId }) => {
          const showDelete =
            !isDiscussionEdge && hoveredEdgeId === edge.id && editingEdgeId === null;
          return (
            <React.Fragment key={`labels-${edge.id}`}>
              <EdgeNoteChip
                edge={edge}
                hovered={hoveredEdgeId === edge.id}
                onHover={setHoveredEdgeId}
                onEditingChange={(editing) => {
                  setEditingEdgeId((prev) => {
                    if (editing) return edge.id;
                    return prev === edge.id ? null : prev;
                  });
                }}
              />
              <button
                data-edge-btn={edge.id}
                className={`absolute transform -translate-x-1/2 -translate-y-1/2 w-5 h-5 bg-white border border-[#C2410C] text-[#C2410C] hover:bg-[#C2410C] hover:text-white shadow-sm rounded-full flex items-center justify-center transition-all z-10 ${
                  showDelete ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-50 pointer-events-none'
                }`}
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); deleteEdge(edge.id); }}
                onMouseEnter={() => setHoveredEdgeId(edge.id)}
                onMouseLeave={() => setHoveredEdgeId(null)}
                style={{ top: -100, left: -100 }}
              >
                <X className="w-3 h-3" />
              </button>
              {isDiscussionEdge && discussHubId && onStartAgentDiscussion && (
                <div
                  data-edge-discuss-cluster={edge.id}
                  className="absolute z-10 pointer-events-auto -translate-x-3 -translate-y-3 flex items-center gap-1.5 group"
                  style={{ top: -100, left: -100 }}
                  onMouseEnter={() => setHoveredEdgeId(edge.id)}
                  onMouseLeave={() => setHoveredEdgeId(null)}
                >
                  <button
                    type="button"
                    data-edge-discuss={edge.id}
                    className="w-6 h-6 shrink-0 bg-[#C2410C] text-white shadow-md rounded-full flex items-center justify-center hover:bg-[#9a3412]"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onStartAgentDiscussion(discussHubId);
                    }}
                    title={t('nodes.agent_start_discussion')}
                    aria-label={t('nodes.agent_start_discussion')}
                  >
                    <MessagesSquare className="w-3.5 h-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    data-testid={`edge-discuss-close-${edge.id}`}
                    className="w-5 h-5 shrink-0 bg-white border border-[#C2410C] text-[#C2410C] hover:bg-[#C2410C] hover:text-white rounded-full flex items-center justify-center shadow-sm opacity-0 scale-90 pointer-events-none transition-all group-hover:opacity-100 group-hover:scale-100 group-hover:pointer-events-auto"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      deleteEdge(edge.id);
                    }}
                    title={t('nodes.agent_discussion_disconnect')}
                    aria-label={t('nodes.agent_discussion_disconnect')}
                  >
                    <X className="w-3 h-3" aria-hidden />
                  </button>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </>
  );
}
