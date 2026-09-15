/** Subset used by evergreen guides: headings, lists, quotes, tables, bold, hr. */

export function prepareGuideMarkdown(markdown: string, h1: string): string {
  const trimmed = markdown.replace(/^\uFEFF/, '').trim();
  const escaped = h1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const withoutTitle = trimmed.replace(new RegExp(`^#\\s+${escaped}\\s*\\n+`), '');
  return withoutTitle.replace(/^# (?!#)/gm, '## ');
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(value: string): string {
  return escapeHtml(value).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function isBlockStart(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (/^---+$/.test(t)) return true;
  if (/^#{2,3}\s/.test(line)) return true;
  if (line.startsWith('>')) return true;
  if (t.startsWith('|')) return true;
  if (/^[-*]\s+/.test(line)) return true;
  return false;
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell.replace(/\s/g, '')));
}

export function guideMarkdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      out.push('<hr />');
      i += 1;
      continue;
    }

    const heading = line.match(/^(#{2,3})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (line.startsWith('>')) {
      const quoted: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        quoted.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      out.push(`<blockquote><p>${inline(quoted.join(' '))}</p></blockquote>`);
      continue;
    }

    if (line.trim().startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = splitTableRow(lines[i]);
        if (!isSeparatorRow(cells)) rows.push(cells);
        i += 1;
      }
      if (rows.length > 0) {
        const [head, ...body] = rows;
        const headHtml = head.map((cell) => `<th>${inline(cell)}</th>`).join('');
        const bodyHtml = body
          .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`)
          .join('');
        out.push(
          `<div class="guide-page__table-wrap"><table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`,
        );
      }
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ''));
        i += 1;
      }
      out.push(`<ul>${items.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`);
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
      para.push(lines[i]);
      i += 1;
    }
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }

  return out.join('\n');
}
