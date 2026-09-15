import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db';
import { spawnLinkedTranscriptNote } from '../../src/services/spawnLinkedTranscriptNote';
import type { CanvasNode } from '../../src/db';

describe('spawnLinkedTranscriptNote', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.edges.clear();
  });

  it('adds a text note beside the source and links them', async () => {
    const source = {
      id: 'audio-1',
      canvasId: 'c1',
      type: 'video',
      content: 'data:audio/wav;base64,AA',
      fileType: 'audio/wav',
      x: 40,
      y: 80,
      width: 320,
      height: 200,
    } satisfies CanvasNode;
    await db.nodes.add(source);

    const noteId = await spawnLinkedTranscriptNote({
      canvasId: 'c1',
      sourceNode: source,
      obstacles: [source],
      transform: { x: 0, y: 0, scale: 1 },
      text: '转写正文',
    });

    const note = await db.nodes.get(noteId);
    expect(note?.type).toBe('text');
    expect(note?.content).toBe('转写正文');
    expect(note?.canvasId).toBe('c1');
    expect(note?.x).toBeGreaterThan(source.x);

    const edges = await db.edges.toArray();
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ from: 'audio-1', to: noteId, canvasId: 'c1' });
  });
});
