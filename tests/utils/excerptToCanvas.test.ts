import { beforeEach, describe, expect, it } from 'vitest';
import { db, type CanvasChatMessage, type CanvasNode } from '../../src/db';
import {
  excerptSearchHitToCanvas,
  excerptToCanvas,
  formatExcerptSourceLabel,
  readChatExcerptDrag,
  writeChatExcerptDrag,
} from '../../src/utils/excerptToCanvas';
import { personaThreadId } from '../../src/utils/agentWorkZone';

function node(
  partial: Partial<CanvasNode> & Pick<CanvasNode, 'id' | 'type' | 'x' | 'y'>,
): CanvasNode {
  return {
    content: '',
    width: 320,
    height: 200,
    canvasId: 'canvas-1',
    ...partial,
  };
}

describe('formatExcerptSourceLabel', () => {
  it('includes agent name and timestamp', () => {
    const message: CanvasChatMessage = {
      id: 'm1',
      role: 'assistant',
      text: 'hello',
      createdAt: new Date('2026-03-08T10:30:00').getTime(),
    };
    const label = formatExcerptSourceLabel('阿狸', message, 'en-US');
    expect(label).toContain('阿狸');
    expect(label).toMatch(/Mar|3|10|30/);
  });
});

describe('chat excerpt drag payload', () => {
  const fakeDt = (initial = ''): DataTransfer => {
    let text = initial;
    return {
      setData: (_type: string, value: string) => {
        text = value;
      },
      getData: () => text,
      effectAllowed: 'none',
    } as DataTransfer;
  };

  it('round-trips through text/plain', () => {
    const dt = fakeDt();
    writeChatExcerptDrag(dt, {
      canvasId: 'canvas-1',
      agentNodeId: 'agent-a',
      threadId: 'canvas-1:agent-a',
      messageId: 'm1',
      text: 'hello',
      role: 'assistant',
    });
    const parsed = readChatExcerptDrag(dt);
    expect(parsed?.messageId).toBe('m1');
    expect(parsed?.text).toBe('hello');
  });

  it('ignores ordinary text', () => {
    expect(readChatExcerptDrag(fakeDt('just a sentence'))).toBeNull();
  });
});

describe('excerptToCanvas', () => {
  const agent = node({ id: 'agent-a', type: 'agent', x: 200, y: 200, agentConfigId: 'cfg' });
  const threadId = personaThreadId('canvas-1', 'agent-a');

  beforeEach(async () => {
    await db.nodes.clear();
    await db.canvasPersonaThreads.clear();
    await db.nodes.add(agent);
    await db.canvasPersonaThreads.add({
      id: threadId,
      canvasId: 'canvas-1',
      agentNodeId: 'agent-a',
      messages: [],
      updatedAt: Date.now(),
    });
  });

  it('creates a scoped note for selection excerpts', async () => {
    const message: CanvasChatMessage = {
      id: 'msg-1',
      role: 'assistant',
      text: 'Full reply text',
      createdAt: Date.now(),
    };
    await db.canvasPersonaThreads.put({
      id: threadId,
      canvasId: 'canvas-1',
      agentNodeId: 'agent-a',
      messages: [message],
      updatedAt: Date.now(),
    });

    const nodeId = await excerptToCanvas({
      canvasId: 'canvas-1',
      agentNodeId: 'agent-a',
      threadId,
      message,
      text: '  selected bit  ',
      kind: 'selection',
      nodes: [agent],
      obstacles: [],
    });

    const created = await db.nodes.get(nodeId);
    expect(created?.type).toBe('note');
    expect(created?.content).toBe('selected bit');
    expect(created?.contextScopeAgentId).toBe('agent-a');
    expect(created?.sourceThreadId).toBe(threadId);
    expect(created?.sourceMessageId).toBe('msg-1');

    const thread = await db.canvasPersonaThreads.get(threadId);
    expect(thread?.messages[0]?.excerptedNodeId).toBe(nodeId);
  });

  it('creates an ai card for full assistant message excerpts', async () => {
    const message: CanvasChatMessage = {
      id: 'msg-2',
      role: 'assistant',
      text: 'Assistant answer',
      createdAt: Date.now(),
    };
    await db.canvasPersonaThreads.put({
      id: threadId,
      canvasId: 'canvas-1',
      agentNodeId: 'agent-a',
      messages: [message],
      updatedAt: Date.now(),
    });

    const nodeId = await excerptToCanvas({
      canvasId: 'canvas-1',
      agentNodeId: 'agent-a',
      threadId,
      message,
      text: 'Assistant answer',
      kind: 'full_message',
      nodes: [agent],
      obstacles: [],
    });

    const created = await db.nodes.get(nodeId);
    expect(created?.type).toBe('ai');
    expect(created?.content).toBe('Assistant answer');
  });

  it('places the card at an explicit drop position', async () => {
    const message: CanvasChatMessage = {
      id: 'msg-pos',
      role: 'assistant',
      text: 'Dropped',
      createdAt: Date.now(),
    };
    await db.canvasPersonaThreads.put({
      id: threadId,
      canvasId: 'canvas-1',
      agentNodeId: 'agent-a',
      messages: [message],
      updatedAt: Date.now(),
    });
    const nodeId = await excerptToCanvas({
      canvasId: 'canvas-1',
      agentNodeId: 'agent-a',
      threadId,
      message,
      text: 'Dropped',
      kind: 'full_message',
      nodes: [agent],
      obstacles: [],
      position: { x: 640, y: 480 },
    });
    const created = await db.nodes.get(nodeId);
    expect(created?.x).toBe(640);
    expect(created?.y).toBe(480);
  });

  it('creates a note for thinking without marking the reply excerpted', async () => {
    const message: CanvasChatMessage = {
      id: 'msg-think',
      role: 'assistant',
      text: 'Visible answer',
      thinkingTrace: 'First weigh the contradiction',
      createdAt: Date.now(),
    };
    await db.canvasPersonaThreads.put({
      id: threadId,
      canvasId: 'canvas-1',
      agentNodeId: 'agent-a',
      messages: [message],
      updatedAt: Date.now(),
    });
    const nodeId = await excerptToCanvas({
      canvasId: 'canvas-1',
      agentNodeId: 'agent-a',
      threadId,
      message,
      text: 'First weigh the contradiction',
      kind: 'thinking',
      nodes: [agent],
      obstacles: [],
    });
    const created = await db.nodes.get(nodeId);
    expect(created?.type).toBe('note');
    expect(created?.content).toBe('First weigh the contradiction');
    const thread = await db.canvasPersonaThreads.get(threadId);
    expect(thread?.messages[0]?.excerptedNodeId).toBeUndefined();
  });

  it('places a webpage search hit as a scoped source note without marking the reply excerpted', async () => {
    const message: CanvasChatMessage = {
      id: 'msg-hit',
      role: 'assistant',
      text: 'Here is what I found.',
      createdAt: Date.now(),
    };
    await db.canvasPersonaThreads.put({
      id: threadId,
      canvasId: 'canvas-1',
      agentNodeId: 'agent-a',
      messages: [message],
      updatedAt: Date.now(),
    });
    const nodeId = await excerptSearchHitToCanvas({
      canvasId: 'canvas-1',
      agentNodeId: 'agent-a',
      threadId,
      message,
      hit: {
        kind: 'webpage',
        query: 'moon',
        title: '月球有多老',
        snippet: '45.1亿年',
        link: 'https://tech.qq.com/a.html',
      },
      nodes: [agent],
      obstacles: [],
    });
    const created = await db.nodes.get(nodeId);
    expect(created?.type).toBe('text');
    expect(created?.layout).toBe(2);
    expect(created?.sourceUrl).toBe('https://tech.qq.com/a.html');
    expect(created?.content).toContain('月球有多老');
    expect(created?.contextScopeAgentId).toBe('agent-a');
    const thread = await db.canvasPersonaThreads.get(threadId);
    expect(thread?.messages[0]?.excerptedNodeId).toBeUndefined();
  });

  it('places an image search hit as an image card', async () => {
    const message: CanvasChatMessage = {
      id: 'msg-img',
      role: 'assistant',
      text: 'Photos',
      createdAt: Date.now(),
    };
    const nodeId = await excerptSearchHitToCanvas({
      canvasId: 'canvas-1',
      agentNodeId: 'agent-a',
      threadId,
      message,
      hit: {
        kind: 'image',
        query: 'cover',
        title: '封面',
        snippet: '',
        imageUrl: 'https://cdn.example/cover.jpg',
        link: 'https://example.com/page',
      },
      nodes: [agent],
      obstacles: [],
    });
    const created = await db.nodes.get(nodeId);
    expect(created?.type).toBe('image');
    expect(created?.content).toBe('https://cdn.example/cover.jpg');
    expect(created?.sourceUrl).toBe('https://example.com/page');
  });

  it('rejects empty excerpts', async () => {
    const message: CanvasChatMessage = {
      id: 'msg-3',
      role: 'user',
      text: 'hi',
      createdAt: Date.now(),
    };

    await expect(
      excerptToCanvas({
        canvasId: 'canvas-1',
        agentNodeId: 'agent-a',
        threadId,
        message,
        text: '   ',
        kind: 'selection',
        nodes: [agent],
        obstacles: [],
      }),
    ).rejects.toThrow('excerpt_empty');
  });
});
