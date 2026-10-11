import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, Check, Copy, CopyPlus, ListChecks, Pencil, Trash2, X } from 'lucide-react';
import type { BookExcerpt } from '../db';
import { BOOK_EXCERPT_NOTE_MAX_CHARS } from '../utils/bookExcerpts';
import { copyTextToClipboard } from '../utils/copyTextToClipboard';

const COPIED_RESET_MS = 1500;
/** 卡片里显示的摘抄长度；双击展开后是完整原文，复制与问 AI 也一直用完整原文。 */
const PREVIEW_CHARS = 220;

function excerptPreview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS)}…` : flat;
}

function RailAction({
  label,
  testId,
  onClick,
  disabled = false,
  children,
}: {
  label: string;
  testId: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    // 灰掉的按钮收不到鼠标事件，浏览器就不给它显示 title——"为什么是灰的"就永远没人看得到。
    // 提示挂在这层 span 上，鼠标停在按钮所在的位置上就能看到。
    <span className="inline-flex" title={disabled ? label : undefined}>
      <button
        type="button"
        data-testid={testId}
        disabled={disabled}
        onClick={(e) => {
          // 卡片整块可点＝问 AI，卡片上的按钮不该顺带触发它。
          e.stopPropagation();
          onClick();
        }}
        title={disabled ? undefined : label}
        aria-label={label}
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[#8c8a84] transition-colors hover:bg-[#EAE7E2] hover:text-[#C2410C] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#8c8a84]"
      >
        {children}
      </button>
    </span>
  );
}

/**
 * 全屏阅读左侧的摘抄本。列表只读，正文摘抄由 `BookNode` 写入，备注由这里就地改写。
 * 单击卡片＝就这条问 AI（顺带选中它，右栏同时显示它正在读什么）；
 * 跳回原文 / 放上画布 / 删除都放在标题行那一排，作用于选中的那条——
 * 三者都是"对一条摘抄做什么"，挤在每张卡里只会把正文和章节标签都挤短。
 * 卡片上只留就地能做完的：复制、写想法。
 *
 * 多选：单击已经被"问 AI"占住了，所以圈选走标题行上那个「多选」开关，而不是
 * Shift/Ctrl+点击那种看不见的手势。开着的这一轮里单击只勾选、不问 AI，
 * 标题行的删除 / 放上画布作用于勾上的全部。跳回原文留在多选外——
 * 一次跳一条，跳多条没有意义。
 */
/**
 * 每张摘抄卡尾部那排「复制 / 写想法」平时不露面，悬停到那张卡、或选中它、
 * 或焦点落进来时才出现。
 *
 * 用 opacity 而不是 display / visibility：那样按钮会退出 tab 序，键盘用户
 * Tab 过去看不见也点不着。`focus-within` 补上这一路——键盘和鼠标看到的是
 * 同一套东西。
 *
 * 顶栏那排（多选开关、跳回原文、放上画布、删除）**不**适用：它们作用在
 * 选中的那一条上，藏起来就等于让功能凭空消失，用户也不会想到顶栏有悬停。
 */

export function BookExcerptRail({
  excerpts,
  selectedId,
  checkedIds,
  selectionMode,
  onAsk,
  onJump,
  onDelete,
  onToCanvas,
  onNoteChange,
  onSelectionModeChange,
  onToggleChecked,
  onSetChecked,
  onClearChecked,
}: {
  excerpts: BookExcerpt[];
  /** 摘抄本里当前选中的那条：标题行那排动作都作用在它身上。 */
  selectedId?: string | null;
  /** 多选这一轮里勾上的那些。多选开着时，标题行的动作作用于它们。 */
  checkedIds?: string[];
  /** 多选是否开着：开着时单击卡片＝勾选，而不是问 AI。 */
  selectionMode?: boolean;
  /** 单击卡片：就这条问 AI（填进右栏输入框，不自动发送）。 */
  onAsk: (excerpt: BookExcerpt) => void;
  /** 跳回这条摘抄所在的章节。 */
  onJump: (excerpt: BookExcerpt) => void;
  /** 删除一条或多条摘抄（多选时是勾上的全部）。 */
  onDelete: (excerpts: BookExcerpt[]) => void;
  onToCanvas?: (excerpts: BookExcerpt[]) => void;
  /** 保存/清空这条摘抄下方的想法（空串＝清掉）。 */
  onNoteChange?: (excerpt: BookExcerpt, note: string) => void;
  /** 开/关多选。由外层持有，好让它把已选中的那条带进来。 */
  onSelectionModeChange?: (next: boolean) => void;
  /** 多选里勾选/取消一条。 */
  onToggleChecked?: (excerptId: string) => void;
  /** 直接把勾选集设成给定的几条（「全选」用；逐条 toggle 表达不了"全都要"）。 */
  onSetChecked?: (excerptIds: string[]) => void;
  /** 清空勾选（退出多选时用）。 */
  onClearChecked?: () => void;
}) {
  const { t } = useTranslation();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const resetTimerRef = useRef<number | null>(null);
  /**
   * 「放到画布」刚刚做完了没有。
   *
   * 这颗按钮是"看着像什么都发生了"的那种：点一下，画布那头多出几张卡，
   * 而人还盯着左栏，画面上一时半会儿看不出来。没有交代的话就只能靠猜——
   * 于是多半会再点一次，画布上就多出一份重复的。
   *
   * 是乐观反馈：`onToCanvas` 不是异步的，返回时卡片只是被安排上了创建，
   * 并不代表已经落库。真去等它成功，链条要一路改成 async，而失败也只有
   * "这一条没生成"这种静默结局——为了一个对勾不值得。
   */
  const [toCanvasDone, setToCanvasDone] = useState(false);
  const toCanvasTimerRef = useRef<number | null>(null);
  /** 同一时刻只开一个想法编辑器，栏窄，卡片一多就没法各开各的。 */
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const railRef = useRef<HTMLElement | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  /** 展开全文的那一条（同时只有一条）。 */
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /**
   * 正在编辑的那条 + 草稿的副本。
   *
   * 自动保存没有"取消"按钮，所以关掉左栏、或者切到另一条时没有"保存"按钮可点——
   * 必须在卸载前自己把草稿冲出去，否则用户写了半天一关就没了。关掉编辑器本身
   * 不触发 blur，所以这里靠 ref 兜住。
   */
  const pendingExcerptRef = useRef<BookExcerpt | null>(null);
  const noteDraftRef = useRef(noteDraft);
  noteDraftRef.current = noteDraft;
  /** 标题行那排动作作用于当前选中的那条，而不是某一行的行内按钮。 */
  const selectedExcerpt = excerpts.find((row) => row.id === selectedId) ?? null;
  const checkedSet = new Set(checkedIds ?? []);
  const checkedExcerpts = excerpts.filter((row) => checkedSet.has(row.id));
  const multi = Boolean(selectionMode);
  /** 多选这一轮里动作作用的对象：勾上的那些；不在多选时就是选中那一条。 */
  const targets = multi ? checkedExcerpts : selectedExcerpt ? [selectedExcerpt] : [];
  /** 对话来源的摘抄没有原文可跳；按钮留着置灰，换选中项时标题行不会跳一下。 */
  const selectedFromBook = targets.length > 0 && targets.every((row) => (row.source ?? 'book') === 'book');
  const pickHint = t('reference.book_excerpt_pick_first');

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
      if (toCanvasTimerRef.current !== null) window.clearTimeout(toCanvasTimerRef.current);
      // 关掉左栏不会触发 blur，草稿得在这里自己冲出去，否则写了一半就没了。
      savePendingNoteRef.current?.();
    };
  }, []);

  const copyExcerpt = (excerpt: BookExcerpt) => {
    void copyTextToClipboard(excerpt.text).then(() => {
      setCopiedId(excerpt.id);
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = window.setTimeout(() => setCopiedId(null), COPIED_RESET_MS);
    });
  };

  const startEditNote = (excerpt: BookExcerpt) => {
    // 切到另一条之前先把上一条存掉：编辑框会失焦，但显式兜一次更稳。
    flushPendingNote();
    // 在这里登记待存项，而不是等 onFocus：焦点若晚于打字才到，
    // onFocus 里重置草稿就会把用户刚敲的字冲掉。
    pendingExcerptRef.current = excerpt;
    noteDraftRef.current = excerpt.note?.trim() ?? '';
    setEditingNoteId(excerpt.id);
    setNoteDraft(excerpt.note?.trim() ?? '');
  };

  /**
   * 把想法存回去。**不改编辑状态**——自动保存之后编辑器继续开着，
   * 用户可以接着写，保存不该打断他。
   *
   * 内容没变就不写库：liveQuery 会把整栏刷一遍，没必要为一次空改动付这个代价。
   */
  const persistNote = (excerpt: BookExcerpt, draft: string) => {
    const next = draft.trim();
    if (next === (excerpt.note ?? '').trim()) return;
    onNoteChange?.(excerpt, next);
  };

  const savePendingNote = () => {
    const excerpt = pendingExcerptRef.current;
    if (!excerpt) return;
    persistNote(excerpt, noteDraftRef.current);
    pendingExcerptRef.current = null;
  };

  /** 供 blur / 切换 / 卸载统一调用；没有待存内容时是个空操作。 */
  const flushPendingNote = () => savePendingNote();
  // 卸载清理里要用，但不能把它列进依赖（否则每渲染都重挂 effect）。
  const savePendingNoteRef = useRef(flushPendingNote);
  savePendingNoteRef.current = flushPendingNote;

  /** 编辑器留着，只是不再处于"正在编辑"状态。 */
  const closeNoteEditor = () => {
    flushPendingNote();
    setEditingNoteId(null);
  };

  // 和 savePendingNoteRef 一个理由：closeNoteEditor 每次渲染都是新函数，
  // 直接列进下面的依赖会让监听器每渲染重挂一次。
  const closeNoteEditorRef = useRef(closeNoteEditor);
  closeNoteEditorRef.current = closeNoteEditor;

  /**
   * 点到摘抄本外面就收起想法编辑器——和伴读栏那条 chip、标题行那个高亮是同一条规则：
   * 「结束」按点击位置判，不看焦点。
   *
   * 之前只有 Esc 能关，而界面上没写这件事，用户只能靠猜。内容是自动保存的
   * （onBlur 写回、closeNoteEditor 里再兜一次），所以收起来不会丢字。
   */
  useEffect(() => {
    if (!editingNoteId) return;
    const onPointerDown = (e: PointerEvent) => {
      const rail = railRef.current;
      if (rail && e.target instanceof Node && rail.contains(e.target)) return;
      closeNoteEditorRef.current();
    };
    // 捕获阶段，不能用冒泡：正文容器（BookNode 的 bodyRef）上有
    // onPointerDown={e => e.stopPropagation()}，为的是选中文字时不触发画布拖拽。
    // 冒泡监听器挂在 document 上，永远等不到点在正文里的那一下。
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [editingNoteId]);

  return (
    <aside
      ref={railRef}
      data-testid="book-excerpt-rail"
      className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-[#E6E4DF] bg-white shadow-sm"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-[#E6E4DF] px-3 py-2.5">
        <span className="text-[11px] font-sans font-bold uppercase tracking-wider text-[#8c8a84]">
          {t('reference.book_excerpt_title')}
        </span>
        {multi ? (
          /* 多选这一轮：计数换成"勾了几条"，动作也换成作用于勾选的那些。 */
          <span
            data-testid="book-excerpt-checked-count"
            className="font-mono text-[11px] tabular-nums text-[#C2410C]"
          >
            {t('reference.book_excerpt_checked', { count: checkedExcerpts.length })}
          </span>
        ) : (
          <span className="font-mono text-[11px] tabular-nums text-[#8c8a84]">
            {excerpts.length}
          </span>
        )}
        {/* 多选这一轮的开关和它的后续动作，都紧跟在数字后面：它们改的是"勾了几条"，
            摆在右边一排动作里会让人以为也是对单条做的。 */}
        <div className="flex shrink-0 items-center gap-0.5">
          {multi ? (
            <>
              <button
                type="button"
                data-testid="book-excerpt-select-all"
                onClick={() => {
                  // 已经全勾上时这一格改成"取消勾选"，省掉一个"退出多选"才能用的动作。
                  const allChecked =
                    excerpts.length > 0 && checkedExcerpts.length === excerpts.length;
                  if (allChecked) onClearChecked?.();
                  else if (onSetChecked) onSetChecked(excerpts.map((row) => row.id));
                  // 没有 setChecked 时退回逐条 toggle——但那条路只在"一个都没勾"时才对：
                  // 已经勾了一半再逐条 toggle，会把勾上的那几条翻成没勾。
                  else excerpts.forEach((row) => onToggleChecked?.(row.id));
                }}
                title={
                  checkedExcerpts.length === excerpts.length && excerpts.length > 0
                    ? t('reference.book_excerpt_clear_checked')
                    : t('reference.book_excerpt_select_all')
                }
                aria-label={
                  checkedExcerpts.length === excerpts.length && excerpts.length > 0
                    ? t('reference.book_excerpt_clear_checked')
                    : t('reference.book_excerpt_select_all')
                }
                className="rounded-md px-1.5 py-0.5 font-sans text-[11px] text-[#5a5a54] transition-colors hover:bg-[#EAE7E2] hover:text-[#C2410C]"
              >
                {checkedExcerpts.length === excerpts.length && excerpts.length > 0
                  ? t('reference.book_excerpt_clear_checked')
                  : t('reference.book_excerpt_select_all')}
              </button>
              <RailAction
                testId="book-excerpt-selection-done"
                label={t('reference.book_excerpt_selection_done')}
                onClick={() => {
                  onClearChecked?.();
                  onSelectionModeChange?.(false);
                }}
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </RailAction>
            </>
          ) : (
            <RailAction
              testId="book-excerpt-multi"
              label={t('reference.book_excerpt_multi')}
              onClick={() => onSelectionModeChange?.(true)}
            >
              <ListChecks className="h-3.5 w-3.5" aria-hidden />
            </RailAction>
          )}
        </div>
        {/* 对选中那条的动作都在这一排，卡片上只留就地能做的（复制、写想法）。
            没选中时整排置灰，而不是各卡片各挂一排挤在正文边上。 */}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {/* 跳回原文一次只跳一条，多选时没有意义——不置灰，直接收起来。 */}
          {!multi ? (
            <RailAction
              testId="book-excerpt-jump"
              disabled={!selectedFromBook}
              label={
                !selectedExcerpt
                  ? pickHint
                  : selectedFromBook
                    ? t('reference.book_excerpt_jump')
                    : t('reference.book_excerpt_jump_unavailable')
              }
              onClick={() => {
                if (selectedExcerpt) onJump(selectedExcerpt);
              }}
            >
              <BookOpen className="h-3.5 w-3.5" aria-hidden />
            </RailAction>
          ) : null}
          {onToCanvas ? (
            <RailAction
              testId="book-excerpt-to-canvas"
              disabled={targets.length === 0}
              label={
                toCanvasDone
                  ? t(
                      multi
                        ? 'reference.book_excerpt_to_canvas_done_many'
                        : 'reference.book_excerpt_to_canvas_done',
                    )
                  : targets.length > 0
                    ? multi
                      ? t('reference.book_excerpt_to_canvas_many', { count: targets.length })
                      : t('reference.book_excerpt_to_canvas')
                    : pickHint
              }
              onClick={() => {
                if (targets.length === 0) return;
                onToCanvas(targets);
                setToCanvasDone(true);
                if (toCanvasTimerRef.current !== null) {
                  window.clearTimeout(toCanvasTimerRef.current);
                }
                toCanvasTimerRef.current = window.setTimeout(() => {
                  toCanvasTimerRef.current = null;
                  setToCanvasDone(false);
                }, 1600);
              }}
            >
              {toCanvasDone ? (
                <Check className="h-3.5 w-3.5 text-[#C2410C]" aria-hidden />
              ) : (
                <CopyPlus className="h-3.5 w-3.5" aria-hidden />
              )}
            </RailAction>
          ) : null}
          <RailAction
            testId="book-excerpt-delete"
            disabled={targets.length === 0}
            label={
              targets.length > 0
                ? multi
                  ? t('reference.book_excerpt_delete_many', { count: targets.length })
                  : t('reference.book_excerpt_delete')
                : pickHint
            }
            onClick={() => {
              if (targets.length > 0) onDelete(targets);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </RailAction>
        </div>
      </header>
      {excerpts.length === 0 ? (
        <p className="px-3 py-4 font-serif text-xs leading-relaxed text-[#8c8a84]">
          {t('reference.book_excerpt_empty')}
        </p>
      ) : (
        <div
          data-testid="book-excerpt-list"
          className="custom-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto p-2"
        >
          {excerpts.map((excerpt) => {
            const copied = copiedId === excerpt.id;
            const checked = checkedSet.has(excerpt.id);
            // 多选这一轮里，勾选状态顶替"选中"，底色和 aria 都跟着它走。
            const selected = multi ? checked : selectedId === excerpt.id;
            // 对话来源的摘抄没有原文位置，别装作能跳回去。
            const fromBook = (excerpt.source ?? 'book') === 'book';
            const where = fromBook ? excerpt.unitLabel : t('reference.book_chat_title');
            const askLabel = t('reference.book_excerpt_ask');
            const cardLabel = multi ? t('reference.book_excerpt_check_toggle') : askLabel;
            const note = excerpt.note?.trim() ?? '';
            const editingNote = editingNoteId === excerpt.id;
            // 多选时单击只勾选，不问 AI——否则圈选一路问一路，把右栏塞满。
            const onCardClick = () => {
              if (multi) onToggleChecked?.(excerpt.id);
              else onAsk(excerpt);
            };
            // 双击展开全文。单击仍然是"问 AI"、保持即时响应，所以这里**不**能把单击延后
            // 来区分两种手势——那会让主操作慢一截。代价见报告。
            const onCardDoubleClick = () => {
              setExpandedId((cur) => (cur === excerpt.id ? null : excerpt.id));
            };
            // 焦点离开这张卡就收起。点卡片内部的想法输入框、复制按钮也会冒泡出 blur，
            // 所以得看焦点是不是真的落到了这张卡外面。
            const onCardBlur = (e: React.FocusEvent<HTMLDivElement>) => {
              if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
              setExpandedId((cur) => (cur === excerpt.id ? null : cur));
            };
            const onCardKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              // 只有焦点在卡片自己身上时才问 AI。卡片里有想法输入框和「保存／取消」，
              // 它们的按键各有各的用处——在「保存」上按回车就该存，冒泡上来既存不下
              // （preventDefault 掐掉了按钮的激活）又白问一次 AI。
              if (e.target !== e.currentTarget) return;
              e.preventDefault();
              onCardClick();
            };
            return (
              <div
                key={excerpt.id}
                data-testid="book-excerpt-card"
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                title={cardLabel}
                onClick={onCardClick}
                onDoubleClick={onCardDoubleClick}
                onBlur={onCardBlur}
                onKeyDown={onCardKeyDown}
                className={`group cursor-pointer rounded-lg border p-2.5 text-left transition-colors ${
                  selected
                    ? // 和右栏"自己发出去的消息"气泡同一个底色（ChatPanel 的 bg-[#C2410C]/10），
                      // 边框保持中性不染红——红框那版被否过一次。
                      'border-[#E6E4DF] bg-[#C2410C]/10'
                    : 'border-[#E6E4DF] bg-[#FAF9F6] hover:border-[#d8d4cc]'
                }`}
              >
                <div className="flex items-start gap-2">
                  {/* 勾选框只在多选这一轮出现：平时它只是噪声，还占掉正文第一行的宽度。 */}
                  {multi ? (
                    <span
                      data-testid="book-excerpt-checkbox"
                      aria-hidden
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        checked
                          ? 'border-[#C2410C] bg-[#C2410C] text-white'
                          : 'border-[#d1cfca] bg-white'
                      }`}
                    >
                      {checked ? <Check className="h-3 w-3" /> : null}
                    </span>
                  ) : null}
                  <p className="min-w-0 flex-1 whitespace-pre-wrap font-serif text-[13px] leading-[1.7] text-[#4a4a44]">
                    {expandedId === excerpt.id ? excerpt.text : excerptPreview(excerpt.text)}
                  </p>
                </div>
                {onNoteChange ? (
                  // 想法区在可点的卡片里：点它、写它都不该顺带问 AI。
                  <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
                    {editingNote ? (
                      <div data-testid="book-excerpt-note-editor">
                        <textarea
                          data-testid="book-excerpt-note-input"
                          aria-label={t('reference.book_excerpt_note_label')}
                          placeholder={t('reference.book_excerpt_note_placeholder')}
                          maxLength={BOOK_EXCERPT_NOTE_MAX_CHARS}
                          rows={3}
                          autoFocus
                          value={noteDraft}
                          onChange={(e) => setNoteDraft(e.target.value)}
                          // 自动保存：没有"保存"按钮，靠失焦、切走、卸载三个时机写回。
                          // 待存项在 startEditNote 里就登记好了——onFocus 若晚于打字才到，
                          // 在这里重置草稿反而会把用户刚敲的字冲掉。
                          onBlur={() => savePendingNote()}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              // 已经是自动保存了，Esc 只是"我写完了"，不是"别存"。
                              e.stopPropagation();
                              closeNoteEditor();
                            }
                          }}
                          className="w-full resize-y rounded-md border border-[#E6E4DF] bg-white px-2 py-1.5 font-sans text-[11px] leading-[1.6] text-[#2c2c28] outline-none focus:border-[#C2410C]"
                        />
                        <p className="mt-1 font-sans text-[11px] text-[#a8a49c]">
                          {t('reference.book_excerpt_note_autosave')}
                          {/* 点摘抄本外面也会收起，但那个手势看不见，Esc 得写出来。 */}
                          <span className="ml-1.5 text-[#c2beb5]">
                            · {t('reference.book_excerpt_note_esc')}
                          </span>
                        </p>
                      </div>
                    ) : note ? (
                      <div
                        data-testid="book-excerpt-note"
                        className="border-l-2 border-[#C2410C]/50 pl-2"
                      >
                        <p className="font-mono text-[11px] text-[#C2410C]">
                          {t('reference.book_excerpt_note_label')}
                        </p>
                        <p className="mt-0.5 whitespace-pre-wrap font-sans text-[11px] leading-[1.6] text-[#4a4a44]">
                          {note}
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="min-w-0 truncate font-mono text-[11px] text-[#8c8a84]">
                    {where}
                  </span>
                  {/* 选中时也显出来：点完卡片指针未必还停在这一张上，
                      动作跟着"没选"一起藏起来的话，选了等于没选。 */}
                  <div
                    className={`ml-auto flex shrink-0 items-center gap-0.5 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150 ${
                      selected ? 'opacity-100' : 'opacity-0'
                    }`}
                  >
                    <RailAction
                      testId="book-excerpt-copy"
                      label={
                        copied ? t('reference.book_excerpt_copied') : t('reference.book_excerpt_copy')
                      }
                      onClick={() => copyExcerpt(excerpt)}
                    >
                      {copied ? (
                        <Check className="h-3.5 w-3.5 text-[#C2410C]" aria-hidden />
                      ) : (
                        <Copy className="h-3.5 w-3.5" aria-hidden />
                      )}
                    </RailAction>
                    {onNoteChange && !editingNote ? (
                      <RailAction
                        testId={note ? 'book-excerpt-note-edit' : 'book-excerpt-note-add'}
                        label={
                          note
                            ? t('reference.book_excerpt_note_edit')
                            : t('reference.book_excerpt_note_add')
                        }
                        onClick={() => startEditNote(excerpt)}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                      </RailAction>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
