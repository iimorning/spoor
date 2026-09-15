import { render, screen } from '@testing-library/react';
import React from 'react';
import Markdown from 'react-markdown';
import { describe, expect, it } from 'vitest';
import {
  markdownBodyComponents,
  markdownGfmPlugins,
  markdownRehypePlugins,
} from '../../src/components/markdownBody';

function renderMarkdown(md: string) {
  return render(
    <div className="markdown-body">
      <Markdown
        remarkPlugins={markdownGfmPlugins}
        rehypePlugins={markdownRehypePlugins}
        components={markdownBodyComponents}
      >
        {md}
      </Markdown>
    </div>,
  );
}

describe('markdown GFM tables', () => {
  it('renders a pipe table as an HTML table', () => {
    const md = [
      '| 场景 | 核查重点 |',
      '| --- | --- |',
      '| 融资/并购 | 政策合规风险 |',
    ].join('\n');

    renderMarkdown(md);

    const table = screen.getByRole('table');
    expect(table).toBeTruthy();
    expect(screen.getByText('场景')).toBeTruthy();
    expect(screen.getByText('融资/并购')).toBeTruthy();
    expect(screen.getByText('政策合规风险')).toBeTruthy();
  });

  it('tables use fixed layout so cell text wraps to the card width', () => {
    const md = [
      '| 核查内容 | 判断标准 |',
      '| --- | --- |',
      '| 办学资质 | 很长很长很长的判断标准文字不该把卡片撑无限宽 |',
    ].join('\n');

    renderMarkdown(md);

    const table = screen.getByRole('table');
    expect(table.className).toContain('table-fixed');
    expect(table.className).toContain('w-full');
    expect(table.parentElement).toHaveClass('min-w-0');
    expect(table.parentElement).toHaveClass('max-w-full');
  });

  it('renders HTML lists inside table cells instead of showing tags as text', () => {
    const md = [
      '| 核查内容 | 判断标准 |',
      '| --- | --- |',
      '| 办学资质 | <ul><li>须持办学许可证</li><li>无资质一票否决</li></ul> |',
    ].join('\n');

    renderMarkdown(md);

    expect(screen.queryByText(/<ul>/)).toBeNull();
    expect(screen.queryByText(/<li>/)).toBeNull();
    const items = screen.getAllByRole('listitem');
    expect(items.map((el) => el.textContent)).toEqual(['须持办学许可证', '无资质一票否决']);
  });

  it('does not execute script tags from model HTML', () => {
    renderMarkdown('Hello <script>window.__pwned = 1</script> world');
    expect(document.querySelector('script')).toBeNull();
    expect((window as { __pwned?: number }).__pwned).toBeUndefined();
    expect(screen.getByText(/Hello/)).toBeTruthy();
    expect(screen.getByText(/world/)).toBeTruthy();
  });
});
