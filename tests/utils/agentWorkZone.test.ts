import { beforeEach, describe, expect, it } from 'vitest';
import { db, type CanvasNode, type CanvasWorkZone } from '../../src/db';
import {
  findPersonaForNodeInZones,
  hitTestWorkZoneHandle,
  isNodeCenterInRect,
  isNodeInWorkZone,
  personaIdForEmptyCanvasClick,
  resizeWorkZoneRect,
  translateWorkZoneRect,
  worldRectFromPoints,
} from '../../src/utils/workZoneGeometry';
import {
  applyWorkZoneOnDragEnd,
  personaBlockedByForeignWorkZone,
  pickPersonaToClaimUnboundZone,
  buildWorkZoneBackgroundText,
  buildWorkZoneContextText,
  collectWorkZoneContextPayload,
  collectWorkZoneNodeIds,
  filterSelectionToWorkZoneFocus,
  resolveComposerFocusNodeIds,
  findNearestAgentForNode,
  inferWorkZoneAssignments,
  isNodeInAgentWorkZone,
  isPersonaAnchorNode,
  personaThreadId,
  releasePersonaBindings,
  resolveWorkZonePersonaId,
} from '../../src/utils/agentWorkZone';

function node(
  partial: Partial<CanvasNode> & Pick<CanvasNode, 'id' | 'type' | 'x' | 'y'>,
): CanvasNode {
  return {
    content: '',
    width: 320,
    height: 200,
    ...partial,
  };
}

function zone(
  partial: Partial<CanvasWorkZone> & Pick<CanvasWorkZone, 'id' | 'x' | 'y' | 'width' | 'height'>,
): CanvasWorkZone {
  return {
    canvasId: 'canvas-1',
    createdAt: 0,
    ...partial,
  };
}

describe('workZoneGeometry', () => {
  const agentA = node({ id: 'agent-a', type: 'agent', x: 0, y: 0, agentConfigId: 'cfg-a' });
  const noteInside = node({ id: 'note-1', type: 'note', x: 100, y: 80, content: 'hello' });
  const noteOutside = node({ id: 'note-2', type: 'note', x: 900, y: 80, content: 'far' });

  const zoneA = zone({
    id: 'zone-a',
    personaNodeId: 'agent-a',
    x: 0,
    y: 0,
    width: 400,
    height: 300,
  });

  it('detects node center inside a drawn rect', () => {
    expect(isNodeInWorkZone(noteInside, zoneA)).toBe(true);
    expect(isNodeInWorkZone(noteOutside, zoneA)).toBe(false);
    expect(isNodeCenterInRect(noteInside, zoneA)).toBe(true);
  });

  it('findPersonaForNodeInZones picks smallest overlapping zone', () => {
    const noteOverlap = node({ id: 'note-overlap', type: 'note', x: 90, y: 70, width: 80, height: 80, content: 'in both' });
    const zoneSmall = zone({
      id: 'zone-small',
      personaNodeId: 'agent-b',
      x: 80,
      y: 60,
      width: 120,
      height: 120,
    });
    const zoneBig = zone({
      id: 'zone-big',
      personaNodeId: 'agent-a',
      x: 0,
      y: 0,
      width: 500,
      height: 400,
    });
    expect(findPersonaForNodeInZones(noteOverlap, [zoneBig, zoneSmall])).toBe('agent-b');
  });

  it('findPersonaForNodeInZones ignores unbound rooms', () => {
    const empty = zone({
      id: 'zone-empty',
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    });
    expect(findPersonaForNodeInZones(noteInside, [empty])).toBeUndefined();
  });

  it('worldRectFromPoints enforces minimum size', () => {
    expect(worldRectFromPoints({ x: 0, y: 0 }, { x: 10, y: 10 })).toBeNull();
    const rect = worldRectFromPoints({ x: 0, y: 0 }, { x: 120, y: 90 });
    expect(rect).toEqual({ x: 0, y: 0, width: 120, height: 90 });
  });

  it('resizeWorkZoneRect stretches from a handle and keeps min size', () => {
    const rect = { x: 0, y: 0, width: 400, height: 300 };
    expect(resizeWorkZoneRect(rect, 'se', { x: 500, y: 400 })).toEqual({
      x: 0,
      y: 0,
      width: 500,
      height: 400,
    });
    expect(resizeWorkZoneRect(rect, 'nw', { x: -40, y: -20 })).toEqual({
      x: -40,
      y: -20,
      width: 440,
      height: 320,
    });
    expect(resizeWorkZoneRect(rect, 'e', { x: 10, y: 150 }).width).toBe(48);
  });

  it('hitTestWorkZoneHandle finds a corner at scale 1', () => {
    const rect = { x: 0, y: 0, width: 400, height: 300 };
    expect(hitTestWorkZoneHandle(rect, { x: 400, y: 300 }, 1)).toBe('se');
    expect(hitTestWorkZoneHandle(rect, { x: 200, y: 150 }, 1)).toBeNull();
  });

  it('translateWorkZoneRect moves without changing size', () => {
    expect(translateWorkZoneRect({ x: 10, y: 20, width: 100, height: 80 }, 5, -8)).toEqual({
      x: 15,
      y: 12,
      width: 100,
      height: 80,
    });
  });
});

describe('agentWorkZone', () => {
  const agentA = node({ id: 'agent-a', type: 'agent', x: 0, y: 0, agentConfigId: 'cfg-a' });
  const agentB = node({ id: 'agent-b', type: 'agent', x: 800, y: 0, agentConfigId: 'cfg-b' });
  const noteNearA = node({ id: 'note-1', type: 'note', x: 100, y: 50, content: 'hello' });
  const noteMid = node({ id: 'note-mid', type: 'note', x: 400, y: 0, content: 'middle' });
  const noteScoped = node({
    id: 'note-scoped',
    type: 'note',
    x: 2000,
    y: 2000,
    content: 'scoped',
    contextScopeAgentId: 'agent-a',
  });

  it('legacy halo membership still works for migration helpers', () => {
    expect(isNodeInAgentWorkZone(noteNearA, agentA)).toBe(true);
    expect(isNodeInAgentWorkZone(noteMid, agentA)).toBe(false);
  });

  it('collectWorkZoneNodeIds reads contextScopeAgentId only', () => {
    const ids = collectWorkZoneNodeIds('agent-a', [agentA, noteNearA, noteScoped]);
    expect(ids).toEqual(['note-scoped']);
  });

  it('filterSelectionToWorkZoneFocus ignores cards outside the persona scope', () => {
    const ids = filterSelectionToWorkZoneFocus('agent-a', [agentA, noteNearA, noteScoped], [
      'note-1',
      'note-scoped',
    ]);
    expect(ids).toEqual(['note-scoped']);
  });

  it('resolveComposerFocusNodeIds falls back to selection when room scope is missing', () => {
    const ids = resolveComposerFocusNodeIds('agent-a', [agentA, noteNearA], ['note-1']);
    expect(ids).toEqual(['note-1']);
  });

  it('filterSelectionToWorkZoneFocus accepts geometry when scope is not stamped yet', () => {
    const room = zone({
      id: 'zone-a',
      personaNodeId: 'agent-a',
      x: 0,
      y: 0,
      width: 400,
      height: 400,
    });
    const ids = filterSelectionToWorkZoneFocus(
      'agent-a',
      [agentA, noteNearA],
      ['note-1'],
      [room],
    );
    expect(ids).toEqual(['note-1']);
  });

  it('collectWorkZoneContextPayload includes all work-zone images (no count cap)', () => {
    const images = Array.from({ length: 6 }, (_, i) =>
      node({
        id: `img-${i}`,
        type: 'image',
        x: 0,
        y: 0,
        content: `data:image/png;base64,${i}`,
        contextScopeAgentId: 'agent-a',
      }),
    );
    const payload = collectWorkZoneContextPayload('agent-a', [agentA, ...images], ['img-0', 'img-1']);
    expect(payload.imageNodeIds).toHaveLength(6);
    expect(payload.focusImageNodeIds).toEqual(['img-0', 'img-1']);
    expect(payload.backgroundImageNodeIds).toEqual(['img-2', 'img-3', 'img-4', 'img-5']);
    expect(payload.imageNodeIds).toEqual([...payload.focusImageNodeIds!, ...payload.backgroundImageNodeIds!]);
  });

  it('collectWorkZoneContextPayload prioritizes focus ids', () => {
    const n1 = node({
      id: 'n1',
      type: 'note',
      x: 0,
      y: 0,
      content: 'one',
      contextScopeAgentId: 'agent-a',
    });
    const n2 = node({
      id: 'n2',
      type: 'note',
      x: 0,
      y: 0,
      content: 'two',
      contextScopeAgentId: 'agent-a',
    });
    const payload = collectWorkZoneContextPayload('agent-a', [agentA, n1, n2], ['n2']);
    expect(payload.focusTextNodeIds).toEqual(['n2']);
    expect(payload.backgroundTextNodeIds).toEqual(['n1']);
    expect(payload.textNodeIds).toEqual(['n2', 'n1']);
  });

  it('findNearestAgentForNode is for migration only', () => {
    const nearest = findNearestAgentForNode(noteMid, [agentA, agentB]);
    expect(nearest?.id).toBe('agent-a');
  });

  it('inferWorkZoneAssignments uses BFS from agents', () => {
    const assignments = inferWorkZoneAssignments(
      [agentA, noteNearA, noteMid],
      [{ id: 'e1', from: 'agent-a', to: 'note-1', canvasId: 'c1' }],
    );
    expect(assignments.get('note-1')).toBe('agent-a');
    expect(assignments.has('note-mid')).toBe(true);
  });

  it('personaThreadId is stable per canvas + persona', () => {
    expect(personaThreadId('canvas-1', 'agent-a')).toBe('canvas-1:agent-a');
  });

  it('resolveWorkZonePersonaId prefers active chat persona', () => {
    const ask = node({ id: 'ask-1', type: 'ask', x: 0, y: 0, content: '' });
    expect(resolveWorkZonePersonaId([agentA, ask], 'ask-1')).toBe('ask-1');
    expect(resolveWorkZonePersonaId([agentA, ask], null)).toBe('agent-a');
  });

  it('isPersonaAnchorNode includes ask and agent', () => {
    expect(isPersonaAnchorNode(node({ id: 'a', type: 'agent', x: 0, y: 0 }))).toBe(true);
    expect(isPersonaAnchorNode(node({ id: 'q', type: 'ask', x: 0, y: 0, content: '' }))).toBe(true);
    expect(isPersonaAnchorNode(node({ id: 'n', type: 'note', x: 0, y: 0, content: '' }))).toBe(false);
  });

  it('buildWorkZoneBackgroundText omits focus and keeps background only', () => {
    const payload = collectWorkZoneContextPayload(
      'agent-a',
      [
        agentA,
        node({ id: 'f1', type: 'note', x: 0, y: 0, content: 'focus body', contextScopeAgentId: 'agent-a' }),
        node({ id: 'b1', type: 'note', x: 0, y: 0, content: 'bg body', contextScopeAgentId: 'agent-a' }),
      ],
      ['f1'],
    );
    const text = buildWorkZoneBackgroundText(payload, ((key: string) => key) as never, (id) => {
      if (id === 'f1') return 'focus body';
      if (id === 'b1') return 'bg body';
      return '';
    });
    expect(text).toContain('canvas.v2.workspace_context_heading');
    expect(text).not.toContain('canvas.v2.focus_context_heading');
    expect(text).not.toContain('focus body');
    expect(text).toContain('bg body');
  });

  it('buildWorkZoneBackgroundText includes whole zone when no focus', () => {
    const payload = collectWorkZoneContextPayload(
      'agent-a',
      [
        agentA,
        node({ id: 'n1', type: 'note', x: 0, y: 0, content: 'note body', contextScopeAgentId: 'agent-a' }),
      ],
    );
    const text = buildWorkZoneBackgroundText(payload, ((key: string) => key) as never, () => 'note body');
    expect(text).toContain('note body');
    expect(text).not.toContain('canvas.v2.workspace_context_heading');
  });

  it('buildWorkZoneContextText separates focus and background sections', () => {
    const payload = collectWorkZoneContextPayload(
      'agent-a',
      [
        agentA,
        node({ id: 'f1', type: 'note', x: 0, y: 0, content: 'focus body', contextScopeAgentId: 'agent-a' }),
        node({ id: 'b1', type: 'note', x: 0, y: 0, content: 'bg body', contextScopeAgentId: 'agent-a' }),
      ],
      ['f1'],
    );
    const text = buildWorkZoneContextText(payload, ((key: string) => key) as never, (id) => {
      if (id === 'f1') return 'focus body';
      if (id === 'b1') return 'bg body';
      return '';
    });
    expect(text).toContain('canvas.v2.focus_context_heading');
    expect(text).toContain('canvas.v2.workspace_context_heading');
    expect(text).toContain('focus body');
    expect(text).toContain('bg body');
  });
});

describe('applyWorkZoneOnDragEnd', () => {
  const agentA = node({ id: 'agent-a', type: 'agent', x: 0, y: 0, agentConfigId: 'cfg-a', canvasId: 'canvas-1' });
  const zoneA = zone({
    id: 'zone-a',
    personaNodeId: 'agent-a',
    x: 0,
    y: 0,
    width: 400,
    height: 300,
  });

  beforeEach(async () => {
    await db.nodes.clear();
    await db.canvasWorkZones.clear();
  });

  it('assigns scope when dragged into a work zone', async () => {
    const note = node({ id: 'note-1', type: 'note', x: 900, y: 900, content: 'move me', canvasId: 'canvas-1' });
    await db.nodes.add(note);

    const result = await applyWorkZoneOnDragEnd(
      'note-1',
      { x: 100, y: 80 },
      [agentA, note],
      [zoneA],
    );

    expect(result.assigned).toBe('agent-a');
    const updated = await db.nodes.get('note-1');
    expect(updated?.contextScopeAgentId).toBe('agent-a');
  });

  it('clears scope when dragged out of all zones', async () => {
    const note = node({
      id: 'note-2',
      type: 'note',
      x: 100,
      y: 80,
      content: 'scoped',
      contextScopeAgentId: 'agent-a',
      canvasId: 'canvas-1',
    });
    await db.nodes.add(note);

    const result = await applyWorkZoneOnDragEnd(
      'note-2',
      { x: 900, y: 900 },
      [agentA, note],
      [zoneA],
    );

    expect(result.cleared).toBe(true);
    const updated = await db.nodes.get('note-2');
    expect(updated?.contextScopeAgentId).toBeUndefined();
  });

  it('first persona into an empty zone claims it', async () => {
    const empty = zone({
      id: 'zone-empty',
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    });
    await db.canvasWorkZones.clear();
    await db.canvasWorkZones.add(empty);
    const result = await applyWorkZoneOnDragEnd(
      'agent-a',
      { x: 40, y: 40 },
      [agentA],
      [empty],
    );
    expect(result.boundZoneId).toBe('zone-empty');
    expect(result.assigned).toBe('agent-a');
    const stored = await db.canvasWorkZones.get('zone-empty');
    expect(stored?.personaNodeId).toBe('agent-a');
  });

  it('blocks another persona from entering a claimed room', async () => {
    const agentB = node({ id: 'agent-b', type: 'agent', x: 900, y: 900, agentConfigId: 'cfg-b', canvasId: 'canvas-1' });
    expect(personaBlockedByForeignWorkZone(agentB, { x: 40, y: 40 }, [zoneA])).toBe(true);
    const result = await applyWorkZoneOnDragEnd(
      'agent-b',
      { x: 40, y: 40 },
      [agentA, agentB],
      [zoneA],
    );
    expect(result.blocked).toBe(true);
  });

  it('does not block a persona when the bound owner card is gone', () => {
    const agentB = node({ id: 'agent-b', type: 'agent', x: 40, y: 40, agentConfigId: 'cfg-b', canvasId: 'canvas-1' });
    expect(personaBlockedByForeignWorkZone(agentB, { x: 40, y: 40 }, [zoneA], [agentB])).toBe(false);
  });

  it('lets a persona claim a room whose owner was deleted', async () => {
    await db.canvasWorkZones.add({ ...zoneA, personaNodeId: 'ghost-ask' });
    const agentB = node({ id: 'agent-b', type: 'agent', x: 40, y: 40, agentConfigId: 'cfg-b', canvasId: 'canvas-1' });
    const result = await applyWorkZoneOnDragEnd('agent-b', { x: 40, y: 40 }, [agentB], [
      { ...zoneA, personaNodeId: 'ghost-ask' },
    ]);
    expect(result.assigned).toBe('agent-b');
    expect((await db.canvasWorkZones.get('zone-a'))?.personaNodeId).toBe('agent-b');
  });

  it('pickPersonaToClaimUnboundZone chooses the earlier occupant', () => {
    const empty = zone({ id: 'zone-empty', x: 0, y: 0, width: 800, height: 600 });
    const ask = node({ id: 'ask-1', type: 'ask', x: 20, y: 20, createdAt: 1, canvasId: 'canvas-1' });
    const later = node({
      id: 'agent-b',
      type: 'agent',
      x: 40,
      y: 40,
      createdAt: 2,
      agentConfigId: 'cfg-b',
      canvasId: 'canvas-1',
    });
    expect(pickPersonaToClaimUnboundZone([later, ask], empty)?.id).toBe('ask-1');
  });
});

describe('releasePersonaBindings', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.canvasWorkZones.clear();
    await db.canvasPersonaThreads.clear();
  });

  it('unbinds the room, deletes the thread, and clears scoped notes', async () => {
    await db.canvasWorkZones.add(
      zone({
        id: 'zone-a',
        personaNodeId: 'ask-1',
        x: 0,
        y: 0,
        width: 400,
        height: 300,
      }),
    );
    await db.canvasPersonaThreads.add({
      id: 'canvas-1:ask-1',
      canvasId: 'canvas-1',
      agentNodeId: 'ask-1',
      messages: [{ id: 'm1', role: 'user', text: 'hi', createdAt: 1 }],
      updatedAt: 1,
    });
    await db.nodes.add(
      node({ id: 'note-1', type: 'note', x: 20, y: 20, canvasId: 'canvas-1', contextScopeAgentId: 'ask-1' }),
    );

    const result = await releasePersonaBindings(['ask-1']);
    expect(result.unboundZoneIds).toEqual(['zone-a']);
    expect(result.deletedThreadIds).toEqual(['canvas-1:ask-1']);
    expect(result.clearedScopeNodeIds).toEqual(['note-1']);
    expect((await db.canvasWorkZones.get('zone-a'))?.personaNodeId).toBeUndefined();
    expect(await db.canvasPersonaThreads.get('canvas-1:ask-1')).toBeUndefined();
    expect((await db.nodes.get('note-1'))?.contextScopeAgentId).toBeUndefined();
  });
});

describe('personaIdForEmptyCanvasClick', () => {
  it('opens the bound persona when clicking inside their room', () => {
    const bound = zone({
      id: 'room',
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      personaNodeId: 'agent-a',
    });
    expect(personaIdForEmptyCanvasClick([bound], { x: 40, y: 40 })).toBe('agent-a');
  });

  it('dismisses chat when clicking empty canvas or an unbound room', () => {
    const empty = zone({ id: 'empty', x: 0, y: 0, width: 400, height: 300 });
    expect(personaIdForEmptyCanvasClick([empty], { x: 40, y: 40 })).toBeNull();
    expect(personaIdForEmptyCanvasClick([empty], { x: 900, y: 900 })).toBeNull();
  });
});
