import React from 'react';
import { FileText } from 'lucide-react';
import type { NodeContentProps } from './types';
import { CANVAS_NODE_CONTEXT_TEXT_ATTR } from '../../utils/canvasNodeContextText';
import {
  DOCUMENT_CARD_AUTO_MAX_HEIGHT_PX,
  DOCUMENT_CARD_SCROLL_MAX_HEIGHT_PX,
} from '../../utils/canvas';

export function DocumentNode({ node }: NodeContentProps) {
  const userSizedHeight = Boolean(node.height && node.height > 0);

  return (
    <div
      data-testid="document-node-shell"
      className={`w-full h-full bg-white p-5 shadow-lg border-2 border-[#E6E4DF] flex flex-col ${
        userSizedHeight ? '' : 'overflow-hidden'
      }`}
      style={{
        outline: '1px solid transparent',
        ...(userSizedHeight ? {} : { maxHeight: DOCUMENT_CARD_AUTO_MAX_HEIGHT_PX }),
      }}
    >
      <div className="flex items-center gap-2 mb-3 shrink-0">
        <FileText className="w-4 h-4 text-[#C2410C]" />
        <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-[#8c8a84]">
          DOCUMENT
        </span>
        {node.description && (
          <span className="text-[10px] font-mono text-[#5a5a54] ml-auto truncate max-w-[120px]" title={node.description}>
            {node.description}
          </span>
        )}
      </div>
      <div
        data-testid="document-body-scroll"
        className="flex-1 overflow-y-auto min-h-0 pr-1 custom-scrollbar text-sm font-serif leading-relaxed text-[#4a4a44] doc-content"
        style={userSizedHeight ? undefined : { maxHeight: DOCUMENT_CARD_SCROLL_MAX_HEIGHT_PX }}
        {...{ [CANVAS_NODE_CONTEXT_TEXT_ATTR]: '' }}
        dangerouslySetInnerHTML={{ __html: node.content || '<em>(空文档)</em>' }}
      />
    </div>
  );
}
