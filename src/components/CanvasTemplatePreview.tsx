/**
 * Draggable preview canvas for a CanvasTemplateDoc.
 *
 * Renders a 1200×800 design-box where each TemplateNode is a fixed-size
 * rectangle you can drag around. Position changes are reported back as
 * fractions (0..1) so the parent can store them on the template row.
 *
 * Edges render as straight SVG line segments through the centers of the
 * two endpoint rectangles — a clear preview without depending on the
 * live canvas edge system.
 */
import React, { useRef } from 'react';
import type { CanvasTemplateDoc, TemplateNode, TemplateNodeType } from '../db';
import { usePreviewDraggable } from '../hooks/usePreviewDraggable';

const DESIGN_WIDTH = 1200;
const DESIGN_HEIGHT = 800;

const NODE_BG: Record<TemplateNodeType, string> = {
  theme: 'bg-[#FAF9F6] border-2 border-[#C2410C]',
  note: 'bg-white border border-[#E6E4DF]',
  agent: 'bg-[#FFF7ED] border-2 border-[#C2410C]/60',
  ask: 'bg-white border-2 border-dashed border-[#8c8a84]',
};

const NODE_LABEL: Record<TemplateNodeType, string> = {
  theme: 'THEME',
  note: 'NOTE',
  agent: 'AGENT',
  ask: 'ASK',
};

function NodeVisual({ node, label }: { node: TemplateNode; label: string }) {
  return (
    <div
      className={`absolute rounded-lg shadow-sm p-2 text-[10px] font-mono font-bold text-[#1a1a1a] flex items-center justify-center pointer-events-none ${NODE_BG[node.type]}`}
      style={{
        width: 120,
        height: 60,
        // Centered on (xFrac, yFrac) — preview rendering offsets by -50%/-50%.
        transform: 'translate(-50%, -50%)',
      }}
    >
      <span className="truncate px-1">{label}</span>
    </div>
  );
}

interface DraggableNodeProps {
  node: TemplateNode;
  label: string;
  onChange: (key: string, next: { xFrac: number; yFrac: number }) => void;
}

function DraggableNode({ node, label, onChange }: DraggableNodeProps) {
  const { pos, bind } = usePreviewDraggable({
    initialXFrac: node.xFrac,
    initialYFrac: node.yFrac,
    onChange: (next) => onChange(node.key, next),
  });

  return (
    <div
      data-no-drag={undefined}
      {...bind}
      className={`absolute rounded-lg shadow-sm p-2 text-[10px] font-mono font-bold text-[#1a1a1a] flex items-center justify-center ${NODE_BG[node.type]}`}
      style={{
        width: 120,
        height: 60,
        left: `${pos.xFrac * 100}%`,
        top: `${pos.yFrac * 100}%`,
        transform: 'translate(-50%, -50%)',
        userSelect: 'none',
      }}
      data-testid={`template-preview-node-${node.key}`}
    >
      <span className="truncate px-1">{label}</span>
    </div>
  );
}

export interface CanvasTemplatePreviewProps {
  template: CanvasTemplateDoc;
  /** Called when a node is dragged to a new position; consumer stores new fractions. */
  onNodeMove: (key: string, next: { xFrac: number; yFrac: number }) => void;
}

export function CanvasTemplatePreview({
  template,
  onNodeMove,
}: CanvasTemplatePreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={containerRef}
      data-preview-container="true"
      className="relative w-full max-w-full bg-[#FAF9F6] border border-[#E6E4DF] rounded-xl overflow-hidden"
      style={{ aspectRatio: `${DESIGN_WIDTH} / ${DESIGN_HEIGHT}` }}
      data-testid="canvas-template-preview"
    >
      {/* Design-canvas label */}
      <div className="absolute top-2 left-2 text-[10px] font-mono uppercase tracking-wider text-[#8c8a84] pointer-events-none">
        {DESIGN_WIDTH} × {DESIGN_HEIGHT}
      </div>

      {/* SVG edges layer */}
      <svg
        className="absolute inset-0 pointer-events-none"
        viewBox={`0 0 ${DESIGN_WIDTH} ${DESIGN_HEIGHT}`}
        preserveAspectRatio="none"
      >
        {template.edges.map((edge, idx) => {
          const from = template.nodes.find((n) => n.key === edge.fromKey);
          const to = template.nodes.find((n) => n.key === edge.toKey);
          if (!from || !to) return null;
          const x1 = from.xFrac * DESIGN_WIDTH;
          const y1 = from.yFrac * DESIGN_HEIGHT;
          const x2 = to.xFrac * DESIGN_WIDTH;
          const y2 = to.yFrac * DESIGN_HEIGHT;
          return (
            <line
              key={`${edge.fromKey}-${edge.toKey}-${idx}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="#C2410C"
              strokeWidth={2}
              strokeOpacity={0.45}
            />
          );
        })}
      </svg>

      {/* Nodes */}
      {template.nodes.map((node) => {
        const fallbackLabel = NODE_LABEL[node.type];
        const display =
          node.contentText?.slice(0, 24) ||
          node.contentKey?.split('.').pop()?.slice(0, 24) ||
          (node.type === 'agent' && node.agentConfigId) ||
          fallbackLabel;
        return (
          <DraggableNode
            key={node.key}
            node={node}
            label={display}
            onChange={onNodeMove}
          />
        );
      })}

      {template.nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-[#8c8a84] pointer-events-none">
          Empty layout
        </div>
      )}
    </div>
  );
}
