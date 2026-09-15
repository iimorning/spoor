import { describe, it, expect } from 'vitest';
import {
  ASK_DISCUSSION_SPEAKER_ID,
  canStartAgentDiscussion,
  DISCUSSION_MAX_SPEAKERS,
  DISCUSSION_TURN_COUNT,
  findDiscussionHubAgentId,
  isAgentDiscussionLeaf,
  isDiscussionLinkEdge,
  nextDiscussionSpeakerId,
  resolveAgentDiscussionParticipants,
} from '../../src/utils/agentDiscussion';
import type { CanvasNode, Edge } from '../../src/db';

describe('agentDiscussion', () => {
  const nodes: CanvasNode[] = [
    { id: 'hub', type: 'agent', agentConfigId: 'cosmos_weaver', x: 0, y: 0 },
    { id: 'peer', type: 'agent', agentConfigId: 'character_atelier', x: 1, y: 0 },
    { id: 'extra', type: 'agent', agentConfigId: 'interviewer', x: 2, y: 0 },
    { id: 'spare', type: 'agent', agentConfigId: 'futurist', x: 3, y: 0 },
    { id: 'note', type: 'note', content: 'My pain is …', x: 0, y: 1 },
    { id: 'empty', type: 'note', content: '   ', x: 0, y: 2 },
    { id: 'ask', type: 'ask', content: '', x: 4, y: 0 },
  ];

  it('exports fixed turn count and max speakers', () => {
    expect(DISCUSSION_TURN_COUNT).toBe(2);
    expect(DISCUSSION_MAX_SPEAKERS).toBe(3);
  });

  it('resolves hub + peer agents and a non-empty context note', () => {
    const edges: Edge[] = [
      { id: 'e1', from: 'hub', to: 'note' },
      { id: 'e2', from: 'hub', to: 'peer' },
    ];
    const text = (id: string) => (id === 'note' ? 'Hello world' : '');
    const r = resolveAgentDiscussionParticipants('hub', nodes, edges, text);
    expect(r).not.toBeNull();
    expect(r!.contextNodeId).toBe('note');
    expect(r!.speakerAgentConfigIds).toEqual(['character_atelier', 'cosmos_weaver']);
    expect(canStartAgentDiscussion('hub', nodes, edges, text)).toBe(true);
  });

  it('returns null without a peer agent', () => {
    const edges: Edge[] = [{ id: 'e1', from: 'hub', to: 'note' }];
    const text = () => 'ctx';
    expect(resolveAgentDiscussionParticipants('hub', nodes, edges, text)).toBeNull();
    expect(canStartAgentDiscussion('hub', nodes, edges, text)).toBe(false);
  });

  it('counts 阿狸 as a discussion peer of a persona card', () => {
    const edges: Edge[] = [
      { id: 'e1', from: 'hub', to: 'note' },
      { id: 'e2', from: 'hub', to: 'ask' },
    ];
    const r = resolveAgentDiscussionParticipants('hub', nodes, edges, () => 'ctx');
    expect(r).not.toBeNull();
    expect(r!.speakerAgentConfigIds).toEqual(['cosmos_weaver', ASK_DISCUSSION_SPEAKER_ID].sort());
    expect(canStartAgentDiscussion('hub', nodes, edges, () => 'ctx')).toBe(true);
  });

  it('isDiscussionLinkEdge is true for agent↔agent and ask↔agent', () => {
    expect(isDiscussionLinkEdge('agent', 'agent')).toBe(true);
    expect(isDiscussionLinkEdge('ask', 'agent')).toBe(true);
    expect(isDiscussionLinkEdge('agent', 'ask')).toBe(true);
    expect(isDiscussionLinkEdge('ask', 'ask')).toBe(false);
    expect(isDiscussionLinkEdge('agent', 'note')).toBe(false);
  });

  it('returns null when context note is empty', () => {
    const edges: Edge[] = [
      { id: 'e1', from: 'hub', to: 'empty' },
      { id: 'e2', from: 'hub', to: 'peer' },
    ];
    expect(resolveAgentDiscussionParticipants('hub', nodes, edges, () => '')).toBeNull();
  });

  it('caps speakers at DISCUSSION_MAX_SPEAKERS', () => {
    const edges: Edge[] = [
      { id: 'e1', from: 'hub', to: 'note' },
      { id: 'e2', from: 'hub', to: 'peer' },
      { id: 'e3', from: 'hub', to: 'extra' },
      { id: 'e4', from: 'hub', to: 'spare' },
    ];
    const r = resolveAgentDiscussionParticipants('hub', nodes, edges, () => 'ctx');
    expect(r!.speakerAgentConfigIds).toHaveLength(3);
  });

  it('nextDiscussionSpeakerId round-robins', () => {
    const ids = ['a', 'b'];
    expect(nextDiscussionSpeakerId(ids, 0)).toBe('b');
    expect(nextDiscussionSpeakerId(ids, 1)).toBe('a');
    expect(nextDiscussionSpeakerId(ids, 3)).toBe('a');
  });

  it('isAgentDiscussionLeaf is true only for the latest finished discussion card', () => {
    const discussionNodes: CanvasNode[] = [
      {
        id: 'ai-a',
        type: 'ai',
        x: 0,
        y: 0,
        content: 'first',
        threadDiscussionId: 'd1',
        threadDiscussionAgentIds: ['a', 'b'],
      },
      {
        id: 'ai-b',
        type: 'ai',
        x: 0,
        y: 1,
        content: 'second',
        threadDiscussionId: 'd1',
        threadDiscussionAgentIds: ['a', 'b'],
      },
      { id: 'plain', type: 'ai', x: 0, y: 2, content: 'not discussion' },
    ];
    const discussionEdges: Edge[] = [
      { id: 'e1', from: 'ai-a', to: 'ai-b' },
    ];
    expect(isAgentDiscussionLeaf('ai-b', discussionNodes, discussionEdges)).toBe(true);
    expect(isAgentDiscussionLeaf('ai-a', discussionNodes, discussionEdges)).toBe(false);
    expect(isAgentDiscussionLeaf('plain', discussionNodes, discussionEdges)).toBe(false);
    expect(
      isAgentDiscussionLeaf(
        'ai-b',
        discussionNodes.map((n) => (n.id === 'ai-b' ? { ...n, content: '' } : n)),
        discussionEdges,
      ),
    ).toBe(false);
  });

  it('findDiscussionHubAgentId walks from the first AI card to the agent hub', () => {
    const chain: CanvasNode[] = [
      { id: 'ai-a', type: 'ai', x: 0, y: 0, content: 'first' },
      { id: 'ai-b', type: 'ai', x: 0, y: 1, content: 'second' },
    ];
    const graphNodes: CanvasNode[] = [
      { id: 'hub', type: 'agent', agentConfigId: 'cosmos_weaver', x: 0, y: 0 },
      ...chain,
    ];
    const graphEdges: Edge[] = [
      { id: 'e0', from: 'hub', to: 'ai-a' },
      { id: 'e1', from: 'ai-a', to: 'ai-b' },
    ];
    expect(findDiscussionHubAgentId(chain, graphNodes, graphEdges)).toBe('hub');
  });
});
