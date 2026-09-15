/** Stamp `createdAt` on a card being inserted for the first time. */
export function stampNewCard<T extends object>(node: T, at = Date.now()): T & { createdAt: number } {
  return { ...node, createdAt: at };
}

export function stampNewCards<T extends object>(
  nodes: T[],
  at = Date.now(),
): Array<T & { createdAt: number }> {
  return nodes.map((node) => stampNewCard(node, at));
}
