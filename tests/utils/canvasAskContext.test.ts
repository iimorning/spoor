import { describe, it, expect } from 'vitest';
import type { AgentConfig, CanvasNode } from '../../src/db';
import {
  coerceToolbarVoicePin,
  collectReachableAskIds,
  listCanvasVoicePersonas,
  readStoredVoicePin,
  resolveToolbarVoiceThreadRoot,
  shouldClearVoicePin,
  voicePinStorageKey,
  writeStoredVoicePin,
} from '../../src/utils/canvasAskContext';

describe('collectReachableAskIds', () => {
  it('walks undirected edges and excludes the start node', () => {
    const edges = [
      { id: 'e1', canvasId: 'c1', from: 'ask', to: 'n1' },
      { id: 'e2', canvasId: 'c1', from: 'n1', to: 'n2' },
    ];
    expect([...collectReachableAskIds('ask', edges)].sort()).toEqual(['n1', 'n2']);
  });
});

describe('listCanvasVoicePersonas', () => {
  it('returns canvas agent cards in reading order and skips orphans', () => {
    const turtle: AgentConfig = {
      id: 'turtle_soup_host',
      name: '海龟汤主持人',
      role: '',
      prompt: '',
    };
    const pump: AgentConfig = {
      id: 'intuition_pump_expert',
      name: '直觉泵专家',
      role: '',
      prompt: '',
      coverImageUrl: 'https://img.example/pump.png',
    };
    const nodes: CanvasNode[] = [
      { id: 'ask1', type: 'ask', x: 0, y: 0, canvasId: 'c1' },
      { id: 'lower', type: 'agent', agentConfigId: 'turtle_soup_host', x: 0, y: 80, canvasId: 'c1' },
      { id: 'upper', type: 'agent', agentConfigId: 'intuition_pump_expert', x: 40, y: 10, canvasId: 'c1' },
      { id: 'ghost', type: 'agent', agentConfigId: 'deleted', x: 0, y: 0, canvasId: 'c1' },
    ];
    expect(listCanvasVoicePersonas(nodes, [turtle, pump])).toEqual([
      {
        nodeId: 'upper',
        agentConfigId: 'intuition_pump_expert',
        name: '直觉泵专家',
        coverUrl: 'https://img.example/pump.png',
      },
      {
        nodeId: 'lower',
        agentConfigId: 'turtle_soup_host',
        name: '海龟汤主持人',
        coverUrl: undefined,
      },
    ]);
  });

  it('resolveToolbarVoiceThreadRoot pins the agent card, otherwise the Ask card', () => {
    const nodes: CanvasNode[] = [
      { id: 'ask1', type: 'ask', x: 0, y: 0, canvasId: 'c1' },
      { id: 'host1', type: 'agent', agentConfigId: 'turtle_soup_host', x: 10, y: 10, canvasId: 'c1' },
    ];
    expect(resolveToolbarVoiceThreadRoot('host1', nodes)).toEqual({
      rootId: 'host1',
      needsAskCard: false,
    });
    expect(resolveToolbarVoiceThreadRoot(null, nodes)).toEqual({
      rootId: 'ask1',
      needsAskCard: false,
    });
    expect(resolveToolbarVoiceThreadRoot(null, [nodes[1]!])).toEqual({
      rootId: 'host1',
      needsAskCard: false,
    });
    expect(resolveToolbarVoiceThreadRoot('gone', nodes)).toEqual({
      rootId: 'ask1',
      needsAskCard: false,
    });
    expect(resolveToolbarVoiceThreadRoot(null, [])).toEqual({
      rootId: null,
      needsAskCard: true,
    });
  });

  it('coerceToolbarVoicePin keeps Ali only when an Ask card exists', () => {
    const host = { id: 'host1', type: 'agent' as const, agentConfigId: 'turtle', x: 0, y: 0, canvasId: 'c1' };
    const ask = { id: 'ask1', type: 'ask' as const, x: 0, y: 0, canvasId: 'c1' };
    const personas = [{ nodeId: 'host1', agentConfigId: 'turtle', name: '海龟汤主持人' }];
    expect(coerceToolbarVoicePin(null, undefined, personas)).toBeNull();
    expect(coerceToolbarVoicePin(null, [host], personas)).toBe('host1');
    expect(coerceToolbarVoicePin(null, [host, ask], personas)).toBeNull();
    expect(coerceToolbarVoicePin('host1', [host], personas)).toBe('host1');
    expect(coerceToolbarVoicePin(null, [], [])).toBeNull();
  });

  it('shouldClearVoicePin keeps the pin while Dexie nodes are still loading', () => {
    expect(shouldClearVoicePin('host1', undefined)).toBe(false);
    expect(shouldClearVoicePin(null, [])).toBe(false);
    expect(shouldClearVoicePin('host1', [{ id: 'host1', type: 'agent', x: 0, y: 0, canvasId: 'c1' }])).toBe(false);
    expect(shouldClearVoicePin('host1', [{ id: 'ask1', type: 'ask', x: 0, y: 0, canvasId: 'c1' }])).toBe(true);
    expect(shouldClearVoicePin('host1', [])).toBe(true);
  });

  it('stores the toolbar voice pin per canvas', () => {
    sessionStorage.removeItem(voicePinStorageKey('c1'));
    sessionStorage.removeItem(voicePinStorageKey('c2'));
    writeStoredVoicePin('c1', 'host1');
    expect(readStoredVoicePin('c1')).toBe('host1');
    expect(readStoredVoicePin('c2')).toBeNull();
    writeStoredVoicePin('c1', null);
    expect(readStoredVoicePin('c1')).toBeNull();
  });
});
