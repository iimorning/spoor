import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { BookNode } from '../../src/components/nodes/BookNode';
import { encodeBookContent } from '../../src/utils/bookPayload';
import { db } from '../../src/db';
import { appendBookFocusMarks, appendBookTranslateHighlight } from '../../src/utils/bookFocusMarks';
import { setAutoAnnotationEnabled } from '../../src/utils/autoAnnotation';

/** 和 tests/mocks/lucideReactMock 的约定一致：从真实模块建替身，不手抄名单。 */
vi.mock('lucide-react', async (importOriginal) =>
  (await import('../mocks/lucideReactMock')).lucideReactMock(importOriginal),
);

const FILLER =
  'The industry moved quickly that year and few people had time to stop and think. ';

function makeNode(text: string) {
  return {
    id: 'b1',
    type: 'book' as const,
    x: 0,
    y: 0,
    description: 'demo.epub',
    fileType: 'epub',
    content: encodeBookContent({ format: 'epub' as const, title: 'Demo', units: [{ title: 'Ch1', text }] }),
  };
}

/** 存进库再渲染：标注是写库之后由 liveQuery 推回来的，这条链路要真的走到。 */
async function seedBook(text: string) {
  await db.nodes.clear();
  await db.nodes.add(makeNode(text) as never);
  return makeNode(text);
}

/**
 * 渲染时读一次库拿最新的行——BookNode 收的是 node 属性，自己不查库，
 * 而标注是写库之后才有的，拿写之前的快照渲染当然标不出来。
 */
function renderBook() {
  return render(
    <BookNode node={{ id: 'b1' } as never} editingNodeId={null} setEditingNodeId={() => {}} />,
  );
}

async function renderBookFromDb() {
  const row = await db.nodes.get('b1');
  return render(
    <BookNode node={(row ?? { id: 'b1' }) as never} editingNodeId={null} setEditingNodeId={() => {}} />,
  );
}

function marksIn(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-book-focus-id]')].map((m) => m.textContent ?? '');
}

describe('翻译高亮真的画在正文上', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    // 缺省是开。上一条如果把全局开关留下「关」，下一条会在开关关着的情况下画高亮，
    // 测的就不是它自己以为的那件事了。
    setAutoAnnotationEnabled('book', true);
  });

  it('wraps a word in a short chapter', async () => {
    const node = await seedBook('Her enthusiasm for the work was obvious to everyone watching that day.');
    await appendBookTranslateHighlight("b1", 0, { quote: 'enthusiasm', note: '' }, 'n. 热情');

    const { container } = await renderBookFromDb();
    await waitFor(() => expect(marksIn(container)).toContain('enthusiasm'));
  });

  it('wraps a word in the middle of a long chapter', async () => {
    // 词埋在长段落中间——这才是真实的阅读位置，也是高亮消失的那种位置。
    const node = await seedBook(
      FILLER.repeat(4) + 'He became a media darling almost overnight. ' + FILLER.repeat(4),
    );
    await appendBookTranslateHighlight("b1", 0, { quote: 'media', note: '' }, 'n. 媒体');

    const { container } = await renderBookFromDb();
    await waitFor(() => expect(screen.getByTestId('book-body')).toBeInTheDocument());
    await waitFor(() => expect(marksIn(container)).toContain('media'));
  });

  it('wraps a short word that occurs more than once in the chapter', async () => {
    // "media" 只有 5 个字（低于 AI 标注的 10 字门槛），而且在真实长文里常出现多次。
    // 读者自己拖选的词不适用这两条 AI 侧的规则。
    await seedBook(
      'The media was everywhere that season, and the media loved it. ' + 'He read every media report.',
    );
    await appendBookTranslateHighlight("b1", 0, { quote: 'media', note: '' }, 'n. 媒体');
    const { container } = await renderBookFromDb();
    await waitFor(() => expect(marksIn(container)).toContain('media'));
  });

  it('wraps a word that sits at the very end of the chapter', async () => {
    const node = await seedBook(FILLER.repeat(3) + 'He was still pondering the matter.');
    await appendBookTranslateHighlight("b1", 0, { quote: 'pondering', note: '' }, 'v. 思考');

    const { container } = await renderBookFromDb();
    await waitFor(() => expect(marksIn(container)).toContain('pondering'));
  });

  it('keeps both the translation highlight and an existing AI mark when the companion is off', async () => {
    // 右上角那颗按钮只停「以后还要不要自动标」。已经落库的重点，和读者自己划出来的词，
    // 都不该跟着开关一起从正文上消失。
    setAutoAnnotationEnabled('book', false);
    await seedBook('Her enthusiasm for the work was obvious to everyone watching that day.');
    await appendBookFocusMarks('b1', 0, [
      {
        quote: 'obvious to everyone',
        note: '这一句把旁观写成了证据，读者该停下来问自己站在哪一边看这件事。',
      },
    ]);
    await appendBookTranslateHighlight('b1', 0, { quote: 'enthusiasm', note: '' }, 'n. 热情');

    const { container } = await renderBookFromDb();
    await waitFor(() => {
      const marks = marksIn(container);
      expect(marks).toContain('enthusiasm');
      expect(marks).toContain('obvious to everyone');
    });
  });
});
