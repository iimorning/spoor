import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { BookFullscreen } from '../../src/components/BookFullscreen';
import { encodeBookContent } from '../../src/utils/bookPayload';
import { db } from '../../src/db';
import { withAppDialogProvider } from '../testUtils';

/**
 * 顶栏四个按钮得看起来是一套。
 *
 * 原来「AI 对话」独一份：对话栏开着的时候是橙底 + 橙图标，另外三个都是中性灰
 * （只有 hover 才染橙）。四个按钮里就它一个在喊，视觉上不统一。开着没有开着
 * 本来就由右栏有没有展开来说明，状态信息也还在 aria-expanded 里。
 */
describe('BookFullscreen 顶栏按钮外观一致', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.nodes.put({
      id: 'b1',
      type: 'book',
      x: 0,
      y: 0,
      description: 'demo.epub',
      fileType: 'epub',
      content: encodeBookContent({
        format: 'epub',
        title: 'Demo',
        units: [{ title: 'Ch1', text: 'First unit text' }],
      }),
    });
  });

  afterEach(async () => {
    await db.nodes.clear();
  });

  it('对话栏开着时，AI 对话按钮也不带强调色', async () => {
    render(withAppDialogProvider(<BookFullscreen nodeId="b1" onClose={vi.fn()} />));
    await waitFor(() => {
      expect(screen.getByTestId('book-fullscreen')).toBeInTheDocument();
    });

    const chat = await screen.findByTestId('book-fullscreen-toggle-chat');
    // 默认（宽屏）右栏是展开的，也就是"开着"这个最容易露馅的状态
    expect(chat).toHaveAttribute('aria-expanded', 'true');
    expect(chat.className).not.toContain('text-[#C2410C] ');
    expect(chat.className).not.toContain('bg-[#FFF7ED]');
    expect(chat.className).toContain('text-[#8c8a84]');
  });

  it('和摘抄本那颗按钮用同一套类名', async () => {
    render(withAppDialogProvider(<BookFullscreen nodeId="b1" onClose={vi.fn()} />));
    const chat = await screen.findByTestId('book-fullscreen-toggle-chat');
    const excerpts = screen.getByTestId('book-fullscreen-toggle-excerpts');
    // 去掉 shrink-0（只影响布局）之后应当完全一致
    const norm = (c: string) => c.replace(/\s*shrink-0/, '').trim();
    expect(norm(chat.className)).toBe(norm(excerpts.className));
  });
});
