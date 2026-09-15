import React from 'react';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { markdownExternalLinkComponents } from './MarkdownExternalLink';

/** GFM tables / strikethrough / autolinks. Used by AI cards and other markdown bodies. */
export const markdownGfmPlugins = [remarkGfm];

/**
 * Models often emit HTML lists (`<ul><li>`) inside GFM table cells, where
 * markdown `-` lists cannot nest. Parse a sanitized HTML subset so those tags
 * render instead of showing as literal text. Sanitize after raw so scripts/handlers
 * from model output cannot run.
 */
export const markdownRehypePlugins = [rehypeRaw, rehypeSanitize];

export const markdownBodyComponents: Components = {
  ...markdownExternalLinkComponents,
  table: ({ children, node: _node, className, ...props }) => (
    <div className="markdown-table-wrap min-w-0 w-full max-w-full">
      <table
        {...props}
        className={['w-full table-fixed', className].filter(Boolean).join(' ')}
      >
        {children}
      </table>
    </div>
  ),
};
