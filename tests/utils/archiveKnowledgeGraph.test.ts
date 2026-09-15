import { describe, expect, it } from 'vitest';
import type { ArchivedCard } from '../../src/db';
import {
  archivedCardToGraphNode,
  buildArchiveKnowledgeEdges,
  expandInsightWithFolderMates,
} from '../../src/utils/archiveKnowledgeGraph';

function archived(
  id: string,
  nodeId: string,
  opts?: { folderId?: string; archivedAt?: number; content?: string },
): ArchivedCard {
  return {
    id,
    archivedAt: opts?.archivedAt ?? 1,
    node: { id: nodeId, type: 'note', content: opts?.content ?? 'body', x: 0, y: 0 },
    ...(opts?.folderId ? { folderId: opts.folderId } : {}),
  };
}

describe('archiveKnowledgeGraph', () => {
  it('uses the archive id as the graph node id and readable body as content', () => {
    const node = archivedCardToGraphNode(
      archived('arch-1', 'n1', { content: 'Non-euclidean memory leaks' }),
    );
    expect(node.id).toBe('arch-1');
    expect(node.content).toContain('memory leaks');
  });

  it('reconstructs edges from canvas links between archived source nodes', () => {
    const rows = [archived('a', 'n1'), archived('b', 'n2'), archived('c', 'n3')];
    const edges = buildArchiveKnowledgeEdges(rows, [
      { id: 'e1', from: 'n1', to: 'n2', note: 'why' },
      { id: 'e2', from: 'n2', to: 'n9' },
    ]);
    expect(edges).toHaveLength(1);
    expect(undirected(edges[0]!.from, edges[0]!.to)).toEqual(['a', 'b']);
    expect(edges[0]!.note).toBe('why');
  });

  it('chains cards in the same folder by archive time', () => {
    const rows = [
      archived('late', 'n2', { folderId: 'f1', archivedAt: 20 }),
      archived('early', 'n1', { folderId: 'f1', archivedAt: 10 }),
      archived('other', 'n3', { folderId: 'f2', archivedAt: 10 }),
    ];
    const edges = buildArchiveKnowledgeEdges(rows, []);
    expect(edges).toHaveLength(1);
    expect(undirected(edges[0]!.from, edges[0]!.to)).toEqual(['early', 'late']);
    expect(edges[0]!.note).toBe('same archive folder');
  });

  it('expandInsightWithFolderMates adds same-folder cards missing from the graph hop', () => {
    const rows = [
      archived('hub', 'n1', { folderId: 'f1' }),
      archived('mate', 'n2', { folderId: 'f1' }),
      archived('outside', 'n3', { folderId: 'f2' }),
    ];
    const expanded = expandInsightWithFolderMates('hub', ['hub'], rows, 12);
    expect(expanded).toEqual(['hub', 'mate']);
  });
});

function undirected(a: string, b: string): string[] {
  return [a, b].sort();
}
