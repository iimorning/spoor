/** Stroke-order helpers for publish: brush over cards to set reading order. */

/** Screen-space hit test: first candidate whose element contains the point. */
export function hitTestPublishCandidate(
  clientX: number,
  clientY: number,
  candidateIds: readonly string[],
  nodesRef: Record<string, HTMLElement | null | undefined>,
  alreadyOrdered: ReadonlySet<string>,
): string | null {
  for (const id of candidateIds) {
    if (alreadyOrdered.has(id)) continue;
    const el = nodesRef[id];
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
      return id;
    }
  }
  return null;
}

/** Append id once; returns same array reference if unchanged. */
export function appendPublishOrderId(order: readonly string[], id: string): string[] {
  if (!id || order.includes(id)) return order as string[];
  return [...order, id];
}

/**
 * Ordered cards first; any candidates not brushed are appended in candidate
 * (selection) order so confirm never drops cards.
 */
export function finalizePublishOrder(
  orderedIds: readonly string[],
  candidateIds: readonly string[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of orderedIds) {
    if (!id || seen.has(id)) continue;
    if (!candidateIds.includes(id)) continue;
    seen.add(id);
    out.push(id);
  }
  for (const id of candidateIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
