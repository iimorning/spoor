import { describe, expect, it } from 'vitest';

import type { CanvasNode, CanvasWorkZone } from '../../src/db';
import { DEFAULT_NODE_IDS } from '../../src/constants/defaultWorkspace';
import {
  resolveChatReplyDragHandleClientRect,
  resolveOnboardingHighlightRect,
  resolveOnboardingHighlightRects,
  resolveOutsideMaterialDragHandleClientRect,
} from '../../src/onboarding/onboardingHighlight';

const zone: CanvasWorkZone = {
  id: 'zone-1',
  canvasId: 'default',
  personaNodeId: 'ask',
  x: 100,
  y: 100,
  width: 400,
  height: 300,
};

const host = {
  getBoundingClientRect: () => new DOMRect(0, 0, 1200, 800),
} as HTMLElement;

const transform = { x: 0, y: 0, scale: 1 };

function outsideNote(): CanvasNode {
  return {
    id: DEFAULT_NODE_IDS.note,
    canvasId: 'default',
    type: 'note',
    x: 620,
    y: 180,
    width: 280,
    height: 180,
    content: 'note',
  };
}

describe('onboardingHighlight', () => {
  it('highlights the drag handle on outside starter materials', () => {
    const nodes = [outsideNote()];
    const nodesRef = { current: {} as Record<string, HTMLElement | null> };
    const root = document.createElement('div');
    const handle = document.createElement('button');
    handle.dataset.testid = 'node-drag-handle';
    root.appendChild(handle);
    root.getBoundingClientRect = () => new DOMRect(620, 180, 280, 180);
    handle.getBoundingClientRect = () => new DOMRect(626, 186, 16, 16);
    nodesRef.current[nodes[0]!.id] = root;

    const rect = resolveOutsideMaterialDragHandleClientRect({
      host,
      transform,
      workZone: zone,
      nodes,
      nodesRef,
    });

    expect(rect?.left).toBe(620);
    expect(rect?.top).toBe(180);
    expect(rect?.width).toBe(28);
    expect(rect?.height).toBe(28);
  });

  it('uses outside-material-handle mode for step 2 cutouts', () => {
    const rects = resolveOnboardingHighlightRects(
      {
        id: 'move-material',
        targetTestId: 'canvas-workspace-host',
        highlight: 'work-zone-and-outside',
        copy: { titleKey: 'a', bodyKey: 'b' },
      },
      {
        host,
        transform,
        workZone: zone,
        nodes: [outsideNote()],
      },
    );

    expect(rects).toHaveLength(2);
  });

  it('highlights the chat reply drag handle on step 4', () => {
    const panel = document.createElement('div');
    panel.dataset.testid = 'canvas-chat-panel';
    const handle = document.createElement('button');
    handle.dataset.testid = 'chat-reply-drag-handle';
    panel.appendChild(handle);
    document.body.appendChild(panel);
    handle.getBoundingClientRect = () => new DOMRect(100, 200, 16, 16);

    const rect = resolveChatReplyDragHandleClientRect();
    expect(rect?.left).toBe(92);
    expect(rect?.top).toBe(192);

    panel.remove();
  });
});
