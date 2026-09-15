import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db';
import { encodeEssayContent, tryParseEssayContent } from '../../src/utils/essayPayload';
import {
  archiveNode,
  buildArchiveListItem,
  buildPocketArchiveListItem,
  deleteArchivedCard,
  filterAndSortArchiveItems,
  isArchivableNodeType,
  isPocketArchiveItemId,
  pocketNodeIdFromArchiveItem,
  restoreArchivedCard,
  saveArchivedInsight,
} from '../../src/utils/archiveCards';
import { createArchiveFolder } from '../../src/utils/archiveFolders';

describe('archiveCards', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.edges.clear();
    await db.articles.clear();
    await db.archivedCards.clear();
    await db.archiveFolders.clear();
    await db.canvases.clear();
    await db.canvases.add({
      id: 'default',
      name: 'Main',
      createdAt: 1,
      updatedAt: 1,
    });
  });

  it('rejects ask cards', () => {
    expect(isArchivableNodeType('ask')).toBe(false);
    expect(isArchivableNodeType('note')).toBe(true);
    expect(isArchivableNodeType('agent')).toBe(false);
  });

  it('archives a note as a reusable snapshot while keeping it on the canvas', async () => {
    await db.nodes.add({
      id: 'n1',
      type: 'note',
      content: 'Hello archive',
      x: 10,
      y: 20,
      canvasId: 'default',
    });
    await db.edges.add({ id: 'e1', from: 'n1', to: 'n2', canvasId: 'default' });

    const entry = await archiveNode('n1');
    expect(entry.node.content).toBe('Hello archive');
    expect(entry.sourceCanvasName).toBe('Main');
    expect(await db.nodes.get('n1')).toBeTruthy();
    expect(await db.edges.get('e1')).toBeTruthy();
    expect(await db.archivedCards.count()).toBe(1);
  });

  it('archives essay with article snapshot without removing the live article', async () => {
    await db.articles.add({
      id: 'art-1',
      title: 'Essay Title',
      content: 'Full body',
      date: '2026',
      type: 'GEN',
      sourceCards: [
        { nodeId: 'x', canvasId: 'default', kind: 'note', title: 'A', segmentText: 'Seg text' },
      ],
    });
    await db.nodes.add({
      id: 'essay-1',
      type: 'essay',
      content: encodeEssayContent({ articleId: 'art-1' }),
      description: 'Essay Title',
      x: 0,
      y: 0,
      width: 380,
      height: 520,
      canvasId: 'default',
    });

    const entry = await archiveNode('essay-1');
    expect(entry.article?.title).toBe('Essay Title');
    expect(await db.nodes.get('essay-1')).toBeTruthy();
    expect(await db.articles.get('art-1')).toBeTruthy();

    const list = buildArchiveListItem(entry);
    expect(list.title).toBe('Essay Title');
    expect(list.body).toContain('Seg text');
  });

  it('archives a contentDrivesBody essay using content, not leftover segmentText', async () => {
    await db.articles.add({
      id: 'art-edited',
      title: 'Edited Essay',
      content: 'Hand-edited body',
      date: '2026',
      type: 'GEN',
      contentDrivesBody: true,
      sourceCards: [
        { nodeId: 'x', canvasId: 'default', kind: 'note', title: 'A', segmentText: 'Old segment' },
      ],
    });
    await db.nodes.add({
      id: 'essay-edited',
      type: 'essay',
      content: encodeEssayContent({ articleId: 'art-edited' }),
      description: 'Edited Essay',
      x: 0,
      y: 0,
      width: 380,
      height: 520,
      canvasId: 'default',
    });

    const entry = await archiveNode('essay-edited');
    const list = buildArchiveListItem(entry);
    expect(list.body).toBe('Hand-edited body');
    expect(list.body).not.toContain('Old segment');
  });

  it('restores a copy to canvas while keeping the archive entry and original node', async () => {
    await db.nodes.add({
      id: 'n1',
      type: 'text',
      content: 'Reusable',
      x: 0,
      y: 0,
      canvasId: 'default',
    });
    const entry = await archiveNode('n1');
    const newId = await restoreArchivedCard(entry.id, 'default', { x: 100, y: 200 });
    expect(newId).not.toBe('n1');
    expect(await db.nodes.get('n1')).toBeTruthy();
    const restored = await db.nodes.get(newId);
    expect(restored?.content).toBe('Reusable');
    expect(restored?.x).toBe(100);
    expect(typeof restored?.createdAt).toBe('number');
    expect(await db.archivedCards.get(entry.id)).toBeTruthy();
  });

  it('restores essay with a new article id', async () => {
    await db.articles.add({
      id: 'art-old',
      title: 'T',
      content: 'Body',
      date: '2026',
      type: 'GEN',
    });
    await db.nodes.add({
      id: 'essay-1',
      type: 'essay',
      content: encodeEssayContent({ articleId: 'art-old' }),
      x: 0,
      y: 0,
      canvasId: 'default',
    });
    const entry = await archiveNode('essay-1');
    const newId = await restoreArchivedCard(entry.id, 'default', { x: 5, y: 5 });
    const node = await db.nodes.get(newId);
    expect(node?.type).toBe('essay');
    expect(tryParseEssayContent(node?.content)?.articleId).not.toBe('art-old');
    expect(await db.articles.get('art-old')).toBeTruthy();
    expect(await db.articles.count()).toBe(2);
  });

  it('deletes archive entry permanently', async () => {
    await db.nodes.add({
      id: 'n1',
      type: 'note',
      content: 'x',
      x: 0,
      y: 0,
      canvasId: 'default',
    });
    const entry = await archiveNode('n1');
    await deleteArchivedCard(entry.id);
    expect(await db.archivedCards.count()).toBe(0);
    expect(await db.nodes.get('n1')).toBeTruthy();
  });

  it('archives into a chosen folder', async () => {
    await db.nodes.add({
      id: 'n1',
      type: 'note',
      content: 'Hello archive',
      x: 10,
      y: 20,
      canvasId: 'default',
    });
    const folder = await createArchiveFolder('Quotes');
    const entry = await archiveNode('n1', folder.id);
    expect(entry.folderId).toBe(folder.id);
    expect((await db.archivedCards.get(entry.id))?.folderId).toBe(folder.id);
  });

  it('rejects a missing folder id', async () => {
    await db.nodes.add({
      id: 'n1',
      type: 'note',
      content: 'x',
      x: 0,
      y: 0,
      canvasId: 'default',
    });
    await expect(archiveNode('n1', 'missing-folder')).rejects.toThrow(/Folder not found/);
  });

  it('filters and sorts list items', () => {
    const items = [
      buildArchiveListItem({
        id: 'a',
        archivedAt: 1000,
        node: { id: '1', type: 'note', content: 'Zebra idea', x: 0, y: 0 },
      }),
      buildArchiveListItem({
        id: 'b',
        archivedAt: 2000,
        node: { id: '2', type: 'note', content: 'Apple note', x: 0, y: 0 },
      }),
    ];
    const sorted = filterAndSortArchiveItems(items, '');
    expect(sorted.map((i) => i.id)).toEqual(['b', 'a']);
    const filtered = filterAndSortArchiveItems(items, 'zebra');
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.id).toBe('a');
  });

  it('saves a knowledge insight into the hub card folder', async () => {
    const folder = await createArchiveFolder('Memory');
    await db.archivedCards.add({
      id: 'hub-1',
      archivedAt: 1,
      folderId: folder.id,
      sourceCanvasId: 'default',
      sourceCanvasName: 'Main',
      node: { id: 'n1', type: 'note', content: 'Hub note', x: 0, y: 0 },
    });
    const entry = await saveArchivedInsight({
      hubId: 'hub-1',
      text: '1) Cluster — spatial memory.\n2) Tension — leak vs structure.',
      title: 'Knowledge insight',
    });
    expect(entry.folderId).toBe(folder.id);
    expect(entry.node.type).toBe('note');
    expect(entry.node.description).toBe('Knowledge insight');
    expect(entry.node.content).toContain('spatial memory');
    expect(typeof entry.node.createdAt).toBe('number');
    expect(await db.archivedCards.get(entry.id)).toBeTruthy();
  });

  it('uses node.createdAt for the archive date label when present', () => {
    const item = buildArchiveListItem({
      id: 'a',
      archivedAt: Date.UTC(2026, 5, 1),
      node: {
        id: '1',
        type: 'note',
        content: 'x',
        x: 0,
        y: 0,
        createdAt: Date.UTC(2024, 5, 1),
      },
    });
    expect(item.dateLabel).toMatch(/2024/);
    expect(item.dateLabel).toMatch(/06|6/);
  });

  it('falls back to archivedAt when createdAt is missing', () => {
    const item = buildArchiveListItem({
      id: 'a',
      archivedAt: Date.UTC(2026, 5, 1),
      node: { id: '1', type: 'note', content: 'x', x: 0, y: 0 },
    });
    expect(item.dateLabel).toMatch(/2026/);
    expect(item.dateLabel).toMatch(/06|6/);
  });

  it('copies live createdAt onto the archive snapshot', async () => {
    const createdAt = Date.UTC(2024, 5, 1);
    await db.nodes.add({
      id: 'n1',
      type: 'note',
      content: 'x',
      x: 0,
      y: 0,
      canvasId: 'default',
      createdAt,
    });
    const entry = await archiveNode('n1');
    expect(entry.node.createdAt).toBe(createdAt);
    expect(buildArchiveListItem(entry).dateLabel).toMatch(/2024/);
  });

  it('builds a pocket archive item that maps back to the node id', () => {
    const item = buildPocketArchiveListItem({
      id: 'p1',
      type: 'note',
      content: 'From the train',
      x: 0,
      y: 0,
      canvasId: '__pocket__',
      createdAt: Date.UTC(2026, 0, 2),
    });
    expect(item.origin).toBe('pocket');
    expect(item.title).toBe('From the train');
    expect(isPocketArchiveItemId(item.id)).toBe(true);
    expect(pocketNodeIdFromArchiveItem(item.id)).toBe('p1');
  });
});
