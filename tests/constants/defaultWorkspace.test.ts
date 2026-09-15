import { describe, it, expect } from 'vitest';
import {
  buildDefaultWorkspace,
  DEFAULT_NODE_IDS,
  DEFAULT_WORKSPACE_COL_GAP,
  defaultWorkspaceAmbiencePosition,
  isLegacyLShapeDefaultLayout,
  LEGACY_L_SHAPE_DEFAULT_POSITIONS,
  OFFICIAL_DEFAULT_STARTER_NODE_IDS,
} from '../../src/constants/defaultWorkspace';
import { ASK_NODE_SIZE, DEFAULT_NODE_SIZE } from '../../src/utils/canvas';

describe('buildDefaultWorkspace', () => {
  const { nodes, edges } = buildDefaultWorkspace({
    canvasId: 'default',
    themeContent: 'Core Theme',
    noteContent: 'Note placeholder',
  });

  it('places an ask card (阿狸), a theme card, and a note card on the default canvas', () => {
    expect(nodes.map((n) => n.id).sort()).toEqual(
      [DEFAULT_NODE_IDS.theme, DEFAULT_NODE_IDS.ask, DEFAULT_NODE_IDS.note].sort(),
    );

    const ask = nodes.find((n) => n.id === DEFAULT_NODE_IDS.ask)!;
    const theme = nodes.find((n) => n.id === DEFAULT_NODE_IDS.theme)!;
    const note = nodes.find((n) => n.id === DEFAULT_NODE_IDS.note)!;

    expect(ask.type).toBe('ask');
    expect(theme.type).toBe('theme');
    expect(note.type).toBe('note');

    expect(ask.width).toBe(ASK_NODE_SIZE.width);
    expect(ask.height).toBe(ASK_NODE_SIZE.height);
    expect(theme.width).toBe(DEFAULT_NODE_SIZE.width);
    expect(note.width).toBe(DEFAULT_NODE_SIZE.width);
  });

  it('lays out 阿狸 → 主题 → 便签 in one horizontal row with clear gaps', () => {
    const ask = nodes.find((n) => n.id === DEFAULT_NODE_IDS.ask)!;
    const theme = nodes.find((n) => n.id === DEFAULT_NODE_IDS.theme)!;
    const note = nodes.find((n) => n.id === DEFAULT_NODE_IDS.note)!;

    expect(theme.x).toBe(ask.x! + (ask.width ?? 0) + DEFAULT_WORKSPACE_COL_GAP);
    expect(note.x).toBe(theme.x! + (theme.width ?? 0) + DEFAULT_WORKSPACE_COL_GAP);
    expect(ask.y).toBe(theme.y);
    expect(note.y).toBe(ask.y);
    // No vertical stacking — keeps starters clear of the bottom-left ambience fixture.
    expect(note.y! + (note.height ?? 0)).toBeLessThan(360);
  });

  it('fills theme + note content from caller-supplied text', () => {
    const theme = nodes.find((n) => n.id === DEFAULT_NODE_IDS.theme)!;
    const note = nodes.find((n) => n.id === DEFAULT_NODE_IDS.note)!;
    expect(theme.content).toBe('Core Theme');
    expect(note.content).toBe('Note placeholder');
  });

  it('emits no edges (let the user wire them up)', () => {
    expect(edges).toEqual([]);
  });

  it('registers every new id in the official default starter set', () => {
    for (const id of Object.values(DEFAULT_NODE_IDS)) {
      expect(OFFICIAL_DEFAULT_STARTER_NODE_IDS.has(id)).toBe(true);
    }
  });

  it('accepts caller ids so extra canvases do not reuse default-* keys', () => {
    const ids = { theme: 'c-theme', ask: 'c-ask', note: 'c-note' };
    const { nodes } = buildDefaultWorkspace({
      canvasId: 'other',
      themeContent: 'Core Theme',
      noteContent: 'Note placeholder',
      ids,
    });
    expect(nodes.map((n) => n.id).sort()).toEqual(['c-ask', 'c-note', 'c-theme']);
    expect(nodes.every((n) => n.canvasId === 'other')).toBe(true);
    const ask = nodes.find((n) => n.id === 'c-ask')!;
    const theme = nodes.find((n) => n.id === 'c-theme')!;
    expect(theme.x).toBe(ask.x! + (ask.width ?? 0) + DEFAULT_WORKSPACE_COL_GAP);
    const note = nodes.find((n) => n.id === 'c-note')!;
    expect(note.x).toBe(theme.x! + (theme.width ?? 0) + DEFAULT_WORKSPACE_COL_GAP);
  });

  it('detects the legacy L-shape starter coords', () => {
    expect(
      isLegacyLShapeDefaultLayout([
        { id: DEFAULT_NODE_IDS.ask, ...LEGACY_L_SHAPE_DEFAULT_POSITIONS.ask },
        { id: DEFAULT_NODE_IDS.theme, ...LEGACY_L_SHAPE_DEFAULT_POSITIONS.theme },
        { id: DEFAULT_NODE_IDS.note, ...LEGACY_L_SHAPE_DEFAULT_POSITIONS.note },
      ]),
    ).toBe(true);
    expect(
      isLegacyLShapeDefaultLayout([
        { id: DEFAULT_NODE_IDS.ask, x: 100, y: 140 },
        { id: DEFAULT_NODE_IDS.theme, x: 500, y: 140 },
        { id: DEFAULT_NODE_IDS.note, x: 900, y: 140 },
      ]),
    ).toBe(false);
  });

  it('places ambience below the starter row', () => {
    const { nodes } = buildDefaultWorkspace({
      canvasId: 'default',
      themeContent: 'Core Theme',
      noteContent: 'Note placeholder',
    });
    const bottom = Math.max(
      ...nodes.map((n) => (n.y ?? 0) + (n.height ?? 0)),
    );
    const amb = defaultWorkspaceAmbiencePosition();
    expect(amb.y).toBeGreaterThanOrEqual(bottom + DEFAULT_WORKSPACE_COL_GAP);
    expect(amb.x).toBe(nodes.find((n) => n.type === 'ask')!.x);
  });
});
