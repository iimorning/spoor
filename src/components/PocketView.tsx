import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Camera, Check, CircleUser, Plus, Trash2 } from 'lucide-react';
import { db, type CanvasNode } from '../db';
import { useAppDialog } from './AppDialogProvider';
import { useAdaptiveLayout } from '../hooks/useAdaptiveLayout';
import {
  POCKET_CANVAS_ID,
  createPocketImageNote,
  createPocketNote,
  deletePocketNote,
  discardEmptyPocketNotes,
  isPocketImageNode,
  pocketItemHasContent,
  pocketMemoBlocks,
  updatePocketMemoBlocks,
  deletePocketMemo,
  pocketItemPreview,
  pocketItemTitle,
  sortPocketNotes,
  updatePocketImageOcrText,
  formatPocketTime,
} from '../utils/pocketNotes';
import { recognizeImageText, type OcrStage } from '../services/pocketOcr';
import { imageBlobFromContent, toCanvasImageDataUrl } from '../utils/file';
import { dropOriginalPhoto, peekOriginalPhoto, rememberOriginalPhoto } from '../utils/recentOriginalPhotos';
import { blocksPlainText, imageBlock, newBlockId, photoIdsIn, withOcrText, withTrailingTextSlot, type PocketBlock } from '../utils/pocketBlocks';


export interface PocketViewProps {
  /** Opens Settings → cloud account when Supabase is configured. */
  onOpenLogin?: () => void;
  /** When true, the header control reads as account/sync instead of sign-in. */
  accountSignedIn?: boolean;
}

/**
 * 编辑器里的一段文字，高度**跟着内容走**。
 *
 * 为什么不能写死最小高度：这个界面是"上面一段、中间一张图、下面一段"的连续文档。
 * 给输入框一个 min-h-[7rem] 之类的固定高度，只有一行字的那段也会占满一百多像素，
 * 夹在图和图之间就撑出一大片空白（用户反馈过）。所以每次内容变化后按 scrollHeight 重设。
 *
 * 空段仍保留一行半的最小高度：不然图下面就没有一个能点的落笔处。
 */
function GrowingTextarea(props: {
  blockId: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const localRef = useRef<HTMLTextAreaElement>(null);

  const attach = (el: HTMLTextAreaElement | null) => {
    localRef.current = el;
    if (props.inputRef) props.inputRef.current = el;
  };

  useLayoutEffect(() => {
    const el = localRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [props.value]);

  return (
    <textarea
      ref={attach}
      data-testid="pocket-editor"
      data-block-id={props.blockId}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      placeholder={props.placeholder}
      className="block w-full min-h-[2.75rem] resize-none overflow-hidden bg-transparent outline-none px-1 py-0.5 text-[1.125rem] leading-[1.85] text-[#1a1a1a] placeholder:text-[#8c8a84] pocket-text pocket-text-editor"
    />
  );
}

const LONG_PRESS_MS = 480;
const LONG_PRESS_MOVE_PX = 12;

export function PocketView({
  onOpenLogin,
  accountSignedIn = false,
}: PocketViewProps) {
  const { t, i18n } = useTranslation();
  const { confirm } = useAppDialog();
  const { touchChrome, phone } = useAdaptiveLayout();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [title, setTitle] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [importingPhotos, setImportingPhotos] = useState(false);
  const [photoError, setPhotoError] = useState(false);
  // 识别失败的原因要能看见，而不是笼统一句"照片没存上"。
  const [ocrError, setOcrError] = useState('');
  const [blocks, setBlocks] = useState<PocketBlock[]>([]);
  const [ocrBusyId, setOcrBusyId] = useState<string | null>(null);
  const [ocrEditing, setOcrEditing] = useState(false);
  const [ocrDraft, setOcrDraft] = useState('');
  const ocrEditingRef = useRef(ocrEditing);
  ocrEditingRef.current = ocrEditing;
  // commitOcrEdit 是个空依赖的 useCallback，只能靠 ref 读最新值。
  const ocrDraftRef = useRef(ocrDraft);
  ocrDraftRef.current = ocrDraft;
  const previewTextRef = useRef('');
  const ocrTextareaRef = useRef<HTMLTextAreaElement>(null);
  const blocksRef = useRef<PocketBlock[]>([]);
  blocksRef.current = blocks;
  const [ocrState, setOcrState] = useState<{
    done: number;
    total: number;
    stage: OcrStage;
  } | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef(title);
  titleRef.current = title;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const editingIdRef = useRef(editingId);
  editingIdRef.current = editingId;
  const selectModeRef = useRef(selectMode);
  selectModeRef.current = selectMode;
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number; id: string } | null>(null);
  const suppressClickRef = useRef(false);
  const editorHistoryPushedRef = useRef(false);
  const skipEditorPopRef = useRef(false);
  const selectHistoryPushedRef = useRef(false);
  const skipSelectPopRef = useRef(false);
  const previewIdRef = useRef(previewId);
  previewIdRef.current = previewId;
  const previewHistoryPushedRef = useRef(false);
  const skipPreviewPopRef = useRef(false);

  const rows =
    useLiveQuery(async () => {
      const all = await db.nodes.where('canvasId').equals(POCKET_CANVAS_ID).toArray();
      return sortPocketNotes(all);
    }, []) ?? [];
  // openNote 要按 id 回读那一行的段落，useLiveQuery 的结果得在别处也能读到。
  const rowsRef = useRef<CanvasNode[]>(rows);
  rowsRef.current = rows;

  const notes = useMemo(
    () =>
      rows.filter(
        (node) =>
          // 属于某条备忘的图片是那条备忘里的一段，不自己冒出来变成第二条。
          !node.ownerMemoId && (pocketItemHasContent(node) || node.id === editingId),
      ),
    [rows, editingId],
  );

  const previewNode = useMemo(
    () => rows.find((node) => node.id === previewId && isPocketImageNode(node)) ?? null,
    [rows, previewId],
  );
  // 全屏预览这一屏给全文，不截断——列表只是扫一眼的地方。
  const previewText = previewNode ? pocketItemPreview(previewNode) : '';
  // 同步进 ref 的时机得在 previewText 声明之后：上面那行赋值跑在它前面会撞 TDZ。
  previewTextRef.current = previewText;

  useEffect(() => {
    void discardEmptyPocketNotes(editingId ?? undefined);
  }, [editingId]);

  useEffect(() => {
    if (!editingId) return;
    const id = window.setTimeout(() => {
      // 编辑器已经关了就别再写：closeEditor 刚存过一次、并且把 title/blocks 清空了，
      // 这个还没落地的定时器再补一笔，会把刚存好的内容抹成空。
      if (editingIdRef.current !== editingId) return;
      // 必须存**段落**，不是 draft 那段纯文字：图文混排的备忘正文在 blocks 里，
      // 拿 content 去覆盖会把 blocks 留在原地、content 变成一串普通文字，
      // 这行记录从此不再是合法图片/备忘（OCR 那边再去 atob 它就会抛 InvalidCharacterError）。
      void updatePocketMemoBlocks(editingId, blocksRef.current, titleRef.current);
    }, 280);
    return () => window.clearTimeout(id);
  }, [draft, editingId]);

  useEffect(() => {
    if (!editingId) return;
    const id = window.requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
    return () => window.cancelAnimationFrame(id);
  }, [editingId]);

  const flushDraft = useCallback(async () => {
    const id = editingIdRef.current;
    if (!id) return;
    // 同上：存段落，不能拿纯文字去覆盖 content。
    await updatePocketMemoBlocks(id, blocksRef.current, titleRef.current);
  }, []);

  const closeEditor = useCallback(async (fromHistory = false) => {
    const id = editingIdRef.current;
    if (!id) return;
    const text = draftRef.current.trim();
    // 只有图、没有字的备忘**不算空稿**：用户可能就只想存一张照片。
    // 判空必须连图片段一起看，只看文字会把这种备忘连它的图一起删掉。
    const hasPhoto = blocksRef.current.some((b) => b.kind === 'image');
    // 光有标题也算有内容：用户可能只想记个名字。
    const head = titleRef.current.trim();
    if (!text && !hasPhoto && !head) await deletePocketMemo(id);
    else await updatePocketMemoBlocks(id, blocksRef.current, titleRef.current);
    setEditingId(null);
    setDraft('');
    setTitle('');
    setBlocks([]);
    if (fromHistory) {
      editorHistoryPushedRef.current = false;
      return;
    }
    if (editorHistoryPushedRef.current) {
      editorHistoryPushedRef.current = false;
      skipEditorPopRef.current = true;
      window.history.back();
    }
  }, []);

  const exitSelectMode = useCallback((fromHistory = false) => {
    if (!selectModeRef.current) return;
    setSelectMode(false);
    setSelectedIds(new Set());
    if (fromHistory) {
      selectHistoryPushedRef.current = false;
      return;
    }
    if (selectHistoryPushedRef.current) {
      selectHistoryPushedRef.current = false;
      skipSelectPopRef.current = true;
      window.history.back();
    }
  }, []);

  useEffect(() => {
    if (!editingId) return;
    window.history.pushState({ pocketEditor: true }, '');
    editorHistoryPushedRef.current = true;
    // skip 标志只对刚压进去的这条 history 有意义。清掉上一轮可能残留的值：
    // closeEditor 走的是 setEditingId + history.back()，React 先跑 effect cleanup 把
    // popstate 监听摘掉，popstate 落地时已经没人听，标志就留成了脏的——
    // 下一次进编辑器按返回键会被它白白吞掉一次。
    skipEditorPopRef.current = false;

    const onPopState = () => {
      if (skipEditorPopRef.current) {
        skipEditorPopRef.current = false;
        return;
      }
      if (!editingIdRef.current) return;
      void closeEditor(true);
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [editingId, closeEditor]);

  /**
   * 存回 ocrText。存空串是有意义的：用户把认不出来的那几行删光了，
   * 摆到画布上时就不该再长出一张空便签（spawnOcrNoteBesideImage 遇空串直接跳过）。
   *
   * 放在按键监听之前是因为那边要把它列进依赖数组，写在后面会撞 TDZ。
   * 它只读 ref，所以依赖数组保持空。
   */
  const commitOcrEdit = useCallback(async () => {
    if (!ocrEditingRef.current) return;
    const id = previewIdRef.current;
    setOcrEditing(false);
    if (!id) return;
    const next = ocrDraftRef.current;
    if (next === (previewTextRef.current ?? '')) return;
    await updatePocketImageOcrText(id, next);
  }, []);

  const closePreview = useCallback(async (fromHistory = false) => {
    if (!previewIdRef.current) return;
    // 正在改字就先把改动存了再关。安卓的硬件返回键走的是 popstate → closePreview，
    // 而那恰恰是用户最顺手的"改完了"手势，直接 setOcrDraft('') 会把刚敲的字悄悄丢掉。
    if (ocrEditingRef.current) {
      const id = previewIdRef.current;
      const next = ocrDraftRef.current;
      if (next !== (previewTextRef.current ?? '')) {
        await updatePocketImageOcrText(id, next);
      }
    }
    setPreviewId(null);
    setOcrEditing(false);
    setOcrDraft('');
    if (fromHistory) {
      previewHistoryPushedRef.current = false;
      return;
    }
    if (previewHistoryPushedRef.current) {
      previewHistoryPushedRef.current = false;
      skipPreviewPopRef.current = true;
      window.history.back();
    }
  }, []);

  // 照片全屏预览和编辑器一样要压一条 history，否则安卓的返回键会直接退出应用。
  useEffect(() => {
    if (!previewId) return;
    window.history.pushState({ pocketPhoto: true }, '');
    previewHistoryPushedRef.current = true;
    skipPreviewPopRef.current = false;

    const onPopState = () => {
      if (skipPreviewPopRef.current) {
        skipPreviewPopRef.current = false;
        return;
      }
      if (!previewIdRef.current) return;
      void closePreview(true);
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [previewId, closePreview]);

  useEffect(() => {
    if (!selectMode) return;
    window.history.pushState({ pocketSelect: true }, '');
    selectHistoryPushedRef.current = true;
    skipSelectPopRef.current = false;

    const onPopState = () => {
      if (skipSelectPopRef.current) {
        skipSelectPopRef.current = false;
        return;
      }
      if (!selectModeRef.current) return;
      exitSelectMode(true);
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [selectMode, exitSelectMode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (previewIdRef.current) {
        // 正在改文字时，Esc 只该退出编辑，而不是把整屏关掉——刚敲的字会丢。
        if (ocrEditingRef.current) void commitOcrEdit();
        else void closePreview();
        return;
      }
      if (editingIdRef.current) {
        void closeEditor();
        return;
      }
      if (selectModeRef.current) exitSelectMode();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeEditor, closePreview, commitOcrEdit, exitSelectMode]);

  const startNew = async () => {
    exitSelectMode();
    await flushDraft();
    const id = await createPocketNote('');
    setDraft('');
    setTitle('');
    setBlocks([{ kind: 'text', id: newBlockId(), text: '' }]);
    setEditingId(id);
  };

  /**
   * 拍照 / 从相册选。
   *
   * 只挂一个 `accept="image/*"` 的 input，不加 `capture`：这样 iOS 弹出「照片图库 / 拍照 / 浏览」、
   * Android 弹出「相机 / 相册 / 最近」，由系统替用户回答"用哪个"，比我们自己摆两个按钮准。
   *
   * 相片落在列表的哪一格：正在写某条备忘时贴着它上面放（编辑到一半插的照片不该跳到最前面），
   * 否则排最新。一批多张时按序号递减时间戳，保持选择顺序（0 号排最上）。
   *
   * **不自动识别**。端侧引擎首次要下 45MB、每张还要跑几秒，而用户存一张图多半根本不是
   * 想读字（拍个白板、截个图、留个景），替他按下 45MB 的开关是产品替用户做决定。
   * 所以识别改成每张照片上的一个动作，见 runOcr。
   */
  const onPhotosPicked = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []).filter((file) =>
      file.type.startsWith('image/'),
    );
    // 清空 value，连续拍两张同一张时才会再触发 change。
    input.value = '';
    if (files.length === 0) return;

    // 照片一定是某条备忘里的一段：列表那一屏已经没有拍照按钮了，唯一的入口是
    // 编辑器里那个，而编辑器必然有 editingId。所以不存在"插不进备忘就另起一条"
    // 这条路——而那恰恰是用户不要的行为（上头一段文字、中间一张图、底下再一段）。
    const memoId = editingIdRef.current;
    if (!memoId) return;

    setImportingPhotos(true);
    setPhotoError(false);
    try {
      for (const file of files) {
        // 原图动辄好几 MB，必须压：整条 data URL 要存 IndexedDB 再同步上云，
        // 而云端单次 upsert 一批只有 512KB。
        const encoded = await toCanvasImageDataUrl(file);
        if (!encoded.dataUrl) throw new Error('empty image');
        const id = await createPocketImageNote({
          dataUrl: encoded.dataUrl,
          width: encoded.width,
          height: encoded.height,
          ownerMemoId: memoId,
        });
        rememberOriginalPhoto(id, file);
        insertPhotoIntoMemo(id);
      }
    } catch (e) {
      console.error('[Spoor] pocket photo import failed', e);
      setPhotoError(true);
    } finally {
      setImportingPhotos(false);
    }
  };

  /**
   * 识别按钮在忙着的时候写什么。不忙就返回 null，交给调用方写自己的那一档文案。
   *
   * 为什么不能两个阶段都写"正在识别文字"：首次那个 45MB 下载和真正的识别是两件事，
   * 差着几十秒。实测引擎光初始化（模型已经在本地、零下载延迟）就要 2.4 秒，之后每张图
   * 还要再跑 4 秒以上。两个阶段共用一句话，下载的那几十秒在界面上就长成了"识别很慢"——
   * 用户看到的慢是真的，但慢的地方不是他以为的那个地方。下载阶段就把话说准。
   */
  const ocrBusyLabel = (busy: boolean) =>
    !busy
      ? null
      : ocrState?.stage === 'loading-engine'
        ? t('pocket.ocr_preparing')
        : t('pocket.ocr_working', { done: 0, total: 1 });

  /**
   * 识别这一张照片的文字。用户在照片上点了才跑。
   *
   * 输入优先用刚拍时的**原始文件**：存进库的是压过的 WebP（q0.8，为了塞进 512KB 的
   * 同步批次），小字在上面明显更难认。原图只在本次会话的内存里留最近几张，
   * 超出缓存或者重开应用之后，就只能拿存下来的那张识别——所以老照片认得糙一点是预期内的。
   */
  const runOcr = async (photoId: string) => {
    if (ocrBusyId) return;
    const node = await db.nodes.get(photoId);
    if (!node || !isPocketImageNode(node)) return;
    setOcrBusyId(photoId);
    setOcrError('');
    setOcrState({ done: 0, total: 1, stage: 'loading-engine' });
    try {
      // 原图还在就用原图（像素更足），没有才退回存下来的压缩图。
      // 这里只 peek 不 delete：失败之后用户要能再点一次。
      const original = peekOriginalPhoto(photoId);
      const source: File | Blob = original ?? (await imageBlobFromContent(node.content ?? ''));
      const text = await recognizeImageText(source, (stage) => {
        setOcrState({ done: 0, total: 1, stage });
      });
      if (!text) {
        setOcrError(t('pocket.ocr_no_text'));
        return;
      }
      // 照片是某条备忘里的一段 → 识别结果直接落进**那个编辑面**，跟别的文字一样能改。
      // 不这么做的话，照片上留一份 ocrText、文档里又有一段，画布上会同时长出
      // 一张文字卡和一张关联便签，同一句话出现两次。
      if (node.ownerMemoId) {
        await adoptOcrTextIntoMemo(node.ownerMemoId, photoId, text);
        await updatePocketImageOcrText(photoId, '');
      } else {
        await updatePocketImageOcrText(photoId, text);
      }
      dropOriginalPhoto(photoId);
    } catch (e) {
      // 把真实原因带到界面上。原来统一报"照片没存上"，用户完全无从判断是哪一步坏了。
      console.error('[Spoor] pocket photo OCR failed', e);
      setOcrError(String((e as Error)?.message ?? e).slice(0, 200));
    } finally {
      setOcrBusyId(null);
      setOcrState(null);
    }
  };

  /**
   * 把识别结果写进所属备忘的段落里，插在照片之后。
   * 编辑器开着就用内存里的段落（立刻能看到），否则按 id 回读。
   */
  const adoptOcrTextIntoMemo = async (memoId: string, photoId: string, text: string) => {
    const current =
      editingIdRef.current === memoId && blocksRef.current.length
        ? blocksRef.current
        : pocketMemoBlocks((await db.nodes.get(memoId)) ?? { content: '' });
    const next = withTrailingTextSlot(withOcrText(current, photoId, text));
    if (editingIdRef.current === memoId) setBlocksAndDraft(next);
    await updatePocketMemoBlocks(memoId, next);
  };

  const openPreview = (id: string) => {
    if (selectModeRef.current) return;
    setPreviewId(id);
  };

  const startOcrEdit = () => {
    setOcrDraft(previewText);
    setOcrEditing(true);
    // 光标落到末尾：OCR 结果通常是"前面对、后面错"，要改的多半在尾部。
    window.requestAnimationFrame(() => {
      const el = ocrTextareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };

  // 列表和编辑器两屏都要能拍照，而两屏是各自 early return 的，所以 input 得两处都挂。
  // 不加 capture：让系统弹自己的「拍照 / 相册 / 浏览」，比我们自己摆两个按钮准。
  const photoInput = (
    <input
      ref={photoInputRef}
      type="file"
      accept="image/*"
      multiple
      data-testid="pocket-photo-input"
      aria-hidden
      tabIndex={-1}
      className="hidden"
      onChange={(e) => void onPhotosPicked(e)}
    />
  );

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
  }, []);

  const openNote = (id: string, content: string) => {
    if (selectModeRef.current) return;
    exitSelectMode();
    setDraft(content);
    const node = rowsRef.current.find((n) => n.id === id);
    setTitle(node?.title ?? '');
    const stored: PocketBlock[] = node
      ? pocketMemoBlocks(node)
      : [{ kind: 'text', id: newBlockId(), text: content }];
    setBlocks(withTrailingTextSlot(stored));
    setEditingId(id);
  };

  /** 编辑器里的段落发生变化。纯文字的那一段仍然同步到 draft，好让关闭时的清空逻辑照旧工作。 */
  const setBlocksAndDraft = (next: PocketBlock[]) => {
    setBlocks(next);
    setDraft(blocksPlainText(next));
  };

  /**
   * 把新照片插进当前这条备忘，位置在**光标所在的文字段之后**。
   *
   * 这正是"上面一段文字、中间插一张图、下面再写"：用户写着写着拍照，
   * 图就落在正在写的那段和下一段之间。找不到光标（比如还没聚焦任何一段）
   * 就插到最后。
   */
  const insertPhotoIntoMemo = (photoId: string) => {
    const memoId = editingIdRef.current;
    if (!memoId) return;
    const current: PocketBlock[] = blocksRef.current.length
      ? blocksRef.current
      : [{ kind: 'text', id: newBlockId(), text: draftRef.current }];
    const focusId = document.activeElement instanceof HTMLElement
      ? document.activeElement.dataset.blockId
      : undefined;
    let focusAt = -1;
    if (focusId) {
      focusAt = current.findIndex((b) => b.id === focusId);
    } else {
      // 没聚焦就插到最后一段文字之后（findLastIndex 在这套 lib 下没有，手写循环）。
      for (let k = 0; k < current.length; k += 1) {
        if (current[k]!.kind === 'text') focusAt = k;
      }
    }
    const at = focusAt < 0 ? current.length : focusAt + 1;
    const next = [...current.slice(0, at), imageBlock(photoId), ...current.slice(at)];
    // 图后面必须留一段能继续打字的地方——"上面文字、中间图、下面文字"里的下面那段。
    // 没有它的话插完图就没法再往下写，形状就断了。
    if (next[at + 1]?.kind !== 'text') {
      next.splice(at + 1, 0, { kind: 'text', id: newBlockId(), text: '' });
    }
    setBlocksAndDraft(next);
    void updatePocketMemoBlocks(memoId, next);
    // 光标挪到下面那段，用户可以直接接着写
    window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLTextAreaElement>(
        `[data-block-id="${next[at + 1]!.id}"]`,
      );
      target?.focus();
    });
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const enterSelectMode = (id: string) => {
    setSelectMode(true);
    setSelectedIds(new Set([id]));
  };

  const onCardPointerDown = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0 && e.pointerType !== 'touch') return;
    if (selectModeRef.current) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* jsdom */
    }
    clearLongPress();
    longPressStartRef.current = { x: e.clientX, y: e.clientY, id };
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      longPressStartRef.current = null;
      suppressClickRef.current = true;
      enterSelectMode(id);
    }, LONG_PRESS_MS);
  };

  const onCardPointerMove = (e: React.PointerEvent) => {
    const start = longPressStartRef.current;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (dx * dx + dy * dy > LONG_PRESS_MOVE_PX * LONG_PRESS_MOVE_PX) {
      clearLongPress();
    }
  };

  const onCardPointerEnd = () => {
    clearLongPress();
  };

  const onCardClick = (node: CanvasNode) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (selectModeRef.current) {
      toggleSelected(node.id);
      return;
    }
    // 照片没有文字可编辑，点开是全屏看图；文字备忘才进编辑器。
    if (isPocketImageNode(node)) {
      openPreview(node.id);
      return;
    }
    openNote(node.id, node.content ?? '');
  };

  const removeSelected = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const titles = notes
      .filter((node) => ids.includes(node.id))
      .map((node) => pocketItemTitle(node, t('pocket.photo')) || t('pocket.untitled'));
    const ok = await confirm({
      message:
        ids.length === 1
          ? t('pocket.delete_confirm', { title: titles[0] ?? t('pocket.untitled') })
          : t('pocket.delete_n_confirm', { count: ids.length }),
      variant: 'danger',
      confirmLabel: t('dialog.confirm'),
      cancelLabel: t('dialog.cancel'),
    });
    if (!ok) return;
    await Promise.all(ids.map((id) => deletePocketNote(id)));
    exitSelectMode();
  };

  const padClass = phone
    ? 'pt-[calc(1.25rem+env(safe-area-inset-top))] px-7 pb-[calc(1.5rem+env(safe-area-inset-bottom))]'
    : touchChrome
      ? 'pt-[calc(4.75rem+env(safe-area-inset-top))] px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]'
      : 'pl-14 pr-8 py-8';
  const editorPadClass = phone
    ? 'pt-[calc(1.25rem+env(safe-area-inset-top))] px-7 pb-[calc(1.75rem+env(safe-area-inset-bottom))]'
    : touchChrome
      ? 'pt-[calc(4.75rem+env(safe-area-inset-top))] px-7 pb-[calc(1.75rem+env(safe-area-inset-bottom))]'
      : 'pl-16 pr-12 py-8';
  const previewPadClass = phone
    ? 'pt-[calc(1.25rem+env(safe-area-inset-top))] px-7'
    : touchChrome
      ? 'pt-[calc(4.75rem+env(safe-area-inset-top))] px-7'
      : 'pl-16 pr-12 pt-8';

  if (editingId) {
    return (
      <div
        className={`relative flex-1 min-h-0 overflow-hidden bg-[#FAF9F6] paper-texture flex flex-col ${editorPadClass}`}
        data-testid="pocket-view"
      >
        {/*
          顶上分两半：左边是标题区，右边是拍照 + 返回。
          拍照挪到右边是因为**拍照是往这条备忘里加内容**，属于"编辑"这一侧；
          放左边会让人以为是"回到上一张"，跟返回键抢同一个位置。左边让给标题，
          符合"先起个名，再写正文"的常规操作顺序。
        */}
        <header className="flex items-start justify-between gap-3 shrink-0 mb-4">
          <input
            ref={titleInputRef}
            data-testid="pocket-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              // 回车落到正文第一段，别在标题里换行
              if (e.key !== 'Enter') return;
              e.preventDefault();
              const first = blocksRef.current.find((b) => b.kind === 'text');
              if (first && first.kind === 'text') {
                document.querySelector<HTMLTextAreaElement>(`[data-block-id="${first.id}"]`)?.focus();
              }
            }}
            placeholder={t('pocket.title_placeholder')}
            aria-label={t('pocket.title_placeholder')}
            className="min-w-0 flex-1 bg-transparent outline-none text-[1.5rem] leading-snug text-[#1a1a1a] placeholder:text-[#c9c6bf] pocket-text"
          />
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              data-testid="pocket-editor-photo"
              onClick={() => photoInputRef.current?.click()}
              disabled={importingPhotos || !!ocrState}
              className="w-10 h-10 flex items-center justify-center rounded-full text-[#5a5a54] hover:text-[#C2410C] hover:bg-white/90 border border-transparent hover:border-[#E6E4DF] disabled:opacity-40"
              aria-label={t('pocket.add_photo')}
              title={t('pocket.add_photo')}
            >
              <Camera className="w-5 h-5" />
            </button>
            <button
              type="button"
              data-testid="pocket-back"
              onClick={() => void closeEditor()}
              className="w-10 h-10 flex items-center justify-center rounded-full text-[#5a5a54] hover:text-[#C2410C] hover:bg-white/90 border border-transparent hover:border-[#E6E4DF]"
              aria-label={t('pocket.back')}
              title={t('pocket.back')}
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          </div>
        </header>
        {/*
          一个编辑面里上下接着排：文字段是输入框，图片段是缩略图。
          纯文字的备忘只有一段，行为和以前一模一样（同一个 data-testid=pocket-editor）。
        */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {blocks.map((block, i) => {
            if (block.kind === 'image') {
              const photo = rowsRef.current.find((n) => n.id === block.photoId);
              if (!photo) return null;
              // 这张照片的文字是不是已经被"收进"文档了（runOcr 插进来的那段）。
              const adopted = blocks.some((b) => b.kind === 'text' && b.fromOcr === photo.id);
              return (
                <figure key={block.id} className="my-2" data-testid={`pocket-block-photo-${block.id}`}>
                  <button
                    type="button"
                    data-testid={`pocket-block-open-${block.photoId}`}
                    onClick={() => openPreview(block.photoId)}
                    className="block w-full"
                  >
                    <img
                      src={photo.content}
                      alt=""
                      draggable={false}
                      className="w-full max-h-64 object-cover rounded-xl border border-[#E6E4DF] bg-[#F4F1ED]"
                    />
                  </button>
                  {/*
                    这里**不再单开一个只读的框**显示识别结果。照片在文档里，识别出来的字
                    就该是文档里的一段普通文字（runOcr 会把它插成照片之后的可编辑段），
                    而不是贴一个改不了的框——那样它和"图文同一编辑态"是矛盾的。
                    照片属于备忘时，ocrText 会被清掉，所以这里只看动作。
                  */}
                  <figcaption className="mt-1.5 flex flex-wrap items-center gap-3 text-[12px] text-[#8c8a84]">
                    <button
                      type="button"
                      data-testid={`pocket-ocr-run-${photo.id}`}
                      disabled={ocrBusyId === photo.id}
                      onClick={() => void runOcr(photo.id)}
                      className="font-medium text-[#C2410C] hover:underline disabled:opacity-50"
                    >
                      {ocrBusyLabel(ocrBusyId === photo.id) ??
                        (adopted || photo.ocrText ? t('pocket.ocr_redo') : t('pocket.ocr_run'))}
                    </button>
                    {/*
                      「查看并修改」只对**独立照片**有意义：它没有编辑面，
                      文字存在照片自己身上，只能去全屏那屏改。
                      备忘里的照片，文字已经是下面那段可编辑的正文了，不用再指一个入口。
                    */}
                    {photo.ocrText ? (
                      <button
                        type="button"
                        data-testid={`pocket-ocr-open-${photo.id}`}
                        onClick={() => openPreview(photo.id)}
                        className="hover:underline"
                      >
                        {t('pocket.ocr_view')}
                      </button>
                    ) : null}
                  </figcaption>
                </figure>
              );
            }
            return (
              <GrowingTextarea
                key={block.id}
                blockId={block.id}
                value={block.text}
                onChange={(text) => {
                  const next = [...blocks];
                  next[i] = { ...block, text };
                  setBlocksAndDraft(next);
                }}
                placeholder={i === 0 ? t('pocket.placeholder') : undefined}
                inputRef={i === 0 ? textareaRef : undefined}
              />
            );
          })}
        </div>
        {photoInput}
      </div>
    );
  }

  return (
    <div
      className={`relative flex-1 min-h-0 overflow-hidden bg-[#FAF9F6] paper-texture flex flex-col ${padClass}`}
      data-testid="pocket-view"
    >
      <header className="shrink-0 mb-6 max-w-xl">
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-serif text-[#1a1a1a]">{t('pocket.title')}</h1>
          </div>
          {selectMode ? (
            <button
              type="button"
              data-testid="pocket-cancel-select"
              onClick={() => exitSelectMode()}
              className="shrink-0 h-10 px-3 rounded-full text-sm font-medium border border-[#E6E4DF] bg-white text-[#5a5a54] hover:text-[#C2410C] inline-flex items-center gap-1.5"
              title={t('pocket.cancel_select')}
            >
              {t('pocket.cancel_select')}
            </button>
          ) : (
            <>
              {/* 这一屏不放拍照按钮：照片是备忘里的一段，不是独立一条，
                  从列表直接拍会变成一条没有文字的孤立照片。要拍照就进备忘里拍。 */}
              {onOpenLogin ? (
                <button
                  type="button"
                  data-testid="pocket-sign-in"
                  onClick={onOpenLogin}
                  className="shrink-0 w-10 h-10 flex items-center justify-center text-[#5a5a54] hover:text-[#C2410C] transition-colors"
                  aria-label={accountSignedIn ? t('cloud.title') : t('cloud.signIn')}
                  title={accountSignedIn ? t('cloud.title') : t('cloud.signIn')}
                >
                  <CircleUser className="w-5 h-5" strokeWidth={1.75} />
                </button>
              ) : null}
            </>
          )}
        </div>
        {importingPhotos || photoError || ocrError || ocrState ? (
          <p
            className="mt-2 text-[11px] text-[#8c8a84] pocket-text break-words"
            data-testid="pocket-photo-status"
            role={photoError || ocrError ? 'alert' : 'status'}
          >
            {photoError
              ? t('pocket.photo_failed')
              : ocrError
                ? ocrError
                : ocrState
                  ? t(
                      ocrState.stage === 'loading-engine'
                        ? 'pocket.ocr_loading_engine'
                        : 'pocket.ocr_working',
                      { done: ocrState.done, total: ocrState.total },
                    )
                  : t('pocket.photo_working')}
          </p>
        ) : null}
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto max-w-xl pb-24">
        {notes.length === 0 ? (
          <p className="text-sm text-[#8c8a84] pocket-text leading-[1.75] tracking-[0.03em]" data-testid="pocket-empty">
            {t('pocket.empty')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {notes.map((node) => {
              const isPhoto = isPocketImageNode(node);
              const preview = pocketItemPreview(node);
              const title = pocketItemTitle(node, t('pocket.photo')) || t('pocket.untitled');
              const selected = selectedIds.has(node.id);
              const memoPhotoIds = isPhoto ? [] : photoIdsIn(pocketMemoBlocks(node));
              const memoPhotos = memoPhotoIds
                .map((pid) => rowsRef.current.find((n) => n.id === pid))
                .filter((n): n is CanvasNode => Boolean(n));
              return (
                <li key={node.id}>
                  <div
                    role={selectMode ? 'checkbox' : 'button'}
                    aria-checked={selectMode ? selected : undefined}
                    aria-label={title}
                    tabIndex={0}
                    className={`w-full rounded-xl border px-4 py-3 text-left transition-colors select-none touch-manipulation cursor-pointer [-webkit-touch-callout:none] ${
                      selected
                        ? 'border-[#C2410C]/50 bg-white'
                        : 'border-[#E6E4DF] bg-white/80 hover:border-[#C2410C]/40'
                    }`}
                    data-testid={`pocket-item-${node.id}`}
                    data-selected={selected ? 'true' : 'false'}
                    onPointerDown={(e) => onCardPointerDown(e, node.id)}
                    onPointerMove={onCardPointerMove}
                    onPointerUp={onCardPointerEnd}
                    onPointerCancel={onCardPointerEnd}
                    onContextMenu={(e) => e.preventDefault()}
                    onClick={() => onCardClick(node)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();
                      onCardClick(node);
                    }}
                  >
                    <div className={`flex gap-3 ${selectMode ? 'items-center' : 'items-start'}`}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="pocket-text pocket-text-list-title text-[#1a1a1a] line-clamp-1">{title}</span>
                          {!selectMode ? (
                            <span className="text-[11px] font-mono text-[#8c8a84] shrink-0">
                              {formatPocketTime(node.createdAt, i18n.language)}
                            </span>
                          ) : null}
                        </div>
                        {!isPhoto && memoPhotoIds.length > 0 ? (
                          /* 备忘里内嵌的图片：跟着这条备忘一起显示，缩略图并排。
                              点进去还是那条备忘的编辑器，不跳到别的条目。 */
                          <div className="mt-2 flex gap-1.5" data-testid={`pocket-inline-photos-${node.id}`}>
                            {memoPhotos.map((photo) => (
                              <img
                                key={photo.id}
                                src={photo.content}
                                alt=""
                                draggable={false}
                                loading="lazy"
                                decoding="async"
                                data-testid={`pocket-inline-photo-${photo.id}`}
                                className="h-20 w-20 shrink-0 rounded-lg border border-[#E6E4DF] bg-[#F4F1ED] object-cover pointer-events-none"
                              />
                            ))}
                          </div>
                        ) : null}
                        {isPhoto ? (
                          <>
                            <img
                              src={node.content}
                              alt=""
                              draggable={false}
                              loading="lazy"
                              decoding="async"
                              data-testid={`pocket-photo-${node.id}`}
                              className="mt-2 w-full h-40 object-cover rounded-lg border border-[#E6E4DF] bg-[#F4F1ED] pointer-events-none"
                            />
                            {/* 识别出来的字：不给它露脸的话，这张照片以后就没法被翻到了。
                                列表是扫一眼的地方，固定四行，**不提供"展开全文"**——
                                全文在点进去的那一屏里，两个入口是重复的。 */}
                            {preview ? (
                              <p
                                className="mt-1.5 text-[15px] text-[#5a5a54] line-clamp-4 whitespace-pre-wrap break-words pocket-text pocket-text-list-preview"
                                data-testid={`pocket-ocr-${node.id}`}
                              >
                                {preview}
                              </p>
                            ) : !selectMode ? (
                              /* 没识别过就把动作摆出来——识别是可选的，不做也不该像个残缺。
                                  注意这个分支必须挂在 isPhoto 里面：外层的 `isPhoto ?`
                                  已经把所有照片都接走了，挂在外面永远走不到。 */
                              <button
                                type="button"
                                data-testid={`pocket-ocr-run-${node.id}`}
                                disabled={ocrBusyId === node.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void runOcr(node.id);
                                }}
                                onKeyDown={(e) => e.stopPropagation()}
                                className="mt-2 text-[12px] font-medium text-[#C2410C] hover:underline disabled:opacity-50"
                              >
                                {ocrBusyLabel(ocrBusyId === node.id) ?? t('pocket.ocr_run')}
                              </button>
                            ) : null}
                          </>
                        ) : preview && preview !== title ? (
                          <p className="mt-1.5 text-[15px] text-[#5a5a54] line-clamp-2 whitespace-pre-wrap pocket-text pocket-text-list-preview">
                            {preview}
                          </p>
                        ) : null}
                      </div>
                      {selectMode ? (
                        <span
                          className={`w-5 h-5 shrink-0 self-center rounded-full border inline-flex items-center justify-center ${
                            selected
                              ? 'border-[#C2410C] bg-[#C2410C] text-white'
                              : 'border-[#d1cfca] bg-white text-transparent'
                          }`}
                          aria-hidden
                        >
                          <Check className="w-3 h-3" strokeWidth={3} />
                        </span>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {selectMode ? (
        <div className="absolute inset-x-0 bottom-0 px-4 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))] bg-gradient-to-t from-[#FAF9F6] via-[#FAF9F6] to-transparent">
          <button
            type="button"
            data-testid="pocket-select-delete"
            onClick={() => void removeSelected()}
            disabled={selectedIds.size === 0}
            className="w-full h-12 rounded-full bg-[#C2410C] text-white text-sm font-medium shadow-lg inline-flex items-center justify-center gap-2 disabled:opacity-40 disabled:pointer-events-none"
          >
            <Trash2 className="w-4 h-4" />
            {selectedIds.size > 1
              ? `${t('pocket.delete')} (${selectedIds.size})`
              : t('pocket.delete')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          data-testid="pocket-new"
          onClick={() => void startNew()}
          aria-label={t('pocket.new')}
          title={t('pocket.new')}
          className="absolute right-5 bottom-[calc(1.25rem+env(safe-area-inset-bottom))] coarse:right-4 w-14 h-14 rounded-full bg-[#C2410C] text-white shadow-lg shadow-[#C2410C]/25 hover:bg-[#9A3412] inline-flex items-center justify-center"
        >
          <Plus className="w-6 h-6" />
        </button>
      )}

      {/* 不加 capture：让系统弹自己的「拍照 / 相册 / 浏览」，比我们自己摆两个按钮准。 */}
      {photoInput}

      {previewNode ? (
        <div
          className="absolute inset-0 z-10 flex flex-col bg-[#FAF9F6] paper-texture"
          data-testid="pocket-photo-preview"
        >
          <header className={`flex items-center justify-between shrink-0 ${previewPadClass}`}>
            <span />
            <button
              type="button"
              data-testid="pocket-photo-back"
              onClick={() => void closePreview()}
              className="w-10 h-10 flex items-center justify-center rounded-full text-[#5a5a54] hover:text-[#C2410C] hover:bg-white/90 border border-transparent hover:border-[#E6E4DF]"
              aria-label={t('pocket.back')}
              title={t('pocket.back')}
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          </header>
          <div className="flex-1 min-h-0 flex flex-col px-7 pb-[calc(1.75rem+env(safe-area-inset-bottom))] gap-3">
            <div className="flex-1 min-h-0 flex items-center justify-center">
              <img
                src={previewNode.content}
                alt=""
                draggable={false}
                data-testid="pocket-photo-full"
                className="max-w-full max-h-full object-contain"
              />
            </div>
            {/* 全文在这一屏给，而且**点文字就能改**——端侧识别认错是常态（末尾多一个字、
                竖排串行都很常见），没有地方纠正就只能扔掉整张照片重拍。改完存回 ocrText，
                列表摘要跟着变，摆到画布上长出来的那张关联便签也就带着这份修正。

                高度的关键：上限只能加在**面板**上，里面那个滚动盒必须靠 flex-1 + min-h-0
                被约束。之前两层都写了 max-h-[45%]，而百分比对高度不定的父容器无效，
                于是里面的盒子撑到内容全高、溢出面板，"完成"按钮直接压在文字上，
                最后一行被拦腰截断——看起来就是"只显示一半"。

                这块不给独立按钮：点文字就是编辑，点别处失焦即存（跟便签编辑器一致），
                硬件返回键也存。两套入口纯属多余。 */}
            {previewText || ocrEditing ? (
              <div className="max-h-[60%] min-h-0 shrink-0 flex flex-col overflow-hidden rounded-xl border border-[#E6E4DF] bg-white/80">
                {ocrEditing ? (
                  <textarea
                    ref={ocrTextareaRef}
                    data-testid="pocket-photo-text-edit"
                    value={ocrDraft}
                    onChange={(e) => setOcrDraft(e.target.value)}
                    onBlur={() => void commitOcrEdit()}
                    placeholder={t('pocket.ocr_empty')}
                    className="flex-1 min-h-0 w-full resize-none bg-transparent outline-none px-3 py-3 text-[15px] leading-[1.75] text-[#5a5a54] whitespace-pre-wrap break-words pocket-text pocket-text-editor"
                  />
                ) : (
                  <button
                    type="button"
                    data-testid="pocket-photo-text"
                    onClick={startOcrEdit}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();
                      startOcrEdit();
                    }}
                    aria-label={t('pocket.ocr_edit_hint')}
                    className="flex-1 min-h-0 cursor-text overflow-y-auto overscroll-contain px-3 py-3 text-left text-[15px] leading-[1.75] text-[#5a5a54] whitespace-pre-wrap break-words pocket-text"
                  >
                    {previewText}
                  </button>
                )}
              </div>
            ) : !selectMode ? (
              /* 这张还没识别过：全屏这一屏也把动作给出来。 */
              <button
                type="button"
                data-testid="pocket-ocr-run-preview"
                disabled={ocrBusyId !== null}
                onClick={() => void runOcr(previewNode.id)}
                className="shrink-0 rounded-xl border border-dashed border-[#C2410C]/40 bg-white/70 px-3 py-2.5 text-[12px] font-medium text-[#C2410C] disabled:opacity-50"
              >
                {ocrBusyLabel(!!ocrBusyId) ?? t('pocket.ocr_run')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
