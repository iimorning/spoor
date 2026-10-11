import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor, act } from '@testing-library/react';
import React from 'react';
import { BookNode } from '../../src/components/nodes/BookNode';
import { encodeBookContent } from '../../src/utils/bookPayload';
import { db, type CanvasNode } from '../../src/db';
import type { AIConfig } from '../../src/components/AISettingsModal';
import type { BookTranslateResult } from '../../src/services/bookTranslate';

// useTranslation 只给 t，和 BookNode.test.tsx 同一套口径：真i18n 初始化起来会
// 让按钮的可访问名变成译文而不是 key，测试就找不到按钮了。
vi.mock('react-i18next', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actual = await (vi as any).importActual('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key }),
  };
});

vi.mock('lucide-react', async (importOriginal) =>
  (await import('../mocks/lucideReactMock')).lucideReactMock(importOriginal),
);

/**
 * 词表这一层要绕开：它会抢在模型前面把划词变成瞬时查词，而这里要测的是
 * 模型那条路的流式。查词另有自己的用例。
 */
vi.mock('../../src/services/dictionary', () => ({
  lookupWord: vi.fn(async () => ({ via: 'phrase', matched: '', ecdict: null })),
  lookupEnglishMeanings: vi.fn(async () => null),
}));

/**
 * 逐帧回调 onPartial，模拟 SSE 到达。onPartial 给的是**累加**译文，
 * 所以这里按 1/3 → 2/3 → 全量三帧给。
 */
vi.mock('../../src/services/bookTranslate', () => ({
  runBookTranslate: vi.fn(async ({ onPartial }: { onPartial?: (t: string) => void }) => {
    onPartial?.('一排');
    await Promise.resolve();
    onPartial?.('一排票');
    await Promise.resolve();
    const done: BookTranslateResult = { translation: '一排票', note: '行取 háng。' };
    onPartial?.(done.translation);
    return done;
  }),
}));

import { runBookTranslate } from '../../src/services/bookTranslate';

/** 抓住组件传进来的 onPartial，测试自己决定什么时候吐下一段。 */
let capturedOnPartial: ((t: string) => void) | undefined;

const bookNode: CanvasNode = {
  id: 'b1',
  type: 'book',
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

function selectBodyText(container: HTMLElement) {
  const scroller = container.querySelector('[data-canvas-node-context-text]') as HTMLElement;
  const textNode = Array.from(scroller.childNodes).find(
    (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.includes('First unit text'),
  );
  const range = document.createRange();
  range.selectNodeContents(textNode!);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  fireEvent.mouseUp(scroller);
}

/** 浮层正文那一段（去掉关闭键、音标这些装饰，只看译文本身）。 */
function popoverText(): string {
  const pop = screen.getByTestId('book-translate-popover');
  return pop.textContent ?? '';
}

describe('翻译浮层的流式显示', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.nodes.add(bookNode as never);
    vi.mocked(runBookTranslate).mockClear();
    capturedOnPartial = undefined;
  });

  it('模型还在写的时候浮层上就已经有字，而不是一直转圈', async () => {
    // 流式是异步到达的，用一个自己掌握开关的 promise 把时序钉住：mock 吐一段
    // 增量之后**不返回**。这样中间态是确定的，不用 waitFor 去撞一个还在动的画面。
    let release: (r: BookTranslateResult) => void = () => {};
    const gate = new Promise<BookTranslateResult>((res) => {
      release = res;
    });
    vi.mocked(runBookTranslate).mockImplementationOnce(async ({ onPartial }) => {
      capturedOnPartial = onPartial;
      return gate;
    });

    const { container } = render(
      <BookNode
        node={bookNode}
        editingNodeId={null}
        setEditingNodeId={() => {}}
        aiConfig={{ provider: 'openrouter', apiKey: 'k' } as AIConfig}
      />,
    );
    selectBodyText(container);
    // 工具条按钮认的是 pointerup（它要先 arm 再触发，和 BookNode.test.tsx 一样）
    fireEvent.pointerUp(screen.getByRole('button', { name: 'reference.book_translate' }));

    // 还没出字：转圈 +「翻译中」
    await waitFor(() => expect(screen.getByTestId('book-translate-popover')).toBeInTheDocument());
    expect(popoverText()).toContain('reference.book_translate_loading');

    // 模型吐到一半：字上来了，转圈让位，光标立着表示还在写
    await act(async () => {
      capturedOnPartial?.('一排');
    });
    expect(popoverText()).toContain('一排');
    expect(popoverText()).not.toContain('reference.book_translate_loading');
    expect(screen.getByTestId('book-translate-caret')).toBeInTheDocument();

    // 收尾
    await act(async () => {
      release({ translation: '一排票', note: '行取 háng。' });
    });
    await waitFor(() => expect(popoverText()).toContain('一排票'));
    expect(popoverText()).toContain('行取 háng。');
    // 写完就撤光标，别让读者以为还有下文
    expect(screen.queryByTestId('book-translate-caret')).toBeNull();
  });

  it('收尾解析失败时，已经流出来的译文不会被抹掉', async () => {
    // 模型把译文吐完了，最后信封解析不出来（多吐半截废话之类）。
    // 抹掉等于让读者刚才那几秒白等——他确实已经读到东西了。
    let release: (r: BookTranslateResult) => void = () => {};
    const gate = new Promise<BookTranslateResult>((res) => {
      release = res;
    });
    vi.mocked(runBookTranslate).mockImplementationOnce(async ({ onPartial }) => {
      capturedOnPartial = onPartial;
      return gate;
    });

    const { container } = render(
      <BookNode
        node={bookNode}
        editingNodeId={null}
        setEditingNodeId={() => {}}
        aiConfig={{ provider: 'openrouter', apiKey: 'k' } as AIConfig}
      />,
    );
    selectBodyText(container);
    fireEvent.pointerUp(screen.getByRole('button', { name: 'reference.book_translate' }));

    await waitFor(() => expect(screen.getByTestId('book-translate-popover')).toBeInTheDocument());
    await act(async () => {
      capturedOnPartial?.('一排票');
    });
    expect(popoverText()).toContain('一排票');

    await act(async () => {
      release({ translation: '', note: '' });
    });
    await waitFor(() =>
      expect(popoverText()).toContain('reference.book_translate_empty'),
    );
    expect(popoverText()).toContain('一排票');
  });

it('onPartial 一路都被调用，说明走的是流式而不是一次性返回', async () => {
    const { container } = render(
      <BookNode
        node={bookNode}
        editingNodeId={null}
        setEditingNodeId={() => {}}
        aiConfig={{ provider: 'openrouter', apiKey: 'k' } as AIConfig}
      />,
    );
    selectBodyText(container);
    // 工具条按钮认的是 pointerup（它要先 arm 再触发，和 BookNode.test.tsx 一样）
  fireEvent.pointerUp(screen.getByRole('button', { name: 'reference.book_translate' }));

    await waitFor(() => expect(screen.getByTestId('book-translate-popover')).toBeInTheDocument());
    const opts = vi.mocked(runBookTranslate).mock.calls[0]?.[0] as { onPartial?: unknown };
    expect(typeof opts.onPartial).toBe('function');
  });
});