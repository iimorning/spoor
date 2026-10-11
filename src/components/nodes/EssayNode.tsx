import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { FileText, Maximize2 } from 'lucide-react';
import { db } from '../../db';
import type { NodeContentProps } from './types';
import { tryParseEssayContent } from '../../utils/essayPayload';
import { essayBodyMarkdown } from '../../utils/essayWordCount';
import { WebSearchSourcesToggle } from './WebSearchSourcesToggle';

export interface EssayNodeProps extends NodeContentProps {
  onOpenEssay?: (articleId: string, nodeId: string) => void;
  essaySourceCount?: number;
  essaySourcesCollapsed?: boolean;
  onToggleEssaySources?: () => void;
  /** Another card is being dragged over this essay. */
  collectHover?: boolean;
  /** Play the inbox pulse after a card is collected. */
  collectPulse?: boolean;
}

type PreviewBlock = {
  kind: 'heading' | 'paragraph' | 'list' | 'quote';
  text: string;
  level?: number;
};

function essayPreviewBlocks(markdown: string): PreviewBlock[] {
  const cleaned = markdown
    .replace(/```(?:[^\n]*)\n?([\s\S]*?)```/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1');
  const inlineText = (value: string) => value.replace(/[*_~]/g, '').trim();
  const blocks: PreviewBlock[] = [];
  let paragraph: string[] = [];
  const flushParagraph = () => {
    const text = paragraph.join(' ').replace(/\s+/g, ' ').trim();
    if (text) blocks.push({ kind: 'paragraph', text });
    paragraph = [];
  };

  for (const rawLine of cleaned.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ kind: 'heading', level: heading[1].length, text: inlineText(heading[2]) });
      continue;
    }
    const list = /^(?:[-+*]|\d+\.)\s+(.+)$/.exec(line);
    if (list) {
      flushParagraph();
      blocks.push({ kind: 'list', text: inlineText(list[1]) });
      continue;
    }
    const quote = /^>\s*(.+)$/.exec(line);
    if (quote) {
      flushParagraph();
      blocks.push({ kind: 'quote', text: inlineText(quote[1]) });
      continue;
    }
    paragraph.push(inlineText(line));
  }
  flushParagraph();
  return blocks;
}

export function EssayNode({
  node,
  onOpenEssay,
  essaySourceCount = 0,
  essaySourcesCollapsed = false,
  onToggleEssaySources,
  collectHover = false,
  collectPulse = false,
}: EssayNodeProps) {
  const { t } = useTranslation();
  const payload = useMemo(() => tryParseEssayContent(node.content), [node.content]);
  const articleId = payload?.articleId;
  const article = useLiveQuery(
    () => (articleId ? db.articles.get(articleId) : Promise.resolve(undefined)),
    [articleId],
  );

  const title = article?.title?.trim() || node.description?.trim() || t('nodes.essay_untitled');
  const previewBlocks = useMemo(
    () => (article ? essayPreviewBlocks(essayBodyMarkdown(article)) : []),
    [article],
  );

  const open = () => {
    if (!articleId || !onOpenEssay) return;
    onOpenEssay(articleId, node.id);
  };

  const collectActive = collectHover || collectPulse;

  return (
    <div
      className={`relative w-full h-full overflow-hidden bg-white shadow-lg border-2 flex flex-col min-h-[280px] transition-[border-color,box-shadow] duration-200 ${
        collectActive
          ? 'border-[#C2410C]/70 shadow-[0_0_0_4px_rgba(194,65,12,0.14)]'
          : 'border-[#E6E4DF]'
      }`}
      data-testid={`essay-node-${node.id}`}
      data-collect-hover={collectHover ? 'true' : undefined}
      data-collect-pulse={collectPulse ? 'true' : undefined}
      onDoubleClick={(e) => {
        e.stopPropagation();
        open();
      }}
    >
      <div
        className={`relative z-0 flex min-h-0 flex-1 flex-col p-4 transition-[opacity,filter] duration-200 ${
          collectActive ? 'essay-collect-ghost' : ''
        }`}
      >
      <div className="flex items-center gap-2 mb-2 shrink-0">
        <FileText className="w-4 h-4 text-[#C2410C] shrink-0" />
        <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-[#8c8a84]">
          {t('nodes.essay')}
        </span>
        <div className="ml-auto flex items-center gap-1 shrink-0">
          <WebSearchSourcesToggle
            count={essaySourceCount}
            collapsed={essaySourcesCollapsed}
            onToggle={onToggleEssaySources}
            minCount={1}
            collapseTitle={t('nodes.collapse_essay_sources')}
            expandTitle={t('nodes.expand_essay_sources')}
            className="!relative !top-auto !right-auto shadow-none"
          />
          <button
            type="button"
            data-testid={`essay-open-${node.id}`}
            disabled={!articleId || !onOpenEssay}
            data-no-drag=""
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              open();
            }}
            title={t('nodes.essay_open')}
            aria-label={t('nodes.essay_open')}
            className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-[#C2410C] text-white hover:bg-[#a0350a] disabled:opacity-40 disabled:pointer-events-none transition-colors shrink-0"
          >
            <Maximize2 className="w-3.5 h-3.5" aria-hidden />
          </button>
        </div>
      </div>

      <h3 className="font-serif text-lg font-bold text-[#1a1a1a] leading-snug mb-2 shrink-0 line-clamp-3">
        {title}
      </h3>

      <div
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-1 custom-scrollbar"
        data-no-drag=""
        data-testid={`essay-body-scroll-${node.id}`}
      >
        {!articleId ? (
          <p className="text-sm text-[#8c8a84] font-serif">{t('nodes.essay_missing')}</p>
        ) : !article ? (
          <p className="text-sm text-[#8c8a84] font-serif">{t('nodes.essay_loading')}</p>
        ) : previewBlocks.length > 0 ? (
          <div className="font-serif text-[#4a4a44]">
            {previewBlocks.map((block, index) => {
              if (block.kind === 'heading') {
                const className =
                  block.level === 1
                    ? 'text-lg font-bold leading-snug mt-4 mb-2 first:mt-0 text-[#1a1a1a]'
                    : 'text-base font-bold leading-snug mt-3 mb-1.5 first:mt-0 text-[#2d2d29]';
                return (
                  <h4 key={`${block.kind}-${index}`} className={className}>
                    {block.text}
                  </h4>
                );
              }
              if (block.kind === 'list') {
                return (
                  <div key={`${block.kind}-${index}`} className="flex gap-2 text-sm leading-7 pl-1">
                    <span aria-hidden>•</span>
                    <span>{block.text}</span>
                  </div>
                );
              }
              if (block.kind === 'quote') {
                return (
                  <blockquote
                    key={`${block.kind}-${index}`}
                    className="my-2 border-l-2 border-[#C2410C]/40 pl-3 text-sm leading-7 text-[#6b6963]"
                  >
                    {block.text}
                  </blockquote>
                );
              }
              return (
                <p key={`${block.kind}-${index}`} className="mb-3 text-sm leading-7 last:mb-0">
                  {block.text}
                </p>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-[#8c8a84] font-serif italic">{t('reference.empty_body')}</p>
        )}
      </div>
      </div>

      {collectActive ? (
        <div
          className={`essay-collect-overlay pointer-events-none absolute inset-0 z-20 flex items-center justify-center ${
            collectPulse ? 'essay-collect-overlay--pulse' : ''
          }`}
          data-testid={`essay-collect-hint-${node.id}`}
        >
          <span className="essay-collect-label">{t('reference.collect_into_essay')}</span>
        </div>
      ) : null}
    </div>
  );
}
