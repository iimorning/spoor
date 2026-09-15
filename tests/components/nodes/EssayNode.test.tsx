import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { encodeEssayContent } from '../../../src/utils/essayPayload';
import type { CanvasNode } from '../../../src/db';

const article = {
  id: 'art-1',
  title: '生成长文',
  type: 'GEN-1',
  content: `## 标题\n\n正文里有一张图 ![x](data:image/png;base64,AAA) 和一段说明。\n\n第二段排版。\n\n${'长正文'.repeat(120)}完整结尾`,
  sourceCards: undefined as undefined | Array<{ segmentText: string }>,
};

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: () => article,
}));

const { EssayNode } = await import('../../../src/components/nodes/EssayNode');

function makeNode(): CanvasNode {
  return {
    id: 'essay-1',
    type: 'essay',
    x: 0,
    y: 0,
    content: encodeEssayContent({ articleId: 'art-1' }),
  };
}

describe('EssayNode', () => {
  it('shows the full article with lightweight heading and paragraph formatting', () => {
    render(<EssayNode node={makeNode()} editingNodeId={null} setEditingNodeId={vi.fn()} />);
    expect(screen.getByText('生成长文')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: '标题' })).toBeInTheDocument();
    expect(screen.getByText(/正文里有一张图/)).toBeInTheDocument();
    expect(screen.getByText('第二段排版。')).toBeInTheDocument();
    const body = screen.getByTestId('essay-body-scroll-essay-1');
    expect(body).toHaveTextContent('完整结尾');
    expect(body).not.toHaveTextContent(/…$/);
  });

  it('shows a stack toggle when synthesize sources exist', () => {
    render(
      <EssayNode
        node={makeNode()}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        essaySourceCount={2}
        essaySourcesCollapsed={false}
        onToggleEssaySources={vi.fn()}
      />,
    );
    expect(screen.getByTestId('stack-cards-toggle')).toHaveTextContent('2');
  });
});
