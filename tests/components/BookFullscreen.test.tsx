import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
import React from 'react';
import { BookFullscreen } from '../../src/components/BookFullscreen';
import type { AIConfig } from '../../src/components/AISettingsModal';
import { encodeBookContent } from '../../src/utils/bookPayload';
import { isAutoAnnotationEnabled, setAutoAnnotationEnabled } from '../../src/utils/autoAnnotation';
import { callUniversalAI } from '../../src/services/ai';
import { db, type BookExcerpt } from '../../src/db';
import { withAppDialogProvider } from '../testUtils';
import i18n from '../../src/i18n';
import { resetEcdictCache } from '../../src/services/dictionary/ecdict';

/** 在容器里找一段文字所在的文本节点。 */
function findTextNode(root: HTMLElement, needle: string): Text | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const t = n.textContent ?? '';
    if (t.toLowerCase().includes(needle.toLowerCase())) return n as Text;
  }
  return null;
}
// 英英释义走运行时抓取（要过网络、走 Tauri 绕 CORS），这里换成固定结果：
// 断言的是"接上了、而且画出来了"，不是"抓取能不能成"。
vi.mock('../../src/services/dictionary/sources', () => ({
  ENGLISH_SOURCES: [{ id: 'test', label: 'Test Dictionary' }],
  sourcesForWord: () => [{ id: 'test', label: 'Test Dictionary' }],
  lookupEnglish: vi.fn(async (word: string) => ({
    sourceId: 'test',
    sourceLabel: 'Test Dictionary',
    definitions: [
      { pos: 'noun', text: `English gloss for ${word}`, audio: `https://api.dictionaryapi.dev/media/${word}.mp3` },
    ],
  })),
}));

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, opts?: Record<string, unknown>) => {
        if (key === 'nodes.book_page') return `${opts?.current} / ${opts?.total}`;
        // 提示词那几个键要真插值——只回 key 的话，"摘抄有没有进 prompt"根本无从断言。
        if (key.startsWith('ai.prompts.')) {
          return (i18n.t as unknown as (k: string, o?: Record<string, unknown>) => string)(
            key,
            opts,
          );
        }
        // 同上：这条提示带 {{count}}，只回键名就断言不了"全选时变成 2 条"。
        // book_focus_reading 带 {{label}}，不回插值就看不出转圈时说的是哪一章。
        if (
          key === 'reference.book_chat_excerpt_focus_label' ||
          key === 'reference.book_focus_failed' ||
          key === 'reference.book_focus_reading' ||
          key === 'reference.book_focus_unseen'
        ) {
          return (i18n.t as unknown as (k: string, o?: Record<string, unknown>) => string)(
            key,
            opts,
          );
        }
        return key;
      },
      // 语音那条路要读 i18n.language 决定用哪种朗读语言，mock 里不能少这一项。
      i18n: { language: 'en' },
    }),
  };
});

vi.mock('lucide-react', async (importOriginal) =>
  (await import('../mocks/lucideReactMock')).lucideReactMock(importOriginal),
);

// 拦下真实调用：这里要断言的是"勾选的摘抄有没有进到 prompt"，而不是模型回了什么。
vi.mock('../../src/services/ai', () => ({
  callUniversalAI: vi.fn(async (opts: { onStreamChunk?: (acc: string) => void }) => {
    const text = '{"reply":"知道了。"}';
    opts.onStreamChunk?.(text);
    return text;
  }),
  formatAiError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

vi.mock('../../src/utils/suggestedFollowUps', () => ({
  generateSuggestedFollowUps: vi.fn(async () => []),
}));

const callAi = vi.mocked(callUniversalAI);

function excerpt(overrides: Partial<BookExcerpt> = {}): BookExcerpt {
  return {
    id: 'e1',
    text: '第二条的正文',
    unitIndex: 1,
    unitLabel: 'Ch2',
    bookTitle: 'Demo Book',
    createdAt: 1,
    ...overrides,
  };
}

async function seedBook() {
  await db.nodes.add({
    id: 'b1',
    type: 'book',
    x: 0,
    y: 0,
    description: 'demo.epub',
    fileType: 'epub',
    content: encodeBookContent({
      format: 'epub',
      title: 'Demo Book',
      units: [
        { title: 'Ch1', text: 'Fullscreen chapter text' },
        { title: 'Ch2', text: 'Second unit text' },
      ],
    }),
  });
}

/** 选中正文里的「Fullscreen chapter text」，让选择工具栏出现。 */
function selectReaderText(container: HTMLElement) {
  const scroller = container.querySelector('[data-canvas-node-context-text]') as HTMLElement;
  const textNode = Array.from(scroller.childNodes).find(
    (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.includes('Fullscreen chapter text'),
  );
  const range = document.createRange();
  range.selectNodeContents(textNode!);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  fireEvent.mouseUp(scroller);
}

describe('BookFullscreen — AI 伴读', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await seedBook();
    // 伴读开关存 localStorage，测试之间必须清干净，否则上一条留下的"全局已关"
    // 会让这一条默认就是关的。
    localStorage.clear();
    callAi.mockReset();
    callAi.mockImplementation(async (opts: { onStreamChunk?: (acc: string) => void }) => {
      const text = '{"reply":"知道了。"}';
      opts.onStreamChunk?.(text);
      return text;
    });
  });

  function renderBook() {
    return render(
      withAppDialogProvider(
        <BookFullscreen
          nodeId="b1"
          onClose={vi.fn()}
          aiConfig={{ provider: 'openrouter', apiKey: 'k' } as AIConfig}
        />,
      ),
    );
  }

  /** 触发前有 1.5 秒防抖，等它自己放出去。不用假时钟：Dexie 是异步的，
   *  假时钟和 waitFor 一起用只会把"等不到"变成假绿。 */
  const SETTLED = { timeout: 5000 };

  it('translates the selection into a popover and closes it on Escape', async () => {
    callAi.mockImplementation(async () =>
      JSON.stringify({
        translation: '全身心投入的画布',
        note: '取 all-in 的意思，不是逐字对应。',
      }),
    );
    const { container } = renderBook();
    await waitFor(() => expect(screen.getByTestId('book-reader-pane')).toBeInTheDocument());

    selectReaderText(container);
    // 没配模型就不该露这颗按钮：点下去必然失败。
    const toolbar = await screen.findByTestId('text-selection-toolbar');
    const translateBtn = within(toolbar).getByText('reference.book_translate');
    expect(translateBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.pointerUp(translateBtn.closest('button')!);
    });
    // 点完工具条要收起来（选区高亮该退），但浮层留在原地
    await waitFor(() =>
      expect(screen.getByTestId('book-translate-popover')).toBeInTheDocument(),
    );
    // 锚点必须是**选区自己**的矩形，不是工具条的坐标。
    // askUi.left 是工具条的左边缘（midX - 工具条宽/2 再夹紧），拿它当锚点
    // 又叠 translateX(-50%)，浮层就会整体左偏约半个工具条。
    const popover = screen.getByTestId('book-translate-popover');
    const popStyle = popover.getAttribute('style') ?? '';
    expect(popStyle).not.toContain('translate(-50%');
    expect(popStyle).toMatch(/left:\s*\d/);
    expect(popStyle).toMatch(/top:\s*\d/);
    await waitFor(() =>
      expect(screen.getByTestId('book-translate-popover')).toHaveTextContent(
        '全身心投入的画布',
      ),
    );
    // 多义或术语才写的那句说明
    expect(screen.getByTestId('book-translate-popover')).toHaveTextContent(
      'all-in',
    );
    // 整段翻译时原文绝不回到浮层里——它在正文里已经亮着。
    // 顶栏那一行只给单词查词用，这里是整段，所以整行都该是空的。
    expect(screen.getByTestId('book-translate-popover')).not.toHaveTextContent(
      'Fullscreen chapter text',
    );
    // 整段没有音标，也就没有朗读键
    expect(screen.queryByTestId('book-translate-speak')).toBeNull();
    // 顶栏那条只挂关闭键的行**整行不渲染**：留着它，正文上方就是一道空带，
    // 长句翻出来两行字时特别明显。关闭键改为贴右上角。
    const popBox = screen.getByTestId('book-translate-popover');
    expect(popBox.querySelector('[class*="mb-1.5"]')).toBeNull();
    // 贴角的关闭键还在
    expect(
      popBox.querySelector('[data-testid="book-translate-close"]')?.parentElement?.className,
    ).toContain('absolute');
    // 译完的这段在正文里留下高亮
    await waitFor(async () => {
      const saved = await db.nodes.get('b1');
      const marks = saved?.bookFocusMarks ?? [];
      expect(marks).toHaveLength(1);
      expect(marks[0].origin).toBe('translate');
      // 译文存在 note 里。再点高亮时按空行拆回「译文」和「说明」。
      expect(marks[0].note).toContain('全身心投入的画布');
    });
    // 但它是读者自己划的：不算伴读标过，也不进伴读清单。
    // 要是被算进去，翻过一次翻译的章节伴读就再也不会去标它了。
    const { isChapterFocused, readAiFocusMarks, readBookFocusMarks } =
      await import('../../src/utils/bookFocusMarks');
    const row = await db.nodes.get('b1');
    expect(isChapterFocused(row, 0)).toBe(false);
    expect(readAiFocusMarks(row)).toHaveLength(0);
    expect(readBookFocusMarks(row)).toHaveLength(1);

    // 点开高亮要回到初次那张浮层：译文和说明各占一块，不拍进同一行。
    // 伴读脚注不挂在翻译高亮上，否则义项和说明会跟复制、删除挤成一行。
    await waitFor(() => {
      expect(container.querySelectorAll('[data-book-focus-id]').length).toBeGreaterThan(0);
    });
    expect(container.querySelector('[data-book-focus-note]')).toBeNull();

    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    await waitFor(() =>
      expect(screen.queryByTestId('book-translate-popover')).toBeNull(),
    );

    await act(async () => {
      fireEvent.click(container.querySelector('[data-book-focus-id]')!);
    });
    const again = await screen.findByTestId('book-translate-popover');
    const againParas = [...again.querySelectorAll('p')];
    const translationP = againParas.find((p) => p.textContent === '全身心投入的画布');
    const noteP = againParas.find((p) =>
      (p.textContent ?? '').includes('reference.book_translate_note_label'),
    );
    expect(translationP).toBeTruthy();
    expect(translationP?.querySelector('button')).toBeNull();
    expect(noteP?.textContent).toContain('all-in');
    expect(noteP?.textContent).not.toContain('全身心投入的画布');
    expect(again.querySelector('[aria-label="reference.book_translate_copy"]')).toBeTruthy();
    expect(again.querySelector('[aria-label="reference.book_translate_delete"]')).toBeTruthy();
  });

  it('answers a single word from the local dictionary without calling the model', async () => {
    // 查词是划词里最常见的场景。词典瞬时、免费、离线可用；调模型要好几秒还花钱。
    // 所以单词必须走词典，一个模型请求都不该发。
    await db.nodes.update('b1', {
      content: encodeBookContent({
        format: 'epub',
        title: 'Demo Book',
        units: [
          { title: 'Ch1', text: 'Her enthusiasm for the work was obvious to everyone.' },
        ],
      }),
    });
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('ecdict-subset')) {
        return {
          ok: true,
          json: async () => ({
            enthusiasm: { w: 'enthusiasm', p: "in'θju:ziæzәm", t: 'n. 巨大的热情, 热心' },
          }),
        } as Response;
      }
      return realFetch(input as RequestInfo);
    }) as unknown as typeof fetch;
    resetEcdictCache();
    try {
      const { container } = renderBook();
      await waitFor(() => expect(screen.getByTestId('book-reader-pane')).toBeInTheDocument());
      callAi.mockClear();

      const textNode = findTextNode(container, 'enthusiasm');
      expect(textNode).toBeTruthy();
      const start = textNode!.textContent!.indexOf('enthusiasm');
      const range = document.createRange();
      range.setStart(textNode!, start);
      range.setEnd(textNode!, start + 'enthusiasm'.length);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      await act(async () => {
        fireEvent.mouseUp(screen.getByTestId('book-body'));
      });

      const toolbar = await screen.findByTestId('text-selection-toolbar');
      const btn = within(toolbar).getByText('reference.book_translate').closest('button');
      expect(btn).toBeTruthy();
      await act(async () => {
        fireEvent.pointerUp(btn!);
      });

      // 词典答案是即时的，浮层直接就位，而且没走模型
      await waitFor(() =>
        expect(screen.getByTestId('book-translate-popover')).toHaveTextContent('巨大的热情'),
      );
      expect(callAi).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = realFetch;
      resetEcdictCache();
    }
  });

  it('splits senses onto their own lines and fills in English later', async () => {
    await db.nodes.update('b1', {
      content: encodeBookContent({
        format: 'epub',
        title: 'Demo Book',
        units: [
          { title: 'Ch1', text: 'Her enthusiasm for the work was obvious.' },
        ],
      }),
    });
    const realFetch = globalThis.fetch;
    // 本地词表：两个义项，中间是换行——ECDICT 就是这么存的，被拍成一行就分不清了
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('ecdict-subset')) {
        return {
          ok: true,
          json: async () => ({
            enthusiasm: {
              w: 'enthusiasm',
              p: "in'θju:ziæzәm",
              t: 'n. 巨大的热情, 热心\n[计] 热情值',
            },
          }),
        } as Response;
      }
      return realFetch(input as RequestInfo);
    }) as unknown as typeof fetch;
    resetEcdictCache();
    try {
      const { container } = renderBook();
      await waitFor(() => expect(screen.getByTestId('book-reader-pane')).toBeInTheDocument());

      const textNode = findTextNode(container, 'enthusiasm');
      const start = textNode!.textContent!.indexOf('enthusiasm');
      const range = document.createRange();
      range.setStart(textNode!, start);
      range.setEnd(textNode!, start + 'enthusiasm'.length);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      await act(async () => {
        fireEvent.mouseUp(screen.getByTestId('book-body'));
      });
      const toolbar = await screen.findByTestId('text-selection-toolbar');
      await act(async () => {
        fireEvent.pointerUp(
          within(toolbar).getByText('reference.book_translate').closest('button')!,
        );
      });

      const popover = await screen.findByTestId('book-translate-popover');
      // 单词查词：顶栏摆出被查的词，音标单独一行并挂朗读键
      expect(popover.textContent).toContain('enthusiasm');
      expect(popover.textContent).toContain("in'θju:ziæzәm");
      // 音标只该出现一次：lines 里放过一遍、phonetic 又渲染一遍就会重复
      expect(
        popover.textContent!.split("in'θju:ziæzәm").length - 1,
      ).toBe(1);
      expect(screen.getByTestId('book-translate-speak')).toBeInTheDocument();
      // 浮层对了还不够：划过的词必须在正文里留下高亮，否则浮层一关就找不回
      // 是哪一段。这一条是踩过的坑——重写词典分支时把写高亮那行顺手删掉了，
      // 而当时的测试只看浮层，所以没发现。
      await waitFor(async () => {
        const row = await db.nodes.get('b1');
        const marks = row?.bookFocusMarks ?? [];
        expect(marks).toHaveLength(1);
        expect(marks[0].origin).toBe('translate');
        expect(marks[0].note).toContain('巨大的热情');
      });
      await waitFor(() =>
        expect(container.querySelectorAll('[data-book-focus-id]').length).toBeGreaterThan(0),
      );

      // 音标一行、两个义项各占一行
      const lines = popover.querySelectorAll('p');
      expect(popover.textContent).toContain('巨大的热情');
      expect(popover.textContent).toContain('[计] 热情值');
      // 必须是**各自独占一个元素**。只断言"文本里出现过"是不够的：拍回一整行
      // 再塞进同一个 <p>，那行断言照样过。
      // 整行相等，不能只是"包含"：拍回一整行塞进同一个 <p>，"包含"照样过。
      const senseTexts = Array.from(lines).map((l) => (l.textContent ?? '').trim());
      expect(senseTexts).toContain('[计] 热情值');
      expect(senseTexts).toContain('n. 巨大的热情, 热心');
      // 英英释义是**后补**的：中文先落地，英文到了再添上，且标出处
      await waitFor(() =>
        expect(screen.getByTestId('book-translate-popover')).toHaveTextContent(
          'English gloss for enthusiasm',
        ),
      );
      expect(screen.getByTestId('book-translate-popover').textContent).toContain(
        'reference.book_translate_english_label',
      );
      expect(screen.getByTestId('book-translate-popover').textContent).toContain(
        'Test Dictionary',
      );
      // 真人录音优先：有它就不该退到合成语音
      const spoken: string[] = [];
      // jsdom 里没有 speechSynthesis，补一个桩：它是"没有真人录音时"的兜底路径
      const hadSynth = 'speechSynthesis' in window;
      const origSynth = (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
      const synthStub = { cancel: () => {}, getVoices: () => [], speak: () => {} };
      (window as unknown as { speechSynthesis: unknown }).speechSynthesis = synthStub;
      const origPlay = window.HTMLMediaElement.prototype.play;
      window.HTMLMediaElement.prototype.play = function play(this: HTMLMediaElement) {
        spoken.push(this.src);
        return Promise.resolve();
      };
      (synthStub as { speak: (u: unknown) => void }).speak = (u) => {
        spoken.push('synth:' + String((u as { text?: string })?.text ?? ''));
      };
      try {
        await act(async () => {
          fireEvent.click(screen.getByTestId('book-translate-speak'));
        });
      } finally {
        window.HTMLMediaElement.prototype.play = origPlay;
        if (hadSynth) {
          (window as unknown as { speechSynthesis: unknown }).speechSynthesis = origSynth;
        } else {
          delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
        }
      }
      expect(spoken.join('|')).toContain('enthusiasm.mp3');
      expect(spoken.join('|')).not.toContain('synth:');

      // 关掉再点高亮：还是初次那张浮层，两个义项各自一行，音标还在。
      await act(async () => {
        fireEvent.keyDown(document, { key: 'Escape' });
      });
      await waitFor(() => expect(screen.queryByTestId('book-translate-popover')).toBeNull());
      await act(async () => {
        fireEvent.click(container.querySelector('[data-book-focus-id]')!);
      });
      const again = await screen.findByTestId('book-translate-popover');
      const againLines = Array.from(again.querySelectorAll('p')).map((l) =>
        (l.textContent ?? '').trim(),
      );
      expect(againLines).toContain('n. 巨大的热情, 热心');
      expect(againLines).toContain('[计] 热情值');
      expect(againLines.some((line) => line.includes('巨大的热情') && line.includes('热情值'))).toBe(
        false,
      );
      expect(again.textContent).toContain("in'θju:ziæzәm");
      expect(screen.getByTestId('book-translate-speak')).toBeInTheDocument();
    } finally {
      globalThis.fetch = realFetch;
      resetEcdictCache();
    }
  });

  it('keeps the translate button away when no model is configured', async () => {
    const { container } = render(
      withAppDialogProvider(<BookFullscreen nodeId="b1" onClose={vi.fn()} />),
    );
    await waitFor(() => expect(screen.getByTestId('book-reader-pane')).toBeInTheDocument());
    selectReaderText(container);
    const toolbar = await screen.findByTestId('text-selection-toolbar');
    expect(within(toolbar).queryByText('reference.book_translate')).toBeNull();
  });


  it('waits for the page to settle before reading it', async () => {
    renderBook();
    await waitFor(() => expect(screen.getByTestId('book-reader-pane')).toBeInTheDocument());

    // 刚翻过来就该是静的：连着翻页时不该一章一调用。
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(callAi).not.toHaveBeenCalled();
  });

  it('marks the chapter and posts a remark without being asked', async () => {
    callAi.mockImplementation(async () =>
      JSON.stringify({
        marks: [
          {
            quote: 'Fullscreen chapter text',
            note: '这一章其实在把问题从「这一段讲了什么」换成「人给自己设了什么条件」，值得停一下再看后面。',
          },
        ],
        message: '你有没有觉得，这一章讲的是同一件事被说成了两遍？',
      }),
    );
    renderBook();
    await waitFor(() => expect(screen.getByTestId('book-reader-pane')).toBeInTheDocument());

    await waitFor(async () => {
      const saved = await db.nodes.get('b1');
      expect(saved?.bookFocusMarks?.[0]?.quote).toBe('Fullscreen chapter text');
      expect(saved?.bookFocusMarks?.[0]?.unitIndex).toBe(0);
    }, SETTLED);
    await waitFor(async () => {
      const saved = await db.nodes.get('b1');
      expect(saved?.bookChatMessages?.[0]?.text).toBe(
        '你有没有觉得，这一章讲的是同一件事被说成了两遍？',
      );
      // 自己开口的那句话要排在用户这一轮之后，而不是插进对话中间。
      expect(saved?.bookChatMessages?.[0]?.role).toBe('assistant');
    }, SETTLED);
  });

  it('stays silent when the model has nothing to say', async () => {
    callAi.mockImplementation(async () => '{"marks":[],"message":""}');
    renderBook();
    await waitFor(() => expect(screen.getByTestId('book-reader-pane')).toBeInTheDocument());

    await waitFor(() => expect(callAi).toHaveBeenCalled(), SETTLED);
    const saved = await db.nodes.get('b1');
    expect(saved?.bookChatMessages ?? []).toHaveLength(0);
    expect(saved?.bookFocusMarks ?? []).toHaveLength(0);
  });

  it('still marks the chapter whose pass was running when the page turned', async () => {
    // 读到一半翻页，这一章不能就此悬空：它要么被标上，要么明确还能再读，
    // 最坏的情况是既没标上、又被记成"试过了"——那在界面上和"模型调不动"
    // 一模一样，没有任何报错可查。
    let releaseFirst: ((value: string) => void) | null = null;
    let calls = 0;
    callAi.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return new Promise<string>((res) => { releaseFirst = res; });
      return Promise.resolve('{"marks":[],"message":""}');
    });
    renderBook();
    await waitFor(() => expect(screen.getByTestId('book-reader-pane')).toBeInTheDocument());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 1700));
    });
    expect(calls).toBe(1);

    // 读到一半翻页。这一趟不会被作废——它读完的是自己那一章，落点是对的。
    await act(async () => {
      fireEvent.click(screen.getByLabelText('nodes.book_next'));
    });
    await waitFor(() => expect(screen.getByText('2 / 2')).toBeInTheDocument());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1700));
    });
    expect(calls).toBe(1);

    await act(async () => {
      // 说明短于 30 字会被 pickFocusMarks 当成复述正文挡掉，这里得给够长度。
      releaseFirst?.(
        '{"marks":[{"quote":"Fullscreen chapter text","note":"这一句是全章的落点，读者第一次进来就该先看到它，后面的展开都从它开始。"}],"message":""}',
      );
      await new Promise((r) => setTimeout(r, 50));
    });

    // 第 0 章的标注确实落库了：读者已经翻走，这一章不会白读。
    await waitFor(async () => {
      const saved = await db.nodes.get('b1');
      expect(saved?.bookFocusMarks?.length).toBe(1);
      expect(saved?.bookFocusMarks?.[0]?.unitIndex).toBe(0);
    });
    // 转圈也收掉了。
    await waitFor(() =>
      expect(screen.queryByTestId('book-fullscreen-focus-status')).toBeNull(),
    );
  }, 20000);

  it('does not re-read a chapter it already marked', async () => {
    // 翻回去不该再花一次钱。
    await db.nodes.update('b1', {
      bookFocusMarks: [
        {
          id: 'm1',
          unitIndex: 0,
          quote: 'Fullscreen chapter text',
          note: '这一章其实在把问题从"这一段讲了什么"换成"人给自己设了什么条件"。',
          createdAt: 1,
        },
      ],
    });
    renderBook();
    await waitFor(() => expect(screen.getByTestId('book-reader-pane')).toBeInTheDocument());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 2200));
    });
    expect(callAi).not.toHaveBeenCalled();
  });

  it('reads nothing once the reader turns it off', async () => {
    setAutoAnnotationEnabled('book', false);
    renderBook();
    await waitFor(() => expect(screen.getByTestId('book-fullscreen-toggle-focus')).toBeInTheDocument());
    expect(screen.getByTestId('book-fullscreen-toggle-focus')).toHaveAttribute('aria-pressed', 'false');

    await act(async () => {
      await new Promise((r) => setTimeout(r, 2200));
    });
    expect(callAi).not.toHaveBeenCalled();
  });

  it('turns the reader off and on from the header, default on', async () => {
    renderBook();
    await waitFor(() => expect(screen.getByTestId('book-fullscreen-toggle-focus')).toBeInTheDocument());
    const toggle = screen.getByTestId('book-fullscreen-toggle-focus');
    // 缺省即开启——没写进 localStorage 就是开着。
    expect(toggle).toHaveAttribute('aria-pressed', 'true');

    await act(async () => {
      fireEvent.click(toggle);
    });
    await waitFor(() => {
      expect(isAutoAnnotationEnabled('book')).toBe(false);
    });
    // 写盘和重渲染是分开的两拍，按钮上的 aria-pressed 得等它翻过来。
    await waitFor(() =>
      expect(screen.getByTestId('book-fullscreen-toggle-focus')).toHaveAttribute(
        'aria-pressed',
        'false',
      ),
    );

    await act(async () => {
      fireEvent.click(toggle);
    });
    await waitFor(() => {
      expect(isAutoAnnotationEnabled('book')).toBe(true);
    });
  });

  it('leaves the format badge and the title but drops the icon and the word "book"', async () => {
    renderBook();
    await waitFor(() => expect(screen.getByTestId('book-reader-pane')).toBeInTheDocument());

    const bar = document.querySelector('div[data-testid="book-fullscreen"] > div') as HTMLElement;
    const left = bar?.firstElementChild as HTMLElement | null;
    expect(left, 'header left group').toBeTruthy();
    // 认得出是书：书名一定在。格式徽标在顶栏挤不下时会让位（展开键比它更要紧），
    // 所以这里不钉死它在不在。
    expect(left.textContent).toContain('Demo Book');
    // 图标和"书籍"两个字不在了——读者正在读这本书，不需要被告知。
    expect(left.querySelector('[data-testid="icon-BookOpen"]')).toBeNull();
    expect(left.textContent).not.toContain('nodes.book');
    // 折叠摘抄本那颗还在，位置没被前面的东西挤走。
    expect(within(left).getByTestId('book-fullscreen-toggle-excerpts')).toBeInTheDocument();
  });

  it('names the chapter while the reader is working, and clears it afterwards', async () => {
    // 把这一趟模型调用悬住，标注就停在"在途"这个状态上——正是要断言的那一刻。
    let release: (v: string) => void = () => {};
    callAi.mockImplementation(
      () => new Promise<string>((resolve) => { release = resolve; }),
    );
    renderBook();
    await waitFor(() => expect(screen.getByTestId('book-fullscreen-toggle-focus')).toBeInTheDocument());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 2200));
    });

    // 标注不是流式的：模型回来之前正文上什么都没有，全靠这颗药丸说明在等什么。
    const status = await screen.findByTestId('book-fullscreen-focus-status');
    expect(status.textContent).toContain('Ch1');
    expect(screen.getByTestId('book-fullscreen-toggle-focus')).toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      release('{"marks":[],"message":""}');
      await new Promise((r) => setTimeout(r, 50));
    });
    await waitFor(() =>
      expect(screen.queryByTestId('book-fullscreen-focus-status')).toBeNull(),
    );
  });

  it('reads one chapter at a time when the reader turns pages mid-read', async () => {
    // 悬住第一趟：模拟一次整章调用要好几秒。
    const releases: Array<(v: string) => void> = [];
    callAi.mockImplementation(
      () => new Promise<string>((resolve) => { releases.push(resolve); }),
    );
    renderBook();
    await waitFor(() => expect(screen.getByTestId('book-fullscreen-toggle-focus')).toBeInTheDocument());

    // 第一章：定时器到期，发起第一趟。
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1700));
    });
    expect(callAi).toHaveBeenCalledTimes(1);

    // 读还在路上就连翻到第二章。没有在途闸的时候这里会再发一次，
    // 于是并行的整章调用越堆越多，转圈一直等的是最后一次。
    await act(async () => {
      await db.nodes.update('b1', { bookPageIndex: 1 });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1700));
    });
    expect(callAi).toHaveBeenCalledTimes(1);

    // 第一趟回来：转圈必须收掉，而不是挂在 busy 上等一个永远不会来的结果。
    await act(async () => {
      releases[0]('{"marks":[],"message":""}');
      await new Promise((r) => setTimeout(r, 50));
    });
    await waitFor(() =>
      expect(screen.queryByTestId('book-fullscreen-focus-status')).toBeNull(),
    );

    // 收工之后，读者当时停在的那一章才被读——不是他翻过的那几章。
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1700));
    });
    expect(callAi).toHaveBeenCalledTimes(2);
    const second = callAi.mock.calls[1]?.[0] as { messages?: Array<{ content?: string }> };
    expect(second?.messages?.[0]?.content ?? '').toContain('Ch2');
  }, 20000);

  it('badges every mark the reader has not had in front of them yet', async () => {
    // 两章各一条，全部是"之前读出来的"：重新打开就该算待读，而不是一片空白。
    await db.nodes.update('b1', {
      bookFocusMarks: [
        {
          id: 'a1',
          createdAt: 1,
          unitIndex: 0,
          quote: 'Fullscreen chapter text',
          note: '这一句是全章的落点，读者第一次进来就该先看到它，后面的展开都从它开始。',
        },
        {
          id: 'b1m',
          createdAt: 2,
          unitIndex: 1,
          quote: 'Second unit text',
          note: '这一章的起点，承接上一章收尾的那句话，两章连起来才看得出走向。',
        },
      ],
    });
    renderBook();
    await waitFor(() => expect(screen.getByTestId('book-reader-pane')).toBeInTheDocument());

    // 当前就在第 0 章且它有标记，那一条已经摆在眼前；第 1 章那条还没见过。
    const badge = await screen.findByTestId('book-fullscreen-focus-badge');
    expect(badge.textContent).toBe('1');

    await act(async () => {
      fireEvent.click(screen.getByLabelText('nodes.book_next'));
    });
    await waitFor(() => expect(screen.getByText('2 / 2')).toBeInTheDocument());
    // 翻到第 1 章：那边的标记也进正文了，角标收掉。
    await waitFor(() =>
      expect(screen.queryByTestId('book-fullscreen-focus-badge')).toBeNull(),
    );

    // 翻回第 0 章，仍然是两条都见过，不该又冒出来。
    await act(async () => {
      fireEvent.click(screen.getByLabelText('nodes.book_prev'));
    });
    await waitFor(() => expect(screen.getByText('1 / 2')).toBeInTheDocument());
    expect(screen.queryByTestId('book-fullscreen-focus-badge')).toBeNull();
  });

  it('badges a mark that lands after the reader turned the page', async () => {
    // 另一种顺序：读者先离开，标注才落回来。章号是"到过的"，但这条他没见过。
    let releaseFirst: ((value: string) => void) | null = null;
    let calls = 0;
    callAi.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return new Promise<string>((res) => { releaseFirst = res; });
      return Promise.resolve('{"marks":[],"message":""}');
    });
    renderBook();
    await waitFor(() => expect(screen.getByTestId('book-reader-pane')).toBeInTheDocument());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 1700));
    });
    expect(calls).toBe(1);

    await act(async () => {
      fireEvent.click(screen.getByLabelText('nodes.book_next'));
    });
    await waitFor(() => expect(screen.getByText('2 / 2')).toBeInTheDocument());
    await act(async () => {
      releaseFirst?.(
        '{"marks":[{"quote":"Fullscreen chapter text","note":"这一句是全章的落点，读者第一次进来就该先看到它，后面的展开都从它开始。"}],"message":""}',
      );
      await new Promise((r) => setTimeout(r, 80));
    });

    const badge = await screen.findByTestId('book-fullscreen-focus-badge');
    expect(badge.textContent).toBe('1');

    await act(async () => {
      fireEvent.click(screen.getByLabelText('nodes.book_prev'));
    });
    await waitFor(() => expect(screen.getByText('1 / 2')).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.queryByTestId('book-fullscreen-focus-badge')).toBeNull(),
    );
  }, 20000);

  it('lends the page nav to the title bar so it costs no reading space', async () => {
    const { container } = renderBook();
    await waitFor(() => expect(screen.getByTestId('book-reader-pane')).toBeInTheDocument());

    // 顶栏里有个给页码栏留的空位……
    const host = screen.getByTestId('book-fullscreen-page-nav-host');
    // ……页码栏确实搬进去了。
    const prev = within(host).getByLabelText('nodes.book_prev');
    const next = within(host).getByLabelText('nodes.book_next');
    expect(within(host).getByText('1 / 2')).toBeInTheDocument();

    // 翻页按钮还在顶栏里管用。
    await act(async () => {
      fireEvent.click(next);
    });
    await waitFor(() => expect(within(host).getByText('2 / 2')).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(prev);
    });
    await waitFor(() => expect(within(host).getByText('1 / 2')).toBeInTheDocument());

    // 空位必须**脱离顶栏的 flex 排布**并按阅读区定位。正文列是阅读区里
    // mx-auto max-w-3xl 居中的，空位若跟着书名一起排，页码栏就歪到左边——
    // 两栏宽度不等时，两条中线根本不重合。
    //
    // 这里只断言结构：jsdom 的 getBoundingClientRect 一律返回 0，像素级的
    // 对齐在这里验不出来，得靠真页面。测的是"别退回 flex 流"这条。
    expect(host.className).toContain('absolute');
    expect(host.className).not.toContain('shrink-0');
    // 借位不能是 display:none。首次挂载时 liveQuery 还没回来、阅读区没渲染，
    // 早先用 useLayoutEffect([]) 去量就永远量不到，整条页码栏会直接消失。
    expect(host.style.display).not.toBe('none');
    // 空位给的是**阅读区**的范围，页码栏要在这范围里再按正文列的宽度收一次。
    // 少了 max-w-3xl，它会横跨整个空位，justify-between 把两个箭头甩到窗口
    // 两端，抽屉一收就压在书名和右侧按钮底下看不见了。
    const navBox = within(host).getByLabelText('nodes.book_prev').closest('div');
    expect(navBox?.className ?? '').toContain('max-w-3xl');
    expect(navBox?.className ?? '').toContain('mx-auto');
    // 空位横跨阅读区，里面只有页码栏有内容。放着不管的话，抽屉一收、阅读区
    // 铺满窗口，书名和「展开摘抄本」那颗就被它整个盖住——点不动，箭头也压在
    // 字底下。
    expect(host.className).toContain('pointer-events-none');
    expect(navBox?.className ?? '').toContain('pointer-events-auto');
    // 书名这一组要在页码栏左缘之前收住，长名字自己截断而不是压在下面。
    const leftGroup = host.previousElementSibling as HTMLElement;
    expect(leftGroup.style.maxWidth).toBeTruthy();
    // 兜底下限必须小。之前给的是 220px，正好把限宽顶掉：左栏一收、这一组就
    // 伸进页码栏里，展开键被箭头（连同它 before:-inset-2 撑开的可点区）盖住，
    // 点不动。下限只要放得下"标题缩成 0 + 展开键"那 36px 就够。
    const cap = Number.parseInt(leftGroup.style.maxWidth, 10);
    expect(cap).toBeLessThan(220);
    expect(cap).toBeGreaterThanOrEqual(36);

    // 正文区里不再有第二份——放底部或正文上方都还占阅读区的一行。
    const readerPane = screen.getByTestId('book-reader-pane');
    expect(readerPane.querySelector('[aria-label="nodes.book_prev"]')).toBeNull();
    expect(container.querySelector('[data-testid="book-reader-pane"] [aria-label="nodes.book_next"]'))
      .toBeNull();
  });

  it('says which passages are unread, not just how many', async () => {
    // 第 0 章两条、第 1 章一条。读者停在第 0 章，所以第 0 章那两条已经摆在眼前
    // （已读），第 1 章那条才是"没看过的"。
    await db.nodes.update('b1', {
      bookFocusMarks: [
        {
          id: 'a1',
          createdAt: 1,
          unitIndex: 0,
          quote: 'Fullscreen chapter text',
          note: '本章第一条的批注：这一句是全章的落点，读者第一次进来就该先看到它。',
        },
        {
          id: 'a2',
          createdAt: 2,
          unitIndex: 0,
          quote: 'Fullscreen chapter text again',
          note: '本章第二条的批注：紧跟着上一句，两句要一起看才说得通，别拆开读。',
        },
        {
          id: 'b1m',
          createdAt: 3,
          unitIndex: 1,
          quote: 'Second unit text',
          note: '别章的批注：这一章的起点，承接上一章收尾的那句话才看得出走向。',
        },
      ],
    });
    renderBook();
    await waitFor(() => expect(screen.getByTestId('book-reader-pane')).toBeInTheDocument());

    await act(async () => {
      fireEvent.pointerOver(screen.getByTestId('book-fullscreen-toggle-focus').parentElement!);
    });
    const list = await screen.findByTestId('book-fullscreen-focus-list');
    const chapters = within(list).getAllByTestId('book-fullscreen-focus-chapter');
    const items = () => within(list).getAllByTestId('book-fullscreen-focus-list-item');

    // 角标说"还有 1 处"，那一条必须能被指出来。
    expect(screen.getByTestId('book-fullscreen-focus-badge').textContent).toBe('1');

    // 当前章的两条：读过，不点。
    expect(items()[0].getAttribute('data-unread')).toBeNull();
    expect(items()[1].getAttribute('data-unread')).toBeNull();
    expect(within(items()[0]).queryByTestId('book-fullscreen-focus-unread-dot')).toBeNull();

    // 别的章那条：没读过，章名后报数、段落前点记号。
    await act(async () => {
      fireEvent.click(chapters[1]);
    });
    const unreadItem = items()[2];
    expect(unreadItem.getAttribute('data-unread')).toBe('true');
    expect(within(unreadItem).getByTestId('book-fullscreen-focus-unread-dot')).toBeTruthy();
    // 折叠着的章也要报数——不然读者不知道该展开哪一章。
    expect(within(chapters[1]).getByTestId('book-fullscreen-focus-chapter-unread').textContent)
      .toBe('1');
    // 读过的那一章不报数。
    expect(within(chapters[0]).queryByTestId('book-fullscreen-focus-chapter-unread')).toBeNull();

    // 翻到那一章、标记真的画进正文，计数就该归零。
    await act(async () => {
      fireEvent.click(screen.getByLabelText('nodes.book_next'));
    });
    await waitFor(() => expect(screen.getByText('2 / 2')).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.queryByTestId('book-fullscreen-focus-badge')).toBeNull(),
    );
  });

  it('collapses other chapters to their name and opens one on click', async () => {
    // 第 0 章两条、第 1 章一条。说明都够长（>=30 字），引文够长（>=10 字），
    // 不然 readBookFocusMarks 会当脏数据挡掉。
    await db.nodes.update('b1', {
      bookFocusMarks: [
        {
          id: 'a1',
          createdAt: 1,
          unitIndex: 0,
          quote: 'Fullscreen chapter text',
          note: '本章第一条的批注：这一句是全章的落点，读者第一次进来就该先看到它。',
        },
        {
          id: 'a2',
          createdAt: 2,
          unitIndex: 0,
          quote: 'Fullscreen chapter text again',
          note: '本章第二条的批注：紧跟着上一句，两句要一起看才说得通，别拆开读。',
        },
        {
          id: 'b1m',
          createdAt: 3,
          unitIndex: 1,
          quote: 'Second unit text',
          note: '别章的批注：这一章的起点，承接上一章收尾的那句话才看得出走向。',
        },
      ],
    });
    renderBook();
    await waitFor(() => expect(screen.getByTestId('book-reader-pane')).toBeInTheDocument());

    // React 的 onPointerEnter 是从 pointerover 合成的（enter/leave 不冒泡）。
    await act(async () => {
      fireEvent.pointerOver(screen.getByTestId('book-fullscreen-toggle-focus').parentElement!);
    });
    const list = await screen.findByTestId('book-fullscreen-focus-list');
    const chapters = within(list).getAllByTestId('book-fullscreen-focus-chapter');
    expect(chapters).toHaveLength(2);

    // 当前章默认展开：两条都在，批注也都在。
    expect(chapters[0].getAttribute('data-open')).toBe('true');
    expect(within(list).getAllByTestId('book-fullscreen-focus-list-item')).toHaveLength(2);
    expect(list.textContent).toContain('本章第一条的批注');
    expect(list.textContent).toContain('本章第二条的批注');

    // 别的章压到只剩章名：一个字的内容都不留。
    expect(chapters[1].getAttribute('data-open')).toBe('false');
    // 箭头方向也跟着：收起指右（-rotate-90），展开指下（不转）。
    // 这条是纯视觉的，但曾经反过来过一次——展开时指上，读起来像"收起"。
    // SVG 上的 className 是 SVGAnimatedString，得读 class 属性。
    const chevronOf = (el: HTMLElement) =>
      el.querySelector('[data-testid="icon-ChevronDown"]')?.getAttribute('class') ?? '';
    expect(chevronOf(chapters[1])).toContain('-rotate-90');
    expect(chevronOf(chapters[0])).not.toContain('rotate');
    expect(list.textContent).not.toContain('Second unit text');
    expect(list.textContent).not.toContain('别章的批注');

    // 点章名才展开，一次展开这一章的全部。
    await act(async () => {
      fireEvent.click(chapters[1]);
    });
    expect(chapters[1].getAttribute('data-open')).toBe('true');
    expect(list.textContent).toContain('Second unit text');
    expect(list.textContent).toContain('别章的批注');
    // 本章那两条没被动过。
    expect(list.textContent).toContain('本章第一条的批注');
    expect(within(list).getAllByTestId('book-fullscreen-focus-list-item')).toHaveLength(3);
  });

  it('jumps by clicking the passage itself, and gives it a focus frame', async () => {
    await db.nodes.update('b1', {
      bookFocusMarks: [
        {
          id: 'a1',
          createdAt: 1,
          unitIndex: 0,
          quote: 'Fullscreen chapter text',
          note: '本章的批注：这一句是全章的落点，读者第一次进来就该先看到它。',
        },
        {
          id: 'b1m',
          createdAt: 2,
          unitIndex: 1,
          quote: 'Second unit text',
          note: '别章的批注：这一章的起点，承接上一章收尾的那句话才看得出走向。',
        },
      ],
    });
    renderBook();
    await waitFor(() => expect(screen.getByTestId('book-reader-pane')).toBeInTheDocument());
    await act(async () => {
      fireEvent.pointerOver(screen.getByTestId('book-fullscreen-toggle-focus').parentElement!);
    });
    const list = await screen.findByTestId('book-fullscreen-focus-list');
    const chapters = within(list).getAllByTestId('book-fullscreen-focus-chapter');

    // 别章折叠时里面没有可点的段落。
    expect(within(list).getAllByTestId('book-fullscreen-focus-list-item')).toHaveLength(1);
    await act(async () => {
      fireEvent.click(chapters[1]);
    });
    const items = within(list).getAllByTestId('book-fullscreen-focus-list-item');
    expect(items).toHaveLength(2);

    // 聚焦框：键盘 Tab 过去要看得见在哪，别只剩一个几乎看不出的轮廓。
    const focusFrame = items[1].getAttribute('class') ?? '';
    expect(focusFrame).toContain('focus-visible:ring-2');
    expect(focusFrame).toContain('focus-visible:border-[#C2410C]');
    expect(focusFrame).toContain('hover:border-[#E6E4DF]');

    // 整块可点：不再需要右侧那颗小按钮。
    await act(async () => {
      fireEvent.click(items[1]);
    });
    await waitFor(async () => {
      const saved = await db.nodes.get('b1');
      expect(saved?.bookPageIndex).toBe(1);
    });
  });

  it('角色条不会把对话栏的输入框顶出可视区', async () => {
    // ChatPanel 的根是 h-full（按父容器满高算）。它直接和角色条并排的话，满高加上
    // 顶框那一行就溢出了，外层 overflow-hidden 会把底部的输入框裁掉。
    //
    // 修法是给两者之间加一个占剩余高度的壳——但那只在**栏本身是列容器**时成立。
    // 书籍那一栏本来不是：它是外层行里的一个 flex item，靠行拉伸拿到高度，
    // `flex-1` 在里面完全不生效，壳会缩成内容高度，面板就贴到顶上去了。
    // jsdom 量不出高度，所以这里钉的是两条结构不变式。
        renderBook();
    await screen.findByTestId('surface-persona-controls');
    const rail = screen.getByTestId('surface-persona-strip').parentElement as HTMLElement;
    expect(rail.className).toContain('flex-col');

    const shell = screen.getByTestId('chat-panel').parentElement as HTMLElement;
    expect(shell.className).toContain('flex-1');
    expect(shell.className).toContain('min-h-0');
    expect(shell.parentElement).toBe(rail);
  });


  it('「历史 / 新建」常驻在对话栏顶部那一行的右边，和房间里的人同层', async () => {
    // 它们曾经在顶栏对话按钮的悬停弹层里。现在和对象并排放在同一行，
    // 按钮本身仍由 ChatPanel 拥有，这里只借一个空位。
    renderBook();
    // 等那一行本身：角色条要等角色库查完才渲染，等阅读器面板不算数。
    const slot = await screen.findByTestId('surface-persona-controls');
    expect(slot.querySelector('[data-testid="chat-panel-history"]')).not.toBeNull();
    expect(slot.querySelector('[data-testid="chat-panel-new"]')).not.toBeNull();
    // 顶栏那颗按钮回归成纯粹的开关，弹层整个没了。
    expect(screen.queryByTestId('book-fullscreen-chat-menu')).toBeNull();
  });

  it('opens the mark list from the keyboard, not just the pointer', async () => {
    await db.nodes.update('b1', {
      bookFocusMarks: [
        {
          id: 'a1',
          createdAt: 1,
          unitIndex: 0,
          quote: 'Fullscreen chapter text',
          note: '本章的批注：这一句是全章的落点，读者第一次进来就该先看到它。',
        },
      ],
    });
    renderBook();
    await waitFor(() => expect(screen.getByTestId('book-reader-pane')).toBeInTheDocument());

    // 弹层默认 hidden，hidden 子树不进 tab 序——所以只挂 onPointerEnter 的话，
    // 键盘用户永远打不开它。
    expect(screen.queryByTestId('book-fullscreen-focus-list')).toBeNull();

    // 焦点落进高亮按钮所在的容器，弹层就要开。发 focusIn 而不是 focus：
    // React 的 onFocus 是在根节点上听 focusin 合成的，focus 自己不冒泡。
    await act(async () => {
      fireEvent.focusIn(screen.getByTestId('book-fullscreen-toggle-focus').parentElement!);
    });
    await waitFor(() => expect(screen.getByTestId('book-fullscreen-focus-list')).toBeInTheDocument());

    // 「历史 / 新建」不再需要这套：它们常驻在角色条那一行，键盘直接 Tab 得到。
    const slot = screen.getByTestId('surface-persona-controls');
    expect(slot.querySelector('button')).not.toBeNull();
  });





  it('keeps existing marks, the badge, and the list when the companion is off', async () => {
    setAutoAnnotationEnabled('book', false);
    await db.nodes.update('b1', {
      bookFocusMarks: [
        {
          id: 'a1',
          createdAt: 1,
          unitIndex: 0,
          quote: 'Fullscreen chapter text',
          note: '本章的批注：这一句是全章的落点，读者第一次进来就该先看到它。',
        },
        {
          id: 'b1m',
          createdAt: 2,
          unitIndex: 1,
          quote: 'Second unit text',
          note: '别章的批注：这一章的起点，承接上一章收尾的那句话才看得出走向。',
        },
      ],
    });
    renderBook();
    await waitFor(() => expect(screen.getByTestId('book-reader-pane')).toBeInTheDocument());

    // 开关关掉，只是不再自动标新的。这一章已经标上的句子还在正文里。
    await waitFor(() => {
      const marked = document.querySelector('[data-book-focus-id="a1"]');
      expect(marked?.textContent).toContain('Fullscreen chapter text');
    });
    // 当前这一章算看过了，角标只数还没翻到的那一章。
    await waitFor(() => expect(screen.getByTestId('book-fullscreen-focus-badge')).toHaveTextContent('1'));
    await act(async () => {
      fireEvent.pointerOver(screen.getByTestId('book-fullscreen-toggle-focus').parentElement!);
    });
    const list = await screen.findByTestId('book-fullscreen-focus-list');
    expect(list.textContent).toContain('Fullscreen chapter text');
    // 别的章默认收着，点开章名才看得到那一句。清单在，才能点开。
    const otherChapter = list.querySelector<HTMLButtonElement>('button[data-unit="1"]');
    expect(otherChapter).toBeTruthy();
    await act(async () => {
      fireEvent.click(otherChapter!);
    });
    expect(list.textContent).toContain('Second unit text');
  });

  it('drops a pass that was already in flight when the reader turns it off', async () => {
    let release: ((value: string) => void) | null = null;
    callAi.mockImplementation(() => new Promise<string>((res) => {
      release = res;
    }));
    renderBook();
    await waitFor(() => expect(screen.getByTestId('book-reader-pane')).toBeInTheDocument());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 1700));
    });
    expect(callAi).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByTestId('book-fullscreen-toggle-focus'));
    });
    await waitFor(() => expect(isAutoAnnotationEnabled('book')).toBe(false));

    await act(async () => {
      release?.(
        JSON.stringify({
          marks: [
            {
              quote: 'Fullscreen chapter text',
              note: '这一章其实在把问题从「这一段讲了什么」换成「人给自己设了什么条件」，值得停一下再看后面。',
            },
          ],
          message: '你有没有觉得，这一章讲的是同一件事被说成了两遍？',
        }),
      );
      await new Promise((r) => setTimeout(r, 50));
    });
    const saved = await db.nodes.get('b1');
    expect(saved?.bookFocusMarks ?? []).toHaveLength(0);
    expect(saved?.bookChatMessages ?? []).toHaveLength(0);
  });

  it('shows the footnote only when the marked sentence is clicked', async () => {
    await db.nodes.update('b1', {
      bookFocusMarks: [
        {
          id: 'm1',
          unitIndex: 0,
          quote: 'Fullscreen chapter text',
          note: '这一章其实在把问题从「这一段讲了什么」换成「人给自己设了什么条件」。',
          createdAt: 1,
        },
      ],
    });
    renderBook();
    await waitFor(() => expect(screen.getByTestId('book-body')).toBeInTheDocument());

    const mark = () =>
      document.querySelector<HTMLElement>('[data-book-focus-id="m1"]')!;
    const note = () => document.querySelector<HTMLElement>('[data-book-focus-note]')!;

    // 先得真的标上去。
    await waitFor(() => expect(mark()).toBeTruthy());
    expect(note().hidden).toBe(true);

    await act(async () => {
      fireEvent.click(mark());
    });
    await waitFor(() => expect(note().hidden).toBe(false));
    expect(note().textContent).toContain('人给自己设了什么条件');

    // 点空白收起来——不然一脚注开着就再也关不掉了。
    await act(async () => {
      fireEvent.pointerDown(document.body);
    });
    await waitFor(() => expect(note().hidden).toBe(true));
  });

  it('copies the passage and its note in one go, and deletes a mark', async () => {
    const copied: string[] = [];
    const write = navigator.clipboard?.writeText;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => void copied.push(text) },
    });
    await db.nodes.update('b1', {
      bookFocusMarks: [
        {
          id: 'm1',
          unitIndex: 0,
          quote: 'Fullscreen chapter text',
          note: '这一章其实在把问题从「这一段讲了什么」换成「人给自己设了什么条件」。',
          createdAt: 1,
        },
      ],
    });
    renderBook();
    await waitFor(() => expect(screen.getByTestId('book-body')).toBeInTheDocument());

    const mark = () => document.querySelector<HTMLElement>('[data-book-focus-id="m1"]')!;
    const note = () =>
      document.querySelector<HTMLElement>('[data-book-focus-note][data-book-focus-for="m1"]')!;
    await waitFor(() => expect(mark()).toBeTruthy());

    await act(async () => {
      fireEvent.click(mark());
    });
    await waitFor(() => expect(note().hidden).toBe(false));
    // 脚注的正文必须落在自己的 span 里，不能直接塞在脚注上——
    // 否则复制按钮会和文字混在一个文本节点里。
    expect(note().querySelector('.book-focus-note-text')?.textContent).toContain('人给自己设了什么条件');

    await act(async () => {
      fireEvent.click(note().querySelector('[data-book-focus-action="copy"]')!);
    });
    // 原文 + 空行 + 批注，一次拿走。
    expect(copied[0]).toBe(
      'Fullscreen chapter text\n\n这一章其实在把问题从「这一段讲了什么」换成「人给自己设了什么条件」。',
    );
    // 点复制不该顺手把脚注收起来。
    expect(note().hidden).toBe(false);

    await act(async () => {
      fireEvent.click(note().querySelector('[data-book-focus-action="delete"]')!);
    });
    await waitFor(async () => {
      expect((await db.nodes.get('b1'))?.bookFocusMarks).toHaveLength(0);
    });
    // 用户动过这一章，就别再自动读它了——否则删完 1.5 秒它自己长回来。
    expect((await db.nodes.get('b1'))?.bookFocusDismissedUnits).toEqual([0]);

    if (write) Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: write } });
  });

  it('does not read a chapter the user cleared by hand', async () => {
    await db.nodes.update('b1', { bookFocusDismissedUnits: [0] });
    renderBook();
    await waitFor(() => expect(screen.getByTestId('book-reader-pane')).toBeInTheDocument());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 2200));
    });
    expect(callAi).not.toHaveBeenCalled();
  });

  it('anchors the footnote to the end of the sentence, not to the viewport', async () => {
    // 这条钉的是一次真实故障：脚注是标注的**兄弟**节点而不是子节点，
    // 于是 CSS 里那套 left:100% 落到最近的定位祖先上——正文里没有，
    // 整块跑到视口原点去了，贴着屏幕左下角出现。
    // jsdom 量不出布局，所以这里把矩形直接喂进去。
    await db.nodes.update('b1', {
      bookFocusMarks: [
        {
          id: 'm1',
          unitIndex: 0,
          quote: 'Fullscreen chapter text',
          note: '这一章其实在把问题从「这一段讲了什么」换成「人给自己设了什么条件」。',
          createdAt: 1,
        },
      ],
    });
    renderBook();
    await waitFor(() => expect(screen.getByTestId('book-body')).toBeInTheDocument());
    const body = screen.getByTestId('book-body');
    const mark = () => document.querySelector<HTMLElement>('[data-book-focus-id="m1"]')!;
    const note = () => document.querySelector<HTMLElement>('[data-book-focus-note]')!;

    await waitFor(() => expect(mark()).toBeTruthy());
    body.getBoundingClientRect = () =>
      ({ left: 0, right: 800, top: 0, bottom: 600 }) as DOMRect;
    // 折成两行的标注：最后一行才是脚注该待的地方。
    mark().getClientRects = () =>
      [
        { left: 300, right: 640, top: 100, bottom: 140 },
        { left: 300, right: 520, top: 140, bottom: 180 },
      ] as unknown as DOMRectList;

    await act(async () => {
      fireEvent.click(mark());
    });
    await waitFor(() => expect(note().hidden).toBe(false));
    expect(note().style.left).toBe('300px');
    // 贴着最后一行字的底边。往下留的那点空隙由 .book-focus-note 的 margin-top
    // 负责，JS 里再补一次就成 16px 了。
    expect(note().style.top).toBe('180px');
  });

  it('says so when the read fails, without touching the page', async () => {
    callAi.mockImplementation(async () => {
      throw new Error('network down');
    });
    renderBook();
    await waitFor(() => expect(screen.getByTestId('book-reader-pane')).toBeInTheDocument());

    await waitFor(() => expect(callAi).toHaveBeenCalled(), SETTLED);
    // 正文照常读，开关也没变成报错态，标注也没写进去。
    expect(screen.getByTestId('book-reader-pane')).toBeInTheDocument();
    expect(screen.getByTestId('book-fullscreen-toggle-focus')).toBeInTheDocument();
    const saved = await db.nodes.get('b1');
    expect(saved?.bookFocusMarks ?? []).toHaveLength(0);

    // 但必须**说**出来。静默失败的话，"模型调不动"和"这一章没什么值得标的"
    // 在界面上长得一模一样，两者就再也分不开了——只能靠翻 DevTools 才看得出。
    await waitFor(() => expect(screen.getByTestId('chat-panel-error')).toHaveTextContent('network down'));
  });
  it('inviting a persona writes the room onto the book card, not into panel state', async () => {
    // 名单要跟着这本书走：换一本书就该换一个说话的人，关掉全屏再打开也还在。
    await db.agents.clear();
    await db.agents.add({ id: 'astr', name: '问镜', role: '记者', prompt: 'P' });
    renderBook();

    await waitFor(() => {
      expect(screen.getByTestId('surface-persona-strip')).toBeInTheDocument();
    });
    fireEvent.click(await screen.findByTestId('canvas-chat-room-add'));
    fireEvent.click(await screen.findByTestId('canvas-chat-room-library-astr'));

    await waitFor(async () => {
      const row = await db.nodes.get('b1');
      expect(row?.bookChatPersonaIds).toEqual(['astr']);
    });
  });

});

describe('BookFullscreen', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await seedBook();
  });

  it('renders the book body and closes', async () => {
    const onClose = vi.fn();
    render(withAppDialogProvider(<BookFullscreen nodeId="b1" onClose={onClose} />));
    await waitFor(() => {
      expect(screen.getByTestId('book-fullscreen')).toBeInTheDocument();
      expect(screen.getByText('Fullscreen chapter text')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('book-fullscreen-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('lays out excerpts, reader and chat side by side', async () => {
    render(withAppDialogProvider(<BookFullscreen nodeId="b1" onClose={vi.fn()} />));
    await waitFor(() => {
      expect(screen.getByTestId('book-excerpt-pane')).toBeInTheDocument();
    });
    expect(screen.getByTestId('book-reader-pane')).toBeInTheDocument();
    expect(screen.getByTestId('book-chat-pane')).toBeInTheDocument();
    expect(screen.getByTestId('book-excerpt-rail')).toBeInTheDocument();
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
  });

  it('collapses each side pane from its header toggle', async () => {
    render(withAppDialogProvider(<BookFullscreen nodeId="b1" onClose={vi.fn()} />));
    await waitFor(() => {
      expect(screen.getByTestId('book-excerpt-pane')).toBeInTheDocument();
    });
    const excerptsToggle = screen.getByTestId('book-fullscreen-toggle-excerpts');
    const chatToggle = screen.getByTestId('book-fullscreen-toggle-chat');
    expect(screen.getByTestId('book-excerpt-pane')).not.toHaveAttribute('aria-hidden');
    expect(screen.getByTestId('book-chat-pane')).not.toHaveAttribute('aria-hidden');

    fireEvent.click(excerptsToggle);
    fireEvent.click(chatToggle);
    expect(screen.getByTestId('book-excerpt-pane')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('book-chat-pane')).toHaveAttribute('aria-hidden', 'true');

    fireEvent.click(excerptsToggle);
    expect(screen.getByTestId('book-excerpt-pane')).not.toHaveAttribute('aria-hidden');
  });



  it('offers the mic once both speech keys are configured, and hides it otherwise', async () => {
    // 识别（火山 ASR）和朗读（MiniMax TTS）缺一不可：只有一个 key 时那个按钮
    // 只能让人听到半截流程，所以干脆不给。
    const { unmount } = render(withAppDialogProvider(<BookFullscreen nodeId="b1" onClose={vi.fn()} />));
    await waitFor(() => expect(screen.getByTestId('chat-panel')).toBeInTheDocument());
    expect(screen.queryByTestId('chat-panel-voice')).toBeNull();
    unmount();

    const withAsrOnly = render(
      withAppDialogProvider(
        <BookFullscreen
          nodeId="b1"
          onClose={vi.fn()}
          aiConfig={{ volcAsrApiKey: 'asr-key' } as AIConfig}
        />,
      ),
    );
    await waitFor(() => expect(screen.getByTestId('chat-panel')).toBeInTheDocument());
    expect(screen.queryByTestId('chat-panel-voice')).toBeNull();
    withAsrOnly.unmount();

    render(
      withAppDialogProvider(
        <BookFullscreen
          nodeId="b1"
          onClose={vi.fn()}
          aiConfig={{ volcAsrApiKey: 'asr-key', minimaxApiKey: 'tts-key' } as AIConfig}
        />,
      ),
    );
    await waitFor(() => expect(screen.getByTestId('chat-panel-voice')).toBeInTheDocument());
  });

  it('hands the ticked excerpts to the AI when the user picks them in the rail', async () => {
    // 这条链路跨了三个文件：勾选 → focusedExcerpts → prompt。
    // 断在哪一环都不会报错，只会静悄悄地少送摘抄，所以在这儿钉死。
    // 关掉 AI 伴读：它自己也会调一次模型，会把下面按次序数的那次调用顶掉。
    setAutoAnnotationEnabled('book', false);
    await db.nodes.update('b1', {
      bookExcerpts: [
        excerpt({ id: 'e1', text: '勾上的那条' }),
        excerpt({ id: 'e2', text: '没勾的那条' }),
      ],
    });
    // 这条按次序数调用，所以前一个 describe 留下的记录得先清掉。
    callAi.mockReset();
    callAi.mockImplementation(async (opts: { onStreamChunk?: (acc: string) => void }) => {
      const text = '{"reply":"知道了。"}';
      opts.onStreamChunk?.(text);
      return text;
    });

    render(
      withAppDialogProvider(
        <BookFullscreen
          nodeId="b1"
          onClose={vi.fn()}
          aiConfig={{ provider: 'openrouter', apiKey: 'k' } as AIConfig}
        />,
      ),
    );
    await waitFor(() => expect(screen.getAllByTestId('book-excerpt-card')).toHaveLength(2));

    // 勾上就够了：勾选本身就是"这一轮递 AI 这几条"，不需要再按一颗按钮。
    fireEvent.click(screen.getByTestId('book-excerpt-multi'));
    fireEvent.click(screen.getAllByTestId('book-excerpt-checkbox')[0]);
    expect(screen.queryByTestId('book-excerpt-ask-many')).toBeNull();

    fireEvent.change(screen.getByTestId('chat-panel-input'), {
      target: { value: '这些我在想什么？' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('chat-panel-send'));
    });

    await waitFor(() => expect(callAi).toHaveBeenCalled());
    const prompt = String(
      (callAi.mock.calls[0]?.[0] as { messages?: Array<{ content?: string }> })?.messages?.[0]
        ?.content ?? '',
    );
    expect(prompt).toContain('勾上的那条');
    expect(prompt).not.toContain('没勾的那条');
  });

  it('tells the user the AI is reading their ticked excerpts', async () => {
    // 挑了不等于用户知道挑了。没有这条提示，他只能猜 AI 到底看见了什么。
    await db.nodes.update('b1', {
      bookExcerpts: [
        excerpt({ id: 'e1', text: '第一条' }),
        excerpt({ id: 'e2', text: '第二条' }),
      ],
    });

    render(withAppDialogProvider(<BookFullscreen nodeId="b1" onClose={vi.fn()} />));
    await waitFor(() => expect(screen.getAllByTestId('book-excerpt-card')).toHaveLength(2));
    expect(screen.queryByTestId('chat-panel-excerpt-focus')).toBeNull();

    fireEvent.click(screen.getByTestId('book-excerpt-multi'));
    fireEvent.click(screen.getAllByTestId('book-excerpt-checkbox')[0]);
    // 勾一条就提示，不用先点"给 AI 看"——那一下只是让它知道你能这么用。
    await waitFor(() =>
      expect(screen.getByTestId('chat-panel-excerpt-focus')).toHaveTextContent('1'),
    );

    // 全选时条数跟着走。
    fireEvent.click(screen.getByTestId('book-excerpt-select-all'));
    await waitFor(() =>
      expect(screen.getByTestId('chat-panel-excerpt-focus')).toHaveTextContent('2'),
    );

    // 退出多选＝不递了，提示也得跟着走，不能留一条说谎的话。
    fireEvent.click(screen.getByTestId('book-excerpt-selection-done'));
    await waitFor(() =>
      expect(screen.queryByTestId('chat-panel-excerpt-focus')).toBeNull(),
    );
  });

  it('lists saved excerpts and jumps back to the chapter they came from', async () => {
    await db.nodes.update('b1', { bookExcerpts: [excerpt()] });

    render(withAppDialogProvider(<BookFullscreen nodeId="b1" onClose={vi.fn()} />));
    await waitFor(() => {
      expect(screen.getByTestId('book-excerpt-card')).toBeInTheDocument();
    });
    expect(screen.getByText('第二条的正文')).toBeInTheDocument();

    // 标题行那排动作作用在选中的那条上，所以先选。
    expect(screen.getByTestId('book-excerpt-jump')).toBeDisabled();
    fireEvent.click(screen.getByTestId('book-excerpt-card'));
    expect(screen.getByTestId('book-excerpt-jump')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('book-excerpt-jump'));
    await waitFor(async () => {
      const saved = await db.nodes.get('b1');
      expect(saved?.bookPageIndex).toBe(1);
    });
  });

  it('deletes an excerpt from the rail', async () => {
    await db.nodes.update('b1', { bookExcerpts: [excerpt()] });

    render(withAppDialogProvider(<BookFullscreen nodeId="b1" onClose={vi.fn()} />));
    await waitFor(() => {
      expect(screen.getByTestId('book-excerpt-card')).toBeInTheDocument();
    });
    // 标题行的删除作用于选中的那条，所以先选中。
    fireEvent.click(screen.getByTestId('book-excerpt-card'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('book-excerpt-delete'));
    });
    // 断言 DOM 而不是数据库：liveQuery 的重渲染要等一拍，只等数据库会抢跑。
    await waitFor(() => {
      expect(screen.queryByTestId('book-excerpt-card')).toBeNull();
    });
    const saved = await db.nodes.get('b1');
    expect(saved?.bookExcerpts).toEqual([]);
  });

  it('clicking an excerpt card puts it in front of the AI without sending', async () => {
    await db.nodes.update('b1', { bookExcerpts: [excerpt()] });

    render(withAppDialogProvider(<BookFullscreen nodeId="b1" onClose={vi.fn()} />));
    await waitFor(() => {
      expect(screen.getByTestId('book-excerpt-card')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('book-excerpt-card'));

    // 右栏出现摘要，用户才知道 AI 正在读哪一条；输入框仍然空着（不自动发送）。
    const chip = screen.getByTestId('chat-panel-selection');
    expect(chip).toHaveTextContent('reference.book_chat_selection_label');
    expect(chip).toHaveTextContent('第二条的正文');
    expect(screen.getByTestId('chat-panel-input')).toHaveValue('');
    expect(screen.getByTestId('book-excerpt-card')).toHaveAttribute('aria-pressed', 'true');
  });

  it('clearing the chat selection un-highlights the card', async () => {
    await db.nodes.update('b1', { bookExcerpts: [excerpt()] });

    render(withAppDialogProvider(<BookFullscreen nodeId="b1" onClose={vi.fn()} />));
    await waitFor(() => {
      expect(screen.getByTestId('book-excerpt-card')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('book-excerpt-card'));
    fireEvent.click(screen.getByTestId('chat-panel-selection-clear'));

    expect(screen.queryByTestId('chat-panel-selection')).toBeNull();
    expect(screen.getByTestId('book-excerpt-card')).toHaveAttribute('aria-pressed', 'false');
  });

  it('drops the excerpt selection when the click lands outside the rail', async () => {
    await db.nodes.update('b1', { bookExcerpts: [excerpt()] });

    render(withAppDialogProvider(<BookFullscreen nodeId="b1" onClose={vi.fn()} />));
    await waitFor(() => {
      expect(screen.getByTestId('book-excerpt-card')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('book-excerpt-card'));
    expect(screen.getByTestId('book-excerpt-card')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('book-excerpt-delete')).not.toBeDisabled();

    // 点正文里别处 = 取消选中：不该留一条顶着橙色边框的、也不该让删除一直亮着。
    // 必须点 book-body 而不是外层 book-reader-pane：正文容器自己在冒泡阶段
    // stopPropagation（选中文字时不触发画布拖拽），派发到外层会绕开那条路径。
    fireEvent.pointerDown(screen.getByTestId('book-body'));
    await waitFor(() => {
      expect(screen.getByTestId('book-excerpt-card')).toHaveAttribute('aria-pressed', 'false');
    });
    expect(screen.getByTestId('book-excerpt-delete')).toBeDisabled();
    // 正文不在伴读栏里，所以这条 chip 也该跟着收——「结束」按点击位置判，不看焦点。
    expect(screen.queryByTestId('chat-panel-selection')).toBeNull();
  });

  it('keeps the chat chip when the click lands inside the chat pane', async () => {
    await db.nodes.update('b1', { bookExcerpts: [excerpt()] });

    render(withAppDialogProvider(<BookFullscreen nodeId="b1" onClose={vi.fn()} />));
    await waitFor(() => {
      expect(screen.getByTestId('book-excerpt-card')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('book-excerpt-card'));
    expect(screen.getByTestId('chat-panel-selection')).toBeInTheDocument();

    // 选完摘抄顺手去输入框打字：伴读栏之内不算离开，那段上下文正是要交给 AI 的。
    fireEvent.pointerDown(screen.getByTestId('book-chat-pane'));
    expect(screen.getByTestId('chat-panel-selection')).toBeInTheDocument();
  });

  it('closes the note editor when the click lands on the body text', async () => {
    // 点的是正文容器本身：它在冒泡阶段 stopPropagation，document 上的监听器
    // 必须是捕获阶段才收得到这一下。派发到外层 book-reader-pane 测不到这件事。
    await db.nodes.update('b1', { bookExcerpts: [excerpt()] });

    render(withAppDialogProvider(<BookFullscreen nodeId="b1" onClose={vi.fn()} />));
    await waitFor(() => {
      expect(screen.getByTestId('book-excerpt-card')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('book-excerpt-note-add'));
    expect(screen.getByTestId('book-excerpt-note-input')).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByTestId('book-body'));

    expect(screen.queryByTestId('book-excerpt-note-input')).toBeNull();
  });

  it('keeps the selection when the click stays inside the rail', async () => {
    await db.nodes.update('b1', { bookExcerpts: [excerpt()] });

    render(withAppDialogProvider(<BookFullscreen nodeId="b1" onClose={vi.fn()} />));
    await waitFor(() => {
      expect(screen.getByTestId('book-excerpt-card')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('book-excerpt-card'));

    // 在栏里点想法、保存这些按钮不能顺手把选中态清了——否则删除按钮永远点不到东西。
    fireEvent.pointerDown(screen.getByTestId('book-excerpt-rail'));
    fireEvent.pointerDown(screen.getByTestId('book-excerpt-delete'));
    expect(screen.getByTestId('book-excerpt-card')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('book-excerpt-delete')).not.toBeDisabled();
  });

  it('deleting the excerpt the AI was reading clears the chip too', async () => {
    await db.nodes.update('b1', { bookExcerpts: [excerpt()] });

    render(withAppDialogProvider(<BookFullscreen nodeId="b1" onClose={vi.fn()} />));
    await waitFor(() => {
      expect(screen.getByTestId('book-excerpt-card')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('book-excerpt-card'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('book-excerpt-delete'));
    });

    await waitFor(() => {
      expect(screen.queryByTestId('book-excerpt-card')).toBeNull();
    });
    expect(screen.queryByTestId('chat-panel-selection')).toBeNull();
  });

  it('sends a text selection to the chat without any button', async () => {
    const { container } = render(
      withAppDialogProvider(<BookFullscreen nodeId="b1" onClose={vi.fn()} />),
    );
    await waitFor(() => {
      expect(screen.getByTestId('book-reader-pane')).toBeInTheDocument();
    });

    selectReaderText(container);

    // 和长文编辑器一样：选中就出现在右栏，不用点「问 AI」，也不自动发送。
    await waitFor(() => {
      expect(screen.getByTestId('chat-panel-selection')).toHaveTextContent(
        'Fullscreen chapter text',
      );
    });
    expect(screen.getByTestId('chat-panel-input')).toHaveValue('');
  });

  it('lets a card click win over a selection that is still queued', async () => {
    await db.nodes.update('b1', { bookExcerpts: [excerpt()] });
    const { container } = render(
      withAppDialogProvider(<BookFullscreen nodeId="b1" onClose={vi.fn()} />),
    );
    await waitFor(() => {
      expect(screen.getByTestId('book-excerpt-card')).toBeInTheDocument();
    });

    // 选中文字后立刻点卡片：右栏该显示卡片那条，而不是还没到点的那次选区更新。
    selectReaderText(container);
    fireEvent.click(screen.getByTestId('book-excerpt-card'));

    await waitFor(() => {
      expect(screen.getByTestId('chat-panel-selection')).toHaveTextContent('第二条的正文');
    });
    // 等过防抖窗口，确认排队的那次选区更新没有反过来盖掉卡片。
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    expect(screen.getByTestId('chat-panel-selection')).toHaveTextContent('第二条的正文');
    expect(screen.getByTestId('book-excerpt-card')).toHaveAttribute('aria-pressed', 'true');
  });

  it('mounts the selection toolbar inside the fullscreen, not under it', async () => {
    // 工具栏是 `fixed z-[80]`；挂到 document.body 时会被 `z-[125]` 的不透明全屏整个盖住，
    // 表现为"选中了但按钮不出现"。这个断言就是那次的防回归。
    const { container } = render(
      withAppDialogProvider(<BookFullscreen nodeId="b1" onClose={vi.fn()} />),
    );
    await waitFor(() => {
      expect(screen.getByTestId('book-reader-pane')).toBeInTheDocument();
    });

    const scroller = container.querySelector('[data-canvas-node-context-text]') as HTMLElement;
    selectReaderText(container);

    const toolbar = screen.getByTestId('text-selection-toolbar');
    expect(screen.getByTestId('book-fullscreen').contains(toolbar)).toBe(true);
    expect(toolbar.parentElement).not.toBe(document.body);

    // 全屏阅读里只留「摘抄」：思维导图和问 AI 在画布的卡片上有。
    expect(within(toolbar).getByRole('button', { name: 'nodes.book_to_card' })).toBeInTheDocument();
    expect(within(toolbar).queryByRole('button', { name: 'nodes.book_expand' })).toBeNull();
    expect(within(toolbar).queryByRole('button', { name: 'nodes.book_ask_ai' })).toBeNull();
  });

  it('saves a thought on the excerpt itself', async () => {
    await db.nodes.update('b1', { bookExcerpts: [excerpt()] });

    render(withAppDialogProvider(<BookFullscreen nodeId="b1" onClose={vi.fn()} />));
    await waitFor(() => {
      expect(screen.getByTestId('book-excerpt-card')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('book-excerpt-note-add'));
    const input = screen.getByTestId('book-excerpt-note-input');
    fireEvent.change(input, { target: { value: '这段正好是我上周踩的坑' } });
    // 自动保存：失焦就写回，Esc 是"我写完了"（关掉编辑器），不是"别存"。
    fireEvent.blur(input);
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Escape' });
    });

    // 存回去之后卡片上要看得见，光写进库不算数。
    await waitFor(() => {
      expect(screen.getByTestId('book-excerpt-note')).toHaveTextContent(
        '这段正好是我上周踩的坑',
      );
    });
    const saved = await db.nodes.get('b1');
    expect(saved?.bookExcerpts?.[0]?.note).toBe('这段正好是我上周踩的坑');
  });

  it('hands the thought to the canvas export alongside the passage', async () => {
    const onExtractSelectionToCard = vi.fn();
    const row = excerpt({ note: '这段正好是我上周踩的坑' });
    await db.nodes.update('b1', { bookExcerpts: [row] });

    render(
      withAppDialogProvider(
        <BookFullscreen
          nodeId="b1"
          onClose={vi.fn()}
          onExtractSelectionToCard={onExtractSelectionToCard}
        />,
      ),
    );
    await waitFor(() => {
      expect(screen.getByTestId('book-excerpt-card')).toBeInTheDocument();
    });

    // 「放上画布」在标题行上，作用在选中的那条：先选，再放。
    expect(screen.getByTestId('book-excerpt-to-canvas')).toBeDisabled();
    fireEvent.click(screen.getByTestId('book-excerpt-card'));
    fireEvent.click(screen.getByTestId('book-excerpt-to-canvas'));
    expect(onExtractSelectionToCard).toHaveBeenCalledWith(
      row.text,
      row.unitLabel,
      'b1',
      row.note,
    );
  });

  it('passes no thought to the canvas export for a plain excerpt', async () => {
    const onExtractSelectionToCard = vi.fn();
    await db.nodes.update('b1', { bookExcerpts: [excerpt()] });

    render(
      withAppDialogProvider(
        <BookFullscreen
          nodeId="b1"
          onClose={vi.fn()}
          onExtractSelectionToCard={onExtractSelectionToCard}
        />,
      ),
    );
    await waitFor(() => {
      expect(screen.getByTestId('book-excerpt-card')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('book-excerpt-card'));
    fireEvent.click(screen.getByTestId('book-excerpt-to-canvas'));
    expect(onExtractSelectionToCard).toHaveBeenCalledWith('第二条的正文', 'Ch2', 'b1', undefined);
  });

  it('carries the excerpt already being read into multi-select', async () => {
    await db.nodes.update('b1', { bookExcerpts: [excerpt()] });
    render(withAppDialogProvider(<BookFullscreen nodeId="b1" onClose={vi.fn()} />));
    await waitFor(() => {
      expect(screen.getByTestId('book-excerpt-card')).toBeInTheDocument();
    });

    // 「就这条问 AI」点完再开多选：手里那条应该已经在勾选里，
    // 否则圈选第一下就等于把它取消掉了。
    fireEvent.click(screen.getByTestId('book-excerpt-card'));
    fireEvent.click(screen.getByTestId('book-excerpt-multi'));
    expect(screen.getByTestId('book-excerpt-card')).toHaveAttribute('aria-pressed', 'true');
  });

  it('deletes every checked excerpt in one go, after confirming', async () => {
    await db.nodes.update('b1', {
      bookExcerpts: [
        excerpt({ id: 'e1', text: '第一条' }),
        excerpt({ id: 'e2', text: '第二条' }),
        excerpt({ id: 'e3', text: '第三条' }),
      ],
    });
    render(withAppDialogProvider(<BookFullscreen nodeId="b1" onClose={vi.fn()} />));
    await waitFor(() => {
      expect(screen.getAllByTestId('book-excerpt-card')).toHaveLength(3);
    });

    fireEvent.click(screen.getByTestId('book-excerpt-multi'));
    fireEvent.click(screen.getAllByTestId('book-excerpt-card')[0]);
    fireEvent.click(screen.getAllByTestId('book-excerpt-card')[2]);
    fireEvent.click(screen.getByTestId('book-excerpt-delete'));

    // 一次丢三条摘抄不是"点错了也就少一条"，所以先问一句。
    // 确认按钮用的是摘抄自己的删除文案，不是通用的 dialog.confirm。
    fireEvent.click(await screen.findByRole('button', { name: 'reference.book_excerpt_delete' }));

    await waitFor(async () => {
      const saved = await db.nodes.get('b1');
      expect(saved?.bookExcerpts?.map((row) => row.id)).toEqual(['e2']);
    });
    expect(screen.getAllByTestId('book-excerpt-card')).toHaveLength(1);
  });

  it('keeps every checked excerpt when the confirmation is declined', async () => {
    await db.nodes.update('b1', {
      bookExcerpts: [excerpt({ id: 'e1', text: '第一条' }), excerpt({ id: 'e2', text: '第二条' })],
    });
    render(withAppDialogProvider(<BookFullscreen nodeId="b1" onClose={vi.fn()} />));
    await waitFor(() => {
      expect(screen.getAllByTestId('book-excerpt-card')).toHaveLength(2);
    });

    fireEvent.click(screen.getByTestId('book-excerpt-multi'));
    fireEvent.click(screen.getAllByTestId('book-excerpt-card')[0]);
    fireEvent.click(screen.getAllByTestId('book-excerpt-card')[1]);
    fireEvent.click(screen.getByTestId('book-excerpt-delete'));
    fireEvent.click(await screen.findByRole('button', { name: 'dialog.cancel' }));

    const saved = await db.nodes.get('b1');
    expect(saved?.bookExcerpts).toHaveLength(2);
  });

  it('exports every checked excerpt to the canvas', async () => {
    const onExtractSelectionToCard = vi.fn();
    await db.nodes.update('b1', {
      bookExcerpts: [
        excerpt({ id: 'e1', text: '第一条' }),
        excerpt({ id: 'e2', text: '第二条' }),
      ],
    });
    render(
      withAppDialogProvider(
        <BookFullscreen
          nodeId="b1"
          onClose={vi.fn()}
          onExtractSelectionToCard={onExtractSelectionToCard}
        />,
      ),
    );
    await waitFor(() => {
      expect(screen.getAllByTestId('book-excerpt-card')).toHaveLength(2);
    });

    fireEvent.click(screen.getByTestId('book-excerpt-multi'));
    fireEvent.click(screen.getAllByTestId('book-excerpt-card')[0]);
    fireEvent.click(screen.getAllByTestId('book-excerpt-card')[1]);
    fireEvent.click(screen.getByTestId('book-excerpt-to-canvas'));

    // 一条一张卡，顺序跟着摘抄本。
    expect(onExtractSelectionToCard).toHaveBeenCalledTimes(2);
    expect(onExtractSelectionToCard.mock.calls.map((call) => call[0])).toEqual([
      '第一条',
      '第二条',
    ]);
  });
});

describe('BookFullscreen jump highlight', () => {
  // jsdom 没有 Custom Highlight API；搭一个最小替身，好断言「到底注册了什么」。
  class FakeHighlight {
    ranges: Range[];
    constructor(...ranges: Range[]) {
      this.ranges = ranges;
    }
  }
  const highlights = new Map<string, unknown>();

  beforeEach(async () => {
    highlights.clear();
    Object.defineProperty(globalThis.CSS, 'highlights', {
      configurable: true,
      value: {
        set: (name: string, value: unknown) => highlights.set(name, value),
        delete: (name: string) => highlights.delete(name),
      },
    });
    vi.stubGlobal('Highlight', FakeHighlight);
    await db.nodes.clear();
    await seedBook();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(globalThis.CSS as object, 'highlights');
  });

  it('marks the passage it jumped back to', async () => {
    await db.nodes.update('b1', { bookExcerpts: [excerpt({ text: 'Second unit text' })] });
    render(withAppDialogProvider(<BookFullscreen nodeId="b1" onClose={vi.fn()} />));
    await waitFor(() => {
      expect(screen.getByTestId('book-excerpt-card')).toBeInTheDocument();
    });
    expect(highlights.has('spoor-book-passage')).toBe(false);

    fireEvent.click(screen.getByTestId('book-excerpt-card'));
    fireEvent.click(screen.getByTestId('book-excerpt-jump'));

    await waitFor(() => {
      expect(highlights.has('spoor-book-passage')).toBe(true);
    });
    const registered = highlights.get('spoor-book-passage') as FakeHighlight;
    expect(registered.ranges[0]?.toString()).toContain('Second unit text');
  });

  it('leaves nothing highlighted when the excerpt cannot be found in the chapter', async () => {
    await db.nodes.update('b1', { bookExcerpts: [excerpt({ text: '这段话并不在第二章里' })] });
    render(withAppDialogProvider(<BookFullscreen nodeId="b1" onClose={vi.fn()} />));
    await waitFor(() => {
      expect(screen.getByTestId('book-excerpt-card')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('book-excerpt-card'));
    fireEvent.click(screen.getByTestId('book-excerpt-jump'));

    await waitFor(async () => {
      const saved = await db.nodes.get('b1');
      expect(saved?.bookPageIndex).toBe(1);
    });
    expect(highlights.has('spoor-book-passage')).toBe(false);
  });

  // 高亮是给落点指路的：鼠标压在那段上时留着，移开就不亮了。
  const PASSAGE_RECT = { left: 120, right: 480, top: 200, bottom: 260 } as DOMRect;

  /** jsdom 量不出行矩形，鼠标在不在那段上就无从判断——补一个假的给那一段。 */
  function stubPassageRect() {
    const registered = highlights.get('spoor-book-passage') as FakeHighlight;
    registered.ranges[0].getClientRects = () =>
      [PASSAGE_RECT] as unknown as DOMRectList;
  }

  async function renderAndJump() {
    await db.nodes.update('b1', { bookExcerpts: [excerpt({ text: 'Second unit text' })] });
    render(withAppDialogProvider(<BookFullscreen nodeId="b1" onClose={vi.fn()} />));
    await waitFor(() => {
      expect(screen.getByTestId('book-excerpt-card')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('book-excerpt-card'));
    fireEvent.click(screen.getByTestId('book-excerpt-jump'));
    await waitFor(() => {
      expect(highlights.has('spoor-book-passage')).toBe(true);
    });
    stubPassageRect();
    return screen.getByTestId('book-body');
  }

  const movePointerTo = (body: HTMLElement, x: number, y: number) =>
    act(() => {
      body.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y }));
    });

  it('keeps the highlight while the pointer travels over the margin', async () => {
    const body = await renderAndJump();
    // 从左栏挪进正文，路上先经过的是行间留白——这时还不能算"看过了"。
    movePointerTo(body, 10, 10);
    expect(highlights.has('spoor-book-passage')).toBe(true);
  });

  it('drops the highlight once the pointer leaves the passage', async () => {
    const body = await renderAndJump();
    movePointerTo(body, 300, 220);
    expect(highlights.has('spoor-book-passage')).toBe(true);

    movePointerTo(body, 10, 10);
    expect(highlights.has('spoor-book-passage')).toBe(false);
  });

  it('drops the highlight when the pointer leaves the reader', async () => {
    const body = await renderAndJump();
    // React 的 onPointerLeave 是由 pointerout 合成的，这里得发那一个。
    act(() => {
      body.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: null }));
    });
    expect(highlights.has('spoor-book-passage')).toBe(false);
  });
});
