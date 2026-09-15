import {
  parseEssayExportMarkdown,
  type EssayExportInline,
} from './parseEssayExportMarkdown';

function inlinesToText(inlines: EssayExportInline[]): string {
  return inlines
    .map((node) => {
      switch (node.type) {
        case 'text':
        case 'strong':
        case 'em':
        case 'code':
          return node.text;
        case 'link':
          return node.text;
        case 'break':
          return '\n';
        default:
          return '';
      }
    })
    .join('');
}

/** Readable title + body for pasting into Word, chat, or another editor. */
export function formatEssayCopyText(input: { title?: string; markdown?: string }): string {
  const title = (input.title ?? '').trim();
  const blocks = parseEssayExportMarkdown(input.markdown ?? '');
  const bodyParts: string[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
      case 'paragraph':
      case 'blockquote': {
        const text = inlinesToText(block.inlines).trim();
        if (text) bodyParts.push(text);
        break;
      }
      case 'list': {
        const lines = block.items
          .map((item, i) => {
            const text = inlinesToText(item).trim();
            if (!text) return '';
            return block.ordered ? `${i + 1}. ${text}` : `• ${text}`;
          })
          .filter(Boolean);
        if (lines.length) bodyParts.push(lines.join('\n'));
        break;
      }
      case 'code':
        if (block.text.trim()) bodyParts.push(block.text);
        break;
      case 'image':
        if (block.alt.trim()) bodyParts.push(`[${block.alt.trim()}]`);
        break;
      default:
        break;
    }
  }

  return [title, ...bodyParts].filter(Boolean).join('\n\n');
}
