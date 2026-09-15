import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { ThemeNode } from '../../src/components/nodes/ThemeNode';
import { db } from '../../src/db';
import type { CanvasNode } from '../../src/db';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh', changeLanguage: vi.fn() },
  }),
}));

vi.mock('../../src/db', () => ({
  db: {
    nodes: { update: vi.fn() },
  },
}));

const persistenceDisabled = vi.fn(() => false);

vi.mock('../../src/config/persistence', () => ({
  isContentBlurPersistenceDisabled: () => persistenceDisabled(),
}));

vi.mock('lucide-react', () => ({
  MapPin: (props: Record<string, unknown>) => {
    const { createElement } = require('react');
    return createElement('svg', { 'data-testid': 'icon-MapPin', ...props });
  },
}));

const makeNode = (overrides?: Partial<CanvasNode>): CanvasNode => ({
  id: 'n1',
  canvasId: 'c1',
  type: 'theme',
  content: 'Theme title',
  x: 0,
  y: 0,
  width: 320,
  height: 160,
  ...overrides,
});

describe('ThemeNode blur 持久化', () => {
  beforeEach(() => {
    vi.mocked(db.nodes.update).mockClear();
    persistenceDisabled.mockReturnValue(false);
  });

  it('未聚焦时 props 更新会同步标题到 DOM', async () => {
    const { rerender } = render(
      <ThemeNode node={makeNode({ content: '旧标题' })} editingNodeId={null} setEditingNodeId={vi.fn()} />,
    );
    const title = screen.getByRole('heading', { level: 3 });
    await waitFor(() => expect(title.textContent).toBe('旧标题'));

    rerender(
      <ThemeNode
        node={makeNode({ content: '来自数据库的新标题' })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
      />,
    );
    await waitFor(() => expect(title.textContent).toBe('来自数据库的新标题'));
  });

  it('标题失焦时持久化 content', () => {
    render(<ThemeNode node={makeNode()} editingNodeId={null} setEditingNodeId={vi.fn()} />);
    const title = screen.getByRole('heading', { level: 3 });
    title.innerText = '新标题';
    fireEvent.blur(title);
    expect(db.nodes.update).toHaveBeenCalledWith('n1', { content: '新标题' });
  });

  it('不渲染正文 description 区域', () => {
    render(
      <ThemeNode
        node={makeNode({ description: '已持久化的研究目标说明' })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()} />
    );
    expect(screen.queryByText('已持久化的研究目标说明')).toBeNull();
    expect(screen.queryByText('nodes.theme_default_description')).toBeNull();
  });

  it('禁用 blur 持久化时标题失焦不写库', () => {
    persistenceDisabled.mockReturnValue(true);
    render(<ThemeNode node={makeNode()} editingNodeId={null} setEditingNodeId={vi.fn()} />);
    const title = screen.getByRole('heading', { level: 3 });
    title.innerText = '不应写入';
    fireEvent.blur(title);
    expect(db.nodes.update).not.toHaveBeenCalled();
  });

  it('不渲染底部副标题区域', () => {
    render(
      <ThemeNode
        node={makeNode({ themeTag: '空间编码' })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
      />,
    );
    expect(screen.queryByText('空间编码')).toBeNull();
    expect(screen.queryByText('nodes.theme_default_tag')).toBeNull();
  });

  it('标题单行截断，适配 2:1 横向卡片', () => {
    const { container } = render(
      <ThemeNode
        node={makeNode({ content: '中国教师会不会走日本化的老路' })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
      />,
    );
    const title = container.querySelector('h3');
    expect(title?.className).toMatch(/truncate/);
    expect(title?.className).toMatch(/leading-snug/);
  });
});
