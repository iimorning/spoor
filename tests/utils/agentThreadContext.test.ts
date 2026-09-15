import { describe, it, expect } from 'vitest';
import {
  collectAiThreadChain,
  formatAgentDiscussionDialogueHistory,
  formatAgentThreadDialogueHistory,
} from '../../src/utils/agentThreadContext';
import type { CanvasNode } from '../../src/db';

describe('agentThreadContext', () => {
  const nodes: CanvasNode[] = [
    {
      id: 'root',
      type: 'ai',
      content: 'A0',
      x: 0,
      y: 0,
      threadRootContextNodeId: 'n1',
      threadAgentConfigId: 'ag1',
    },
    {
      id: 'mid',
      type: 'ai',
      userTurn: 'Q1',
      content: 'A1',
      x: 0,
      y: 1,
      threadRootContextNodeId: 'n1',
      threadAgentConfigId: 'ag1',
    },
    {
      id: 'leaf',
      type: 'ai',
      userTurn: 'Q2',
      content: 'A2',
      x: 0,
      y: 2,
      threadRootContextNodeId: 'n1',
      threadAgentConfigId: 'ag1',
    },
  ];
  const edges = [
    { id: 'e1', from: 'root', to: 'mid' },
    { id: 'e2', from: 'mid', to: 'leaf' },
  ];

  it('collectAiThreadChain 自叶到根仅含 ai 链并时间正序', () => {
    expect(collectAiThreadChain(nodes, edges as any, 'leaf').map((n) => n.id)).toEqual([
      'root',
      'mid',
      'leaf',
    ]);
  });

  it('formatAgentThreadDialogueHistory 首轮仅 Assistant，其后 User/Assistant', () => {
    const chain = collectAiThreadChain(nodes, edges as any, 'leaf');
    const text = formatAgentThreadDialogueHistory(chain);
    expect(text).toContain('Assistant:\nA0');
    expect(text).toContain('User:\nQ1');
    expect(text).toContain('Assistant:\nA1');
    expect(text).toContain('User:\nQ2');
    expect(text).toContain('Assistant:\nA2');
  });

  it('formatAgentDiscussionDialogueHistory labels speakers and user interrupts', () => {
    const discussion: CanvasNode[] = [
      {
        id: 'd0',
        type: 'ai',
        userTurn: 'Weaver',
        content: 'Opening',
        x: 0,
        y: 0,
        threadAgentConfigId: 'weaver',
        threadDiscussionId: 'd',
        threadDiscussionAgentIds: ['atelier', 'weaver'],
        threadDiscussionTurnIndex: 0,
      },
      {
        id: 'd1',
        type: 'ai',
        userTurn: 'Atelier',
        content: 'Reply',
        x: 0,
        y: 1,
        threadAgentConfigId: 'atelier',
        threadDiscussionId: 'd',
        threadDiscussionAgentIds: ['atelier', 'weaver'],
        threadDiscussionTurnIndex: 1,
      },
      {
        id: 'd2',
        type: 'ai',
        userTurn: 'What about the ritual?',
        content: 'Ritual idea',
        x: 0,
        y: 2,
        threadAgentConfigId: 'weaver',
        threadDiscussionId: 'd',
        threadDiscussionAgentIds: ['atelier', 'weaver'],
        threadDiscussionTurnIndex: 2,
      },
    ];
    const names = (id: string) => (id === 'weaver' ? 'Weaver' : 'Atelier');
    const text = formatAgentDiscussionDialogueHistory(discussion, names);
    expect(text).toContain('Weaver:\nOpening');
    expect(text).toContain('Atelier:\nReply');
    expect(text).toContain('User:\nWhat about the ritual?');
    expect(text).toContain('Weaver:\nRitual idea');
  });
});
