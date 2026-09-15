import { describe, it, expect, beforeEach } from 'vitest';
import {
  BATCH_FILE_COLS,
  BATCH_FILE_GAP,
  batchFileDropPosition,
  ingestFilesToCanvas,
} from '../../src/utils/canvasFileIngest';
import { DEFAULT_NODE_SIZE } from '../../src/utils/canvas';
import { db } from '../../src/db';

describe('batchFileDropPosition', () => {
  it('places the first file at the origin', () => {
    expect(batchFileDropPosition({ x: 100, y: 50 }, 0)).toEqual({ x: 100, y: 50 });
  });

  it('lays out a 3-column grid with card-sized gaps', () => {
    const origin = { x: 0, y: 0 };
    const stepX = DEFAULT_NODE_SIZE.width + BATCH_FILE_GAP;
    const stepY = DEFAULT_NODE_SIZE.height + BATCH_FILE_GAP;

    expect(batchFileDropPosition(origin, 1)).toEqual({ x: stepX, y: 0 });
    expect(batchFileDropPosition(origin, 2)).toEqual({ x: stepX * 2, y: 0 });
    expect(batchFileDropPosition(origin, BATCH_FILE_COLS)).toEqual({ x: 0, y: stepY });
  });
});

describe('ingestFilesToCanvas', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.canvasWorkZones.clear();
    localStorage.clear();
  });

  it('adds every successful file as its own node', async () => {
    const files = [
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.png', { type: 'image/png' }),
      new File(['c'], 'c.txt', { type: 'text/plain' }),
    ];

    const { addedIds, failures } = await ingestFilesToCanvas({
      canvasId: 'default',
      files,
      origin: { x: 10, y: 20 },
    });

    expect(failures).toEqual([]);
    expect(addedIds).toHaveLength(3);

    const nodes = await db.nodes.toArray();
    expect(nodes).toHaveLength(3);
    expect(nodes.map((n) => n.type).sort()).toEqual(['image', 'image', 'text']);
    expect(nodes.every((n) => typeof n.createdAt === 'number')).toBe(true);

    const stepX = DEFAULT_NODE_SIZE.width + BATCH_FILE_GAP;
    expect(nodes.find((n) => n.content.includes('a') || n.type === 'image')?.x).toBeDefined();
    const xs = nodes.map((n) => n.x).sort((a, b) => a - b);
    expect(xs[0]).toBe(10);
    expect(xs).toContain(10 + stepX);
  });

  it('keeps successful files when some fail', async () => {
    const files = [
      new File(['ok'], 'ok.png', { type: 'image/png' }),
      new File(['bad'], 'bad.bin', { type: 'application/octet-stream' }),
    ];

    const { addedIds, failures } = await ingestFilesToCanvas({
      canvasId: 'default',
      files,
      origin: { x: 0, y: 0 },
    });

    expect(addedIds).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].name).toBe('bad.bin');
    expect(await db.nodes.count()).toBe(1);
  });

  it('stamps work-zone scope when the upload lands inside a bound room', async () => {
    await db.canvasWorkZones.add({
      id: 'zone-a',
      canvasId: 'default',
      personaNodeId: 'agent-a',
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      createdAt: 0,
    });

    await ingestFilesToCanvas({
      canvasId: 'default',
      files: [new File(['ok'], 'ok.png', { type: 'image/png' })],
      origin: { x: 40, y: 40 },
    });

    const nodes = await db.nodes.toArray();
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.contextScopeAgentId).toBe('agent-a');
  });

  it('forces persona scope for chat panel uploads', async () => {
    const { addedIds } = await ingestFilesToCanvas({
      canvasId: 'default',
      files: [new File(['ok'], 'ok.png', { type: 'image/png' })],
      origin: { x: 9000, y: 9000 },
      contextScopeAgentId: 'ask-1',
    });

    expect(addedIds).toHaveLength(1);
    const node = await db.nodes.get(addedIds[0]!);
    expect(node?.contextScopeAgentId).toBe('ask-1');
  });
});
