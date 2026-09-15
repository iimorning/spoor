import { describe, it, expect } from 'vitest';
import { DEFAULT_NODE_IDS } from '../../src/constants/defaultWorkspace';
import { encodeEssayContent } from '../../src/utils/essayPayload';
import type { ArchivedCard, Article, Canvas, CanvasNode, Edge } from '../../src/db';
import {
  IMPORT_CARD_GAP,
  mergeLocalOntoCloud,
  offsetImportedCardGroup,
  type WorkspaceSnapshot,
} from '../../src/utils/mergeCloudWorkspace';

function emptySnapshot(overrides: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return {
    canvases: [],
    nodes: [],
    edges: [],
    articles: [],
    agents: [],
    sandboxThreads: [],
    archivedCards: [],
    archiveFolders: [],
    canvasFolders: [],
    workZones: [],
    personaThreads: [],
    ...overrides,
  };
}

function canvas(id: string, name = id): Canvas {
  return { id, name, createdAt: 1, updatedAt: 1 };
}

function node(id: string, canvasId: string, overrides: Partial<CanvasNode> = {}): CanvasNode {
  return { id, canvasId, type: 'text', content: id, x: 0, y: 0, ...overrides };
}

function edge(id: string, from: string, to: string, canvasId = 'default'): Edge {
  return { id, from, to, canvasId };
}

function article(id: string, title = id): Article {
  return { id, title, content: '', date: '2024-01-01', type: 'REF' };
}

function archived(id: string, n: CanvasNode, sourceCanvasId = n.canvasId): ArchivedCard {
  return { id, archivedAt: 1, sourceCanvasId, node: n };
}

describe('mergeLocalOntoCloud', () => {
  it('keeps disjoint local and cloud canvases and cards', () => {
    const merged = mergeLocalOntoCloud(
      emptySnapshot({
        canvases: [canvas('cloud-c')],
        nodes: [node('cloud-n', 'cloud-c')],
      }),
      emptySnapshot({
        canvases: [canvas('local-c')],
        nodes: [node('local-n', 'local-c')],
      }),
    );
    expect(merged.canvases.map((c) => c.id).sort()).toEqual(['cloud-c', 'local-c']);
    expect(merged.nodes.map((n) => n.id).sort()).toEqual(['cloud-n', 'local-n']);
  });

  it('does not drop cloud default starters when local is still the official layout', () => {
    const cloudNote = node(DEFAULT_NODE_IDS.note, 'default', {
      type: 'note',
      content: 'from cloud',
      x: 80,
      y: 360,
    });
    const localNote = node(DEFAULT_NODE_IDS.note, 'default', {
      type: 'note',
      content: 'from cloud',
      x: 80,
      y: 360,
    });
    const merged = mergeLocalOntoCloud(
      emptySnapshot({
        canvases: [canvas('default', 'Main')],
        nodes: [cloudNote],
      }),
      emptySnapshot({
        canvases: [canvas('default', '本机')],
        nodes: [localNote],
      }),
    );
    expect(merged.canvases).toHaveLength(1);
    expect(merged.canvases[0]?.name).toBe('Main');
    expect(merged.nodes).toHaveLength(1);
    expect(merged.nodes[0]?.content).toBe('from cloud');
  });

  it('adds local-only cards onto the shared default canvas', () => {
    const merged = mergeLocalOntoCloud(
      emptySnapshot({
        canvases: [canvas('default')],
        nodes: [node('cloud-n', 'default', { x: 0, width: 100 })],
      }),
      emptySnapshot({
        canvases: [canvas('default')],
        nodes: [
          node('cloud-n', 'default', { x: 0, width: 100 }),
          node('local-extra', 'default', { x: 0, width: 80, content: 'mine' }),
        ],
      }),
    );
    const extra = merged.nodes.find((n) => n.id === 'local-extra');
    expect(extra?.content).toBe('mine');
    expect(extra?.canvasId).toBe('default');
    expect(extra?.x).toBe(100 + IMPORT_CARD_GAP);
  });

  it('remaps an edited official starter so both copies survive', () => {
    const merged = mergeLocalOntoCloud(
      emptySnapshot({
        canvases: [canvas('default')],
        nodes: [node(DEFAULT_NODE_IDS.note, 'default', { type: 'note', content: 'cloud text' })],
      }),
      emptySnapshot({
        canvases: [canvas('default')],
        nodes: [node(DEFAULT_NODE_IDS.note, 'default', { type: 'note', content: 'local edit' })],
      }),
      { newId: () => 'remapped-note' },
    );
    expect(merged.nodes.map((n) => n.content).sort()).toEqual(['cloud text', 'local edit']);
    expect(merged.nodes.find((n) => n.content === 'local edit')?.id).toBe('remapped-note');
    expect(merged.nodes.find((n) => n.content === 'cloud text')?.id).toBe(DEFAULT_NODE_IDS.note);
  });

  it('keeps both copies when a shared user card has different text', () => {
    const merged = mergeLocalOntoCloud(
      emptySnapshot({
        nodes: [node('user-1', 'default', { content: 'stale' })],
        agents: [{ id: 'cloud-agent', name: 'Cloud', role: 'r', prompt: 'p' }],
      }),
      emptySnapshot({
        nodes: [node('user-1', 'default', { content: 'fresh' })],
        agents: [{ id: 'local-agent', name: 'Local', role: 'r', prompt: 'p' }],
      }),
      { newId: () => 'user-1-local' },
    );
    expect(merged.nodes.find((n) => n.id === 'user-1')?.content).toBe('stale');
    expect(merged.nodes.find((n) => n.id === 'user-1-local')?.content).toBe('fresh');
    expect(merged.agents.map((a) => a.id).sort()).toEqual(['cloud-agent', 'local-agent']);
  });

  it('overlays local flags when a shared user card has the same text', () => {
    const merged = mergeLocalOntoCloud(
      emptySnapshot({
        nodes: [node('user-1', 'default', { content: 'same', askThreadCollapsed: false })],
      }),
      emptySnapshot({
        nodes: [node('user-1', 'default', { content: 'same', askThreadCollapsed: true })],
      }),
    );
    expect(merged.nodes).toHaveLength(1);
    expect(merged.nodes[0]?.askThreadCollapsed).toBe(true);
  });

  describe('edges', () => {
    it('rewrites from/to when the local starter endpoint is remapped', () => {
      const starter = DEFAULT_NODE_IDS.note;
      const merged = mergeLocalOntoCloud(
        emptySnapshot({
          canvases: [canvas('default')],
          nodes: [node(starter, 'default', { type: 'note', content: 'cloud text' })],
          edges: [edge('e-cloud', starter, 'cloud-other')],
        }),
        emptySnapshot({
          canvases: [canvas('default')],
          nodes: [
            node(starter, 'default', { type: 'note', content: 'local edit' }),
            node('local-extra', 'default', { content: 'leaf' }),
          ],
          edges: [edge('e-local', starter, 'local-extra')],
        }),
        { newId: () => 'remapped-note' },
      );
      const localEdge = merged.edges.find((e) => e.id === 'e-local');
      expect(localEdge).toEqual(
        expect.objectContaining({ from: 'remapped-note', to: 'local-extra' }),
      );
      expect(merged.edges.find((e) => e.id === 'e-cloud')?.from).toBe(starter);
    });

    it('mints a new edge id when the id collides but endpoints changed after remap', () => {
      const starter = DEFAULT_NODE_IDS.ask;
      let n = 0;
      const merged = mergeLocalOntoCloud(
        emptySnapshot({
          canvases: [canvas('default')],
          nodes: [
            node(starter, 'default', { type: 'ask', content: 'cloud ask' }),
            node('cloud-leaf', 'default'),
          ],
          edges: [edge('e1', starter, 'cloud-leaf')],
        }),
        emptySnapshot({
          canvases: [canvas('default')],
          nodes: [
            node(starter, 'default', { type: 'ask', content: 'local ask' }),
            node('local-leaf', 'default'),
          ],
          edges: [edge('e1', starter, 'local-leaf')],
        }),
        { newId: () => `gen-${++n}` },
      );
      expect(merged.edges.some((e) => e.id === 'e1' && e.to === 'cloud-leaf')).toBe(true);
      expect(merged.edges).toContainEqual(
        expect.objectContaining({ id: 'gen-2', from: 'gen-1', to: 'local-leaf' }),
      );
    });

    it('skips a local edge whose id and unmapped endpoints already exist on the cloud', () => {
      const merged = mergeLocalOntoCloud(
        emptySnapshot({
          nodes: [node('a', 'default'), node('b', 'default')],
          edges: [edge('e1', 'a', 'b')],
        }),
        emptySnapshot({
          nodes: [node('a', 'default'), node('b', 'default')],
          edges: [edge('e1', 'a', 'b')],
        }),
      );
      expect(merged.edges).toEqual([edge('e1', 'a', 'b')]);
    });
  });

  describe('archived cards', () => {
    it('remaps the snapshot node id when the live starter was remapped', () => {
      const starter = DEFAULT_NODE_IDS.theme;
      const merged = mergeLocalOntoCloud(
        emptySnapshot({
          canvases: [canvas('default')],
          nodes: [node(starter, 'default', { type: 'theme', content: 'cloud theme' })],
          archivedCards: [
            archived('arc-cloud', node(starter, 'default', { type: 'theme', content: 'cloud theme' })),
          ],
        }),
        emptySnapshot({
          canvases: [canvas('default')],
          nodes: [node(starter, 'default', { type: 'theme', content: 'local theme' })],
          archivedCards: [
            archived('arc-local', node(starter, 'default', { type: 'theme', content: 'local theme' })),
          ],
        }),
        { newId: () => 'remapped-theme' },
      );
      const localArc = merged.archivedCards.find((r) => r.id === 'arc-local');
      expect(localArc?.node.id).toBe('remapped-theme');
      expect(localArc?.node.content).toBe('local theme');
      expect(merged.archivedCards.find((r) => r.id === 'arc-cloud')?.node.id).toBe(starter);
    });

    it('keeps a cloud archived card when the id already exists locally', () => {
      const merged = mergeLocalOntoCloud(
        emptySnapshot({
          archivedCards: [archived('arc1', node('n1', 'default', { content: 'cloud' }))],
        }),
        emptySnapshot({
          archivedCards: [archived('arc1', node('n1', 'default', { content: 'local' }))],
        }),
      );
      expect(merged.archivedCards).toHaveLength(1);
      expect(merged.archivedCards[0]?.node.content).toBe('cloud');
    });
  });

  describe('articles, agents, sandbox threads', () => {
    it('keeps both articles when the shared id has different text', () => {
      const merged = mergeLocalOntoCloud(
        emptySnapshot({
          articles: [article('shared', 'cloud title'), article('cloud-only')],
        }),
        emptySnapshot({
          articles: [article('shared', 'local title'), article('local-only')],
        }),
        { newId: () => 'shared-local' },
      );
      expect(merged.articles.map((a) => a.id).sort()).toEqual([
        'cloud-only',
        'local-only',
        'shared',
        'shared-local',
      ]);
      expect(merged.articles.find((a) => a.id === 'shared')?.title).toBe('cloud title');
      expect(merged.articles.find((a) => a.id === 'shared-local')?.title).toBe('local title');
    });

    it('unions agents by id and keeps the cloud row on conflict', () => {
      const merged = mergeLocalOntoCloud(
        emptySnapshot({
          agents: [
            { id: 'shared', name: 'Cloud', role: 'r', prompt: 'cloud' },
            { id: 'cloud-only', name: 'C', role: 'r', prompt: 'p' },
          ],
        }),
        emptySnapshot({
          agents: [
            { id: 'shared', name: 'Local', role: 'r', prompt: 'local' },
            { id: 'local-only', name: 'L', role: 'r', prompt: 'p' },
          ],
        }),
      );
      expect(merged.agents.map((a) => a.id).sort()).toEqual(['cloud-only', 'local-only', 'shared']);
      expect(merged.agents.find((a) => a.id === 'shared')?.prompt).toBe('cloud');
    });

    it('unions sandbox threads by agentId; cloud conversation wins on conflict', () => {
      const merged = mergeLocalOntoCloud(
        emptySnapshot({
          sandboxThreads: [
            { agentId: 'shared', messages: [{ role: 'user', text: 'cloud' }], updatedAt: 2 },
            { agentId: 'cloud-bot', messages: [], updatedAt: 1 },
          ],
        }),
        emptySnapshot({
          sandboxThreads: [
            { agentId: 'shared', messages: [{ role: 'user', text: 'local' }], updatedAt: 9 },
            { agentId: 'local-bot', messages: [{ role: 'model', text: 'hi' }], updatedAt: 3 },
          ],
        }),
      );
      expect(merged.sandboxThreads.map((t) => t.agentId).sort()).toEqual([
        'cloud-bot',
        'local-bot',
        'shared',
      ]);
      expect(merged.sandboxThreads.find((t) => t.agentId === 'shared')?.messages).toEqual([
        { role: 'user', text: 'cloud' },
      ]);
      expect(merged.sandboxThreads.find((t) => t.agentId === 'local-bot')?.messages).toEqual([
        { role: 'model', text: 'hi' },
      ]);
    });
  });

  it('keeps cloud-only node fields when overlaying matching text', () => {
    const merged = mergeLocalOntoCloud(
      emptySnapshot({
        nodes: [node('n1', 'default', { content: 'same', themeTag: 'cloud-tag', templateKey: 'tpl' })],
      }),
      emptySnapshot({ nodes: [node('n1', 'default', { content: 'same', x: 9 })] }),
    );
    expect(merged.nodes[0]).toMatchObject({ themeTag: 'cloud-tag', templateKey: 'tpl', x: 9 });
  });

  it('keeps cloud article tags and overlays local linkedCanvasIds when the body matches', () => {
    const cloudA = { ...article('a1', 'T'), tags: ['cloud'], linkedCanvasIds: ['c1'] };
    const localA = { ...article('a1', 'T'), linkedCanvasIds: ['local'] };
    const merged = mergeLocalOntoCloud(emptySnapshot({ articles: [cloudA] }), emptySnapshot({ articles: [localA] }));
    expect(merged.articles[0]).toMatchObject({ tags: ['cloud'], linkedCanvasIds: ['local'] });
  });

  it('uses the local starter position when content matches', () => {
    const id = DEFAULT_NODE_IDS.note;
    const merged = mergeLocalOntoCloud(
      emptySnapshot({ nodes: [node(id, 'default', { type: 'note', content: 'Core', x: 80, y: 360 })] }),
      emptySnapshot({ nodes: [node(id, 'default', { type: 'note', content: 'Core', x: 400, y: 20 })] }),
    );
    expect(merged.nodes).toHaveLength(1);
    expect(merged.nodes[0]).toMatchObject({ x: 400, y: 20 });
  });

  it('rewrites essay content when the referenced article id is remapped', () => {
    const essay = encodeEssayContent({ articleId: 'a1' });
    const merged = mergeLocalOntoCloud(
      emptySnapshot({ articles: [article('a1', 'cloud')], nodes: [] }),
      emptySnapshot({
        articles: [article('a1', 'local')],
        nodes: [node('e1', 'default', { type: 'essay', content: essay })],
      }),
      { newId: () => 'a1-local' },
    );
    expect(merged.nodes.find((n) => n.id === 'e1')?.content).toBe(encodeEssayContent({ articleId: 'a1-local' }));
    expect(merged.articles.map((a) => a.id).sort()).toEqual(['a1', 'a1-local']);
  });

  it('keeps local-only canvas folders and local folder placement on a shared canvas', () => {
    const merged = mergeLocalOntoCloud(
      emptySnapshot({
        canvases: [canvas('default', 'Main')],
        canvasFolders: [{ id: 'cloud-f', name: 'Cloud', createdAt: 1, sortOrder: 0 }],
      }),
      emptySnapshot({
        canvases: [{ ...canvas('default', 'Main'), folderId: 'local-f', sortOrder: 3 }],
        canvasFolders: [{ id: 'local-f', name: 'Local', createdAt: 2, sortOrder: 0 }],
      }),
    );
    expect(merged.canvasFolders.map((f) => f.id).sort()).toEqual(['cloud-f', 'local-f']);
    expect(merged.canvases[0]?.folderId).toBe('local-f');
    expect(merged.canvases[0]?.sortOrder).toBe(3);
  });

  it('unions work zones and remaps persona binding when a card id changes', () => {
    const merged = mergeLocalOntoCloud(
      emptySnapshot({
        canvases: [canvas('default')],
        nodes: [node('agent-cloud', 'default', { type: 'agent', content: 'cloud agent' })],
        workZones: [
          {
            id: 'zone-cloud',
            canvasId: 'default',
            personaNodeId: 'agent-cloud',
            x: 0,
            y: 0,
            width: 200,
            height: 200,
            createdAt: 1,
          },
        ],
      }),
      emptySnapshot({
        canvases: [canvas('default')],
        nodes: [node('agent-cloud', 'default', { type: 'agent', content: 'local agent' })],
        workZones: [
          {
            id: 'zone-local',
            canvasId: 'default',
            personaNodeId: 'agent-cloud',
            x: 40,
            y: 40,
            width: 120,
            height: 120,
            createdAt: 2,
          },
        ],
      }),
      { newId: () => 'agent-local' },
    );
    expect(merged.workZones.map((z) => z.id).sort()).toEqual(['zone-cloud', 'zone-local']);
    expect(merged.workZones.find((z) => z.id === 'zone-local')?.personaNodeId).toBe('agent-local');
    expect(merged.nodes.find((n) => n.id === 'agent-local')?.contextScopeAgentId).toBeUndefined();
  });

  it('merges persona thread messages by id instead of dropping one side', () => {
    const merged = mergeLocalOntoCloud(
      emptySnapshot({
        personaThreads: [
          {
            id: 'default:ask-1',
            canvasId: 'default',
            agentNodeId: 'ask-1',
            updatedAt: 10,
            messages: [
              { id: 'm1', role: 'user', text: 'cloud user', createdAt: 1 },
              { id: 'm2', role: 'assistant', text: 'cloud reply', createdAt: 2 },
            ],
          },
        ],
      }),
      emptySnapshot({
        personaThreads: [
          {
            id: 'default:ask-1',
            canvasId: 'default',
            agentNodeId: 'ask-1',
            updatedAt: 20,
            composerDraft: 'unsent',
            messages: [
              { id: 'm1', role: 'user', text: 'cloud user', createdAt: 1 },
              { id: 'm3', role: 'user', text: 'local follow-up', createdAt: 3 },
            ],
          },
        ],
      }),
    );
    expect(merged.personaThreads).toHaveLength(1);
    expect(merged.personaThreads[0]?.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
    expect(merged.personaThreads[0]?.composerDraft).toBe('unsent');
  });

  it('keeps user before assistant when merged messages share createdAt', () => {
    const merged = mergeLocalOntoCloud(
      emptySnapshot({
        personaThreads: [
          {
            id: 'default:ask-1',
            canvasId: 'default',
            agentNodeId: 'ask-1',
            updatedAt: 10,
            messages: [
              { id: 'a-assistant', role: 'assistant', text: 'reply', createdAt: 100 },
              { id: 'z-user', role: 'user', text: 'question', createdAt: 100 },
            ],
          },
        ],
      }),
      emptySnapshot(),
    );
    expect(merged.personaThreads[0]?.messages.map((m) => m.id)).toEqual(['z-user', 'a-assistant']);
  });
});

describe('offsetImportedCardGroup', () => {
  it('returns the same nodes when the cloud canvas is empty', () => {
    const local = [node('a', 'c', { x: 40, y: 90 })];
    expect(offsetImportedCardGroup(local, [])).toEqual(local);
  });

  it('returns the same nodes when there is nothing to import', () => {
    expect(offsetImportedCardGroup([], [node('c', 'c', { x: 0 })])).toEqual([]);
  });

  it('does not shift when local is already to the right of cloud', () => {
    const local = [node('a', 'c', { x: 500, y: 12, width: 80 })];
    const cloud = [node('c', 'c', { x: 0, width: 100 })];
    expect(offsetImportedCardGroup(local, cloud)).toEqual(local);
  });

  it('shifts a negative-x cluster just to the right of cloud, keeping y', () => {
    const local = [
      node('a', 'c', { x: -800, y: 10, width: 80 }),
      node('b', 'c', { x: -700, y: 200, width: 80 }),
    ];
    const cloud = [node('c', 'c', { x: 0, width: 100 })];
    const out = offsetImportedCardGroup(local, cloud);
    expect(out[0]?.x).toBe(100 + IMPORT_CARD_GAP);
    expect(out[1]?.x).toBe(200 + IMPORT_CARD_GAP);
    expect(out[0]?.y).toBe(10);
    expect(out[1]?.y).toBe(200);
  });

  it('handles a 1px-wide cloud card', () => {
    const local = [node('a', 'c', { x: 0, width: 40 })];
    const cloud = [node('c', 'c', { x: 0, width: 1 })];
    expect(offsetImportedCardGroup(local, cloud)[0]?.x).toBe(1 + IMPORT_CARD_GAP);
  });

  it('leaves nodes unmoved when cloud x is non-finite', () => {
    const local = [node('a', 'c', { x: 0 })];
    const cloud = [node('c', 'c', { x: Number.POSITIVE_INFINITY, width: 10 })];
    expect(offsetImportedCardGroup(local, cloud)).toEqual(local);
  });
});
