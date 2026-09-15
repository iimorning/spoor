import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import React, { createRef } from 'react';
import { CanvasEdgeLines } from '../../src/components/canvas/CanvasEdgeLines';
import type { CanvasNode, Edge } from '../../src/db';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'canvas.edge_note_add': 'Add link note',
        'canvas.edge_note_placeholder': 'Why linked?',
        'canvas.edge_note_aria': 'Edit link note',
        'nodes.agent_start_discussion': 'Start a discussion with linked agents',
        'nodes.agent_discussion_disconnect': 'Disconnect',
      }[key] ?? key),
  }),
}));

const updateMock = vi.fn();
vi.mock('../../src/db', async () => {
  const actual = await vi.importActual<typeof import('../../src/db')>('../../src/db');
  return {
    ...actual,
    db: {
      ...actual.db,
      edges: {
        ...actual.db.edges,
        update: (...args: unknown[]) => updateMock(...args),
      },
    },
  };
});

describe('CanvasEdgeLines', () => {
  const defaultProps = {
    edges: [] as Edge[],
    nodes: [] as CanvasNode[],
    connectingFrom: null as string | null,
    svgRef: createRef<SVGSVGElement>(),
    edgeLabelsRef: createRef<HTMLDivElement>(),
    hoveredEdgeId: null as string | null,
    setHoveredEdgeId: vi.fn(),
    deleteEdge: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('无 edges 时只渲染 temp-edge', () => {
    const { container } = render(<CanvasEdgeLines {...defaultProps} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    const tempEdge = container.querySelector('#temp-edge');
    expect(tempEdge).toBeInTheDocument();
    const groups = container.querySelectorAll('g[data-edge-id]');
    expect(groups.length).toBe(0);
  });

  it('渲染正确数量的 edge groups', () => {
    const edges = [
      { id: 'e1', from: 'a', to: 'b' },
      { id: 'e2', from: 'c', to: 'd' },
    ] as Edge[];

    const { container } = render(<CanvasEdgeLines {...defaultProps} edges={edges} />);
    const groups = container.querySelectorAll('g[data-edge-id]');
    expect(groups.length).toBe(2);
    expect(container.querySelector('[data-edge-from="a"]')).toBeInTheDocument();
    expect(container.querySelector('[data-edge-from="c"]')).toBeInTheDocument();
  });

  it('每个 edge group 渲染 2 条线（视觉线 + hit area）', () => {
    const edges = [{ id: 'e1', from: 'a', to: 'b' }] as Edge[];
    const { container } = render(<CanvasEdgeLines {...defaultProps} edges={edges} />);
    const lines = container.querySelectorAll('g[data-edge-id="e1"] line');
    expect(lines.length).toBe(2);
  });

  it('hovered edge 对应的删除按钮可见', () => {
    const edges = [{ id: 'e1', from: 'a', to: 'b' }] as Edge[];
    const { container } = render(
      <CanvasEdgeLines {...defaultProps} edges={edges} hoveredEdgeId="e1" />
    );
    const btn = container.querySelector('[data-edge-btn="e1"]');
    expect(btn).toHaveClass('opacity-100');
  });

  it('非 hovered edge 对应的删除按钮不可见', () => {
    const edges = [{ id: 'e1', from: 'a', to: 'b' }] as Edge[];
    const { container } = render(
      <CanvasEdgeLines {...defaultProps} edges={edges} hoveredEdgeId={null} />
    );
    const btn = container.querySelector('[data-edge-btn="e1"]');
    expect(btn).toHaveClass('opacity-0');
  });

  it('connectingFrom 存在时 temp-edge 可见', () => {
    const { container } = render(
      <CanvasEdgeLines {...defaultProps} connectingFrom="node-a" />
    );
    const tempEdge = container.querySelector('#temp-edge') as SVGLineElement;
    expect(tempEdge.style.display).toBe('block');
  });

  it('connectingFrom 为 null 时 temp-edge 隐藏', () => {
    const { container } = render(
      <CanvasEdgeLines {...defaultProps} connectingFrom={null} />
    );
    const tempEdge = container.querySelector('#temp-edge') as SVGLineElement;
    expect(tempEdge.style.display).toBe('none');
  });

  it('点击删除按钮调用 deleteEdge', () => {
    const deleteEdge = vi.fn();
    const edges = [{ id: 'e1', from: 'a', to: 'b' }] as Edge[];
    const { container } = render(
      <CanvasEdgeLines {...defaultProps} edges={edges} hoveredEdgeId="e1" deleteEdge={deleteEdge} />
    );
    const btn = container.querySelector('[data-edge-btn="e1"]')!;
    fireEvent.pointerDown(btn);
    expect(deleteEdge).toHaveBeenCalledWith('e1');
  });

  it('有备注时在中点显示备注文本', () => {
    const edges = [{ id: 'e1', from: 'a', to: 'b', note: '因果对比' }] as Edge[];
    render(<CanvasEdgeLines {...defaultProps} edges={edges} hoveredEdgeId="e1" />);
    expect(screen.getByTestId('edge-note-chip-e1')).toHaveTextContent('因果对比');
  });

  it('点击备注可编辑并在 Enter 时写入 db', () => {
    const edges = [{ id: 'e1', from: 'a', to: 'b', note: '旧备注' }] as Edge[];
    render(<CanvasEdgeLines {...defaultProps} edges={edges} hoveredEdgeId="e1" />);
    fireEvent.click(screen.getByTestId('edge-note-chip-e1'));
    const input = screen.getByTestId('edge-note-input-e1');
    fireEvent.change(input, { target: { value: '新备注' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(updateMock).toHaveBeenCalledWith('e1', { note: '新备注' });
  });

  it('编辑时隐藏删除按钮', () => {
    const edges = [{ id: 'e1', from: 'a', to: 'b', note: '备注' }] as Edge[];
    const { container } = render(
      <CanvasEdgeLines {...defaultProps} edges={edges} hoveredEdgeId="e1" />,
    );
    fireEvent.click(screen.getByTestId('edge-note-chip-e1'));
    const btn = container.querySelector('[data-edge-btn="e1"]');
    expect(btn).toHaveClass('opacity-0');
    expect(btn).toHaveClass('pointer-events-none');
  });

  it('marks agent-to-agent edges as flowing and leaves stroke to CSS', () => {
    const nodes: CanvasNode[] = [
      { id: 'a', type: 'agent', x: 0, y: 0 },
      { id: 'b', type: 'agent', x: 10, y: 10 },
      { id: 'n', type: 'note', x: 0, y: 0 },
    ];
    const { container } = render(
      <CanvasEdgeLines
        {...defaultProps}
        nodes={nodes}
        edges={[
          { id: 'e-agent', from: 'a', to: 'b' },
          { id: 'e-note', from: 'a', to: 'n' },
        ]}
      />,
    );
    expect(container.querySelector('g[data-edge-id="e-agent"]')).toHaveAttribute('data-edge-flowing', '1');
    expect(container.querySelector('g[data-edge-id="e-note"]')).not.toHaveAttribute('data-edge-flowing');
    const visual = container.querySelector('g[data-edge-id="e-agent"] .node-connector') as SVGLineElement;
    expect(visual.style.stroke).toBe('');
  });

  it('marks 阿狸-to-agent edges as flowing', () => {
    const nodes: CanvasNode[] = [
      { id: 'ask', type: 'ask', x: 0, y: 0 },
      { id: 'agent', type: 'agent', x: 10, y: 10 },
    ];
    const { container } = render(
      <CanvasEdgeLines
        {...defaultProps}
        nodes={nodes}
        onStartAgentDiscussion={vi.fn()}
        edges={[{ id: 'e-ask', from: 'ask', to: 'agent' }]}
      />,
    );
    expect(container.querySelector('g[data-edge-id="e-ask"]')).toHaveAttribute('data-edge-flowing', '1');
    expect(container.querySelector('[data-edge-discuss-cluster="e-ask"]')).toBeInTheDocument();
  });

  it('discussion close sits beside the discuss button and stays hidden until hover', () => {
    const deleteEdge = vi.fn();
    const nodes: CanvasNode[] = [
      { id: 'a', type: 'agent', x: 0, y: 0 },
      { id: 'b', type: 'agent', x: 10, y: 10 },
    ];
    const { container } = render(
      <CanvasEdgeLines
        {...defaultProps}
        nodes={nodes}
        deleteEdge={deleteEdge}
        onStartAgentDiscussion={vi.fn()}
        edges={[{ id: 'e1', from: 'a', to: 'b' }]}
      />,
    );
    const cluster = container.querySelector('[data-edge-discuss-cluster="e1"]');
    const close = screen.getByTestId('edge-discuss-close-e1');
    expect(cluster).toHaveClass('flex');
    expect(close).toHaveClass('opacity-0');
    expect(close).toHaveClass('group-hover:opacity-100');
    expect(close.className).not.toMatch(/-top-1/);
    fireEvent.pointerDown(close);
    expect(deleteEdge).toHaveBeenCalledWith('e1');
  });
});
