import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React, { createRef, useState, type MutableRefObject } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { DraggableNode } from '../../src/components/canvas/DraggableNode';
import { NoteNode } from '../../src/components/nodes/NoteNode';
import { TOUCH_CARD_DRAG_THRESHOLD_PX } from '../../src/hooks/useDraggable';
import type { CanvasNode } from '../../src/db';

/**
 * 核心契约：点便签正文必须进入编辑。
 * 上一轮平板拖卡在 pointerdown 立刻 capture + suppressNextClick，把这条路径掐断了。
 * 本文件同时锁源码形状和 DraggableNode→NoteNode 的真实点击栈。
 */

vi.mock('../../src/utils/uiSfx', () => ({
  playUiSfx: () => undefined,
  preloadUiSfx: () => undefined,
}));

vi.mock('../../src/components/nodes/AgentNode', () => ({
  AgentRunAnalysisButton: () => null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh', changeLanguage: vi.fn() },
  }),
}));

vi.mock('../../src/db', () => ({
  db: { nodes: { update: vi.fn() } },
}));

vi.mock('../../src/config/persistence', () => ({
  isContentBlurPersistenceDisabled: () => false,
}));

vi.mock('lucide-react', () => {
  const names = [
    'Archive', 'Coffee', 'Loader2', 'Plus', 'Send', 'SlidersHorizontal',
    'Sparkles', 'Trash2', 'Wand2',
  ];
  const icons: Record<string, React.FC> = {};
  for (const name of names) {
    icons[name] = (props: Record<string, unknown>) =>
      React.createElement('svg', { 'data-testid': `icon-${name}`, ...props });
  }
  return icons;
});

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) =>
    React.createElement('div', { 'data-testid': 'markdown' }, children),
}));

const root = join(__dirname, '../..');

function readSrc(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

function makeNode(overrides?: Partial<CanvasNode>): CanvasNode {
  return {
    id: 'n1',
    canvasId: 'c1',
    type: 'note',
    content: 'Click to edit me',
    x: 0,
    y: 0,
    ...overrides,
  };
}

function NoteOnCanvas({ layout = 0 }: { layout?: number }) {
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const nodesRef = createRef<Record<string, HTMLElement | null>>();
  nodesRef.current = {};
  return (
    <DraggableNode
      id="n1"
      nodesRef={nodesRef as MutableRefObject<Record<string, HTMLElement | null>>}
      isConnecting={false}
      onLink={vi.fn()}
    >
      <NoteNode
        node={makeNode({ layout })}
        editingNodeId={editingNodeId}
        setEditingNodeId={setEditingNodeId}
      />
    </DraggableNode>
  );
}

function tapPreview(preview: HTMLElement, pointerType: 'mouse' | 'touch', pointerId: number) {
  act(() => {
    fireEvent.pointerDown(preview, {
      button: 0,
      clientX: 10,
      clientY: 10,
      pointerType,
      pointerId,
    });
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId, pointerType }));
  });
  act(() => {
    fireEvent.click(preview);
  });
}

describe('便签点击进入编辑（核心路径安全网）', () => {
  it('NoteBody 预览区必须用 onClick 把 editingNodeId 设成当前便签', () => {
    const src = readSrc('src/components/nodes/note/NoteBody.tsx');
    const viewStart = src.indexOf('key="note-view"');
    const viewEnd = src.indexOf('className=', viewStart);
    const clickHandler = src.slice(viewStart, viewEnd);
    expect(viewStart).toBeGreaterThanOrEqual(0);
    expect(clickHandler).toContain('onClick=');
    expect(clickHandler).toContain('setEditingNodeId(node.id)');
    expect(src).toContain('contentEditable');
  });

  it('useDraggable：鼠标不得在 pointerdown 立刻 armed；capture / 吞 click 只发生在越过 slop 之后', () => {
    const src = readSrc('src/hooks/useDraggable.ts');
    expect(src).not.toMatch(/let armed = !touchLike/);
    expect(src).toMatch(/let armed = false/);

    const moveFn = src.slice(src.indexOf('const onPointerMove'), src.indexOf('const onPointerUp'));
    expect(moveFn).toContain('armed = true');
    expect(moveFn).toContain('capturePointer()');

    const upFn = src.slice(src.indexOf('const onPointerUp'));
    expect(upFn).toMatch(/if\s*\(\s*!armed\s*\)/);
    expect(upFn.indexOf('if (!armed)')).toBeLessThan(upFn.indexOf('suppressNextClick(el)'));
  });

  it.each([0, 1, 4] as const)('layout %i：鼠标轻点便签正文后出现 contentEditable', (layout) => {
    render(<NoteOnCanvas layout={layout} />);
    expect(document.querySelector('[contenteditable="true"]')).toBeNull();

    tapPreview(screen.getByTestId('markdown'), 'mouse', 1);

    const editor = document.querySelector('[contenteditable="true"]');
    expect(editor).toBeTruthy();
    expect(editor).toHaveTextContent('Click to edit me');
  });

  it('触屏轻点（未越过 slop）同样进入编辑', () => {
    render(<NoteOnCanvas />);
    tapPreview(screen.getByTestId('markdown'), 'touch', 7);
    expect(document.querySelector('[contenteditable="true"]')).toBeTruthy();
  });

  it('鼠标拖过 slop 后不会进入编辑（拖卡不应误开编辑）', () => {
    render(<NoteOnCanvas />);
    const preview = screen.getByTestId('markdown');

    act(() => {
      fireEvent.pointerDown(preview, {
        button: 0,
        clientX: 10,
        clientY: 10,
        pointerType: 'mouse',
        pointerId: 1,
      });
      window.dispatchEvent(
        new PointerEvent('pointermove', {
          clientX: 10 + TOUCH_CARD_DRAG_THRESHOLD_PX + 6,
          clientY: 10,
          pointerId: 1,
          pointerType: 'mouse',
        }),
      );
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'mouse' }));
    });
    act(() => {
      fireEvent.click(preview);
    });

    expect(document.querySelector('[contenteditable="true"]')).toBeNull();
  });
});
