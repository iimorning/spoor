import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin } from 'lucide-react';
import { db } from '../../db';
import type { ThemeNodeProps } from './types';
import { isContentBlurPersistenceDisabled } from '../../config/persistence';
import { CANVAS_NODE_CONTEXT_TEXT_ATTR } from '../../utils/canvasNodeContextText';
import { pastePlainText } from '../../utils/pastePlainText';
import { THEME_NODE_SIZE } from '../../utils/canvas';
import { WebSearchSourcesToggle } from './WebSearchSourcesToggle';

interface ThemeEditableFieldProps {
  as: 'h3';
  nodeId: string;
  displayValue: string;
  className: string;
  onPersist: (raw: string) => void;
}

/** 聚焦时不从 props 回写 DOM，避免 useLiveQuery 刷新导致光标乱跳、输入法中断 */
function ThemeEditableField({ as: Tag, nodeId, displayValue, className, onPersist }: ThemeEditableFieldProps) {
  const elRef = useRef<HTMLElement | null>(null);
  const isFocusedRef = useRef(false);

  useEffect(() => {
    const el = elRef.current;
    if (!el || isFocusedRef.current) return;
    if (el.innerText !== displayValue) {
      el.textContent = displayValue;
    }
  }, [displayValue, nodeId]);

  return (
    <Tag
      ref={(el) => {
        elRef.current = el;
      }}
      className={className}
      contentEditable
      suppressContentEditableWarning
      onPaste={pastePlainText}
      onFocus={() => {
        isFocusedRef.current = true;
      }}
      onBlur={(e) => {
        isFocusedRef.current = false;
        onPersist(e.currentTarget.innerText);
      }}
    />
  );
}

export function ThemeNode({
  node,
  editingNodeId,
  bookExpandBranchCount = 0,
  bookExpandBranchesCollapsed = false,
  onToggleBookExpandBranches,
}: ThemeNodeProps) {
  const { t } = useTranslation();

  /** 旧版窄条尺寸写入 DB 后，渲染时补升到当前标准 2:1 比例 */
  useEffect(() => {
    const patch: { width?: number; height?: number } = {};
    if ((node.width ?? 0) < THEME_NODE_SIZE.width) patch.width = THEME_NODE_SIZE.width;
    if ((node.height ?? 0) < THEME_NODE_SIZE.height) patch.height = THEME_NODE_SIZE.height;
    if (Object.keys(patch).length > 0) {
      void db.nodes.update(node.id, patch);
    }
  }, [node.id, node.width, node.height]);

  const persistContent = (raw: string) => {
    if (isContentBlurPersistenceDisabled()) return;
    void db.nodes.update(node.id, { content: raw });
  };

  const shellClass =
    node.layout === 1
      ? 'border-l-[3px] border-l-[#C2410C] bg-white border border-[#E6E4DF]'
      : node.layout === 2
        ? 'bg-[#1a1a1a] text-white border border-[#333]'
        : node.layout === 3
          ? 'border border-black bg-white'
          : 'bg-white border border-[#E6E4DF]';

  const accentClass = node.layout === 2 ? 'text-[#FDBA74]' : 'text-[#C2410C]';

  const titleClass =
    node.layout === 1
      ? 'text-lg font-serif font-bold leading-snug'
      : node.layout === 2
        ? 'text-lg font-sans font-bold tracking-tight leading-snug'
        : node.layout === 3
          ? 'text-sm font-mono uppercase leading-snug'
          : 'text-lg font-serif font-bold leading-snug';

  const titleDisplay = node.content?.trim() ? node.content : t('nodes.new_theme_title');

  const stackToggleClass =
    node.layout === 2
      ? 'border-white/20 bg-white/10 text-white/80 hover:border-[#C2410C]/60 hover:text-[#FDBA74]'
      : undefined;

  return (
    <div
      className={`relative flex h-full w-full min-h-0 flex-col rounded-sm shadow-sm transition-all duration-300 ${shellClass}`}
      style={{ outline: '1px solid transparent' }}
    >
      {onToggleBookExpandBranches ? (
        <WebSearchSourcesToggle
          count={bookExpandBranchCount}
          collapsed={bookExpandBranchesCollapsed}
          onToggle={onToggleBookExpandBranches}
          minCount={1}
          collapseTitle={t('nodes.collapse_theme_notes')}
          expandTitle={t('nodes.expand_theme_notes')}
          className={stackToggleClass}
        />
      ) : null}

      <div
        className={`flex flex-1 items-center justify-center px-4 py-3 ${editingNodeId === node.id ? 'select-text' : ''}`}
        {...{ [CANVAS_NODE_CONTEXT_TEXT_ATTR]: '' }}
      >
        <div className="flex min-w-0 max-w-full items-center justify-center gap-2.5">
          <MapPin className={`h-5 w-5 shrink-0 ${accentClass}`} aria-hidden />
          <ThemeEditableField
            as="h3"
            nodeId={node.id}
            displayValue={titleDisplay}
            className={`m-0 min-w-0 max-w-full truncate py-0.5 focus:outline-none rounded px-0.5 transition-all cursor-text ${titleClass} ${accentClass} ${
              node.content?.trim() ? '' : 'opacity-75'
            }`}
            onPersist={persistContent}
          />
        </div>
      </div>
    </div>
  );
}
