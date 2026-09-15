/** Lightweight 2D force layout for the archive knowledge graph (no d3).
 *
 * Used by `CanvasGraphView.tsx` via ArchiveLibrary — not the live canvas.
 */

export type ForceGraphNode = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  degree: number;
  type: string;
  label: string;
};

export type ForceGraphEdge = {
  id: string;
  from: string;
  to: string;
};

export type ForceGraphInputNode = {
  id: string;
  type: string;
  label: string;
  /** Optional seed from canvas card position so the first frame feels familiar. */
  seedX?: number;
  seedY?: number;
};

const REPULSION = 2800;
const SPRING = 0.028;
const SPRING_LENGTH = 88;
const CENTER = 0.012;
const DAMPING = 0.86;
const MAX_SPEED = 14;

export function buildForceGraph(
  inputNodes: ForceGraphInputNode[],
  edges: { id: string; from: string; to: string }[],
): { nodes: ForceGraphNode[]; edges: ForceGraphEdge[] } {
  const idSet = new Set(inputNodes.map((n) => n.id));
  const degree = new Map<string, number>();
  for (const n of inputNodes) degree.set(n.id, 0);

  const linkEdges: ForceGraphEdge[] = [];
  for (const e of edges) {
    if (!idSet.has(e.from) || !idSet.has(e.to) || e.from === e.to) continue;
    linkEdges.push({ id: e.id, from: e.from, to: e.to });
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }

  const nodes: ForceGraphNode[] = inputNodes.map((n, i) => {
    const angle = (i / Math.max(inputNodes.length, 1)) * Math.PI * 2;
    const radius = 40 + (i % 7) * 12;
    const sx = n.seedX;
    const sy = n.seedY;
    const hasSeed = typeof sx === 'number' && typeof sy === 'number' && Number.isFinite(sx) && Number.isFinite(sy);
    return {
      id: n.id,
      type: n.type,
      label: n.label,
      degree: degree.get(n.id) ?? 0,
      x: hasSeed ? sx * 0.08 : Math.cos(angle) * radius,
      y: hasSeed ? sy * 0.08 : Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
    };
  });

  return { nodes, edges: linkEdges };
}

/** One simulation tick. Mutates `nodes` in place. */
export function stepForceGraph(nodes: ForceGraphNode[], edges: ForceGraphEdge[]): void {
  const n = nodes.length;
  if (n === 0) return;

  for (let i = 0; i < n; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < n; j++) {
      const b = nodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let distSq = dx * dx + dy * dy;
      if (distSq < 0.01) {
        dx = (Math.random() - 0.5) * 0.5;
        dy = (Math.random() - 0.5) * 0.5;
        distSq = dx * dx + dy * dy;
      }
      const dist = Math.sqrt(distSq);
      const force = REPULSION / distSq;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx -= fx;
      a.vy -= fy;
      b.vx += fx;
      b.vy += fy;
    }
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const e of edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
    const stretch = dist - SPRING_LENGTH;
    const force = stretch * SPRING;
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    a.vx += fx;
    a.vy += fy;
    b.vx -= fx;
    b.vy -= fy;
  }

  let cx = 0;
  let cy = 0;
  for (const node of nodes) {
    cx += node.x;
    cy += node.y;
  }
  cx /= n;
  cy /= n;

  for (const node of nodes) {
    node.vx += (0 - (node.x - cx)) * CENTER;
    node.vy += (0 - (node.y - cy)) * CENTER;
    node.vx *= DAMPING;
    node.vy *= DAMPING;
    const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
    if (speed > MAX_SPEED) {
      node.vx = (node.vx / speed) * MAX_SPEED;
      node.vy = (node.vy / speed) * MAX_SPEED;
    }
    node.x += node.vx;
    node.y += node.vy;
  }
}

export function graphNodeRadius(degree: number): number {
  return Math.min(18, 4.5 + Math.sqrt(Math.max(degree, 0)) * 3.2);
}
