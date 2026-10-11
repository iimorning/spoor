/**
 * 工作区顾问气泡：将常见 Markdown 转为安全 HTML（无外部依赖，浏览器可直引）。
 * 支持：标题 #–###、段落、-/* 列表、有序列表、**粗体**、`行内代码`、``` 围栏代码块、--- 分隔线、GFM 表格（含被拆行的表头分隔符）。
 */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function applyInline(escaped) {
  let s = escaped;
  s = s.replace(
    /`([^`]+)`/g,
    '<code class="rounded bg-stone-100 px-1 py-0.5 font-mono text-[0.8em] text-stone-800">$1</code>'
  );
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-stone-900">$1</strong>');
  return s;
}

function formatParagraph(raw) {
  const esc = escapeHtml(raw);
  const withBr = esc.replace(/\n/g, '<br />\n');
  return `<p class="mb-2.5 text-stone-700 leading-relaxed last:mb-0">${applyInline(withBr)}</p>`;
}

function formatCodeBlock(raw) {
  return `<pre class="mb-3 overflow-x-auto rounded-lg border border-stone-100 bg-stone-50 px-2.5 py-2 text-xs text-stone-800"><code>${escapeHtml(raw)}</code></pre>`;
}

function headerBlock(level, content) {
  const inner = applyInline(escapeHtml(content));
  if (level === 3) {
    return `<h3 class="mb-1.5 mt-4 border-b border-stone-100 pb-1 text-sm font-bold text-stone-900 first:mt-0">${inner}</h3>`;
  }
  if (level === 2) {
    return `<h2 class="mb-2 mt-4 text-base font-bold text-stone-900 first:mt-0">${inner}</h2>`;
  }
  return `<h1 class="mb-2 mt-4 text-base font-bold text-stone-900 first:mt-0">${inner}</h1>`;
}

/** @param {string} line */
function splitTableRow(line) {
  let s = String(line).trim();
  if (!s.includes('|')) return null;
  if (!s.startsWith('|')) s = `|${s}`;
  if (!s.endsWith('|')) s = `${s}|`;
  const cells = s
    .slice(1, -1)
    .split('|')
    .map((c) => c.trim());
  if (cells.length < 2) return null;
  return cells;
}

/** @param {string} line */
function isTableRow(line) {
  const cells = splitTableRow(line);
  return cells != null && cells.length >= 2;
}

/**
 * @param {string} merged
 * @param {number} expectedCols 须与表头列数一致（GFM）
 */
function isTableSeparatorLine(merged, expectedCols) {
  const cells = splitTableRow(merged);
  if (!cells || cells.length !== expectedCols) return false;
  return cells.every((c) => /^:?-{2,}:?$/.test(c));
}

/**
 * @param {string[]} lines
 * @param {number} startIdx
 * @returns {{ html: string, nextIndex: number } | null}
 */
function tryConsumeTable(lines, startIdx) {
  if (startIdx >= lines.length) return null;
  const headers = splitTableRow(lines[startIdx]);
  if (!headers || headers.length < 2) return null;

  const expectedCols = headers.length;
  let k = startIdx + 1;
  let mergedSep = '';
  while (k < lines.length) {
    const t = lines[k].trim();
    if (t === '') return null;
    if (!/^[-|\s:]+$/.test(t)) return null;
    /** 避免 |---- 与 ---| 拼成 |-------|（单列）；在「以 -/: 结尾」且「以下一段 - 开头」时补 | */
    const joint =
      mergedSep.length > 0 &&
      /[-:]/.test(mergedSep[mergedSep.length - 1]) &&
      /^[-:]/.test(t[0])
        ? '|'
        : '';
    mergedSep += joint + t;
    k += 1;
    if (isTableSeparatorLine(mergedSep, expectedCols)) break;
  }
  if (!isTableSeparatorLine(mergedSep, expectedCols)) return null;

  const body = [];
  while (k < lines.length) {
    const ln = lines[k];
    if (ln.trim() === '') break;
    if (!isTableRow(ln)) break;
    const cells = splitTableRow(ln);
    if (!cells) break;
    body.push(cells);
    k += 1;
  }

  const ths = headers
    .map(
      (h) =>
        `<th class="border border-stone-200 bg-stone-50 px-2 py-1.5 text-left text-[11px] font-semibold text-stone-800">${applyInline(escapeHtml(h))}</th>`
    )
    .join('');
  const trHead = `<thead><tr>${ths}</tr></thead>`;
  const bodyRows = body
    .map((row) => {
      const cells = row.slice();
      while (cells.length < expectedCols) cells.push('');
      const slice = cells.slice(0, expectedCols);
      if (cells.length > expectedCols) {
        slice[expectedCols - 1] = cells
          .slice(expectedCols - 1)
          .join(' ')
          .trim();
      }
      const tds = slice
        .map(
          (c) =>
            `<td class="border border-stone-200 px-2 py-1.5 align-top text-[11px] leading-snug text-stone-700">${applyInline(escapeHtml(c))}</td>`
        )
        .join('');
      return `<tr>${tds}</tr>`;
    })
    .join('');
  const html = `<div class="chat-md-table-wrap my-3 max-w-full overflow-x-auto"><table class="w-full min-w-[240px] border-collapse overflow-hidden rounded-md border border-stone-200 text-left">${trHead}<tbody>${bodyRows}</tbody></table></div>`;
  return { html, nextIndex: k };
}

/**
 * @param {string} text
 * @returns {string}
 */
export function renderAssistantMarkdown(text) {
  const lines = String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  const blocks = [];
  let para = [];
  /** @type {{ ordered: boolean, items: string[][] } | null} */
  let list = null;
  /** @type {string[] | null} */
  let fence = null;

  function flushPara() {
    if (!para.length) return;
    blocks.push(formatParagraph(para.join('\n')));
    para = [];
  }

  function flushList() {
    if (!list?.items.length) {
      list = null;
      return;
    }
    const tag = list.ordered ? 'ol' : 'ul';
    const listCls = list.ordered
      ? 'mb-3 list-decimal space-y-2 pl-5 text-stone-700'
      : 'mb-3 list-disc space-y-2 pl-5 text-stone-700';
    const inner = list.items
      .map((itemLines) => {
        const raw = itemLines.join('\n');
        const esc = escapeHtml(raw);
        const withBr = esc.replace(/\n/g, '<br />\n');
        return `<li class="leading-relaxed">${applyInline(withBr)}</li>`;
      })
      .join('');
    blocks.push(`<${tag} class="${listCls}">${inner}</${tag}>`);
    list = null;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (fence !== null) {
      if (line.trim().startsWith('```')) {
        blocks.push(formatCodeBlock(fence.join('\n')));
        fence = null;
      } else {
        fence.push(line);
      }
      continue;
    }

    if (line.trim().startsWith('```')) {
      flushPara();
      flushList();
      fence = [];
      continue;
    }

    const trimmed = line.trim();
    if (trimmed === '') {
      flushPara();
      flushList();
      continue;
    }

    if (/^---+\s*$/.test(trimmed)) {
      flushPara();
      flushList();
      blocks.push('<hr class="my-3 border-0 border-t border-stone-200" />');
      continue;
    }

    const m3 = line.match(/^###\s+(.+)$/);
    if (m3) {
      flushPara();
      flushList();
      blocks.push(headerBlock(3, m3[1]));
      continue;
    }
    const m2 = line.match(/^##\s+(.+)$/);
    if (m2) {
      flushPara();
      flushList();
      blocks.push(headerBlock(2, m2[1]));
      continue;
    }
    const m1 = line.match(/^#\s+(.+)$/);
    if (m1) {
      flushPara();
      flushList();
      blocks.push(headerBlock(1, m1[1]));
      continue;
    }

    const tableBlock = tryConsumeTable(lines, i);
    if (tableBlock) {
      flushPara();
      flushList();
      blocks.push(tableBlock.html);
      i = tableBlock.nextIndex - 1;
      continue;
    }

    const ordered = line.match(/^(\d+)\.\s+(.+)$/);
    if (ordered) {
      flushPara();
      const isNum = true;
      if (!list || list.ordered !== isNum) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push([ordered[2]]);
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushPara();
      const isNum = false;
      if (!list || list.ordered !== isNum) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push([bullet[1]]);
      continue;
    }

    if (list?.items.length) {
      const isNewBlock =
        /^###\s/.test(trimmed) ||
        /^##\s/.test(trimmed) ||
        /^#\s/.test(trimmed) ||
        /^\d+\.\s/.test(trimmed) ||
        /^[-*]\s/.test(trimmed);
      if (!isNewBlock) {
        list.items[list.items.length - 1].push(line);
        continue;
      }
    }

    flushList();
    para.push(line);
  }

  flushPara();
  flushList();
  if (fence?.length) {
    blocks.push(formatCodeBlock(fence.join('\n')));
  }

  return `<div class="chat-md">${blocks.join('\n')}</div>`;
}
