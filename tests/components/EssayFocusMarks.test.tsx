import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { db } from '../../src/db';
import { withAppDialogProvider } from '../testUtils';
import { EssayBodyEditor } from '../../src/components/essay/EssayBodyEditor';
import { setMatchMediaQueries } from '../setup';
import { COMPACT_MQ } from '../../src/hooks/useAdaptiveLayout';
import {
  ESSAY_FOCUS_GAIN_CHARS,
  ESSAY_FOCUS_MIN_CHARS,
} from '../../src/utils/essayFocusMarks';
import { runEssayFocusPass } from '../../src/services/essayFocusPass';
import { countEssayChars } from '../../src/utils/essayWordCount';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

vi.mock('../../src/components/AgentIcon', () => ({
  AgentIcon: () => <span />,
}));

const NOTE = '这句话把接模型和接你写的东西并排放着，却没说清后者才是重点，读到这里的人多半会滑过去。';
const QUOTE = '几十家端点，比自己配省事';

vi.mock('../../src/services/essayFocusPass', () => ({
  runEssayFocusPass: vi.fn(async () => ({ marks: [], message: '' })),
}));

const passMock = vi.mocked(runEssayFocusPass);

// ProseMirror 在 mousedown 里要把坐标换算成文档位置，那条路要 elementFromPoint 和
// getClientRects。jsdom 两样都没有，缺一个就是 unhandled error——不会让用例失败，
// 但会让"点一下标注"这种走点击的路径根本跑不起来。装上和 EssayBodyEditor.test 同一套。
beforeAll(() => {
  const emptyRect = {
    x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, bottom: 0, right: 0,
    toJSON: () => ({}),
  };
  if (typeof Element.prototype.getClientRects !== 'function') {
    Element.prototype.getClientRects = function () {
      return [] as unknown as DOMRectList;
    };
  }
  if (typeof Element.prototype.getBoundingClientRect !== 'function') {
    Element.prototype.getBoundingClientRect = function () {
      return emptyRect;
    };
  }
  const rangeProto = Range.prototype as unknown as {
    getClientRects?: () => DOMRectList;
    getBoundingClientRect?: () => DOMRect;
  };
  if (typeof rangeProto.getClientRects !== 'function') {
    rangeProto.getClientRects = () => [] as unknown as DOMRectList;
  }
  if (typeof rangeProto.getBoundingClientRect !== 'function') {
    rangeProto.getBoundingClientRect = () => emptyRect as DOMRect;
  }
  if (typeof Document.prototype.elementFromPoint !== 'function') {
    Document.prototype.elementFromPoint = function () {
      return null;
    };
  }
  if (typeof (document as unknown as { caretRangeFromPoint?: unknown }).caretRangeFromPoint !== 'function') {
    (document as unknown as { caretRangeFromPoint: () => unknown }).caretRangeFromPoint = () => null;
  }
  if (typeof (Selection.prototype as unknown as { modify?: unknown }).modify !== 'function') {
    (Selection.prototype as unknown as { modify: (...args: unknown[]) => void }).modify = () => undefined;
  }
});

/** 拼出指定字数的正文：每段都够长，不会被模型判成"太短不值得读"。 */
function bodyOf(chars: number): string {
  const para = '这是一段用来凑字数的正文，写得足够长以便触发阈值判断。';
  const per = countEssayChars(para);
  const paras: string[] = [];
  let total = 0;
  while (total < chars) {
    paras.push(para);
    total += per;
  }
  return paras.join('\n\n');
}

beforeEach(async () => {
  passMock.mockReset();
  passMock.mockResolvedValue({ marks: [], message: '' });
  await db.articles.clear();
});

afterEach(() => {
  setMatchMediaQueries([]);
});

describe('正文里的标注高亮', () => {
  const body = `前面一段话。\n\n${QUOTE}，但陷阱得知道。\n\n后面一段话。`;

  it('引文在正文里就画上黄底', async () => {
    render(
      <EssayBodyEditor
        articleId="a1"
        markdown={body}
        syncKey={0}
        placeholder=""
        mediaObjectUrls={{}}
        onPersist={vi.fn()}
        focusMarks={[{ id: 'm1', quote: QUOTE, note: NOTE, createdAt: 1 }]}
      />,
    );
    await waitFor(() => {
      expect(document.querySelector('[data-essay-focus-id="m1"]')).not.toBeNull();
    });
  });

  it('引文被改掉了就不画，但其余照常', async () => {
    render(
      <EssayBodyEditor
        articleId="a1"
        markdown={body}
        syncKey={0}
        placeholder=""
        mediaObjectUrls={{}}
        onPersist={vi.fn()}
        focusMarks={[
          { id: 'gone', quote: '这句话早就被用户删掉了不存在了', note: NOTE, createdAt: 1 },
          { id: 'm1', quote: QUOTE, note: NOTE, createdAt: 2 },
        ]}
      />,
    );
    await waitFor(() => {
      expect(document.querySelector('[data-essay-focus-id="m1"]')).not.toBeNull();
    });
    expect(document.querySelector('[data-essay-focus-id="gone"]')).toBeNull();
  });

  it('没有标注时正文里干干净净，一个黄底都没有', async () => {
    render(
      <EssayBodyEditor
        articleId="a1"
        markdown={body}
        syncKey={0}
        placeholder=""
        mediaObjectUrls={{}}
        onPersist={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('essay-body-editor-prose')).toBeInTheDocument();
    });
    expect(document.querySelectorAll('.essay-focus-mark')).toHaveLength(0);
  });

  it('标注不会进正文：用户存下来的 markdown 干干净净', async () => {
    // Decoration 方案的核心承诺。注意断的是**序列化结果**而不是 DOM：Decoration 本来
    // 就会渲染进 DOM（不渲染就没高亮），它是视图状态，不在文档里。真正要保证的是
    // 导出和复制全文拿到的是纯正文。
    const ref = React.createRef<import('../../src/components/essay/EssayBodyEditor').EssayBodyEditorHandle>();
    render(
      <EssayBodyEditor
        ref={ref}
        articleId="a1"
        markdown={body}
        syncKey={0}
        placeholder=""
        mediaObjectUrls={{}}
        onPersist={vi.fn()}
        focusMarks={[{ id: 'm1', quote: QUOTE, note: NOTE, createdAt: 1 }]}
      />,
    );
    await waitFor(() => {
      expect(document.querySelector('[data-essay-focus-id="m1"]')).not.toBeNull();
    });
    const markdown = ref.current!.getMarkdown();
    expect(markdown).not.toContain('essay-focus');
    expect(markdown).not.toContain('<mark');
    expect(markdown).not.toContain('<span');
    // 正文本身一个字没少。
    expect(markdown).toContain(QUOTE);
  });

  it('点一下标注就打开它的想法', async () => {
    const user = userEvent.setup();
    render(
      <EssayBodyEditor
        articleId="a1"
        markdown={body}
        syncKey={0}
        placeholder=""
        mediaObjectUrls={{}}
        onPersist={vi.fn()}
        focusMarks={[{ id: 'm1', quote: QUOTE, note: NOTE, createdAt: 1 }]}
      />,
    );
    const el = await waitFor(() => document.querySelector('[data-essay-focus-id="m1"]')!);
    await user.click(el as HTMLElement);
    expect(await screen.findByTestId('essay-focus-note')).toBeInTheDocument();
    expect(screen.getByTestId('essay-focus-note')).toHaveTextContent(NOTE);
  });

  it('再点一下收起来', async () => {
    const user = userEvent.setup();
    render(
      <EssayBodyEditor
        articleId="a1"
        markdown={body}
        syncKey={0}
        placeholder=""
        mediaObjectUrls={{}}
        onPersist={vi.fn()}
        focusMarks={[{ id: 'm1', quote: QUOTE, note: NOTE, createdAt: 1 }]}
      />,
    );
    const el = await waitFor(() => document.querySelector('[data-essay-focus-id="m1"]')!);
    await user.click(el as HTMLElement);
    await screen.findByTestId('essay-focus-note');
    await user.click(el as HTMLElement);
    await waitFor(() => {
      expect(screen.queryByTestId('essay-focus-note')).toBeNull();
    });
  });

  it('去掉一条会通知外面去删库里的那一条', async () => {
    const user = userEvent.setup();
    const onFocusMarkDelete = vi.fn();
    render(
      <EssayBodyEditor
        articleId="a1"
        markdown={body}
        syncKey={0}
        placeholder=""
        mediaObjectUrls={{}}
        onPersist={vi.fn()}
        onFocusMarkDelete={onFocusMarkDelete}
        focusMarks={[{ id: 'm1', quote: QUOTE, note: NOTE, createdAt: 1 }]}
      />,
    );
    const el = await waitFor(() => document.querySelector('[data-essay-focus-id="m1"]')!);
    await user.click(el as HTMLElement);
    await user.click(await screen.findByTestId('essay-focus-note-delete'));
    expect(onFocusMarkDelete).toHaveBeenCalledWith('m1');
  });

  it('清单里点一条能把它在正文里打开', async () => {
    const ref = React.createRef<import('../../src/components/essay/EssayBodyEditor').EssayBodyEditorHandle>();
    render(
      <EssayBodyEditor
        ref={ref}
        articleId="a1"
        markdown={body}
        syncKey={0}
        placeholder=""
        mediaObjectUrls={{}}
        onPersist={vi.fn()}
        focusMarks={[{ id: 'm1', quote: QUOTE, note: NOTE, createdAt: 1 }]}
      />,
    );
    await waitFor(() => {
      expect(document.querySelector('[data-essay-focus-id="m1"]')).not.toBeNull();
    });
    act(() => {
      expect(ref.current?.openFocusMark('m1')).toBe(true);
    });
    expect(await screen.findByTestId('essay-focus-note')).toBeInTheDocument();
  });

  it('打开一条已经被删掉的标注不报错，也不弹浮层', () => {
    const ref = React.createRef<import('../../src/components/essay/EssayBodyEditor').EssayBodyEditorHandle>();
    render(
      <EssayBodyEditor
        ref={ref}
        articleId="a1"
        markdown={body}
        syncKey={0}
        placeholder=""
        mediaObjectUrls={{}}
        onPersist={vi.fn()}
        focusMarks={[]}
      />,
    );
    act(() => {
      expect(ref.current?.openFocusMark('nope')).toBe(false);
    });
    expect(screen.queryByTestId('essay-focus-note')).toBeNull();
  });
});

describe('窄屏', () => {
  // 上一轮就因为 matchMedia 被桩死，窄屏分支一次都没跑过。这条是先把那扇门推开。
  it('窄屏下标注和浮层照样工作', async () => {
    setMatchMediaQueries([COMPACT_MQ]);
    const body = `前面一段话。\n\n${QUOTE}，但陷阱得知道。`;
    render(
      <EssayBodyEditor
        articleId="a1"
        markdown={body}
        syncKey={0}
        placeholder=""
        mediaObjectUrls={{}}
        onPersist={vi.fn()}
        focusMarks={[{ id: 'm1', quote: QUOTE, note: NOTE, createdAt: 1 }]}
      />,
    );
    const el = await waitFor(() => document.querySelector('[data-essay-focus-id="m1"]')!);
    fireEvent.click(el as HTMLElement);
    const note = await screen.findByTestId('essay-focus-note');
    // jsdom 没有布局，`offsetWidth`/`coordsAtPos` 都返回 0，所以"卡片没跑出视口"
    // 这件事在这里断不了。能断的是它照常出现、且宽度是随视口走的（92vw 封顶），
    // 真机上越界的修正走的是 `EssayFocusNote` 里的夹取逻辑。
    expect(note).toBeInTheDocument();
    expect(note.className).toContain('92vw');
  });
});

describe('阈值常量', () => {
  it('首跑阈值和增量阈值都在合理量级', () => {
    expect(ESSAY_FOCUS_MIN_CHARS).toBe(800);
    expect(ESSAY_FOCUS_GAIN_CHARS).toBe(800);
  });
});

describe('withAppDialogProvider 仍可用', () => {
  it('包一层不会把标注功能弄坏', async () => {
    const body = `${QUOTE}，但陷阱得知道。`;
    render(
      withAppDialogProvider(
        <EssayBodyEditor
          articleId="a1"
          markdown={body}
          syncKey={0}
          placeholder=""
          mediaObjectUrls={{}}
          onPersist={vi.fn()}
          focusMarks={[{ id: 'm1', quote: QUOTE, note: NOTE, createdAt: 1 }]}
        />,
      ),
    );
    await waitFor(() => {
      expect(document.querySelector('[data-essay-focus-id="m1"]')).not.toBeNull();
    });
  });
});
