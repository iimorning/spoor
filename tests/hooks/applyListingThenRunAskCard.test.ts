import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRef, useState } from 'react';
import { useAiActions } from '../../src/hooks/useAiActions';
import { db } from '../../src/db';
import { applyCommunityListing } from '../../src/utils/applyCommunityListing';
import { stampNewCard } from '../../src/utils/stampNewCard';
import type { AIConfig } from '../../src/components/AISettingsModal';
import type { AgentConfig } from '../../src/db';
import type { CommunityListing } from '../../src/services/community';
import { OFFICIAL_TURTLE_SOUP_ID } from '../../src/constants/officialCommunityListings';

vi.mock('../../src/services/ai', () => ({
  callUniversalAI: vi.fn().mockResolvedValue('mock ai reply'),
  formatAiError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  maskApiKeyForLog: (k: string) => (k ? `${k.slice(0, 2)}…` : ''),
}));
vi.mock('../../src/services/search', () => ({
  metasoSearch: vi.fn().mockResolvedValue({ credits: 0, total: 0, webpages: [] }),
  buildSearchContext: vi.fn(),
}));
vi.mock('../../src/services/flux302', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/flux302')>();
  return {
    ...actual,
    generateGptImage2: vi.fn(async () => ({ url: 'https://img.example/cover.jpg' })),
  };
});
// 回复之后还有一次"相关问题"的请求（1e80cf6 加的），走的是同一个 callUniversalAI，
// 会把本文件按次数断言的用例算成两次。隔离掉，让调用次数只统计回复本身
// —— 同目录 useAiActions.test.ts 在加这个功能时就做了同样的隔离。
vi.mock('../../src/utils/suggestedFollowUps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/utils/suggestedFollowUps')>()),
  attachSuggestedFollowUpsToThreadMessage: vi.fn(async () => {}),
}));

import { callUniversalAI } from '../../src/services/ai';

const baseAiConfig: AIConfig = {
  provider: 'gemini',
  apiKey: 'test',
  baseUrl: '',
  model: 'gemini-1.5-flash',
  metasoApiKey: 'metaso-k',
};

const turtleSoupListing: CommunityListing = {
  id: OFFICIAL_TURTLE_SOUP_ID,
  author_id: '00000000-0000-0000-0000-000000000001',
  author_name: 'Spoor',
  kind: 'canvas',
  title: '海龟汤：情境推理',
  description: '一个人设就能玩。',
  cover_url: null,
  is_official: true,
  payload: {
    version: 1,
    kind: 'canvas',
    template: {
      id: 'official:turtle-soup-template',
      name: '海龟汤：情境推理',
      description: '一个人设就能玩。',
      origin: 'user',
      builtinKey: null,
      listed: true,
      personaIds: ['turtle_soup_host'],
      nodes: [
        { key: 'note-start', type: 'note', contentText: '开始一局海龟汤。出一道原创题。', xFrac: 0.066, yFrac: 0.55, wFrac: 0.283, hFrac: 0.1875 },
        { key: 'agent-host', type: 'agent', agentConfigId: 'turtle_soup_host', xFrac: 0.466, yFrac: 0.3125 },
        { key: 'ask', type: 'ask', xFrac: 0.716, yFrac: 0.1125, wFrac: 0.25, hFrac: 0.2375 },
      ],
      edges: [{ fromKey: 'note-start', toKey: 'agent-host', noteText: '运行主持人 → 开局' }],
      createdAt: 0,
      updatedAt: 0,
    },
    agents: [
      { id: 'turtle_soup_host', name: '海龟汤主持人', role: '情境推理主持', prompt: '主持海龟汤游戏', temperature: 0.85, creativity: 0.75 },
    ],
  },
  published: true,
  like_count: 0,
  favorite_count: 0,
  comment_count: 0,
  apply_count: 0,
  created_at: new Date().toISOString(),
};

function useHookWithLiveDb(activeCanvasId: string, dynamicNodes: any[], edges: any[], agentConfigs: AgentConfig[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const nodesRef = useRef<Record<string, HTMLElement | null>>({});
  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  return useAiActions({
    aiConfig: baseAiConfig,
    agentConfigs,
    activeCanvasId,
    nodesRef: nodesRef as any,
    transformRef: transformRef as any,
    dynamicNodes,
    edges,
    selectedNodes: selected,
    setSelectedNodes: setSelected,
  });
}

describe('applyCommunityListing + runAskCardGeneration end-to-end', () => {
  beforeEach(async () => {
    await db.agents.clear();
    await db.canvases.clear();
    await db.nodes.clear();
    await db.edges.clear();
    await db.canvasTemplates.clear();
    localStorage.removeItem('active_canvas_id');
    vi.mocked(callUniversalAI).mockClear();
    vi.mocked(callUniversalAI).mockResolvedValue('mock ai reply');
  });

  it('unwired Ask card on a 海龟汤 canvas stays 阿狸', async () => {
    const canvasId = await applyCommunityListing(turtleSoupListing);
    const dbAgents = await db.agents.toArray();
    const askId = 'ask-runtime-3';
    await db.nodes.add(
      stampNewCard({
        id: askId,
        canvasId,
        type: 'ask',
        content: '',
        x: 100,
        y: 100,
        width: 280,
        height: 200,
      }),
    );
    const liveDbNodes = await db.nodes.where('canvasId').equals(canvasId).toArray();
    const liveDbEdges = await db.edges.where('canvasId').equals(canvasId).toArray();

    const { result } = renderHook(() =>
      useHookWithLiveDb(canvasId, liveDbNodes, liveDbEdges, dbAgents),
    );
    await act(async () => {
      await result.current.runAskCardGeneration(askId, '开局来一道');
    });
    expect(vi.mocked(callUniversalAI)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(callUniversalAI).mock.calls[0]![0] as { systemInstruction?: string };
    expect(call.systemInstruction).toMatch(/Your name is 阿狸/);
    expect(call.systemInstruction).not.toMatch(/主持海龟汤游戏/);
  });
});