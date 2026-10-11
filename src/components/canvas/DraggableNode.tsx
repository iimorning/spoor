import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, Loader2, Plus, Send, SlidersHorizontal, Trash2, Wand2 } from 'lucide-react';
import { colorPresets, fontPresets } from '../../constants/presets';
import { isDarkNodeBackground } from '../../utils/nodePaletteTone';
import { DEFAULT_NODE_SIZE } from '../../utils/canvas';
import { playUiSfx } from '../../utils/uiSfx';
import { useDraggable, type DragEndResult } from '../../hooks/useDraggable';
import { useResizable } from '../../hooks/useResizable';
import { useRotatable } from '../../hooks/useRotatable';
import { cardGestureTransform } from '../../utils/nodeDragVisual';
import { ArchiveFolderPicker } from '../ArchiveFolderPicker';
import { AgentRunAnalysisButton } from '../nodes/AgentNode';
import { AiThinkingTraceButton } from '../nodes/AiThinkingTraceButton';
import { useAdaptiveLayout } from '../../hooks/useAdaptiveLayout';
import {
  clearAskComposerDraft,
  getAskComposerDraft,
  setAskComposerDraft,
} from '../../utils/askComposerDraft';
import { placeCaretAtEnd } from '../../utils/placeCaretAtEnd';
import type { NodePaletteApplier, NodePalettePatch } from '../../utils/nodePaletteStyle';

function isNodeGestureChrome(target: HTMLElement): boolean {
  return Boolean(
    target.closest('button') ||
      target.closest('a') ||
      target.closest('input, textarea, select, video') ||
      target.closest('.node-palette') ||
      target.closest('.node-ask-composer') ||
      target.closest('.node-thinking-panel') ||
      target.closest('[data-testid="ai-thinking-trace"]') ||
      target.closest('[data-testid="archive-folder-picker"]') ||
      target.closest('.cursor-nwse-resize') ||
      target.closest('.node-rotate-handle'),
  );
}

export interface DraggableNodeProps {
  id: string;
  nodesRef: React.MutableRefObject<Record<string, HTMLElement | null>>;
  isConnecting: boolean;
  onLink: (id: string) => void;
  children: React.ReactNode;
  initialX?: number;
  initialY?: number;
  onDelete?: () => void;
  /** Archive card to a knowledge-archive folder (`null` = unfiled). */
  onArchive?: (folderId: string | null) => void;
  onCycleLayout?: () => void;
  className?: string;
  scale?: number;
  isSelected?: boolean;
  /** Soft highlight for nodes related to the focused essay card. */
  isRelatedHighlight?: boolean;
  isEditing?: boolean;
  allowPalette?: boolean;
  /**
   * When this card is one of several marquee-selected cards, block click-to-edit
   * so a double-click can open the color palette without the first click
   * dropping the selection ring (which breaks the dblclick sequence).
   */
  groupPaletteLocked?: boolean;
  onRegisterPaletteApplier?: (id: string, apply: NodePaletteApplier | null) => void;
  onPaletteStyleChange?: (originId: string, patch: NodePalettePatch) => void;
  /** Shift+click to add/remove this card from the marquee selection. */
  onToggleSelect?: (id: string) => void;
  onDragEnd?: (
    id: string,
    pos: { x: number; y: number },
    delta: { dx: number; dy: number },
  ) => DragEndResult | Promise<DragEndResult>;
  /** Live visual offset for other selected cards while this node leads a group drag. */
  onGroupDragMove?: (delta: { dx: number; dy: number }) => void;
  /** Live canvas position while this card is being dragged. */
  onDragMove?: (
    id: string,
    pos: { x: number; y: number },
    delta: { dx: number; dy: number },
  ) => void;
  onResizeEnd?: (size: { width: number, height: number }) => void;
  onRotateEnd?: (rotation: number) => void;
  /** When true, dragging this card also moves the rest of the selection. */
  groupDragEnabled?: boolean;
  initialWidth?: number;
  initialHeight?: number;
  rotation?: number;
  /** When set, overrides drag-managed z-index (e.g. neat web-search photo stack). */
  zIndexOverride?: number;
  /** When set (glass note layout), palette does not paint an opaque layer on this root so `backdrop-filter` on the card can sample the canvas. */
  glassSurface?: boolean;
  /** Note/text: card body pointer sets which node Ctrl+C duplicates. */
  onStickyActivate?: (id: string) => void;
  /** Essay card body pointer: highlight related source cards. */
  onEssayActivate?: (id: string) => void;
  /** Inline Ask composer: submit a prompt about this card (search / draw / answer). */
  onAskAiSubmit?: (prompt: string) => void;
  /** Open the composer with this draft (e.g. a book selection). Token retriggers. */
  askComposerPrefill?: { text: string; token: number };
  isAskAiSubmitting?: boolean;
  isAskAiDisabled?: boolean;
  /** Hover/title when Ask AI is shown; defaults to the generic hint. */
  askAiHint?: string;
  /** Agent cards: play control appears with the Ask AI composer (analyze linked notes). */
  onAskAiRunAnalysis?: () => void;
  isAskAiAnalysisDisabled?: boolean;
  /** When true, hide archive/link/delete/resize/rotate chrome (fixture widgets). */
  fixture?: boolean;
  /** When true, the link (+) button is not rendered at all. */
  hideLinkChrome?: boolean;
  /** V2: tap persona anchor (Ask / agent) to open side-panel chat. */
  onPersonaChatOpen?: () => void;
  /** Extra chrome stacked above link / Ask AI on the right edge. */
  leadingRightChrome?: React.ReactNode;
  /** Saved model chain-of-thought for AI reply cards (brain button, bottom-right). */
  thinkingTrace?: string;
  /**
   * Optional template-local key (e.g. `'theme-howto'`, `'agent-host'`) stamped
   * when this card was materialized from a `CanvasTemplateDoc`. Rendered as a
   * `data-testid="template-node-{templateKey}"` so canvas onboarding tours
   * can target template-original cards even after their UUIDs are remapped.
   */
  templateKey?: string;
}

export const DraggableNode: React.FC<DraggableNodeProps> = ({ 
  id, nodesRef, isConnecting, onLink, children, 
  initialX = 100, initialY = 100,
  initialWidth = DEFAULT_NODE_SIZE.width,
  // 0 = content-sized until the user resizes (many notes omit stored height).
  initialHeight = 0,
  onDelete, onArchive, onCycleLayout, className = '', scale = 1, 
  isSelected, isRelatedHighlight, isEditing, allowPalette,
  groupPaletteLocked = false,
  onRegisterPaletteApplier,
  onPaletteStyleChange,
  onToggleSelect,
  onDragEnd, onResizeEnd,
  onRotateEnd,
  onGroupDragMove,
  onDragMove,
  groupDragEnabled = false,
  rotation: rotationProp = 0,
  zIndexOverride,
  glassSurface = false,
  onStickyActivate,
  onEssayActivate,
  onAskAiSubmit,
  askComposerPrefill,
  isAskAiSubmitting = false,
  isAskAiDisabled = false,
  askAiHint,
  onAskAiRunAnalysis,
  isAskAiAnalysisDisabled = false,
  fixture = false,
  leadingRightChrome,
  hideLinkChrome = false,
  onPersonaChatOpen,
  thinkingTrace,
  templateKey,
}) => {
  const { t } = useTranslation();
  const { touchChrome } = useAdaptiveLayout();
  const scaleRef = useRef(scale);
  const elementRef = useRef<HTMLElement | null>(null);
  useEffect(() => { scaleRef.current = scale; }, [scale]);

  /** 编辑正文时隐藏外链、布局/删除、缩放手柄等外围控件（避免 group-hover 仍显示） */
  const hideChrome = Boolean(isEditing) || fixture;

  const node = useDraggable(
    initialX,
    initialY,
    scale,
    (pos, delta) => {
      if (onDragEnd) return onDragEnd(id, pos, delta);
    },
    (pos, delta) => {
      if (groupDragEnabled) onGroupDragMove?.(delta);
      onDragMove?.(id, pos, delta);
    },
  );

  const { size, onPointerDown: onResizePointerDown } = useResizable(
    initialWidth && initialWidth > 0 ? initialWidth : DEFAULT_NODE_SIZE.width,
    initialHeight && initialHeight > 0 ? initialHeight : 0,
    scaleRef,
    (newSize) => {
      if (onResizeEnd) onResizeEnd(newSize);
    },
    elementRef,
  );

  const { rotation, onPointerDown: onRotatePointerDown } = useRotatable(
    rotationProp,
    elementRef,
    (next) => {
      onRotateEnd?.(next);
    },
  );

  const [showPalette, setShowPalette] = useState(false);
  const [styleOverrides, setStyleOverrides] = useState({ bg: '', text: '', font: '', border: '' });
  const applyPalettePatch = useCallback((patch: NodePalettePatch) => {
    setStyleOverrides((prev) => ({ ...prev, ...patch }));
  }, []);

  useEffect(() => {
    onRegisterPaletteApplier?.(id, applyPalettePatch);
    return () => onRegisterPaletteApplier?.(id, null);
  }, [id, applyPalettePatch, onRegisterPaletteApplier]);

  const commitPalettePatch = (patch: NodePalettePatch) => {
    if (onPaletteStyleChange) {
      onPaletteStyleChange(id, patch);
      return;
    }
    applyPalettePatch(patch);
  };
  const [askComposerOpen, setAskComposerOpen] = useState(false);
  const [askMenuOpen, setAskMenuOpen] = useState(false);
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [askDraft, setAskDraft] = useState(() => getAskComposerDraft(id));
  const folderPickerRootRef = useRef<HTMLDivElement | null>(null);
  const askComposerRootRef = useRef<HTMLDivElement | null>(null);
  const askComposerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const askPrefillTokenRef = useRef<number | undefined>(undefined);
  const askHoverCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasAskComposer = Boolean(onAskAiSubmit);
  const hasAskRunChoice = Boolean(onAskAiRunAnalysis && onAskAiSubmit);
  const directRunOnly = Boolean(onAskAiRunAnalysis && !onAskAiSubmit);

  const clearAskHoverClose = () => {
    if (askHoverCloseRef.current) {
      clearTimeout(askHoverCloseRef.current);
      askHoverCloseRef.current = null;
    }
  };

  const openAskMenu = () => {
    if (isAskAiDisabled || askComposerOpen) return;
    clearAskHoverClose();
    setAskMenuOpen(true);
  };

  const scheduleCloseAskMenu = () => {
    clearAskHoverClose();
    askHoverCloseRef.current = setTimeout(() => {
      setAskMenuOpen(false);
      askHoverCloseRef.current = null;
    }, 220);
  };

  const [folderPickerOpen, setFolderPickerOpen] = useState(false);

  useEffect(
    () => () => {
      clearAskHoverClose();
    },
    [],
  );

  useEffect(() => {
    if (!askComposerPrefill) return;
    if (askPrefillTokenRef.current === askComposerPrefill.token) return;
    askPrefillTokenRef.current = askComposerPrefill.token;
    setAskDraft(askComposerPrefill.text);
    setAskComposerDraft(id, askComposerPrefill.text);
    setAskMenuOpen(false);
    setAskComposerOpen(true);
  }, [askComposerPrefill, id]);

  useEffect(() => {
    if (!askComposerOpen) return;
    const frame = requestAnimationFrame(() => {
      const el = askComposerInputRef.current;
      if (el) placeCaretAtEnd(el);
    });
    return () => cancelAnimationFrame(frame);
  }, [askComposerOpen]);

  const updateAskDraft = (text: string) => {
    setAskDraft(text);
    setAskComposerDraft(id, text);
  };

  const submitAskDraft = () => {
    const text = askDraft.trim();
    if (!text || isAskAiDisabled || isAskAiSubmitting || !onAskAiSubmit) return;
    onAskAiSubmit(text);
    updateAskDraft('');
    clearAskComposerDraft(id);
    setAskComposerOpen(false);
  };

  useEffect(() => {
    if (!isAskAiSubmitting || !askComposerOpen) return;
    setAskDraft('');
    clearAskComposerDraft(id);
    setAskComposerOpen(false);
    setAskMenuOpen(false);
  }, [askComposerOpen, id, isAskAiSubmitting]);

  useEffect(() => {
    if (isAskAiDisabled) {
      setAskComposerOpen(false);
      setAskMenuOpen(false);
    }
  }, [isAskAiDisabled]);

  useEffect(() => {
    if (!askComposerOpen && !askMenuOpen) return;
    const onDoc = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const el = askComposerRootRef.current;
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      setAskComposerOpen(false);
      setAskMenuOpen(false);
    };
    document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
  }, [askComposerOpen, askMenuOpen]);

  useEffect(() => {
    if (!folderPickerOpen) return;
    const onDoc = (e: PointerEvent) => {
      const el = folderPickerRootRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setFolderPickerOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFolderPickerOpen(false);
    };
    document.addEventListener('pointerdown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [folderPickerOpen]);

  useEffect(() => {
    if (!showPalette) return;
    const onDoc = (e: PointerEvent) => {
      const el = elementRef.current;
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      setShowPalette(false);
    };
    document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
  }, [showPalette]);

  // 卡片上的控件（外链、问 AI、缩放/旋转把手）只在选中或悬停时出现。
  // 曾经对角色卡恒常显示右侧控件，理由是"让引导能指着那个魔法棒"——那条引导
  // 现在只高亮工作区和拖拽把手（见 onboarding/tourSteps.ts），所以这个特例没了。
  const chromeVisible = hideChrome && !askComposerOpen && !askMenuOpen && !thinkingOpen
    ? '!opacity-0 pointer-events-none'
    : isSelected || askComposerOpen || askMenuOpen || folderPickerOpen || thinkingOpen
      ? 'opacity-100'
      : 'opacity-0 group-hover:opacity-100';
  const paletteColorChoices = glassSurface ? colorPresets.slice(3) : colorPresets;
  // Fixtures hide most chrome, but ambience still exposes delete on hover/select.
  const deleteChromeVisible = isEditing
    ? '!opacity-0 pointer-events-none'
    : isSelected
      ? 'opacity-100'
      : 'opacity-0 group-hover:opacity-100';

  return (
    <div 
      className={`absolute group pointer-events-auto select-none touch-none ${isSelected ? 'cursor-move' : 'cursor-default'} ${className} ${
        isSelected && !hideChrome
          ? 'ring-2 ring-[#C2410C]'
          : isRelatedHighlight && !hideChrome
            ? 'ring-2 ring-[#C2410C]/55 shadow-[0_0_0_4px_rgba(194,65,12,0.14)]'
            : ''
      }`}
      data-testid={
        isRelatedHighlight
          ? `related-highlight-${id}`
          : templateKey
            ? `template-node-${templateKey}`
            : undefined
      }
      data-glass-surface={glassSurface ? '' : undefined}
      /**
       * 标记「这一整块是画布节点」。节点自带一套纸面色板，暗色主题的外壳规则
       * 不该改写它们——ThemeNode 的深色卡（bg-[#1a1a1a] + 白字）就是靠这个
       * 躲开重映射、保持深色的。
       */
      data-canvas-node={id}
      data-node-tone={
        styleOverrides.bg
          ? isDarkNodeBackground(styleOverrides.bg)
            ? 'dark'
            : 'light'
          : undefined
      }
      style={{ 
        left: node.pos.x, 
        top: node.pos.y, 
        width: size.width || undefined,
        height: size.height || undefined,
        zIndex: zIndexOverride ?? node.zIndex,
        // --drag-x/y and --node-rotate are written on the DOM during gestures
        // (compositor path); React keeps the committed left/top/rotation.
        transform: cardGestureTransform(`${rotation}deg`),
        '--node-bg': styleOverrides.bg || undefined, 
        '--node-text': styleOverrides.text || undefined, 
        '--node-font': styleOverrides.font || undefined, 
        '--node-border': styleOverrides.border || undefined 
      } as React.CSSProperties}
      onDoubleClick={(e) => {
        if (allowPalette) {
          e.stopPropagation();
          e.preventDefault();
          setShowPalette(true);
        }
      }}
      onClickCapture={(e) => {
        if (e.shiftKey || groupPaletteLocked) {
          if (isNodeGestureChrome(e.target as HTMLElement)) return;
          e.stopPropagation();
          if (e.shiftKey) e.preventDefault();
          return;
        }
        if (onPersonaChatOpen && !isNodeGestureChrome(e.target as HTMLElement)) {
          onPersonaChatOpen();
        }
      }}
      onPointerDownCapture={(e) => {
        // Capture so book/AI/essay bodies that stopPropagation still start a
        // touch drag. Chrome (buttons, rotate, resize) is skipped so those
        // handlers keep exclusive control.
        if (isConnecting) return;
        if (isNodeGestureChrome(e.target as HTMLElement)) return;
        if (e.shiftKey && e.button === 0 && onToggleSelect) {
          e.stopPropagation();
          e.preventDefault();
          onToggleSelect(id);
          return;
        }
        node.onPointerDown(e);
      }}
      onPointerDown={(e) => {
        const target = e.target as HTMLElement;
        const isChromeControl = isNodeGestureChrome(target);
        if (
          onStickyActivate &&
          !isChromeControl
        ) {
          onStickyActivate(id);
        }
        if (
          onEssayActivate &&
          !isChromeControl
        ) {
          onEssayActivate(id);
        }
        if (showPalette) setShowPalette(false);
        if (isConnecting) {
          if (fixture) {
            e.stopPropagation();
            return;
          }
          e.stopPropagation();
          e.preventDefault();
          onLink(id);
        }
      }}
      ref={el => {
        elementRef.current = el;
        if (nodesRef) nodesRef.current[id] = el;
      }}
    >
      {(onArchive || onCycleLayout) && !fixture && (
        <div
          className={`absolute -top-3 left-1/2 -translate-x-1/2 flex items-center gap-1 z-10 ${chromeVisible}`}
        >
          {onCycleLayout ? (
            <button
              type="button"
              data-testid="node-cycle-layout"
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onCycleLayout();
              }}
              className="w-6 h-6 bg-white border border-[#E6E4DF] rounded-full flex items-center justify-center text-[#8c8a84] hover:text-[#C2410C] hover:border-[#C2410C] transition-all shadow-sm"
              title={t('canvas.cycle_layout')}
              aria-label={t('canvas.cycle_layout')}
            >
              <SlidersHorizontal className="w-3 h-3" />
            </button>
          ) : null}
          {onArchive && (
            <div className="relative" ref={folderPickerRootRef}>
              <button
                type="button"
                data-testid={`archive-node-${id}`}
                aria-expanded={folderPickerOpen}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setFolderPickerOpen((open) => !open);
                }}
                className="w-6 h-6 bg-white border border-[#E6E4DF] rounded-full flex items-center justify-center text-[#8c8a84] hover:text-[#C2410C] hover:border-[#C2410C] transition-all shadow-sm"
                title={t('canvas.archive_note')}
                aria-label={t('canvas.archive_note')}
              >
                <Archive className="w-3 h-3" />
              </button>
              {folderPickerOpen ? (
                <ArchiveFolderPicker
                  onPick={(folderId) => {
                    setFolderPickerOpen(false);
                    onArchive(folderId);
                  }}
                />
              ) : null}
            </div>
          )}
        </div>
      )}
      {!fixture && (
      <div
        className={`absolute top-1/2 -translate-y-1/2 -right-3 flex flex-col gap-1 z-10 transition-all ${chromeVisible}`}
      >
        {leadingRightChrome}
        {!hideLinkChrome && (
        <button
          type="button"
          data-testid="node-link"
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            playUiSfx('bubblePop');
            onLink(id);
          }}
          className={`${
            touchChrome ? 'w-9 h-9' : 'w-6 h-6'
          } bg-white border border-[#E6E4DF] rounded-full flex items-center justify-center text-[#C2410C] hover:bg-[#C2410C] hover:text-white hover:border-[#C2410C] focus-visible:bg-[#C2410C] focus-visible:text-white transition-all shadow-sm`}
          title={t('canvas.link_note')}
          aria-label={t('canvas.link_note')}
        >
          <Plus className={touchChrome ? 'w-4 h-4' : 'w-4 h-4'} />
        </button>
        )}
        {(hasAskComposer || onAskAiRunAnalysis) ? (
          <div
            className="relative flex items-center"
            ref={askComposerRootRef}
            title={askAiHint ?? (directRunOnly ? t('nodes.agent_run_direct') : t('nodes.ask_ai_hint'))}
            onMouseEnter={() => {
              if (hasAskRunChoice) openAskMenu();
            }}
            onMouseLeave={() => {
              if (hasAskRunChoice && !askComposerOpen) scheduleCloseAskMenu();
            }}
          >
            <button
              type="button"
              data-testid="note-ask-ai"
              aria-disabled={isAskAiDisabled}
              onPointerDown={(e) => {
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (isAskAiDisabled) return;
                if (directRunOnly) {
                  if (!isAskAiAnalysisDisabled && !isAskAiSubmitting) onAskAiRunAnalysis?.();
                  return;
                }
                if (askComposerOpen) {
                  setAskComposerOpen(false);
                  return;
                }
                if (hasAskRunChoice) {
                  clearAskHoverClose();
                  setAskMenuOpen((open) => !open);
                  return;
                }
                setAskComposerOpen((open) => !open);
              }}
              className={`${
                touchChrome ? 'w-9 h-9' : 'w-6 h-6'
              } rounded-full flex items-center justify-center transition-all shadow-sm ${
                isAskAiDisabled
                  ? 'cursor-not-allowed bg-[#F3F2EE] border border-[#E6E4DF] text-[#C4C2BC]'
                  : askComposerOpen || askMenuOpen
                    ? 'bg-[#C2410C] border border-[#E6E4DF] text-white'
                    : 'bg-white border border-[#E6E4DF] text-[#C2410C] hover:bg-[#C2410C] hover:text-white focus-visible:bg-[#C2410C] focus-visible:text-white'
              }`}
              title={askAiHint ?? (directRunOnly ? t('nodes.agent_run_direct') : t('nodes.ask_ai_hint'))}
              aria-label={directRunOnly ? t('nodes.agent_run_direct') : t('nodes.ask_ai')}
              aria-expanded={askComposerOpen || askMenuOpen}
            >
              {isAskAiSubmitting ? (
                <Loader2
                  className={`${touchChrome ? 'w-5 h-5' : 'w-3.5 h-3.5'} animate-spin`}
                  aria-hidden
                />
              ) : (
                <Wand2 className={touchChrome ? 'w-5 h-5' : 'w-3.5 h-3.5'} />
              )}
            </button>
            {askMenuOpen && hasAskRunChoice ? (
              <div
                className="node-ask-menu absolute left-full top-0 z-30 ml-2 flex flex-col items-stretch gap-1.5"
                data-testid="note-ask-menu"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <AgentRunAnalysisButton
                  label={t('nodes.agent_run_direct')}
                  onRunAnalysis={() => {
                    onAskAiRunAnalysis?.();
                    setAskMenuOpen(false);
                  }}
                  disabled={isAskAiDisabled || isAskAiAnalysisDisabled || isAskAiSubmitting}
                />
                <button
                  type="button"
                  data-testid="note-ask-open-input"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setAskMenuOpen(false);
                    setAskComposerOpen(true);
                  }}
                  className="flex h-7 shrink-0 items-center justify-center rounded-full border border-[#C2410C]/20 bg-white px-2.5 text-[13px] font-sans leading-none text-[#8c8a84]/70 whitespace-nowrap transition-colors hover:text-[#C2410C] hover:border-[#C2410C]/40"
                >
                  {t('nodes.agent_ask_option')}
                </button>
              </div>
            ) : null}
            {askComposerOpen ? (
              <div
                className="node-ask-composer absolute left-full top-0 z-30 ml-2 flex items-start gap-1.5"
                data-testid="note-ask-composer"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <div className="flex w-80 min-h-[5.5rem] items-end rounded-2xl border border-[#C2410C]/25 bg-white px-2.5 py-2 shadow-md">
                  <textarea
                    ref={askComposerInputRef}
                    value={askDraft}
                    rows={3}
                    onChange={(e) => updateAskDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        setAskComposerOpen(false);
                        return;
                      }
                      if (e.key !== 'Enter') return;
                      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                      if (e.shiftKey) return;
                      e.preventDefault();
                      submitAskDraft();
                    }}
                    placeholder={t('ask.card_placeholder')}
                    disabled={isAskAiSubmitting}
                    data-testid="note-ask-input"
                    className="node-ask-composer-input min-h-[4.25rem] max-h-48 min-w-0 flex-1 resize-y bg-transparent py-0.5 text-[13px] font-sans leading-5 text-[#1a1a1a] placeholder:text-[#8c8a84]/70 outline-none disabled:opacity-60"
                  />
                  <button
                    type="button"
                    data-testid="note-ask-send"
                    disabled={askDraft.trim().length === 0 || isAskAiDisabled || isAskAiSubmitting}
                    onClick={(e) => {
                      e.stopPropagation();
                      submitAskDraft();
                    }}
                    className="mb-0.5 ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#C2410C] transition-opacity hover:bg-[#C2410C]/10 disabled:opacity-20"
                    aria-label={t('ask.send')}
                    title={t('ask.send')}
                  >
                    {isAskAiSubmitting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        {thinkingTrace?.trim() ? (
          <AiThinkingTraceButton
            text={thinkingTrace}
            touchChrome={touchChrome}
            onOpenChange={setThinkingOpen}
          />
        ) : null}
      </div>
      )}
      {onDelete && (
        <div
          className={`absolute -bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 transition-opacity z-10 ${deleteChromeVisible}`}
        >
          <button
            type="button"
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              playUiSfx('paperSwish');
              onDelete();
            }}
            className={`${
              touchChrome ? 'w-9 h-9' : 'w-6 h-6'
            } bg-white border border-[#E6E4DF] rounded-full flex items-center justify-center text-[#8c8a84] hover:text-[#C2410C] hover:border-[#C2410C] transition-all shadow-sm`}
            title={t('canvas.delete_note')}
          >
            <Trash2 className={touchChrome ? 'w-4 h-4' : 'w-3 h-3'} />
          </button>
        </div>
      )}
      {children}
      
      {!fixture && (
      <>
      {/* Resize Handle — touch-action: none keeps page-zoom from hijacking two-finger pinch during a resize. */}
      <div
        onPointerDown={onResizePointerDown}
        className={`absolute -bottom-1 -right-1 ${
          touchChrome ? 'w-8 h-8 touch-none' : 'w-4 h-4'
        } cursor-nwse-resize flex items-center justify-center transition-opacity z-20 ${chromeVisible}`}
      >
        <div className={`${touchChrome ? 'w-3 h-3' : 'w-1.5 h-1.5'} border-r border-b border-[#8c8a84]`}></div>
      </div>

      {/* Rotate Handle — loading-style open arc; gap faces the card corner */}
      <button
        type="button"
        data-testid="node-rotate-handle"
        onPointerDown={onRotatePointerDown}
        className={`node-rotate-handle absolute -bottom-4 -right-4 ${
          touchChrome ? 'w-9 h-9 touch-none' : 'w-5 h-5'
        } flex items-center justify-center text-[#8c8a84] hover:text-[#C2410C] transition-colors cursor-grab active:cursor-grabbing z-20 ${chromeVisible}`}
        title={t('canvas.rotate_note')}
        aria-label={t('canvas.rotate_note')}
      >
        <Loader2 className={`${touchChrome ? 'w-5 h-5' : 'w-3.5 h-3.5'} -rotate-90`} strokeWidth={1.5} aria-hidden />
      </button>
      </>
      )}

      {showPalette && allowPalette && !fixture && (
        <div 
          className="node-palette absolute -top-14 left-0 bg-white/90 backdrop-blur-md border border-[#E6E4DF] shadow-xl rounded-lg p-2 z-50 flex items-center gap-4 cursor-default pointer-events-auto"
          onPointerDown={(e) => e.stopPropagation()} /* Prevent drag when clicking palette */
        >
          <div className="flex gap-1.5">
            {paletteColorChoices.map((color, i) => (
              <button 
                key={glassSurface ? i + 3 : i} 
                onClick={() => commitPalettePatch({ bg: color.bg, text: color.text, border: color.border })}
                className="w-5 h-5 rounded-full border border-black/10 transition-transform hover:scale-110 shadow-sm"
                style={{ backgroundColor: color.bg }}
                title={t('canvas.change_color')}
              />
            ))}
          </div>
          <div className="w-[1px] h-4 bg-[#E6E4DF]"></div>
          <div className="flex gap-2 text-xs">
            {fontPresets.map((font, i) => (
              <button
                key={i}
                onClick={() => commitPalettePatch({ font: font.value })}
                className="px-2 py-0.5 rounded hover:bg-[#F4F1ED] text-[#5a5a54] hover:text-[#1a1a1a] transition-colors"
                title={`${t('canvas.change_font')}: ${font.name}`}
                style={{ fontFamily: font.value }}
              >
                Aa
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
