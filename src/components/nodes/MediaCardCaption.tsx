import React from 'react';
import { CANVAS_NODE_CONTEXT_TEXT_ATTR } from '../../utils/canvasNodeContextText';

/** Title row + optional two-line relation caption under search image/video cards. */
export function MediaCardCaption({
  title,
  relation,
  trailing,
}: {
  title: string;
  relation?: string;
  trailing?: React.ReactNode;
}) {
  if (!title && !relation && !trailing) return null;
  return (
    <div className="mt-1.5 min-w-0 px-0.5 shrink-0">
      <div className="flex items-center gap-1.5 min-w-0">
        {title ? (
          <p
            className="min-w-0 flex-1 text-[10px] font-sans text-[#8c8a84] truncate"
            title={title}
            {...{ [CANVAS_NODE_CONTEXT_TEXT_ATTR]: '' }}
          >
            {title}
          </p>
        ) : (
          <span className="min-w-0 flex-1" />
        )}
        {trailing}
      </div>
      {relation ? (
        <p
          className="mt-0.5 text-[10px] font-sans leading-snug text-[#a8a59e] line-clamp-2"
          title={relation}
        >
          {relation}
        </p>
      ) : null}
    </div>
  );
}
