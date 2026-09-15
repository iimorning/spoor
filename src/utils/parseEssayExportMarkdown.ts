export type EssayExportInline =
  | { type: 'text'; text: string }
  | { type: 'strong'; text: string }
  | { type: 'em'; text: string }
  | { type: 'code'; text: string }
  | { type: 'link'; text: string; href: string }
  | { type: 'break' };

export type EssayExportBlock =
  | { type: 'heading'; level: 1 | 2 | 3; inlines: EssayExportInline[] }
  | { type: 'paragraph'; inlines: EssayExportInline[] }
  | { type: 'list'; ordered: boolean; items: EssayExportInline[][] }
  | { type: 'blockquote'; inlines: EssayExportInline[] }
  | { type: 'code'; lang: string; text: string }
  | { type: 'image'; alt: string; src: string }
  | { type: 'hr' };

const INLINE_RE = /(\*\*[^*]+?\*\*|\*[^*\n]+?\*|`[^`]+?`|\[[^\]]+\]\([^)]+\))/g;

export function parseEssayExportInlines(text: string): EssayExportInline[] {
  const out: EssayExportInline[] = [];
  const pushText = (chunk: string) => {
    if (!chunk) return;
    const parts = chunk.split('\n');
    parts.forEach((part, i) => {
      if (part) out.push({ type: 'text', text: part });
      if (i < parts.length - 1) out.push({ type: 'break' });
    });
  };

  let last = 0;
  let match: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((match = INLINE_RE.exec(text))) {
    pushText(text.slice(last, match.index));
    const tok = match[0];
    if (tok.startsWith('**')) {
      out.push({ type: 'strong', text: tok.slice(2, -2) });
    } else if (tok.startsWith('*')) {
      out.push({ type: 'em', text: tok.slice(1, -1) });
    } else if (tok.startsWith('`')) {
      out.push({ type: 'code', text: tok.slice(1, -1) });
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      if (link) out.push({ type: 'link', text: link[1], href: link[2] });
    }
    last = match.index + tok.length;
  }
  pushText(text.slice(last));
  return out;
}

function isBlockStart(line: string): boolean {
  return (
    line.startsWith('```') ||
    /^#{1,3} /.test(line) ||
    /^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim()) ||
    /^!\[[^\]]*\]\([^)]+\)\s*$/.test(line.trim()) ||
    /^>\s?/.test(line) ||
    /^[-*+] /.test(line) ||
    /^\d+\. /.test(line)
  );
}

export function parseEssayExportMarkdown(markdown: string): EssayExportBlock[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: EssayExportBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i += 1;
      continue;
    }

    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith('```')) {
        body.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ type: 'code', lang, text: body.join('\n') });
      continue;
    }

    const heading = /^(#{1,3}) (.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length as 1 | 2 | 3;
      blocks.push({ type: 'heading', level, inlines: parseEssayExportInlines(heading[2]) });
      i += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }

    const img = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(line.trim());
    if (img) {
      blocks.push({ type: 'image', alt: img[1], src: img[2] });
      i += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push({ type: 'blockquote', inlines: parseEssayExportInlines(quote.join('\n')) });
      continue;
    }

    const ordered = /^\d+\. /.test(line);
    const unordered = /^[-*+] /.test(line);
    if (ordered || unordered) {
      const items: EssayExportInline[][] = [];
      while (
        i < lines.length &&
        (ordered ? /^\d+\. /.test(lines[i]) : /^[-*+] /.test(lines[i]))
      ) {
        items.push(
          parseEssayExportInlines(lines[i].replace(ordered ? /^\d+\. / : /^[-*+] /, '')),
        );
        i += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i])) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: 'paragraph', inlines: parseEssayExportInlines(para.join('\n')) });
  }

  return blocks;
}
