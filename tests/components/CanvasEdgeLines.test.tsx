import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
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
    connectingFrom: null as string | null,
    svgRef: createRef<SVGSVGElement>(),
    edgeLabelsRef: createRef<HTMLDivElement>(),
    deleteEdge: vi.fn(),
  };

  /** 悬停由组件自己管（悬停态上提会让整张画布重渲染），所以测试直接事件驱动。 */
  const hoverEdge = (container: HTMLElement, edgeId: string) => {
    const group = container.querySelector(`g[data-edge-id="${edgeId}"]`);
    if (!group) throw new Error(`no edge group ${edgeId}`);
    fireEvent.mouseEnter(group);
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
    const { container } = render(<CanvasEdgeLines {...defaultProps} edges={edges} />);
    const btn = container.querySelector('[data-edge-btn="e1"]');
    expect(btn).toHaveClass('opacity-0');

    hoverEdge(container, 'e1');
    expect(btn).toHaveClass('opacity-100');
  });

  it('移出后延迟一小段才隐藏（窄缝里光标小幅移动不该反复收起控件）', async () => {
    const edges = [{ id: 'e1', from: 'a', to: 'b' }] as Edge[];
    const { container } = render(<CanvasEdgeLines {...defaultProps} edges={edges} />);
    const group = container.querySelector('g[data-edge-id="e1"]')!;
    const btn = container.querySelector('[data-edge-btn="e1"]');
    hoverEdge(container, 'e1');
    expect(btn).toHaveClass('opacity-100');

    // 离开的瞬间必须还留着：两张卡挨得很近时，光标在连线附近移动会不断
    // 进出命中区，立刻收起会让控件（以及附近卡片的文字）一秒闪好几次。
    fireEvent.mouseLeave(group);
    expect(btn).toHaveClass('opacity-100');

    await waitFor(() => expect(btn).toHaveClass('opacity-0'));
  });

  it('无备注的 chip 隐藏时也要能收到悬停（窄缝里它是连线唯一的落点）', () => {
    const edges = [{ id: 'e1', from: 'a', to: 'b' }] as Edge[];
    const { container } = render(<CanvasEdgeLines {...defaultProps} edges={edges} />);
    const chip = container.querySelector('[data-edge-note="e1"]');
    // 两张卡挨得很近时中点被卡片挡住，只有这个 chip 还能命中；关掉它的
    // pointer-events，中点点上去只会命中卡片，连线的控件再也亮不起来。
    expect(chip).toHaveClass('opacity-0');
    expect(chip).toHaveClass('pointer-events-auto');
  });

  it('有备注时 chip 不用先悬停连线就可点', () => {
    const edges = [{ id: 'e1', from: 'a', to: 'b', note: '因果对比' }] as Edge[];
    const { container } = render(<CanvasEdgeLines {...defaultProps} edges={edges} />);
    expect(container.querySelector('[data-edge-note="e1"]')).toHaveClass('pointer-events-auto');
  });

  it('连线控件层排在卡片层之上（否则窄缝里被卡片压住、悬停反复丢失）', () => {
    const edges = [{ id: 'e1', from: 'a', to: 'b' }] as Edge[];
    const { container } = render(<CanvasEdgeLines {...defaultProps} edges={edges} />);
    // 卡片各自带 z-index（11–40 都有），控件层必须高过它们，不然两张卡靠得
    // 很近时 × 和备注只剩一条 1px 的缝能扫到，悬停会一秒断好几次。
    expect(container.querySelector('[data-edge-note="e1"]')!.parentElement).toHaveClass('z-40');
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
      <CanvasEdgeLines {...defaultProps} edges={edges} deleteEdge={deleteEdge} />
    );
    hoverEdge(container, 'e1');
    const btn = container.querySelector('[data-edge-btn="e1"]')!;
    fireEvent.pointerDown(btn);
    expect(deleteEdge).toHaveBeenCalledWith('e1');
  });

  it('有备注时在中点显示备注文本', () => {
    const edges = [{ id: 'e1', from: 'a', to: 'b', note: '因果对比' }] as Edge[];
    render(<CanvasEdgeLines {...defaultProps} edges={edges} />);
    expect(screen.getByTestId('edge-note-chip-e1')).toHaveTextContent('因果对比');
  });

  it('点击备注可编辑并在 Enter 时写入 db', () => {
    const edges = [{ id: 'e1', from: 'a', to: 'b', note: '旧备注' }] as Edge[];
    render(<CanvasEdgeLines {...defaultProps} edges={edges} />);
    fireEvent.click(screen.getByTestId('edge-note-chip-e1'));
    const input = screen.getByTestId('edge-note-input-e1');
    fireEvent.change(input, { target: { value: '新备注' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(updateMock).toHaveBeenCalledWith('e1', { note: '新备注' });
  });

  it('编辑时隐藏删除按钮', () => {
    const edges = [{ id: 'e1', from: 'a', to: 'b', note: '备注' }] as Edge[];
    const { container } = render(<CanvasEdgeLines {...defaultProps} edges={edges} />);
    hoverEdge(container, 'e1');
    const btn = container.querySelector('[data-edge-btn="e1"]')!;
    expect(btn).toHaveClass('opacity-100');

    fireEvent.click(screen.getByTestId('edge-note-chip-e1'));
    expect(btn).toHaveClass('opacity-0');
    expect(btn).toHaveClass('pointer-events-none');
  });

  it('keeps a stored persona-to-persona link a plain edge', () => {
    const { container } = render(
      <CanvasEdgeLines
        {...defaultProps}
        edges={[
          { id: 'e-agent', from: 'a', to: 'b' },
          { id: 'e-note', from: 'a', to: 'n' },
        ]}
      />,
    );
    // 你画的连线就是连线：不再因为两端是角色卡而变成讨论入口
    expect(container.querySelector('g[data-edge-id="e-agent"]')).not.toHaveAttribute(
      'data-edge-flowing',
    );
    expect(container.querySelector('[data-edge-discuss-cluster="e-agent"]')).toBeNull();
    expect(container.querySelector('[data-edge-discuss="e-agent"]')).toBeNull();
  });

  it('draws room links as flowing status lines with an unclickable discuss badge', () => {
    const { container } = render(
      <CanvasEdgeLines
        {...defaultProps}
        edges={[]}
        roomLinks={[{ id: 'room:host:guest', from: 'host', to: 'guest' }]}
      />,
    );
    const group = container.querySelector('g[data-edge-id="room:host:guest"]')!;
    expect(group).toHaveAttribute('data-edge-flowing', '1');
    expect(group).toHaveAttribute('data-room-link', 'room:host:guest');
    expect(group).toHaveClass('pointer-events-none');
    expect(container.querySelector('g[data-edge-id="room:host:guest"] .node-connector')).toBeTruthy();
    // 中点有个"正在讨论"的标识，但它只是标识：不可点，也不是按钮
    const badge = container.querySelector('[data-room-link-badge="room:host:guest"]')!;
    expect(badge).toBeTruthy();
    expect(badge).toHaveClass('pointer-events-none');
    // 实心填充的"进行中"状态（和思考气泡展开时同一个填充），白圈把它从橙色虚线上托起来
    expect(badge).toHaveClass('bg-[#C2410C]');
    expect(badge).toHaveClass('text-white');
    expect(badge).toHaveClass('ring-white');
    expect(badge.getAttribute('role')).not.toBe('button');
    expect(badge.querySelector('button')).toBeNull();
    // 状态线不长出任何控件：没有旧气泡、没有备注、没有删除按钮
    expect(container.querySelector('[data-edge-discuss-cluster="room:host:guest"]')).toBeNull();
    expect(container.querySelector('[data-edge-btn="room:host:guest"]')).toBeNull();
    expect(container.querySelector('[data-edge-note="room:host:guest"]')).toBeNull();
  });

  it('draws no discuss badge on plain reference edges', () => {
    const { container } = render(
      <CanvasEdgeLines {...defaultProps} edges={[{ id: 'e1', from: 'a', to: 'b' }]} />,
    );
    expect(container.querySelector('[data-room-link-badge]')).toBeNull();
  });
});
