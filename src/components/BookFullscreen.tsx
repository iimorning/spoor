import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronDown, Highlighter, Loader2, MessageSquare, SidebarClose, SidebarOpen, X } from 'lucide-react';
import { db, type BookExcerpt, type BookFocusMark } from '../db';
import { bookUnitLabel, tryParseBookContent } from '../utils/bookPayload';
import { appendBookExcerpt, buildBookExcerpt, readBookExcerpts, removeBookExcerpts, updateBookExcerptNote } from '../utils/bookExcerpts';
import {
  appendBookFocusMarks,
  isBookFocusChapterDismissed,
  isChapterFocused,
  readAiFocusMarks,
} from '../utils/bookFocusMarks';
import { runBookFocusPass } from '../services/bookFocusPass';
import { bookChatThreadStore } from '../utils/chatThreadStore';
import { spoorLlmSessionId } from '../utils/openRouterPromptCache';
import { useAdaptiveLayout } from '../hooks/useAdaptiveLayout';
import { useBookChat } from '../hooks/useBookChat';
import { useChatVoice } from '../hooks/useChatVoice';
import { useAutoAnnotation } from '../hooks/useAutoAnnotation';
import { hasMinimaxTtsAccess } from '../lib/serverConfig';
import { resolveVoiceInputMode } from '../constants/voiceWriting';
import { hasVolcAsrCredentials } from '../services/volcAsr';
import type { AIConfig } from './AISettingsModal';
import { BookExcerptRail } from './BookExcerptRail';
import { useAppDialog } from './AppDialogProvider';
import { ChatPanel } from './canvas/ChatPanel';
import { SurfacePersonaStrip } from './SurfacePersonaStrip';
import {
  EMPTY_SURFACE_ROOM,
  readSurfaceRoom,
  type SurfaceRoomState,
} from '../utils/surfacePersonaRoom';
import { BookNode } from './nodes/BookNode';

export type BookFullscreenProps = {
  nodeId: string;
  aiConfig?: AIConfig | null;
  onClose: () => void;
  /** 只被左栏的「放上画布」用到；正文摘抄本身只进这本书。 */
  onExtractSelectionToCard?: (
    quote: string,
    sourceLabel?: string,
    sourceNodeId?: string,
    /** 摘抄下方用户的想法，和正文一起成为卡片内容。 */
    note?: string,
  ) => void;
  isExpanding?: boolean;
};

function clampUnitIndex(raw: number, unitCount: number): number {
  if (unitCount <= 0) return 0;
  return Math.min(Math.max(0, raw), unitCount - 1);
}

/**
 * 拖选过程中选区每帧都在变，等手停下来再送进右栏，
 * 免得每帧都重渲染这一整棵三栏。150ms 对"选中就出现"来说察觉不到。
 */
const SELECTION_PREVIEW_DEBOUNCE_MS = 150;

/**
 * 翻到新章节后停多久才让 AI 去读这一章。
 *
 * 1.5 秒是"翻过去了、打算停下来看了"和"连着往后翻"的分界。
 * 连着翻的时候定时器一直在重置，只会算最后一章——一本 300 页的书翻一遍
 * 也只该付一次钱，不是 300 次。
 */
const BOOK_FOCUS_TRIGGER_DELAY_MS = 1500;

/**
 * 全屏阅读：左栏摘抄本、中栏正文、右栏伴读对话。
 * 左右两栏固定宽度 + 折叠按钮；窄屏（`compact`）下两栏变成可滑出的抽屉。
 */
/**
 * 指针此刻是不是还在这个元素上（或它的子树里）。
 *
 * 不靠事件配对判断，是因为配对在这种场景下会失灵：弹层是**这一串手势里**才被
 * 插进 DOM 的，浏览器可能把 pointerout 的 relatedTarget 报成 null，React 于是
 * 当成"从窗口外进来"，把容器也算成离开了；而指针没再动过，就不会有新的 enter
 * 来救场。于是 `onPointerLeave` 说走了、面板却还在指针底下，180ms 后照样关掉。
 * 到点了直接问 DOM，比复述事件可靠。
 */
function pointerStillOver(el: Element | null): boolean {
  if (!el) return false;
  try {
    return el.matches(':hover');
  } catch {
    return false;
  }
}

/** 面板贴边时留出的余量。 */
const POPOVER_GUTTER = 8;

/**
 * 让面板居中挂在按钮底下，但**别顶出屏幕**。
 *
 * 按钮紧贴右缘，居中就意味着右半边在屏幕外——纯 CSS 写不出来（要"先居中、
 * 越界再拉回"，而按钮宽度不是 CSS 拿得到的数）。所以量一次：算出居中后的左缘，
 * 越出视口多少就往左挪多少。屏幕够宽时它仍然精确居中。
 */
function usePopoverShift(
  anchorRef: { current: HTMLElement | null },
  panelRef: { current: HTMLElement | null },
): number {
  const [shift, setShift] = useState(0);
  // 不给依赖数组：面板宽度会随展开的章节变，每次渲染量一次最省事，也最不容易过期。
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const w = panel.offsetWidth;
    if (!w) return;
    const rect = anchor.getBoundingClientRect();
    const centeredLeft = rect.left + rect.width / 2 - w / 2;
    const overflow = centeredLeft + w - (window.innerWidth - POPOVER_GUTTER);
    setShift(overflow > 0 ? -overflow : 0);
  });
  return shift;
}

export function BookFullscreen({
  nodeId,
  aiConfig = null,
  onClose,
  onExtractSelectionToCard,
  isExpanding = false,
}: BookFullscreenProps) {
  const { t } = useTranslation();
  const { confirm } = useAppDialog();
  const { compact } = useAdaptiveLayout();
  const node = useLiveQuery(async () => {
    const row = await db.nodes.get(nodeId);
    return row ?? null;
  }, [nodeId]);
  /** 侧栏房间：谁在说话。空 = 沿用内置助手。 */
  const agentConfigs = useLiveQuery(() => db.agents.toArray(), []) ?? [];

  // 窄屏进来时两栏默认收起；跨越断点后跟着断点走。
  const [excerptsCollapsed, setExcerptsCollapsed] = useState(compact);
  const [chatCollapsed, setChatCollapsed] = useState(compact);
  const [chatSelection, setChatSelection] = useState('');
  /**
   * 房间名单。先从卡片行读一次，之后就以本地为准——不然用户刚拉进来一个人，
   * liveQuery 推回来的旧行会把它抹掉。
   */
  const [bookRoom, setBookRoom] = useState<SurfaceRoomState>(EMPTY_SURFACE_ROOM);
  const roomSeededForRef = useRef('');
  useEffect(() => {
    if (!node || roomSeededForRef.current === nodeId) return;
    roomSeededForRef.current = nodeId;
    setBookRoom(
      readSurfaceRoom(node.bookChatPersonaIds, node.bookChatMutedPersonaIds),
    );
  }, [node, nodeId]);
  /** 摘抄本里当前选中的那条：高亮它，标题行的删除也作用在它身上。 */
  const [selectedExcerptId, setSelectedExcerptId] = useState<string | null>(null);
  /**
   * 多选这一轮的勾选集。
   *
   * 和 selectedExcerptId 分开而不是合用一个数组：前者是"右栏正在读哪条"，
   * 单击卡片就得换；后者是"这一轮圈了哪几条"，只在多选开着时活。合并的话，
   * 每次单击都得重写整个数组，右栏读的那条也会跟着乱跳。
   */
  const [checkedExcerptIds, setCheckedExcerptIds] = useState<string[]>([]);
  const [excerptSelectionMode, setExcerptSelectionMode] = useState(false);
  const excerptPaneRef = useRef<HTMLElement | null>(null);
  /** 伴读栏：判断「这次点击是不是发生在 AI 那边」的锚点。 */
  const chatPaneRef = useRef<HTMLElement | null>(null);
  /**
   * 顶栏里那个空位，伴读栏的「历史 / 新建」按钮渲染进去。
   * ref 回调用 useCallback 包住：否则每次渲染都是新函数，
   * React 会把这个节点反复摘下来再挂上去。
   */
  const [chatControlsHost, setChatControlsHost] = useState<HTMLElement | null>(null);
  /** 顶栏里给页码栏留的空位。没它的话页码栏只能在正文下面占一行。 */
  const [pageNavHost, setPageNavHost] = useState<HTMLElement | null>(null);
  const capturePageNavHost = useCallback((el: HTMLElement | null) => {
    setPageNavHost(el);
  }, []);
  /**
   * 页码栏要对齐的是**正文那一列**，不是窗口。
   *
   * 正文列是阅读区（两条抽屉之间）里 `max-w-3xl` 居中的，而顶栏横跨整个窗口——
   * 两者的中线在两栏宽度不等时并不重合。所以量一次阅读区的左右边界，把空位
   * 摆到那个范围上去，页码栏的 `mx-auto max-w-3xl` 才落在和正文同一列里。
   * 抽屉收起 / 展开、窗口缩放都会让它变，所以跟着观察。
   */
  const [readerColumn, setReaderColumn] = useState<{ left: number; width: number } | null>(
    null,
  );
  /**
   * 用回调 ref，不用 useLayoutEffect + []。
   *
   * 首次挂载时 liveQuery 还没回来，`node` 是 null，BookFullscreen 直接 return null，
   * 阅读区压根没渲染——那时 ref 是空的。写成 effect（依赖数组空）就只会跑那一次，
   * 量不到任何东西，readerColumn 永远是 null，页码栏的借位就一直 display:none，
   * **整条页码栏消失**。回调 ref 在面板真正挂上来的那一刻才开始观察，跟这个
   * 时序无关。
   */
  /**
   * 页码栏左缘。书名的限宽要按**它**算，不是按阅读区左缘——阅读区铺满窗口时
   * 左缘是 0，可页码栏是居中的，左缘其实在中间偏左；拿 0 去限，书名会被压没。
   */
  const PAGE_NAV_MAX_W = 768;   // 和正文列的 max-w-3xl 一致
  const PAGE_NAV_PAD = 32;      // 正文列的 px-6 是左右各 24，这里留 32 的余量
  const navLeftEdge = useMemo(() => {
    if (!readerColumn) return null;
    const col = Math.min(PAGE_NAV_MAX_W, Math.max(0, readerColumn.width - 48));
    return readerColumn.left + (readerColumn.width - col) / 2;
  }, [readerColumn]);
  /**
   * 顶栏左边放得下才留格式徽标。放不下时先舍它：书名和展开键是认得出这是哪本书、
   * 还能收放摘抄本的，EPUB 徽标只是锦上添花。
   */
  const showFormatBadge = navLeftEdge === null || navLeftEdge >= 124;
  const readerObserverRef = useRef<ResizeObserver | null>(null);
  const readerMeasureRef = useRef<(() => void) | null>(null);
  const captureReaderPane = useCallback((el: HTMLDivElement | null) => {
    readerObserverRef.current?.disconnect();
    readerObserverRef.current = null;
    if (!el) {
      setReaderColumn(null);
      return;
    }
    const measure = () => {
      const r = el.getBoundingClientRect();
      setReaderColumn((prev) =>
        // 亚像素抖动不该引起重渲染
        prev && Math.abs(prev.left - r.left) < 0.5 && Math.abs(prev.width - r.width) < 0.5
          ? prev
          : { left: r.left, width: r.width },
      );
    };
    measure();
    // ResizeObserver 让"抽屉收放"也能触发重算——那不会改变窗口宽度，光靠
    // resize 事件听不见。jsdom 里没有这个全局，缺了也得照样量一次，不能直接崩。
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      readerObserverRef.current = ro;
    }
    readerMeasureRef.current = measure;
    window.addEventListener('resize', measure);
  }, []);
  const captureChatControlsHost = useCallback((node: HTMLElement | null) => {
    setChatControlsHost(node);
  }, []);
  const selectionPreviewTimerRef = useRef<number | null>(null);
  const [jumpRequest, setJumpRequest] = useState<{
    unitIndex: number;
    text: string;
    nonce: number;
  } | null>(null);

  useEffect(() => {
    setExcerptsCollapsed(compact);
    setChatCollapsed(compact);
  }, [compact]);

  const book = useMemo(() => tryParseBookContent(node?.content), [node?.content]);
  const unitCount = book?.units.length ?? 0;
  const unitIndex = clampUnitIndex(node?.bookPageIndex ?? 0, unitCount);
  const unit = book?.units[unitIndex];
  const excerpts = readBookExcerpts(node);
  /**
   * 用户在摘抄本里勾出来的那几条 = 这一轮递给 AI 的那几条。
   *
   * 不另存一份状态：多选开着的时候，"勾着的"和"给 AI 看的"本来就是同一件事，
   * 存两份迟早对不上（比如删了一条之后忘了同步）。勾选集一清空，摘抄本重新锁上。
   */
  const focusedExcerpts = useMemo(() => {
    if (checkedExcerptIds.length === 0) return [];
    const checked = new Set(checkedExcerptIds);
    return excerpts.filter((row) => checked.has(row.id));
  }, [checkedExcerptIds, excerpts]);
  const unitLabel = bookUnitLabel(unit, unitIndex, unitCount);
  const bookTitle = book?.title?.trim() || node?.description?.trim() || t('nodes.book');

  /**
   * 面板与报错文案。书籍只为真正会渲染的文案单独措辞（`reference.book_chat_*`），
   * 其余（拖拽提示、无选区占位等）沿用长文那一套，免得漏一个键就把原始 key 显示给用户。
   */
  const copy = useCallback(
    (key: string, opts?: Record<string, unknown>) =>
      t(`reference.book_chat_${key}`, {
        defaultValue: t(`reference.essay_chat_${key}`, opts),
        // 面板自带 defaultValue 的键（拖拽提示等）优先用它，别套上另一个键名。
        ...opts,
      }),
    [t],
  );

  const {
    sending,
    discussing: chatDiscussing,
    error,
    setError: setChatError,
    send,
    discuss,
    startNewChat,
    restoreChatSession,
  } = useBookChat({
    nodeId,
    bookTitle,
    unit,
    unitLabel,
    currentSelection: chatSelection,
    excerpts,
    focusedExcerpts,
    messages: node?.bookChatMessages ?? [],
    aiConfig,
    room: bookRoom,
    agents: agentConfigs,
    t,
    copy,
  });

  /**
   * 房间名单跟着这本书走，不跟着面板走：换一本书就该换一个说话的人。
   * 写回卡片行，所以关掉全屏再打开还在。
   */
  const persistBookRoom = useCallback((room: SurfaceRoomState) => {
    setBookRoom(room);
    if (!nodeId) return;
    void db.nodes.update(nodeId, {
      bookChatPersonaIds: room.personaIds,
      bookChatMutedPersonaIds: room.mutedIds,
    });
  }, [nodeId]);

  /**
   * 语音问答：识别用火山 ASR，朗读用 MiniMax TTS。
   * 和长文改稿那一侧共用 `useChatVoice`——它只认 `sendMessage`，
   * 不关心对面是哪一栏的对话，所以伴读直接把自己的 `send` 递进去。
   * 两个 key 缺一个就不给这个入口：麦克风按钮在 settings 里配好之前不该出现。
   */
  const bookVoiceEnabled = useMemo(
    () =>
      Boolean(
        aiConfig &&
          hasVolcAsrCredentials({
            apiKey: aiConfig.volcAsrApiKey,
            appId: aiConfig.volcAsrAppId,
            accessToken: aiConfig.volcAsrAccessToken,
            resourceId: aiConfig.volcAsrResourceId,
          }) &&
          hasMinimaxTtsAccess(aiConfig.minimaxApiKey),
      ),
    [aiConfig],
  );

  const {
    active: bookVoiceActive,
    phase: bookVoicePhase,
    partialTranscript: bookVoiceTranscript,
    toggle: toggleBookVoice,
    stop: stopBookVoice,
    commitComposer: commitBookVoice,
  } = useChatVoice({
    aiConfig,
    // 上一轮还在回答时不能开麦，否则两路声音会叠在一起。
    disabled: sending || isExpanding || !bookVoiceEnabled,
    sendMessage: send,
  });

  useEffect(() => () => {
    stopBookVoice();
  }, [stopBookVoice]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (node === null) onClose();
  }, [node, onClose]);

  /* ---------------------------------------------------------------- *
   * AI 伴读：翻到新章节就标重点，必要时插一句嘴
   * ---------------------------------------------------------------- */

  /** 全局的，不是这一本的——在任何一本书上关掉，所有书都停。 */
  const [focusEnabled, setFocusEnabled] = useAutoAnnotation('book');
  const chapterMarked = isChapterFocused(node, unitIndex);
  const [focusBusy, setFocusBusy] = useState(false);
  /**
   * 取消令牌 + 已试过的章节。
   *
   * 两个问题一起解决：翻页翻得比模型回得快时，旧那一趟的答案不能落到新章节上；
   * 而"这一章扫过一遍什么也没标"（于是 `chapterMarked` 仍是 false）也不能每次
   * 翻回去都重扫一遍——那是白花钱。只有跑成功才记进 `focusAttempted`，
   * 失败了下次翻回来还能再试。
   */
  const focusRunRef = useRef(0);
  const focusAttemptedRef = useRef(new Set<number>());
  /** 只为了读最新的 `bookChatMessages`，不进任何依赖数组—— */
  const nodeRef = useRef(node);
  nodeRef.current = node;
  /**
   * 悬停高亮按钮时的那张清单。
   *
   * 列的是**全书**的标记，不是当前这一章：翻页翻到哪儿是随意的，而"这一路读过
   * 什么"是全局的事，一份能点的目录比一个角标有用得多。按章排序，章号跟着走，
   * 免得点之前还得猜自己会被带到哪。
   */
  const focusList = useMemo(() => {
    const all = readAiFocusMarks(node);
    return [...all].sort((a, b) => a.unitIndex - b.unitIndex);
    // `node?.` 不是偷懒：liveQuery 第一次回的是 null，写作 node.bookFocusMarks
    // 会在书还没从库里出来的那一帧直接抛。跟下面 chapterDismissed 同一个道理。
  }, [node?.bookFocusMarks]);

  /**
   * 读者眼前真的呈现过的那些标记。
   *
   * 「待读」= 落在这本书上、但此刻不在正文里、而且读者还没在它那一章上见过的那几条。
   * 记的是标记自己的 id，不是章号：按章记会把两种情况混成一个——
   * 一是上一轮读出来的标注重新打开时全成了"已读"，按钮上什么都不剩，读者根本
   * 不知道这本书被读过；二是标注在读者翻走之后才落回来时，明明没看见却算作看过。
   * 按 id 记，这两种都对。
   *
   * 判据是"正文里确实画出来了"（读者正站在这一章，且这一章有标记），不是"翻到过"。
   * 不落库：这是本次打开的会话状态，标记本身在 `bookFocusMarks` 里，不受影响。
   */
  const [seenFocusIds, setSeenFocusIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  useEffect(() => {
    if (!chapterMarked) return;
    const here = focusList.filter((m) => m.unitIndex === unitIndex).map((m) => m.id);
    if (here.length === 0) return;
    setSeenFocusIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of here) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [chapterMarked, focusList, unitIndex]);
  /**
   * 待读条数跟开关无关。开关只停「以后还要不要自动再标」，已经落库的重点
   * 还在正文上，角标和清单继续指着它们。
   */
  const unseenFocusCount = useMemo(
    () => focusList.filter((m) => !seenFocusIds.has(m.id)).length,
    [focusList, seenFocusIds],
  );
  const unseenFocusTotal = unseenFocusCount;

  /** 给读屏器的一句话状态：正在读哪一章 + 还剩几处没看。空串表示没有可说的事。 */
  /**
   * 每章还剩几处没看。
   *
   * 角标只给一个总数，光有数字读者不知道该点哪一条；折叠着的章更是连内容都
   * 看不见。所以每条未读的段落前面点一个记号，章名后面再报一个数——数字回答
   * "在哪儿"，记号回答"是哪几条"。
   */
  const unreadByChapter = useMemo(() => {
    const counts = new Map<number, number>();
    for (const m of focusList) {
      if (seenFocusIds.has(m.id)) continue;
      counts.set(m.unitIndex, (counts.get(m.unitIndex) ?? 0) + 1);
    }
    return counts;
  }, [focusList, seenFocusIds]);

  const focusStatusText = [
    focusBusy ? t('reference.book_focus_reading', { label: unitLabel }) : '',
    unseenFocusTotal > 0 ? t('reference.book_focus_unseen', { count: unseenFocusTotal }) : '',
  ]
    .filter(Boolean)
    .join('；');

  /** 按章分组，章号升序——清单是目录，目录得能顺着翻。 */
  const focusChapters = useMemo(() => {
    const byUnit = new Map<number, BookFocusMark[]>();
    for (const mark of focusList) {
      const bucket = byUnit.get(mark.unitIndex);
      if (bucket) bucket.push(mark);
      else byUnit.set(mark.unitIndex, [mark]);
    }
    return [...byUnit.entries()].sort((a, b) => a[0] - b[0]);
  }, [focusList]);

  /**
   * 哪些章展开了——只存手动覆盖。
   *
   * 默认由"是不是当前这一章"现算：本章的读者人就站在这些标记面前，没有藏起来的
   * 理由；别的章压到只剩一个章名，想看再点开。存覆盖而不是存"折叠了哪些"，
   * 新落回来的标注才能自动按章走默认，不用谁去初始化。
   */
  const [focusChapterOpen, setFocusChapterOpen] = useState<Record<number, boolean>>({});
  const isFocusChapterOpen = useCallback(
    (chapterUnit: number) => focusChapterOpen[chapterUnit] ?? chapterUnit === unitIndex,
    [focusChapterOpen, unitIndex],
  );
  const toggleFocusChapter = useCallback(
    (chapterUnit: number) => {
      setFocusChapterOpen((prev) => ({
        ...prev,
        [chapterUnit]: !(prev[chapterUnit] ?? chapterUnit === unitIndex),
      }));
    },
    [unitIndex],
  );

  // 「历史 / 新建」的弹层已经撤掉：它们现在在对话栏顶部那一行、和房间里的人并排。
  const [focusListOpen, setFocusListOpen] = useState(false);
  const focusListCloseRef = useRef<number | null>(null);
  const focusWrapRef = useRef<HTMLDivElement | null>(null);
  const focusPanelRef = useRef<HTMLDivElement | null>(null);

  const focusListShift = usePopoverShift(focusWrapRef, focusPanelRef);
  const holdFocusList = useCallback(() => {
    if (focusListCloseRef.current !== null) {
      window.clearTimeout(focusListCloseRef.current);
      focusListCloseRef.current = null;
    }
    setFocusListOpen(true);
  }, []);
  const releaseFocusList = useCallback(() => {
    if (focusListCloseRef.current !== null) {
      window.clearTimeout(focusListCloseRef.current);
    }
    focusListCloseRef.current = window.setTimeout(() => {
      focusListCloseRef.current = null;
      if (pointerStillOver(focusWrapRef.current)) {
        setFocusListOpen(true);
        return;
      }
      setFocusListOpen(false);
    }, 180);
  }, []);
  useEffect(
    () => () => {
      if (focusListCloseRef.current !== null) {
        window.clearTimeout(focusListCloseRef.current);
      }
    },
    [],
  );

  const runFocusPass = useCallback(async () => {
    if (!aiConfig || !unit) return;
    const unitAtStart = unitIndex;
    const textAtStart = unit.text;
    // 在途期间用户说过话的话，这句话就该排在他后面，不该插到中间去。
    const messagesAtStart = nodeRef.current?.bookChatMessages?.length ?? 0;
    const token = ++focusRunRef.current;
    setFocusBusy(true);
    try {
      const result = await runBookFocusPass({
        config: aiConfig,
        bookTitle,
        unitLabel,
        chapterText: textAtStart,
        t,
        sessionId: spoorLlmSessionId('book-focus', nodeId),
      });
      // 作废的那一趟**不能**记成"试过了"：它什么都没留下，而这一章还空着。
      // 先记后判的话，用户在模型回答前翻走了，这一章本次会话就再也标不上了，
      // 而且没有任何报错能查——和"模型调不动"看起来一模一样。
      if (focusRunRef.current !== token) return;
      focusAttemptedRef.current.add(unitAtStart);
      if (result.marks.length > 0) {
        await appendBookFocusMarks(nodeId, unitAtStart, result.marks);
      }
      if (result.message) {
        const store = bookChatThreadStore(nodeId);
        const current = await store.loadMessages([]);
        if (current.length !== messagesAtStart) return;
        await store.saveMessages([
          ...current,
          {
            id: `bc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            role: 'assistant',
            text: result.message,
            createdAt: Date.now(),
          },
        ]);
      }
    } catch (e) {
      // 伴读是锦上添花：失败不该打断阅读。但**必须说出来**——
      // 不说的话，"模型调不动"和"这一章没什么值得标的"在界面上完全一样，
      // 两者会一直分不清到底是哪一种，只能靠翻 DevTools 才看得出。
      // 显示在右栏，不往正文上糊东西：正文是读书的地方。
      // 不记进 attempted，下次翻回来还能重试。
      const reason = e instanceof Error ? e.message : String(e);
      console.error('[Spoor] AI 伴读标注失败', e);
      setChatError(t('reference.book_focus_failed', { reason }));
    } finally {
      if (focusRunRef.current === token) setFocusBusy(false);
    }
  }, [aiConfig, bookTitle, nodeId, t, unit, unitIndex, unitLabel, setChatError]);

  /**
   * 用户是不是已经明确不要这一章的标注了。
   *
   * 算成布尔量再进依赖数组，是因为 `node` 本身不能进：Dexie 的 liveQuery 在**任何**
   * 一次 `db.nodes` 写入时都会回一个新的行对象，哪怕写的不是这一本书的字段。
   * 拿它当依赖，等于每写一次就把这 1.5 秒的定时器拆了重来——右栏流式吐字、摘抄里打
   * 一句想法、别的卡片动一下，都会把计时饿死，这一章于是永远标不上。
   */
  const chapterDismissed = isBookFocusChapterDismissed(node, unitIndex);

  useEffect(() => {
    // 关掉时作废已经发出去的那一趟。否则读者刚按停，模型的答案还会落上来，
    // 看起来就像开关没起作用。还没发出去的那次由这个 effect 自己的清理函数拆掉。
    if (!focusEnabled) {
      focusRunRef.current += 1;
      setFocusBusy(false);
      return;
    }
    if (!unit) return;
    // 用户删过这一章的标注：别再自动读它了，否则删完 1.5 秒它自己长回来。
    if (chapterDismissed) return;
    if (chapterMarked || focusAttemptedRef.current.has(unitIndex)) return;
    /**
     * 一次只读一章。
     *
     * 没有这道闸的时候，连翻三页就是三个并行的整章调用：`focusRunRef` 只负责
     * 丢弃过期的**结果**，不阻止重复**发起**，而 `callUniversalAI` 又没有中止入口，
     * 所以前一页那次照样跑完、照样烧钱。表现就是转圈一直不回来——它诚实地反映
     * 着"还有读没结束"，但那一圈等的是几次里最后那一次，前面两次纯属白等。
     *
     * 让这一趟跑完，`focusBusy` 翻回 false 会把本 effect 重新唤醒；那时读者
     * 正好停在第几页就读第几页，不用记他是第几步翻过来的。
     */
    if (focusBusy) return;
    const timer = window.setTimeout(() => {
      void runFocusPass();
    }, BOOK_FOCUS_TRIGGER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [
    chapterDismissed,
    chapterMarked,
    focusBusy,
    focusEnabled,
    runFocusPass,
    unit,
    unitIndex,
  ]);

  const toggleFocusEnabled = useCallback(() => {
    // 只停「以后别再自动读」。已经标上的段落、划词留下的高亮，都不归这颗按钮管。
    setFocusEnabled(!focusEnabled);
  }, [focusEnabled, setFocusEnabled]);

  const clearChatSelection = useCallback(() => {
    setChatSelection('');
    setSelectedExcerptId(null);
  }, []);

  const cancelPendingSelectionPreview = useCallback(() => {
    if (selectionPreviewTimerRef.current === null) return;
    window.clearTimeout(selectionPreviewTimerRef.current);
    selectionPreviewTimerRef.current = null;
  }, []);

  useEffect(() => cancelPendingSelectionPreview, [cancelPendingSelectionPreview]);

  // 面板卸载时把观察器收掉，别让 ResizeObserver 一直挂着一个脱离文档的节点。
  useEffect(
    () => () => {
      readerObserverRef.current?.disconnect();
      readerObserverRef.current = null;
      if (readerMeasureRef.current) {
        window.removeEventListener('resize', readerMeasureRef.current);
        readerMeasureRef.current = null;
      }
    },
    [],
  );

  /**
   * 点到摘抄本外面就取消选中——和文件管理器里点空白取消选中一样，
   * 不然上一次选中的那条会一直顶着橙色边框，删除按钮也一直亮着。
   *
   * 只清高亮，不动右栏那条 chip：那是用户正在读的内容，
   * 选完摘抄顺手去输入框打字时，它不该跟着消失。
   * 监听器只在有选中时挂上，平时不留一个常驻的全局监听。
   */
  useEffect(() => {
    if (!selectedExcerptId) return;
    const onPointerDown = (e: PointerEvent) => {
      const pane = excerptPaneRef.current;
      if (pane && e.target instanceof Node && pane.contains(e.target)) return;
      setSelectedExcerptId(null);
    };
    // 捕获阶段，不能用冒泡：正文容器（BookNode 的 bodyRef）上有
    // onPointerDown={e => e.stopPropagation()}，为的是选中文字时不触发画布拖拽。
    // 冒泡监听器挂在 document 上，永远等不到点在正文里的那一下。
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [selectedExcerptId]);

  /**
   * 点到伴读栏外面就收起右栏那条 chip——和上面摘抄本的取消选中是同一条规则，
   * 只是"里面"指的不是自己那栏。
   *
   * 为什么改用**点击位置**而不是焦点：原来那条判据是
   * `bodyRef.contains(document.activeElement)`，点页码栏、点正文列两侧的空白时
   * activeElement 是按钮或 body，判定落空，chip 就留在那儿不动。现在是
   * 「点在 AI 那栏之外 = 不在用它」，点哪儿都算数。
   *
   * 伴读栏内部仍然保留：选完一段去输入框打字时，那段上下文正是要交给 AI 的，
   * 不该在这时候消失（见 ChatPanel 上 chip 的 preventDefault）。在栏里点 × 是另一条路，
   * 由 clearChatSelection 显式清。
   */
  useEffect(() => {
    if (!chatSelection) return;
    const onPointerDown = (e: PointerEvent) => {
      const pane = chatPaneRef.current;
      if (pane && e.target instanceof Node && pane.contains(e.target)) return;
      // 有一笔预览还排在 debounce 里的话先撤掉，否则清完它又会把旧文字填回来。
      cancelPendingSelectionPreview();
      // 只清 chip，不碰 selectedExcerptId：在摘抄本里点删除按钮也是"伴读栏之外"，
      // 但那是摘抄本自己的规则在管（左栏高亮该留就留），不该被这边顺手带走。
      setChatSelection('');
    };
    // 捕获阶段，不能用冒泡：正文容器（BookNode 的 bodyRef）上有
    // onPointerDown={e => e.stopPropagation()}，为的是选中文字时不触发画布拖拽。
    // 冒泡监听器挂在 document 上，永远等不到点在正文里的那一下。
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [chatSelection, cancelPendingSelectionPreview]);

  /** 正文选区变化 → 右栏自动显示它（和长文编辑器一样，不用点按钮）。 */
  const handleReaderSelectionPreview = useCallback(
    (text: string) => {
      cancelPendingSelectionPreview();
      selectionPreviewTimerRef.current = window.setTimeout(() => {
        selectionPreviewTimerRef.current = null;
        setChatSelection(text);
        setSelectedExcerptId(null);
      }, SELECTION_PREVIEW_DEBOUNCE_MS);
    },
    [cancelPendingSelectionPreview],
  );

  /** 单击摘抄卡片：把整条交给右栏读，并记下是哪条以便高亮。 */
  const handleAskAboutExcerpt = useCallback(
    (excerpt: BookExcerpt) => {
      // 点卡片是对"读哪一条"的明确选择，别让还在排队的选区更新把它盖回去。
      cancelPendingSelectionPreview();
      setChatSelection(excerpt.text);
      setSelectedExcerptId(excerpt.id);
      setChatCollapsed(false);
    },
    [cancelPendingSelectionPreview],
  );

  const handleJumpToExcerpt = useCallback((excerpt: BookExcerpt) => {
    setJumpRequest({ unitIndex: excerpt.unitIndex, text: excerpt.text, nonce: Date.now() });
  }, []);

  /** 落点高亮被撤掉了，这次跳转就此结束——留着请求，翻章回来高亮会自己长回来。 */
  const handleJumpHighlightDismiss = useCallback(() => setJumpRequest(null), []);

  /**
   * 删掉一批摘抄。多于一条要先问一句：单条删除是"点错了也就少一条"，
   * 一次丢掉十几条摘抄不是，标题行的删除按钮在多选时离手也就更近。
   */
  const deleteExcerpts = useCallback(
    async (rows: BookExcerpt[]) => {
      if (rows.length === 0) return;
      if (rows.length > 1) {
        const ok = await confirm({
          title: t('reference.book_excerpt_delete_title'),
          message: t('reference.book_excerpt_delete_confirm', { count: rows.length }),
          confirmLabel: t('reference.book_excerpt_delete'),
          variant: 'danger',
        });
        if (!ok) return;
      }
      const texts = new Set(rows.map((row) => row.text));
      await removeBookExcerpts(nodeId, rows.map((row) => row.id));
      // 删掉的正好是右栏在读的那条，就别再显示它了。
      setSelectedExcerptId((current) => (current && rows.some((row) => row.id === current) ? null : current));
      setChatSelection((current) => (texts.has(current) ? '' : current));
      const stillChecked = checkedExcerptIds.filter((id) => !rows.some((row) => row.id === id));
      setCheckedExcerptIds(stillChecked);
      // 勾的全删光了还开着多选，标题行会空着一排按钮——顺手收起来。
      if (excerptSelectionMode && stillChecked.length === 0) setExcerptSelectionMode(false);
    },
    [confirm, nodeId, t, checkedExcerptIds, excerptSelectionMode],
  );

  const handleDeleteExcerpt = useCallback(
    (rows: BookExcerpt[]) => {
      if (rows.length === 0) return;
      void deleteExcerpts(rows);
    },
    [deleteExcerpts],
  );

  /** 放上画布：多选时是勾上的全部，一条一张卡，顺序跟着摘抄本。 */
  const handleExcerptToCanvas = useCallback(
    (rows: BookExcerpt[]) => {
      rows.forEach((row) => {
        onExtractSelectionToCard?.(row.text, row.unitLabel, nodeId, row.note);
      });
    },
    [nodeId, onExtractSelectionToCard],
  );

  /**
   * 开多选时把当前选中的那条带进去——"就这条问 AI"点完再圈选时，
   * 手里多半已经有了一条，从零开始勾等于逼用户重新点一次。
   */
  const handleExcerptSelectionMode = useCallback((next: boolean) => {
    setExcerptSelectionMode(next);
    setCheckedExcerptIds((current) => {
      if (!next) return [];
      if (current.length > 0 || !selectedExcerptId) return current;
      return [selectedExcerptId];
    });
  }, [selectedExcerptId]);

  const handleToggleExcerptChecked = useCallback((excerptId: string) => {
    setCheckedExcerptIds((current) =>
      current.includes(excerptId)
        ? current.filter((id) => id !== excerptId)
        : [...current, excerptId],
    );
  }, []);

  const handleClearExcerptChecked = useCallback(() => setCheckedExcerptIds([]), []);

  const handleExcerptNoteChange = useCallback(
    (excerpt: BookExcerpt, note: string) => {
      void updateBookExcerptNote(nodeId, excerpt.id, note);
    },
    [nodeId],
  );

  /** 面板里的「摘录」（回复选段 / 检索结果）收进同一个摘抄本，但标记为对话来源。 */
  const handleChatExcerpt = useCallback(
    (markdown: string) => {
      const excerpt = buildBookExcerpt({
        text: markdown,
        source: 'chat',
        unitIndex: -1,
        unitLabel: '',
        bookTitle,
      });
      if (excerpt) void appendBookExcerpt(nodeId, excerpt);
    },
    [bookTitle, nodeId],
  );

  if (node === undefined) {
    return (
      <div
        className="fixed inset-0 z-[125] flex items-center justify-center bg-[#FAF9F6]"
        data-testid="book-fullscreen"
        role="dialog"
        aria-modal="true"
      >
        <Loader2 className="h-6 w-6 animate-spin text-[#C2410C]" />
      </div>
    );
  }

  if (!node || node.type !== 'book') return null;

  const formatBadge = book?.format === 'pdf' ? 'PDF' : book?.format === 'epub' ? 'EPUB' : null;

  const excerptRailClass = compact
    ? `fixed bottom-0 left-0 top-11 z-20 w-[min(280px,90vw)] p-3 transition-transform ${
        excerptsCollapsed ? '-translate-x-full' : 'translate-x-0'
      }`
    : excerptsCollapsed
      ? 'w-0 min-w-0 shrink overflow-hidden opacity-0 pointer-events-none'
      : 'w-72 shrink-0';

  // `flex flex-col` 不是可有可无的：角色条和对话面板要在这个栏里分高度，
  // 而非窄屏那一支是外层行里的一个 flex item，栏自己得是列容器，
  // 里面的 `flex-1` 才知道该吃多少。
  const chatPaneClass = `flex flex-col ${
    compact
      ? `fixed bottom-0 right-0 top-11 z-20 w-[min(320px,90vw)] p-3 transition-transform ${
          chatCollapsed ? 'translate-x-full' : 'translate-x-0'
        }`
      : chatCollapsed
        ? 'w-0 min-w-0 shrink overflow-hidden opacity-0 pointer-events-none'
        : 'w-[20rem] shrink-0'
  }`;

  return (
    <div
      className="fixed inset-0 z-[125] flex flex-col bg-[#FAF9F6] paper-texture"
      data-testid="book-fullscreen"
      role="dialog"
      aria-modal="true"
      aria-label={bookTitle}
    >
      {/* 标题栏只占一条窄边：全屏阅读里读者要的是正文，不是抬头就能看见的书名。
          高度和下面两个抽屉的 top-* 是同一个数，别只改一边。
          z-30 不是随手写的：z-index 作用在 flex item 上会**建立层叠上下文**，
          里面那两个弹层的 z-30 只在这个上下文内有效。顶栏压着 z-10 时，窄屏抽屉
          （根层级 z-20、top-11 起）会盖住探出栏外的弹层——读者看见对话栏滑上来、
          菜单不见了。抬到 30 才高得过它们。 */}
      <div className="relative h-11 shrink-0 bg-white/90 backdrop-blur-md border-b border-[#E6E4DF] flex items-center justify-between px-4 z-30 gap-3">
        {/* 这一组要在页码栏的左缘之前收住。空位给的是阅读区的范围，抽屉一收
            它就从 x=0 开始，长书名会一路伸到页面中间、被箭头压住。限宽让书名
            自己截断，而不是压在页码栏底下。 */}
        <span
          className="min-w-0 flex items-center gap-2 text-[11px] font-sans font-bold uppercase tracking-wider text-[#8c8a84]"
          style={{
            // 顶栏有 px-4（16），页码栏的左箭头还带一层 before:-inset-2 把可点区
            // 往外撑 8px，所以这一组要在箭头左边 24px 处收住。
            // 兜底下限只给"标题缩成 0 + 展开键"留位置（≈36px）；原来给 220
            // 的下限正好把限制顶掉——左栏一收、这一组就伸进页码栏里，把展开键
            // 盖住点不动。
            maxWidth: navLeftEdge !== null ? Math.max(36, navLeftEdge - 40) : undefined,
          }}
        >
          {/* 不摆书本图标和"书籍"两个字：全屏阅读器里书名和 EPUB/PDF 徽标已经
              说清了这是什么，读者也正在读它。格式和书名留着——那两样是识别用的。 */}
          {formatBadge && showFormatBadge ? (
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#F4F1ED] text-[#8c8a84] normal-case tracking-normal">
              {formatBadge}
            </span>
          ) : null}
          <span className="min-w-0 truncate font-serif text-[13px] font-semibold normal-case tracking-normal text-[#2c2c28]">
            {bookTitle}
          </span>
          <button
            type="button"
            data-testid="book-fullscreen-toggle-excerpts"
            onClick={() => setExcerptsCollapsed((v) => !v)}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#8c8a84] transition-colors hover:bg-[#EAE7E2] hover:text-[#C2410C]"
            title={t('reference.book_toggle_excerpts')}
            aria-label={t('reference.book_toggle_excerpts')}
            aria-expanded={!excerptsCollapsed}
          >
            {excerptsCollapsed ? (
              <SidebarOpen className="h-4 w-4" aria-hidden />
            ) : (
              <SidebarClose className="h-4 w-4" aria-hidden />
            )}
          </button>
        </span>
        {/* 页码栏的借位：放进顶栏就不再占阅读区的一行，横向位置按**阅读区**摆，
            所以它对得上正文列，而不是跟着书名挤在左边。
            必须是顶栏的直接子元素——左组是 relative 的话，absolute 的 left
            会按左组算，整块被推出屏幕。 */}
        <div
          ref={capturePageNavHost}
          data-testid="book-fullscreen-page-nav-host"
          /* 这个空位横跨整个阅读区，可里面只有中间那条页码栏是有内容的。
             不放行指针的话，抽屉一收、阅读区铺满窗口，它就把书名和
             展开键一起盖住——点不动，箭头也压在字底下。 */
          className="pointer-events-none absolute top-0 flex h-11 items-center"
          style={
            readerColumn
              ? { left: readerColumn.left, width: readerColumn.width }
              : { display: 'none' }
          }
        />
        <div className="flex items-center gap-2">
          {/* AI 伴读。和上面两颗折叠按钮不是一类：那两颗的开关状态由栏本身的
              展开与否说明，所以按钮一直是中性灰；这颗是一个真开关，开着与否
              不会体现在别的地方，得靠按钮自己说——开着就染橙。 */}
          {/* 伴读的标注不是流式的：一趟模型回来之前正文上不会有任何东西出现。
              只剩一个转圈图标的话，读者分不清"在读"和"卡住了"——所以转圈期间
              这颗按钮撑成药丸，把当前章节说清楚。右组是 justify-between 锚右边的，
              变宽只会向左长，旁边的对话按钮和它的控件不会跟着挪。 */}
          {/* 按钮和清单同属一个 hover 容器：指针在两者之间移动不算离开，
              清单才留得住。 */}
          {/* onFocus/onBlur 不是锦上添花：弹层默认 hidden，只挂 onPointerEnter
              的话键盘用户永远打不开它（hidden 子树不进 tab 序）。而这两颗按钮
              在改动前是常驻顶栏的，那正是被这次搬走的东西。 */}
          <div
            ref={focusWrapRef}
            className="relative shrink-0"
            onPointerEnter={holdFocusList}
            onPointerLeave={releaseFocusList}
            onFocus={holdFocusList}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                releaseFocusList();
              }
            }}
          >
          <button
            type="button"
            data-testid="book-fullscreen-toggle-focus"
            onClick={toggleFocusEnabled}
            title={
              focusBusy
                ? t('reference.book_focus_reading', { label: unitLabel })
                : t(
                    focusEnabled
                      ? 'reference.book_focus_toggle_on'
                      : 'reference.book_focus_toggle',
                  )
            }
            // 名字保持稳定（"AI 标注这一章"），状态另外走一条描述通道：aria-label
            // 会盖掉按钮里的全部内容，那句"正在读第 N 章"和待读条数就直接被吞了，
            // 读屏用户既听不到在读哪一章，也听不到还剩几处没看。
            aria-label={t('reference.book_focus_toggle')}
            aria-describedby={focusStatusText ? 'book-focus-status' : undefined}
            aria-pressed={focusEnabled}
            aria-busy={focusBusy || undefined}
            className={`relative inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md transition-colors ${
              focusBusy ? 'w-auto px-2' : 'w-7'
            } ${
              focusEnabled
                ? 'bg-[#C2410C]/10 text-[#C2410C] hover:bg-[#C2410C]/15'
                : 'text-[#8c8a84] hover:bg-[#EAE7E2] hover:text-[#C2410C]'
            }`}
          >
            {unseenFocusTotal > 0 ? (
              /* 标了、但读者还没翻过去看的条数。钉在右上角往外探一点，
                 免得被按钮自己的圆角和背景吃掉。 */
              <span
                data-testid="book-fullscreen-focus-badge"
                title={t('reference.book_focus_unseen', { count: unseenFocusTotal })}
                aria-label={t('reference.book_focus_unseen', { count: unseenFocusTotal })}
                className="absolute -right-1.5 -top-1.5 min-w-[15px] rounded-full bg-[#C2410C] px-1 text-center font-mono text-[9px] font-semibold leading-[15px] text-white"
              >
                {unseenFocusTotal > 99 ? '99+' : unseenFocusTotal}
              </span>
            ) : null}
            {focusBusy ? (
              <>
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                <span
                  data-testid="book-fullscreen-focus-status"
                  className="whitespace-nowrap text-[11px] font-medium leading-none"
                >
                  {t('reference.book_focus_reading', { label: unitLabel })}
                </span>
              </>
            ) : (
              <Highlighter className="h-4 w-4" aria-hidden />
            )}
          </button>
          {/* 给读屏器的状态口播。按钮的 aria-label 是稳定名字，这里说的是"此刻怎么样"：
              正在读哪一章、还剩几处没翻到。视觉上藏起来，不占顶栏的地方。 */}
          <span id="book-focus-status" role="status" className="sr-only">
            {focusStatusText}
          </span>
          {focusListOpen && focusList.length > 0 ? (
            /* 间隙原来是靠 top-[calc(100%+6px)] 留的，指针穿过那 6px 时人已经不在
               触发器里了——onPointerLeave 先跑，180ms 到点就关掉，宽面板斜着移过去
               根本来不及。改成 top-full 贴住按钮、把间隙做成自己的 padding，指针就
               始终在容器子树内。居中同理：贴在按钮正下方，而不是拿右边缘去对齐。 */
            <div
              data-testid="book-fullscreen-focus-list"
              onPointerEnter={holdFocusList}
              onPointerLeave={releaseFocusList}
              className="absolute left-1/2 top-full z-30 w-[min(24rem,calc(100vw-2rem))] pt-1.5"
              style={{ transform: `translateX(calc(-50% + ${focusListShift}px))` }}
              ref={focusPanelRef}
            >
              <div className="rounded-lg border border-[#E6E4DF] bg-white/98 shadow-lg shadow-black/5 backdrop-blur-md">
              {/* 滚动条留在容器内：条目再多也不把顶栏顶开，正文区高度是死的。 */}
              <ul className="max-h-[min(62vh,30rem)] overflow-y-auto overscroll-contain py-1.5">
                {focusChapters.map(([chapterUnit, marks]) => {
                  const open = isFocusChapterOpen(chapterUnit);
                  const here = chapterUnit === unitIndex;
                  const unreadInChapter = unreadByChapter.get(chapterUnit) ?? 0;
                  return (
                    <li key={chapterUnit}>
                      {/* 章名就是这一组的开关。折叠时下面什么都不留——别的章离
                          读者还远，压着两行引文既占地方又认不出是哪一句。 */}
                      <button
                        type="button"
                        data-testid="book-fullscreen-focus-chapter"
                        data-unit={chapterUnit}
                        data-open={open ? 'true' : 'false'}
                        aria-expanded={open}
                        onClick={() => toggleFocusChapter(chapterUnit)}
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-[#F7F4F0] focus:bg-[#F7F4F0] focus:outline-none"
                      >
                        <ChevronDown
                          /* 图标本身朝下：收起时逆时针转 90° 指右（"进去"），
                             展开时不转指下（"铺开"）。反过来会读成"收起"。 */
                          className={`h-3.5 w-3.5 shrink-0 text-[#B4AFA7] transition-transform ${
                            open ? '' : '-rotate-90'
                          }`}
                          aria-hidden
                        />
                        <span
                          className={`text-[13px] leading-none ${
                            here ? 'font-semibold text-[#C2410C]' : 'font-semibold text-[#6f6b64]'
                          }`}
                        >
                          {bookUnitLabel(book?.units[chapterUnit], chapterUnit, unitCount)}
                        </span>
                        {unreadInChapter > 0 ? (
                          <span
                            data-testid="book-fullscreen-focus-chapter-unread"
                            className="ml-auto rounded-full bg-[#C2410C]/12 px-1.5 text-[10px] font-mono font-semibold leading-[16px] text-[#C2410C]"
                          >
                            {unreadInChapter}
                          </span>
                        ) : null}
                      </button>
                      {open ? (
                        <ul className="pb-2">
                          {marks.map((mark) => {
                            const unread = !seenFocusIds.has(mark.id);
                            return (
                            <li key={mark.id} data-unread={unread ? 'true' : undefined}>
                              {/* 整块就是跳转目标：右侧那颗小按钮太小，正常人不会
                                  去点它。章名那一行已经管着展开/收起，两者不冲突。 */}
                              <button
                                type="button"
                                data-testid="book-fullscreen-focus-list-item"
                                data-unread={unread ? 'true' : undefined}
                                onClick={() => {
                                  // 走摘抄「跳回原文」那一条：切章、滚进视野、高亮，都是现成的。
                                  setJumpRequest({
                                    unitIndex: mark.unitIndex,
                                    text: mark.quote,
                                    nonce: Date.now(),
                                  });
                                  releaseFocusList();
                                }}
                                title={t('reference.book_focus_list_jump')}
                                className="mb-1.5 block w-full rounded-md border border-transparent px-3 py-2.5 text-left transition-colors hover:border-[#E6E4DF] hover:bg-[#F7F4F0] focus-visible:border-[#C2410C] focus-visible:bg-[#F7F4F0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C]/25"
                              >
                                {/* 未读的那几条前面点一颗橙点。角标只说了"还有几处"，
                                    不说"是哪几处"——这才是那一下点击的落点。 */}
                                <span className="block pl-4 text-[14px] leading-relaxed text-[#2c2c28]">
                                  {unread ? (
                                    <span
                                      data-testid="book-fullscreen-focus-unread-dot"
                                      title={t('reference.book_focus_unread_here')}
                                      className="mr-1.5 inline-block h-[6px] w-[6px] translate-y-[-1px] rounded-full bg-[#C2410C]"
                                      aria-label={t('reference.book_focus_unread_here')}
                                    />
                                  ) : null}
                                  {mark.quote}
                                </span>
                                {mark.note ? (
                                  <span className="mt-1.5 block pl-4 text-[12.5px] leading-relaxed text-[#8c8a84]">
                                    {mark.note}
                                  </span>
                                ) : null}
                              </button>
                            </li>
                            );
                          })}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              </div>
            </div>
          ) : null}
          </div>
          {/* 「历史 / 新建」现在和房间里的人并排放在对话栏顶部那一行的右边
              （见 SurfacePersonaStrip）。顶栏这颗按钮回归成纯粹的开关：开合右栏。 */}
          <button
            type="button"
            data-testid="book-fullscreen-toggle-chat"
            onClick={() => setChatCollapsed((v) => !v)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#8c8a84] transition-colors hover:bg-[#EAE7E2] hover:text-[#C2410C]"
            title={t('reference.book_toggle_chat')}
            aria-label={t('reference.book_toggle_chat')}
            aria-expanded={!chatCollapsed}
          >
            <MessageSquare className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            data-testid="book-fullscreen-close"
            onClick={onClose}
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-[#E6E4DF] bg-white text-[#5a5a54] shadow-sm hover:bg-[#C2410C] hover:text-white hover:border-[#C2410C] transition-colors shrink-0"
            title={t('nodes.book_close')}
            aria-label={t('nodes.book_close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className={`flex-1 flex min-h-0 overflow-hidden ${compact ? '' : 'gap-3 p-3'}`}>
        <aside
          ref={excerptPaneRef}
          className={excerptRailClass}
          data-testid="book-excerpt-pane"
          aria-hidden={excerptsCollapsed ? true : undefined}
          // 收起的栏还在 DOM 里（为了过渡），但里面的按钮不该还能被 Tab 到。
          inert={excerptsCollapsed || undefined}
        >
          <BookExcerptRail
            excerpts={excerpts}
            selectedId={selectedExcerptId}
            checkedIds={checkedExcerptIds}
            selectionMode={excerptSelectionMode}
            onAsk={handleAskAboutExcerpt}
            onJump={handleJumpToExcerpt}
            onDelete={handleDeleteExcerpt}
            onToCanvas={onExtractSelectionToCard ? handleExcerptToCanvas : undefined}
            onNoteChange={handleExcerptNoteChange}
            onSelectionModeChange={handleExcerptSelectionMode}
            onToggleChecked={handleToggleExcerptChecked}
            onSetChecked={setCheckedExcerptIds}
            onClearChecked={handleClearExcerptChecked}
          />
        </aside>

        <div
          ref={captureReaderPane}
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          data-testid="book-reader-pane"
        >
          <BookNode
            node={node}
            // 划词翻译要自己发请求，浮层得画在选区旁边——那正是 BookNode 的地盘，
            // 所以配置直接给它，而不是像「问 AI」那样抛回调再把结果传回去。
            aiConfig={aiConfig}
            pageNavHost={pageNavHost}
            editingNodeId={null}
            setEditingNodeId={() => {}}
            layout="immersive"
            onSelectionPreview={handleReaderSelectionPreview}
            isExpanding={isExpanding}
            jumpRequest={jumpRequest}
            onJumpHighlightDismiss={handleJumpHighlightDismiss}
          />
        </div>

        <aside
          ref={chatPaneRef}
          className={chatPaneClass}
          data-testid="book-chat-pane"
          aria-hidden={chatCollapsed ? true : undefined}
          inert={chatCollapsed || undefined}
        >
          <SurfacePersonaStrip
            room={bookRoom}
            onRoomChange={persistBookRoom}
            controlsHostRef={captureChatControlsHost}
            disabled={isExpanding}
            onDiscuss={() => void discuss()}
            discussing={chatDiscussing}
          />
          {/* ChatPanel 的根是 h-full——它按父容器满高算。直接和角色条并排的话，
              满高 + 顶框那一行就溢出了，外层 overflow-hidden 会把底部的输入框裁掉。
              给它一个占剩余高度的壳，h-full 就落在这个壳上。 */}
          <div className="flex min-h-0 flex-1 flex-col">
            <ChatPanel
              messages={node.bookChatMessages ?? []}
              archivedSessions={node.bookChatSessionArchive ?? []}
              sending={sending}
              error={error}
              disabled={isExpanding}
              copy={copy}
              // 这一栏的名字在顶栏的书名和 AI 开关旁边已经说清楚了；
              // 「历史 / 新建」两个按钮也借住顶栏，所以栏里一行标题都不用留。
              hideTitle
              headerControlsHost={chatControlsHost}
              showSpeakerNames={bookRoom.personaIds.length > 1}
              portalHostSelector='[data-testid="book-fullscreen"]'
              selectedText={chatSelection}
              onClearSelection={clearChatSelection}
              // 勾了几条就一直提示着：没有这句，用户不知道自己在给 AI 递东西。
              focusedExcerptCount={focusedExcerpts.length}
              onSend={(text) => {
                // 口述模式：输入框里那句是刚转写出来的，不该再走普通发送，
                // 交给语音这一路——它负责关麦、想、再朗读回来。
                if (
                  bookVoiceActive &&
                  resolveVoiceInputMode(aiConfig?.voiceInputMode) === 'dictation'
                ) {
                  void commitBookVoice(text);
                  return;
                }
                void send(text);
              }}
              onToggleVoice={bookVoiceEnabled ? toggleBookVoice : undefined}
              voiceModeActive={bookVoiceActive}
              voicePhase={bookVoicePhase}
              liveTranscript={bookVoiceTranscript}
              voiceInputMode={resolveVoiceInputMode(aiConfig?.voiceInputMode)}
              voiceEnabled={bookVoiceEnabled}
              onExcerpt={handleChatExcerpt}
              // 按钮现在挂在顶栏的悬停弹层里，对话栏收着的时候点它等于点在
              // 一条看不见的栏上——先把它拉开。
              onInteract={() => setChatCollapsed(false)}
              onNewChat={() => startNewChat()}
              onRestoreSession={(sessionId) => restoreChatSession(sessionId)}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
