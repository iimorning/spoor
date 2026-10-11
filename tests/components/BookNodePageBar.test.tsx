import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { BookNode } from '../../src/components/nodes/BookNode';
import { encodeBookContent } from '../../src/utils/bookPayload';
import { db } from '../../src/db';


function makeBookNode() {
  return {
    id: 'b1',
    type: 'book' as const,
    x: 0,
    y: 0,
    description: 'demo.epub',
    fileType: 'epub',
    content: encodeBookContent({
      format: 'epub' as const,
      title: 'Demo',
      units: [{ title: 'Ch1', text: 'First unit text' }],
    }),
  };
}

function renderBook(layout?: 'immersive') {
  render(
    <BookNode
      node={makeBookNode()}
      editingNodeId={null}
      setEditingNodeId={() => {}}
      {...(layout ? { layout } : {})}
    />,
  );
}

/**
 * 页码栏按 testid 找，不用"翻页按钮的父元素"——那条路要先按无障碍名找按钮，
 * 而无障碍名是**会被翻译的**：BookNode 后来经 runBookTranslate → services/ai
 * 拉进了 i18n 实例，真实 i18n 一初始化，`t()` 就从返回 key 变成返回 Previous page，
 * 查询跟着断掉。这条测试关心的是栏的布局，不该被文案牵着走。
 */
function pageBar(): HTMLElement {
  return screen.getByTestId('book-page-nav');
}

/** 正文滚动容器。 */
function bodyColumn(): HTMLElement {
  return screen.getByText(/First unit text/).closest('div') as HTMLElement;
}

/**
 * 全屏阅读里正文收在一列（max-w-3xl mx-auto px-6），而页码栏是**正文的兄弟节点**、
 * 不是正文内部的一截——之前它铺满整个面板，于是左右箭头被甩到面板两边、跟文字完全脱开，
 * 分隔线也比正文宽出一大截。收进同一列之后箭头、页码、分隔线都对着正文那条竖线。
 *
 * 这条测试钉住"两者永远是同一列"，免得以后有人只改一边。
 */
describe('BookNode 页码栏跟正文同列', () => {
  beforeEach(async () => {
    await db.nodes.clear();
  });

  it('全屏时页码栏和正文共用同一条列约束', () => {
    renderBook('immersive');
    const body = bodyColumn().className;
    const bar = pageBar().className;
    for (const token of ['max-w-3xl', 'mx-auto', 'w-full', 'px-6']) {
      expect(body).toContain(token);
      expect(bar).toContain(token);
    }
  });

  // 宽度对齐还不够：正文底下是整屏的米色纸面，页码栏要是自己刷一层白、再加一条分隔线，
  // 就还是一条跟正文断开的带子。
  it('全屏时页码栏不另刷底色、也不画分隔线', () => {
    renderBook('immersive');
    const bar = pageBar().className;
    expect(bar).not.toContain('bg-white');
    expect(bar).not.toMatch(/border-t/);
  });

  it('画布上那张小书卡仍保留自己的分隔线', () => {
    renderBook();
    expect(pageBar().className).toContain('border-t');
  });

  it('画布上的小书卡保持铺满，不受这条约束', () => {
    renderBook();
    expect(pageBar().className).not.toContain('max-w-3xl');
  });
});
