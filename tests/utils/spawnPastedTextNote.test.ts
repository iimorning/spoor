import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db';
import { DEFAULT_NODE_SIZE } from '../../src/utils/canvas';
import {
  normalizePastedCanvasText,
  spawnNoteFromPastedText,
} from '../../src/utils/spawnPastedTextNote';

describe('normalizePastedCanvasText', () => {
  it('trims whitespace and keeps inner line breaks', () => {
    expect(normalizePastedCanvasText('  hello\r\nworld  \n')).toBe('hello\nworld');
  });

  it('rejects empty or whitespace-only clipboard', () => {
    expect(normalizePastedCanvasText('')).toBeNull();
    expect(normalizePastedCanvasText('   \n\t  ')).toBeNull();
  });
});

describe('spawnNoteFromPastedText', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.edges.clear();
    await db.canvasWorkZones.clear();
    localStorage.clear();
  });

  it('creates a text note with the pasted body', async () => {
    const nodeId = await spawnNoteFromPastedText({
      text: '  辅助摘录\n第二行  ',
      canvasId: 'c1',
      position: { x: 40, y: 80 },
    });
    expect(nodeId).toBeTruthy();
    const node = await db.nodes.get(nodeId!);
    expect(node).toMatchObject({
      type: 'text',
      content: '辅助摘录\n第二行',
      canvasId: 'c1',
      x: 40,
      y: 80,
      width: DEFAULT_NODE_SIZE.width,
      height: DEFAULT_NODE_SIZE.height,
    });
    expect(typeof node?.createdAt).toBe('number');
  });

  it('returns null for blank text and writes nothing', async () => {
    const nodeId = await spawnNoteFromPastedText({
      text: '   ',
      canvasId: 'c1',
      position: { x: 0, y: 0 },
    });
    expect(nodeId).toBeNull();
    expect(await db.nodes.count()).toBe(0);
  });

  it('stamps work-zone scope when the paste lands in a bound room', async () => {
    await db.canvasWorkZones.add({
      id: 'zone-a',
      canvasId: 'c1',
      personaNodeId: 'agent-a',
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      createdAt: 0,
    });
    const nodeId = await spawnNoteFromPastedText({
      text: '进房间',
      canvasId: 'c1',
      position: { x: 20, y: 20 },
    });
    expect((await db.nodes.get(nodeId!))?.contextScopeAgentId).toBe('agent-a');
  });
});
