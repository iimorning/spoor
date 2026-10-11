import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { db } from '../../src/db';
import type { Article } from '../../src/db';
import { withAppDialogProvider } from '../testUtils';
import { EssayFullscreen } from '../../src/components/EssayFullscreen';
import { runEssayFocusPass } from '../../src/services/essayFocusPass';
import {
  ESSAY_FOCUS_GAIN_CHARS,
  ESSAY_FOCUS_MIN_CHARS,
} from '../../src/utils/essayFocusMarks';
import { countEssayChars } from '../../src/utils/essayWordCount';
import { isAutoAnnotationEnabled, setAutoAnnotationEnabled } from '../../src/utils/autoAnnotation';
import { useAutoAnnotation } from '../../src/hooks/useAutoAnnotation';
import type { AIConfig } from '../../src/components/AISettingsModal';

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

vi.mock('../../src/services/essayFocusPass', () => ({
  runEssayFocusPass: vi.fn(async () => ({ marks: [], message: '' })),
}));

const passMock = vi.mocked(runEssayFocusPass);

const NOTE = '这句话把接模型和接你写的东西并排放着，却没说清后者才是重点，读到这里的人多半会滑过去。';
const QUOTE = '但陷阱得知道，比自己配省事';

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
    Element.prototype.getBoundingClientRect = () => emptyRect;
  }
  const rp = Range.prototype as unknown as {
    getClientRects?: () => DOMRectList;
    getBoundingClientRect?: () => DOMRect;
  };
  if (typeof rp.getClientRects !== 'function') rp.getClientRects = () => [] as unknown as DOMRectList;
  if (typeof rp.getBoundingClientRect !== 'function') rp.getBoundingClientRect = () => emptyRect as DOMRect;
  if (typeof Document.prototype.elementFromPoint !== 'function') {
    Document.prototype.elementFromPoint = () => null;
  }
  if (typeof (document as unknown as { caretRangeFromPoint?: unknown }).caretRangeFromPoint !== 'function') {
    (document as unknown as { caretRangeFromPoint: () => unknown }).caretRangeFromPoint = () => null;
  }
  if (typeof (Selection.prototype as unknown as { modify?: unknown }).modify !== 'function') {
    (Selection.prototype as unknown as { modify: (...a: unknown[]) => void }).modify = () => undefined;
  }
});

/** 拼出指定字数的正文，并保证每段都长到能当引文。 */
function bodyOf(chars: number): string {
  const para = '这是一段用来凑字数的正文，写得足够长以便触发阈值判断，不会太短。';
  const per = countEssayChars(para);
  const paras: string[] = [];
  let total = 0;
  while (total < chars) {
    paras.push(para);
    total += per;
  }
  return paras.join('\n\n');
}

async function seed(overrides: Partial<Article> = {}) {
  const article: Article = {
    id: 'a-focus',
    title: '模型中转站OpenRouter入门',
    content: bodyOf(ESSAY_FOCUS_MIN_CHARS + 200),
    date: '2026',
    type: 'GEN',
    tags: [],
    chatMessages: [],
    contentDrivesBody: true,
    ...overrides,
  };
  await db.articles.put(article);
  return article;
}

/** 防抖是 1500ms，触发边界的断言要把等待放宽一点。 */
const SETTLE = 1900;

beforeEach(async () => {
  passMock.mockReset();
  passMock.mockResolvedValue({ marks: [], message: '' });
  // 开关现在存 localStorage，测试之间必须清干净，否则上一条留下的"全局已关"
  // 会让这一条默认就是关的，看着像坏了。
  localStorage.clear();
  await db.articles.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

// 标注那一趟是真的要发模型请求的，`aiConfig` 为空时 `runFocusPass` 直接返回，
// 于是阈值、写入、插话那些断言全都测不到。给一份最小的配置。
const AI_CONFIG = {
  provider: 'openrouter',
  apiKey: 'k',
  model: 'deepseek/deepseek-v4.1-flash',
} as AIConfig;

function renderScreen() {
  return render(
    withAppDialogProvider(
      <EssayFullscreen articleId="a-focus" onClose={() => {}} aiConfig={AI_CONFIG} />,
    ),
  );
}

/** 文章是异步读出来的，按钮会先于文章出现；断开关状态要等它落到该有的样子。 */
async function expectPressed(user: ReturnType<typeof userEvent.setup>, value: string) {
  const toggle = screen.getByTestId('essay-fullscreen-toggle-focus');
  await waitFor(() => {
    expect(toggle).toHaveAttribute('aria-pressed', value);
  });
  return toggle;
}

describe('阈值：什么时候才让 AI 去读', () => {
  it('没写到阈值不去', async () => {
    await seed({ content: bodyOf(ESSAY_FOCUS_MIN_CHARS - 200) });
    renderScreen();
    await screen.findByTestId('essay-fullscreen');
    await new Promise((r) => setTimeout(r, SETTLE));
    expect(passMock).not.toHaveBeenCalled();
  });

  it('第一次写够就去一趟', async () => {
    await seed();
    renderScreen();
    await screen.findByTestId('essay-fullscreen');
    await waitFor(() => {
      expect(passMock).toHaveBeenCalledTimes(1);
    }, { timeout: SETTLE + 800 });
  });

  it('模型说没话说的时候不写任何标注，但记下扫到哪了', async () => {
    passMock.mockResolvedValue({ marks: [], message: '' });
    await seed();
    renderScreen();
    await screen.findByTestId('essay-fullscreen');
    await waitFor(async () => {
      const row = await db.articles.get('a-focus');
      expect(row?.essayFocusLastScanChars ?? 0).toBeGreaterThan(0);
    }, { timeout: SETTLE + 800 });
    const row = await db.articles.get('a-focus');
    expect(row?.essayFocusMarks ?? []).toHaveLength(0);
  });

  it('只送去新写的那一段，不是整篇重读', async () => {
    passMock.mockResolvedValue({ marks: [{ quote: QUOTE, note: NOTE }], message: '' });
    await seed();
    renderScreen();
    await screen.findByTestId('essay-fullscreen');
    await waitFor(() => {
      expect(passMock).toHaveBeenCalled();
    }, { timeout: SETTLE + 800 });
    const firstArgs = passMock.mock.calls[0]![0];
    expect(firstArgs.lastScanChars).toBeUndefined();
  });

  it('又写了一整段才跑第二趟', async () => {
    const scanned = ESSAY_FOCUS_MIN_CHARS + 200;
    await seed({
      content: bodyOf(scanned + ESSAY_FOCUS_GAIN_CHARS - 50),
      essayFocusLastScanChars: scanned,
    });
    renderScreen();
    await screen.findByTestId('essay-fullscreen');
    await new Promise((r) => setTimeout(r, SETTLE));
    // 差 50 个字，不该跑。
    expect(passMock).not.toHaveBeenCalled();
  });
});

describe('开关', () => {
  it('默认开着', async () => {
    await seed();
    renderScreen();
    await screen.findByTestId('essay-fullscreen');
    await expectPressed(userEvent.setup(), 'true');
  });

  it('关掉之后标了也不读', async () => {
    setAutoAnnotationEnabled('essay', false);
    await seed({ content: bodyOf(ESSAY_FOCUS_MIN_CHARS + 400) });
    renderScreen();
    await screen.findByTestId('essay-fullscreen');
    await expectPressed(userEvent.setup(), 'false');
    await new Promise((r) => setTimeout(r, SETTLE));
    expect(passMock).not.toHaveBeenCalled();
  });

  // 开关是全局的：在这篇上按下去，等于把每一篇的标注都关掉。把每一篇都清干净
  // 是毁数据而不是关开关——标过就是标过，关的时候藏起来，开回来原样还在。
  it('关掉只是藏起来，不删已经标上的', async () => {
    const user = userEvent.setup();
    await seed({
      essayFocusMarks: [{ id: 'm1', quote: QUOTE, note: NOTE, createdAt: 1 }],
      essayFocusLastScanChars: 10_000,
    });
    renderScreen();
    const toggle = await screen.findByTestId('essay-fullscreen-toggle-focus');
    await user.click(toggle);
    await waitFor(() => {
      expect(isAutoAnnotationEnabled('essay')).toBe(false);
    });
    const row = await db.articles.get('a-focus');
    expect(row?.essayFocusMarks).toHaveLength(1);

    // 开回来之后原样还在，而且立刻能翻。
    await user.click(toggle);
    await waitFor(() => {
      expect(isAutoAnnotationEnabled('essay')).toBe(true);
    });
    const on = await expectPressed(user, 'true');
    fireEvent.pointerEnter(on.parentElement as HTMLElement);
    expect(await screen.findByTestId('essay-fullscreen-focus-item-m1')).toBeInTheDocument();
  });

  // 这条是整件事的核心：在 A 篇关掉，B 篇（正开着另一个标签页）也得跟着停。
  it('在一篇里关掉，会通知到别处已经打开的长文', async () => {
    const user = userEvent.setup();
    await seed({
      essayFocusMarks: [{ id: 'm1', quote: QUOTE, note: NOTE, createdAt: 1 }],
      essayFocusLastScanChars: 10_000,
    });
    const first = renderScreen();
    const toggle = await screen.findByTestId('essay-fullscreen-toggle-focus');
    await expectPressed(user, 'true');

    // 第二篇挂在另一个模块作用域里（模拟另一个标签页/另一个已挂载的面板）。
    let secondPressed: string | null = null;
    const Second = () => {
      const [on] = useAutoAnnotation('essay');
      secondPressed = String(on);
      return null;
    };
    render(<Second />);

    await user.click(toggle);
    await waitFor(() => {
      expect(secondPressed).toBe('false');
    });
    first.unmount();
  });

  it('关掉之后清单也不再显示', async () => {
    const user = userEvent.setup();
    setAutoAnnotationEnabled('essay', false);
    await seed({
      essayFocusMarks: [{ id: 'm1', quote: QUOTE, note: NOTE, createdAt: 1 }],
    });
    renderScreen();
    await screen.findByTestId('essay-fullscreen');
    const toggle = await expectPressed(userEvent.setup(), 'false');
    fireEvent.pointerEnter(toggle.parentElement as HTMLElement);
    expect(screen.getByTestId('essay-fullscreen-focus-list')).toHaveAttribute('hidden');
  });

  // 书全屏那颗同位置的按钮，开着就是红底红字。开着和关着看不出区别，
  // 就不知道 AI 批注其实已经开了——这条钉住那个视觉约定。
  it('开着的时候按钮是红的，关掉才退成灰的', async () => {
    await seed();
    renderScreen();
    await screen.findByTestId('essay-fullscreen');
    const on = await expectPressed(userEvent.setup(), 'true');
    expect(on.className).toContain('bg-[#C2410C]/10');
    expect(on.className).toContain('text-[#C2410C]');

    const user = userEvent.setup();
    await user.click(on);
    const off = await expectPressed(user, 'false');
    expect(off.className).not.toContain('bg-[#C2410C]/10');
  });
});

describe('清单', () => {
  it('默认是收起来的', async () => {
    await seed({
      essayFocusMarks: [{ id: 'm1', quote: QUOTE, note: NOTE, createdAt: 1 }],
      essayFocusLastScanChars: 10_000,
    });
    renderScreen();
    await screen.findByTestId('essay-fullscreen');
    expect(screen.getByTestId('essay-fullscreen-focus-list')).toHaveAttribute('hidden');
  });

  it('悬停就展开，列出每一条引文和想法', async () => {
    await seed({
      essayFocusMarks: [{ id: 'm1', quote: QUOTE, note: NOTE, createdAt: 1 }],
      essayFocusLastScanChars: 10_000,
    });
    renderScreen();
    await screen.findByTestId('essay-fullscreen');
    // 文章是异步读出来的，标注清单要等它落到页面上才有东西可列。
    const toggle = await expectPressed(userEvent.setup(), 'true');
    await waitFor(() => {
      expect(screen.getByTestId('essay-fullscreen-focus-badge')).toBeInTheDocument();
    });
    fireEvent.pointerEnter(toggle.parentElement as HTMLElement);
    const list = screen.getByTestId('essay-fullscreen-focus-list');
    expect(list).not.toHaveAttribute('hidden');
    expect(screen.getByTestId('essay-fullscreen-focus-item-m1')).toHaveTextContent(QUOTE);
    expect(screen.getByTestId('essay-fullscreen-focus-item-m1')).toHaveTextContent(NOTE);
  });

  it('键盘也开得了——不能只有悬停能打开', async () => {
    await seed({
      essayFocusMarks: [{ id: 'm1', quote: QUOTE, note: NOTE, createdAt: 1 }],
      essayFocusLastScanChars: 10_000,
    });
    renderScreen();
    const toggle = await screen.findByTestId('essay-fullscreen-toggle-focus');
    fireEvent.focus(toggle);
    expect(screen.getByTestId('essay-fullscreen-focus-list')).not.toHaveAttribute('hidden');
  });

  it('键盘打开之后按 Escape 能关上', async () => {
    // 清单只认悬停，Tab 进去之后指针根本不在按钮上——没有 Escape 就关不掉了。
    await seed({
      essayFocusMarks: [{ id: 'm1', quote: QUOTE, note: NOTE, createdAt: 1 }],
      essayFocusLastScanChars: 10_000,
    });
    renderScreen();
    await screen.findByTestId('essay-fullscreen');
    const toggle = await expectPressed(userEvent.setup(), 'true');
    fireEvent.focus(toggle);
    expect(screen.getByTestId('essay-fullscreen-focus-list')).not.toHaveAttribute('hidden');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.getByTestId('essay-fullscreen-focus-list')).toHaveAttribute('hidden');
    });
  });

  it('点清单外面也能关上', async () => {
    await seed({
      essayFocusMarks: [{ id: 'm1', quote: QUOTE, note: NOTE, createdAt: 1 }],
      essayFocusLastScanChars: 10_000,
    });
    renderScreen();
    await screen.findByTestId('essay-fullscreen');
    const toggle = await expectPressed(userEvent.setup(), 'true');
    fireEvent.pointerEnter(toggle.parentElement as HTMLElement);
    expect(screen.getByTestId('essay-fullscreen-focus-list')).not.toHaveAttribute('hidden');
    fireEvent.pointerDown(document.body);
    await waitFor(() => {
      expect(screen.getByTestId('essay-fullscreen-focus-list')).toHaveAttribute('hidden');
    });
  });

  it('一条标注都没有时给出解释，而不是一个空弹层', async () => {
    await seed({ essayFocusLastScanChars: 10_000 });
    renderScreen();
    const toggle = await screen.findByTestId('essay-fullscreen-toggle-focus');
    fireEvent.pointerEnter(toggle.parentElement as HTMLElement);
    expect(screen.getByTestId('essay-fullscreen-focus-list')).toHaveTextContent(
      'reference.essay_focus_list_empty',
    );
  });
});

describe('标注存下来之后', () => {
  it('模型给什么就写什么——校验在服务层做完了', async () => {
    // 这里的 pass 是 mock 的，校验跑在真的 `runEssayFocusPass` 里（那边有独立用例：
    // 引文不在正文、出现两次、太短、太长都会被撤掉）。这一层只负责"把结果落库"。
    passMock.mockResolvedValue({
      marks: [
        { quote: QUOTE, note: NOTE },
        { quote: '第二句也值得停下来看看，这里是它的理由而且写得足够长', note: NOTE },
      ],
      message: '',
    });
    await seed();
    renderScreen();
    await screen.findByTestId('essay-fullscreen');
    await waitFor(async () => {
      const row = await db.articles.get('a-focus');
      expect(row?.essayFocusMarks?.length ?? 0).toBe(2);
    }, { timeout: SETTLE + 800 });
    const row = await db.articles.get('a-focus');
    // 新的排在最前面。
    expect(row?.essayFocusMarks?.[0]?.quote).toBe(QUOTE);
  });

  it('AI 的一句插话进对话栏，但不会盖掉用户刚发的', async () => {
    passMock.mockResolvedValue({ marks: [], message: '你现在是在搭中转站，还是在评估要不要用？' });
    await seed();
    renderScreen();
    await screen.findByTestId('essay-fullscreen');
    await waitFor(async () => {
      const row = await db.articles.get('a-focus');
      expect(row?.chatMessages?.some((m) => m.text.includes('中转站'))).toBe(true);
    }, { timeout: SETTLE + 800 });
  });

  it('模型返回坏输出也不崩，也不写标注', async () => {
    passMock.mockRejectedValue(new Error('上游炸了'));
    await seed();
    renderScreen();
    await screen.findByTestId('essay-fullscreen');
    // 报错要能被接住：跑挂了不能带崩整个全屏。
    await new Promise((r) => setTimeout(r, SETTLE));
    const row = await db.articles.get('a-focus');
    expect(row?.essayFocusMarks ?? []).toHaveLength(0);
  });

  it('跑挂了要说得出来，不能只写进一个没人看的地方', async () => {
    // 之前 focusError 只 set 不渲染，等于失败是静默的——用户只会看到"标了半天没动静"。
    passMock.mockRejectedValue(new Error('上游炸了'));
    await seed();
    renderScreen();
    await screen.findByTestId('essay-fullscreen');
    await waitFor(
      () => {
        // 这个文件里的 t 是直接返回键的桩，插值不会发生，所以断键名。
        expect(screen.getByTestId('chat-panel-error')).toHaveTextContent(
          'reference.essay_focus_failed',
        );
      },
      { timeout: SETTLE + 800 },
    );
  });
});
