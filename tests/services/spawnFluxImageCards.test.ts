import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  FLUX_IMAGE_CARD_WIDTH,
  FLUX_IMAGE_CARD_HEIGHT,
  FLUX_IMAGE_GAP_Y,
  FLUX_IMAGE_OFFSET_FROM_HUB_X,
  fluxImageCardPos,
  fluxImageBesideAnchorPos,
  fluxImageCardSize,
  placeFluxImageBesideLiveAnchor,
  spawnFluxImageCard,
} from '../../src/services/spawnFluxImageCards';
import { BOOK_EXPAND_CHILD_OFFSET_X, BOOK_EXPAND_CHILD_WIDTH, BOOK_EXPAND_HUB_HEIGHT } from '../../src/services/spawnBookExpandCards';
import { db } from '../../src/db';

beforeEach(async () => {
  vi.stubGlobal(
    'crypto',
    Object.assign(globalThis.crypto ?? {}, { randomUUID: () => 'uuid-1' }),
  );
  await db.nodes.clear();
  await db.edges.clear();
});

describe('constants', () => {
  it('exposes the documented card dimensions and gap', () => {
    expect(FLUX_IMAGE_CARD_WIDTH).toBe(320);
    expect(FLUX_IMAGE_CARD_HEIGHT).toBe(210);
    expect(FLUX_IMAGE_GAP_Y).toBe(24);
    expect(fluxImageCardSize('portrait')).toEqual({ width: 210, height: 320 });
    expect(fluxImageCardSize('square')).toEqual({ width: 260, height: 260 });
    expect(fluxImageCardSize('strip')).toEqual({ width: 96, height: 768 });
    expect(fluxImageCardSize('poster')).toEqual({ width: 180, height: 320 });
  });

  it('places Flux cards to the right of the book-expand branch lane', () => {
    expect(FLUX_IMAGE_OFFSET_FROM_HUB_X).toBe(
      BOOK_EXPAND_CHILD_OFFSET_X + BOOK_EXPAND_CHILD_WIDTH + 48,
    );
  });
});

describe('fluxImageCardPos', () => {
  it('centers a single card vertically on the hub center for count=1', () => {
    const hub = { x: 100, y: 200 };
    const p = fluxImageCardPos(hub, 0, 1);
    const expectedCenterY = hub.y + BOOK_EXPAND_HUB_HEIGHT / 2;
    expect(p.x).toBe(hub.x + FLUX_IMAGE_OFFSET_FROM_HUB_X);
    expect(p.y).toBe(expectedCenterY - FLUX_IMAGE_CARD_HEIGHT / 2);
  });

  it('stacks 3 cards centered on the hub for count=3', () => {
    const hub = { x: 0, y: 0 };
    const stackH = (3 - 1) * (FLUX_IMAGE_CARD_HEIGHT + FLUX_IMAGE_GAP_Y) + FLUX_IMAGE_CARD_HEIGHT;
    const centerY = hub.y + BOOK_EXPAND_HUB_HEIGHT / 2;
    const firstY = centerY - stackH / 2;
    const p0 = fluxImageCardPos(hub, 0, 3);
    const p2 = fluxImageCardPos(hub, 2, 3);
    expect(p0.y).toBe(firstY);
    expect(p2.y).toBe(firstY + 2 * (FLUX_IMAGE_CARD_HEIGHT + FLUX_IMAGE_GAP_Y));
    expect(p0.x).toBe(p2.x);
  });

  it('handles count=0 (treated as 1) without crashing', () => {
    const hub = { x: 10, y: 10 };
    const p = fluxImageCardPos(hub, 0, 0);
    expect(p.x).toBe(hub.x + FLUX_IMAGE_OFFSET_FROM_HUB_X);
    expect(typeof p.y).toBe('number');
  });
});

describe('fluxImageBesideAnchorPos', () => {
  it('places the card 48px to the right of the anchor width', () => {
    const anchor = { x: 100, y: 200, width: 200, height: 100 };
    const p = fluxImageBesideAnchorPos(anchor, 0);
    expect(p.x).toBe(100 + 200 + 48);
    expect(p.y).toBe(200);
  });

  it('stacks multiple cards vertically using the documented gap', () => {
    const anchor = { x: 0, y: 0, width: 100, height: 50 };
    const p0 = fluxImageBesideAnchorPos(anchor, 0);
    const p1 = fluxImageBesideAnchorPos(anchor, 1);
    expect(p1.y).toBe(p0.y + FLUX_IMAGE_CARD_HEIGHT + FLUX_IMAGE_GAP_Y);
  });

  it('defaults the anchor width to 320 when missing', () => {
    const anchor = { x: 0, y: 0 };
    const p = fluxImageBesideAnchorPos(anchor, 0);
    expect(p.x).toBe(0 + 320 + 48);
  });

  it('defaults the anchor width to 320 when zero or negative', () => {
    expect(fluxImageBesideAnchorPos({ x: 0, y: 0, width: 0 }, 0).x).toBe(0 + 320 + 48);
    expect(fluxImageBesideAnchorPos({ x: 0, y: 0, width: -10 }, 0).x).toBe(0 + 320 + 48);
  });
});

describe('placeFluxImageBesideLiveAnchor', () => {
  it('sits to the right of the live anchor when that lane is free', () => {
    const anchor = { type: 'ai', x: 40, y: 80, width: 320, height: 200 };
    const pos = placeFluxImageBesideLiveAnchor(anchor, [anchor]);
    expect(pos.x).toBe(40 + 320 + 28);
    expect(pos.y).toBeGreaterThanOrEqual(80);
    expect(Math.abs(pos.x - (anchor.x + (anchor.width ?? 0)))).toBeLessThan(400);
  });

  it('drops below the live anchor instead of jumping far when the right lane is blocked', () => {
    const anchor = { type: 'ask', x: 100, y: 50, width: 320, height: 180 };
    const blocker = {
      type: 'ai',
      x: 100 + 320 + 28,
      y: 50,
      width: 320,
      height: 240,
    };
    const pos = placeFluxImageBesideLiveAnchor(anchor, [anchor, blocker]);
    expect(pos.x).toBe(anchor.x);
    expect(pos.y).toBeGreaterThan(anchor.y);
    expect(pos.y - anchor.y).toBeLessThan(500);
  });
});

describe('spawnFluxImageCard', () => {
  it('returns the new node id (from crypto.randomUUID)', async () => {
    const id = await spawnFluxImageCard({
      canvasId: 'c1',
      imageUrl: 'https://x/a.png',
      x: 0,
      y: 0,
    });
    expect(id).toBe('uuid-1');
  });

  it('inserts a generated image node without a source page URL', async () => {
    await spawnFluxImageCard({
      canvasId: 'c1',
      imageUrl: 'https://x/a.png',
      description: '  雪山日落  ',
      x: 50,
      y: 60,
    });
    const rows = await db.nodes.where('canvasId').equals('c1').toArray();
    expect(rows).toHaveLength(1);
    const node = rows[0];
    expect(node.id).toBe('uuid-1');
    expect(node.type).toBe('image');
    expect(node.content).toBe('https://x/a.png');
    expect(node.sourceUrl).toBeUndefined();
    expect(node.aiGenerated).toBe(true);
    expect(node.description).toBe('雪山日落');
    expect(node.x).toBe(50);
    expect(node.y).toBe(60);
    expect(node.width).toBe(FLUX_IMAGE_CARD_WIDTH);
    expect(node.height).toBe(FLUX_IMAGE_CARD_HEIGHT);
  });

  it('accepts a portrait frame size', async () => {
    await spawnFluxImageCard({
      canvasId: 'c1',
      imageUrl: 'https://x/a.png',
      x: 0,
      y: 0,
      width: 210,
      height: 320,
    });
    const node = await db.nodes.get('uuid-1');
    expect(node?.width).toBe(210);
    expect(node?.height).toBe(320);
  });

  it('trims the description before storing it', async () => {
    await spawnFluxImageCard({
      canvasId: 'c1',
      imageUrl: 'https://x/a.png',
      description: '   trim me   ',
      x: 0,
      y: 0,
    });
    const node = await db.nodes.get('uuid-1');
    expect(node?.description).toBe('trim me');
  });

  it('stores description as undefined when missing or empty/whitespace', async () => {
    await spawnFluxImageCard({
      canvasId: 'c1',
      imageUrl: 'https://x/a.png',
      x: 0,
      y: 0,
    });
    const node = await db.nodes.get('uuid-1');
    expect(node?.description).toBeUndefined();

    vi.stubGlobal('crypto', { ...globalThis.crypto, randomUUID: () => 'uuid-2' });
    await spawnFluxImageCard({
      canvasId: 'c1',
      imageUrl: 'https://x/b.png',
      description: '   ',
      x: 0,
      y: 0,
    });
    const node2 = await db.nodes.get('uuid-2');
    expect(node2?.description).toBeUndefined();
  });

  it('does NOT create an edge when linkFromId is omitted', async () => {
    await spawnFluxImageCard({
      canvasId: 'c1',
      imageUrl: 'https://x/a.png',
      x: 0,
      y: 0,
    });
    const edges = await db.edges.toArray();
    expect(edges).toHaveLength(0);
  });

  it('creates an edge when linkFromId is provided', async () => {
    // Both crypto.randomUUID calls in spawnFluxImageCard return distinct uuids;
    // mock sequentially so the node id is "node-uuid" and the edge id is "edge-uuid"
    const seq = ['node-uuid', 'edge-uuid'];
    vi.stubGlobal('crypto', { ...globalThis.crypto, randomUUID: () => seq.shift() ?? 'fallback' });
    await spawnFluxImageCard({
      canvasId: 'c1',
      imageUrl: 'https://x/a.png',
      x: 0,
      y: 0,
      linkFromId: 'parent-1',
    });
    const edges = await db.edges.toArray();
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      id: 'edge-uuid',
      canvasId: 'c1',
      from: 'parent-1',
      to: 'node-uuid',
    });
  });
});
