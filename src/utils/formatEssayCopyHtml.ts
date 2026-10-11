import {
  parseEssayExportMarkdown,
  type EssayExportBlock,
  type EssayExportInline,
} from './parseEssayExportMarkdown';

/**
 * 富文本版「复制全文」。
 *
 * `formatEssayCopyText` 刻意把 Markdown 拍平成纯文本——粘进聊天框不该看到一堆
 * 星号。但粘进 Word / 飞书 / Google Docs 时，作者的加粗、标题层级、引用全部
 * 消失，等于把排版白费了。
 *
 * 所以同一份内容同时给两种格式写进剪贴板，由接收方挑：认 `text/html` 的用这个，
 * 只认纯文本的（记事本、终端、多数聊天工具）继续用原来那份，行为一个字不变。
 *
 * 图片这一路仍只留 alt 占位：图片要从 IndexedDB 取回再转 data URL，是异步的，
 * 会让日常复制变慢。需要带图时用同一菜单里的 Word / PDF 导出。
 */

/** 正文全是用户写的，进 HTML 前一律转义。属性值里的单引号也要挡。 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 链接地址只放安全的 scheme。
 *
 * 正文是模型生成或用户输入的，`javascript:` 这种地址粘进编辑器再点一下就出事。
 * 只认 http/https/mailto，其余当纯文本处理（显示文字，丢掉跳转）。
 */
function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  return null;
}

function inlinesToHtml(inlines: EssayExportInline[]): string {
  return inlines
    .map((node) => {
      switch (node.type) {
        case 'text':
          return escapeHtml(node.text);
        case 'strong':
          return `<strong>${escapeHtml(node.text)}</strong>`;
        case 'em':
          return `<em>${escapeHtml(node.text)}</em>`;
        case 'code':
          return `<code>${escapeHtml(node.text)}</code>`;
        case 'link': {
          const text = escapeHtml(node.text);
          const href = safeHref(node.href);
          return href ? `<a href="${escapeHtml(href)}">${text}</a>` : text;
        }
        case 'break':
          return '<br>';
        default:
          return '';
      }
    })
    .join('');
}

function blockToHtml(block: EssayExportBlock): string {
  switch (block.type) {
    case 'heading': {
      const tag = `h${block.level}`;
      return `<${tag}>${inlinesToHtml(block.inlines)}</${tag}>`;
    }
    case 'paragraph':
      return `<p>${inlinesToHtml(block.inlines)}</p>`;
    case 'blockquote':
      return `<blockquote><p>${inlinesToHtml(block.inlines)}</p></blockquote>`;
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul';
      const items = block.items
        .map((item) => `<li>${inlinesToHtml(item)}</li>`)
        .join('');
      return `<${tag}>${items}</${tag}>`;
    }
    case 'code':
      return `<pre><code>${escapeHtml(block.text)}</code></pre>`;
    // 图片和纯文本那路一样，只留占位，不进 img（见文件头说明）。
    case 'image':
      return block.alt.trim() ? `<p>[${escapeHtml(block.alt.trim())}]</p>` : '';
    case 'hr':
      return '<hr>';
    default:
      return '';
  }
}

/** 完整的富文本片段，供剪贴板的 `text/html` 用。 */
export function formatEssayCopyHtml(input: { title?: string; markdown?: string }): string {
  const parts: string[] = [];
  const title = (input.title ?? '').trim();
  if (title) parts.push(`<h1>${escapeHtml(title)}</h1>`);
  for (const block of parseEssayExportMarkdown(input.markdown ?? '')) {
    const html = blockToHtml(block);
    if (html) parts.push(html);
  }
  return parts.join('\n');
}