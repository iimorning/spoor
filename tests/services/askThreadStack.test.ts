import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db';
import {
  ASK_THREAD_STACK_STEP,
  askThreadStackFrontIndex,
  askThreadStackPos,
  listAskThreadReplies,
  listAskSourceHistory,
  pickAskThreadStackAnchor,
  setAskThreadCollapsed,
  expandCollapsedAskThreads,
} from '../../src/services/askThreadStack';

describe('listAskThreadReplies', () => {
  it('returns only AI replies for the Ask, oldest to newest', () => {
    const nodes = [
      { id: 'ask1', type: 'ask', x: 0, y: 0 },
      { id: 'r2', type: 'ai', x: 200, y: 0, threadRootContextNodeId: 'ask1', threadRound: 2 },
      { id: 'r0', type: 'ai', x: 100, y: 0, threadRootContextNodeId: 'ask1', threadRound: 0 },
      { id: 'r1', type: 'ai', x: 150, y: 0, threadRootContextNodeId: 'ask1', threadRound: 1 },
      { id: 'other', type: 'ai', x: 0, y: 0, threadRootContextNodeId: 'ask2', threadRound: 0 },
      { id: 'note', type: 'note', x: 0, y: 0, threadRootContextNodeId: 'ask1' },
    ] as const;

    const replies = listAskThreadReplies('ask1', [...nodes]);
    expect(replies.map((n) => n.id)).toEqual(['r0', 'r1', 'r2']);
  });

  it('includes edge-chained AI cards even without threadRootContextNodeId', () => {
    const nodes = [
      { id: 'ask1', type: 'ask', x: 0, y: 0 },
      { id: 'r0', type: 'ai', x: 100, y: 0 },
      { id: 'r1', type: 'ai', x: 200, y: 0 },
      { id: 'note', type: 'note', x: 50, y: 50 },
      { id: 'side-ai', type: 'ai', x: 60, y: 60 },
    ] as const;
    const edges = [
      { from: 'ask1', to: 'r0' },
      { from: 'r0', to: 'r1' },
      { from: 'ask1', to: 'note' },
      { from: 'note', to: 'side-ai' },
    ];
    const replies = listAskThreadReplies('ask1', [...nodes], edges);
    expect(replies.map((n) => n.id)).toEqual(['r0', 'r1']);
  });
});

describe('listAskSourceHistory', () => {
  it('from an AI card includes that card and its own follow-ups, not earlier siblings', () => {
    const nodes = [
      { id: 'ask1', type: 'ask', x: 0, y: 0 },
      { id: 'old', type: 'ai', x: 80, y: 0, threadRootContextNodeId: 'ask1', threadRound: 0, userTurn: 'old q', content: 'old a' },
      { id: 'ai-1', type: 'ai', x: 900, y: 0, threadRootContextNodeId: 'ask1', threadRound: 1, userTurn: 'write a story', content: 'vampire story' },
      { id: 'from-1', type: 'ai', x: 1220, y: 0, threadRootContextNodeId: 'ai-1', threadRound: 0, userTurn: 'make it longer', content: 'longer story' },
    ] as const;
    const history = listAskSourceHistory(nodes[2] as (typeof nodes)[2] & { type: string }, [...nodes]);
    expect(history.map((n) => n.id)).toEqual(['ai-1', 'from-1']);
  });

  it('from 阿狸 still returns the full thread', () => {
    const ask = { id: 'ask1', type: 'ask', x: 0, y: 0 };
    const nodes = [
      ask,
      { id: 'r0', type: 'ai', x: 100, y: 0, threadRootContextNodeId: 'ask1', threadRound: 0 },
      { id: 'r1', type: 'ai', x: 200, y: 0, threadRootContextNodeId: 'ask1', threadRound: 1 },
    ];
    expect(listAskSourceHistory(ask, nodes).map((n) => n.id)).toEqual(['r0', 'r1']);
  });

  it('from an agent card returns only that character\'s replies', () => {
    const host = { id: 'host1', type: 'agent', agentConfigId: 'turtle_soup_host', x: 0, y: 0, canvasId: 'c1' };
    const nodes = [
      host,
      { id: 'ask1', type: 'ask', x: 0, y: 0, canvasId: 'c1' },
      { id: 'ali', type: 'ai', x: 100, y: 0, threadRootContextNodeId: 'ask1', threadRound: 0, userTurn: 'hi 阿狸', content: 'hello' },
      { id: 't0', type: 'ai', x: 200, y: 0, threadRootContextNodeId: 'host1', threadRound: 0, userTurn: '开局', content: '汤面' },
      { id: 'other', type: 'ai', x: 300, y: 0, threadRootContextNodeId: 'host2', threadRound: 0, userTurn: '泵', content: '实验' },
    ];
    expect(listAskSourceHistory(host, nodes).map((n) => n.id)).toEqual(['t0']);
  });
});

describe('askThreadStackFrontIndex', () => {
  it('puts the latest reply at front index 0', () => {
    const ask = { x: 0, y: 0 };
    const replies = [
      { id: 'r0', type: 'ai', x: 100, y: 0, threadRound: 0 },
      { id: 'r1', type: 'ai', x: 200, y: 0, threadRound: 1 },
      { id: 'r2', type: 'ai', x: 300, y: 0, threadRound: 2 },
    ] as const;
    expect(askThreadStackFrontIndex([...replies], 'r2', ask)).toBe(0);
    expect(askThreadStackFrontIndex([...replies], 'r1', ask)).toBe(1);
    expect(askThreadStackFrontIndex([...replies], 'r0', ask)).toBe(2);
  });
});

describe('pickAskThreadStackAnchor', () => {
  it('picks the reply closest to the Ask card', () => {
    const ask = { x: 100, y: 100 };
    const replies = [
      { id: 'far', type: 'ai', x: 900, y: 100, threadRound: 1 },
      { id: 'near', type: 'ai', x: 180, y: 120, threadRound: 0 },
      { id: 'mid', type: 'ai', x: 400, y: 100, threadRound: 2 },
    ] as const;
    const anchor = pickAskThreadStackAnchor(ask, [...replies]);
    expect(anchor.id).toBe('near');
    expect(anchor.x).toBe(180);
    expect(anchor.y).toBe(120);
  });
});

describe('askThreadStackPos', () => {
  it('offsets each deeper card by STACK_STEP from the anchor in place', () => {
    const base = { x: 500, y: 80 };
    const p0 = askThreadStackPos(base, 0);
    const p1 = askThreadStackPos(base, 1);
    expect(p0).toEqual(base);
    expect(p1.x - p0.x).toBe(ASK_THREAD_STACK_STEP);
    expect(p1.y - p0.y).toBe(ASK_THREAD_STACK_STEP);
  });
});

describe('setAskThreadCollapsed', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.edges.clear();
  });

  it('stacks at the nearest reply, latest on top, then expands to saved offsets', async () => {
    await db.nodes.add({
      id: 'ask1',
      canvasId: 'default',
      type: 'ask',
      x: 100,
      y: 100,
      height: 200,
    });
    // r0 is closest to Ask
    await db.nodes.add({
      id: 'r0',
      canvasId: 'default',
      type: 'ai',
      content: 'first',
      x: 500,
      y: 80,
      threadRootContextNodeId: 'ask1',
      threadRound: 0,
    });
    await db.nodes.add({
      id: 'r1',
      canvasId: 'default',
      type: 'ai',
      content: 'second',
      x: 900,
      y: 120,
      threadRootContextNodeId: 'ask1',
      threadRound: 1,
    });
    await db.nodes.add({
      id: 'r2',
      canvasId: 'default',
      type: 'ai',
      content: 'third',
      x: 1300,
      y: 160,
      threadRootContextNodeId: 'ask1',
      threadRound: 2,
    });

    const n = await setAskThreadCollapsed('ask1', true);
    expect(n).toBe(3);

    const ask = await db.nodes.get('ask1');
    expect(ask?.askThreadCollapsed).toBe(true);

    const latest = await db.nodes.get('r2');
    const mid = await db.nodes.get('r1');
    const oldest = await db.nodes.get('r0');
    // Pile sits at nearest reply (r0 @ 500,80), not at Ask+offset elsewhere.
    expect(latest!.x).toBe(askThreadStackPos({ x: 500, y: 80 }, 0).x);
    expect(latest!.y).toBe(askThreadStackPos({ x: 500, y: 80 }, 0).y);
    expect(mid!.x).toBe(askThreadStackPos({ x: 500, y: 80 }, 1).x);
    expect(oldest!.x).toBe(askThreadStackPos({ x: 500, y: 80 }, 2).x);
    expect(latest!.x).toBeLessThan(mid!.x);
    expect(mid!.x).toBeLessThan(oldest!.x);

    expect(latest!.askThreadExpandedOffsetX).toBe(1200);
    expect(oldest!.askThreadExpandedOffsetX).toBe(400);

    await setAskThreadCollapsed('ask1', false);
    const ask2 = await db.nodes.get('ask1');
    expect(ask2?.askThreadCollapsed).toBe(false);

    const r0 = await db.nodes.get('r0');
    const r1 = await db.nodes.get('r1');
    const r2 = await db.nodes.get('r2');
    expect(r0!.x).toBe(500);
    expect(r0!.y).toBe(80);
    expect(r1!.x).toBe(900);
    expect(r1!.y).toBe(120);
    expect(r2!.x).toBe(1300);
    expect(r2!.y).toBe(160);
  });

  it('re-stack while collapsed preserves prior expanded offsets and nearest anchor', async () => {
    await db.nodes.add({
      id: 'ask1',
      canvasId: 'default',
      type: 'ask',
      x: 100,
      y: 100,
      height: 200,
      askThreadCollapsed: true,
    });
    await db.nodes.add({
      id: 'r0',
      canvasId: 'default',
      type: 'ai',
      content: 'first',
      x: 480,
      y: 60,
      threadRootContextNodeId: 'ask1',
      threadRound: 0,
      askThreadExpandedOffsetX: 400,
      askThreadExpandedOffsetY: -20,
    });
    await db.nodes.add({
      id: 'r1',
      canvasId: 'default',
      type: 'ai',
      content: 'new',
      x: 900,
      y: 200,
      threadRootContextNodeId: 'ask1',
      threadRound: 1,
    });

    await setAskThreadCollapsed('ask1', true);

    const r0 = await db.nodes.get('r0');
    const r1 = await db.nodes.get('r1');
    expect(r0!.askThreadExpandedOffsetX).toBe(400);
    expect(r0!.askThreadExpandedOffsetY).toBe(-20);
    expect(r1!.askThreadExpandedOffsetX).toBe(800);
    expect(r1!.askThreadExpandedOffsetY).toBe(100);
    // Nearest expanded spot is r0 at ask+(400,-20)=(500,80).
    expect(r1!.x).toBe(askThreadStackPos({ x: 500, y: 80 }, 0).x);
    expect(r0!.x).toBe(askThreadStackPos({ x: 500, y: 80 }, 1).x);
  });
});

describe('expandCollapsedAskThreads', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.edges.clear();
  });

  it('unfolds every collapsed Ask pile back to saved offsets', async () => {
    await db.nodes.add({
      id: 'ask1',
      canvasId: 'default',
      type: 'ask',
      x: 100,
      y: 100,
      askThreadCollapsed: true,
    });
    await db.nodes.add({
      id: 'r0',
      canvasId: 'default',
      type: 'ai',
      content: 'first',
      x: 500,
      y: 80,
      threadRootContextNodeId: 'ask1',
      threadRound: 0,
      askThreadExpandedOffsetX: 400,
      askThreadExpandedOffsetY: -20,
    });
    await db.nodes.add({
      id: 'r1',
      canvasId: 'default',
      type: 'ai',
      content: 'second',
      x: 505,
      y: 85,
      threadRootContextNodeId: 'ask1',
      threadRound: 1,
      askThreadExpandedOffsetX: 800,
      askThreadExpandedOffsetY: 20,
    });

    const nodes = await db.nodes.toArray();
    const n = await expandCollapsedAskThreads(nodes, []);
    expect(n).toBe(1);

    const ask = await db.nodes.get('ask1');
    const r0 = await db.nodes.get('r0');
    const r1 = await db.nodes.get('r1');
    expect(ask?.askThreadCollapsed).toBe(false);
    expect(r0?.x).toBe(500);
    expect(r0?.y).toBe(80);
    expect(r1?.x).toBe(900);
    expect(r1?.y).toBe(120);
  });
});
