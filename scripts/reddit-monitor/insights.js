import { mountLcIcons } from './icons.mjs';
import { renderAssistantMarkdown } from './lib/chat-markdown.mjs';
import {
  composeInsightsLabBodyHtml,
  draftReplyFromForumParsed,
  renderLabBody
} from './lib/forum-insights-lab-render.mjs';

const DATA_POLL_INTERVAL_MS = 15_000;

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sentimentBadge(sentiment, label) {
  const n = Number(sentiment);
  const isLow = n < 35;
  const isMid = n >= 35 && n < 60;
  const wrap = isLow
    ? 'bg-red-50 text-red-700'
    : isMid
      ? 'bg-orange-50 text-orange-700'
      : 'bg-emerald-50 text-emerald-700';
  const icon = isLow ? 'mood_bad' : isMid ? 'sentiment_neutral' : 'sentiment_satisfied';
  return `<div class="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-bold ${wrap}">
<span class="inline-flex shrink-0" data-lc-icon="${icon}"></span>
${escapeHtml(label)} ${Number.isFinite(n) ? `${Math.round(n)}%` : ''}
</div>`;
}

function formatQuoteHtml(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const paragraphs = raw.split(/\n\s*\n+/).map((x) => x.trim()).filter(Boolean);
  return paragraphs
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

function historyOptionsHtml() {
  if (!state.historyEntries.length) {
    return '<option value="">第 1 轮（当前）</option>';
  }
  return state.historyEntries
    .map((round, index) => {
      const date = new Date(round.fetchedAt);
      const time = Number.isFinite(date.getTime())
        ? date.toLocaleString('zh-CN', { hour12: false })
        : String(round.fetchedAt || '');
      const selected = round.id === state.currentHistoryId ? ' selected' : '';
      return `<option value="${escapeHtml(round.id)}"${selected}>第 ${index + 1} 轮 · ${escapeHtml(time)} · ${Number(round.itemCount || 0)} 条</option>`;
    })
    .join('');
}

function renderMain(items) {
  const cardsHtml = (items || [])
    .map(
      (it) => {
        const isExpanded = state.expandedIds.has(it.id);
        const selectedArchive = state.archiveSelections[it.id] || '';
        const quoteHtml = formatQuoteHtml(it.quote);
        return `
<div class="ins-card group cursor-pointer rounded-xl border border-stone-100 bg-white p-6 ring-1 ring-transparent transition-all hover:shadow-lg hover:ring-primary/20"
  role="button" tabindex="0" data-ins-id="${escapeHtml(it.id)}">
<div class="mb-4 flex items-start justify-between">
<div class="flex items-center gap-3">
<div class="flex h-10 w-10 items-center justify-center rounded-full bg-stone-100 text-stone-400">
<span class="inline-flex shrink-0" data-lc-icon="user"></span>
</div>
<div>
<h4 class="font-semibold text-on-background">${escapeHtml(it.userLabel)}</h4>
<p class="text-xs text-stone-400">${escapeHtml(it.source)} · ${escapeHtml(it.timeAgo)}</p>
</div>
</div>
${sentimentBadge(it.sentiment, it.sentimentLabel)}
</div>
<div class="mb-4 space-y-3 font-body-md italic leading-8 text-stone-700">
  <div class="ins-card-quote overflow-hidden transition-all duration-200 ${isExpanded ? '' : 'max-h-[4.5rem]'}">
    ${quoteHtml}
  </div>
  <button type="button" class="ins-card-toggle mt-1 text-xs font-semibold text-primary/70 hover:text-primary transition-colors">${isExpanded ? '收起' : '展开全文'}</button>
</div>
<div class="flex flex-wrap items-center justify-between gap-2">
<div class="flex flex-wrap items-center gap-2">
<span class="text-xs font-bold uppercase tracking-tighter text-stone-400">核心痛点：</span>
<span class="rounded bg-tertiary-container/10 px-2 py-0.5 text-xs font-semibold uppercase text-tertiary">${escapeHtml(it.painTag)}</span>
</div>
${it.link ? `<a href="${escapeHtml(it.link)}" target="_blank" rel="noopener noreferrer" class="rounded-lg border border-stone-300 bg-stone-50 px-2.5 py-1 text-xs font-semibold text-stone-700 transition-colors hover:bg-stone-100">查看原帖</a>` : ''}
</div>
<div class="ins-archive-actions mt-4 w-full max-w-full rounded-lg border border-dashed border-stone-300 bg-stone-50/70 p-3 ${isExpanded ? '' : 'hidden'}">
  <div class="mb-2 text-xs font-semibold text-stone-500">归档分类</div>
  <div class="mb-3 flex flex-wrap gap-2">
    ${archiveChoiceHtml(it.id, 'responded', '已回复', selectedArchive === 'responded')}
    ${archiveChoiceHtml(it.id, 'notTarget', '不是目标客户', selectedArchive === 'notTarget')}
  </div>
  ${selectedArchive ? (() => {
  const noteVal = state.archiveNotes[it.id] ?? '';
  const label = selectedArchive === 'responded' ? '回复说明' : '判定说明';
  const ph = selectedArchive === 'responded'
    ? '填写你实际回复给用户的内容要点…'
    : '说明为何判定为非目标客户…';
  return `<div class="mb-3 w-full min-w-0 space-y-1">
    <label class="text-xs font-semibold text-stone-600" for="ins-archive-note-${escapeHtml(it.id)}">${label}</label>
    <textarea id="ins-archive-note-${escapeHtml(it.id)}" rows="3" class="ins-archive-note box-border w-full min-w-0 resize-y rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 placeholder:text-stone-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20" data-ins-id="${escapeHtml(it.id)}" placeholder="${escapeHtml(ph)}">${escapeHtml(noteVal)}</textarea>
  </div>`;
})() : ''}
  <div class="flex justify-end">
    <button type="button" class="ins-archive-submit rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white transition-all hover:brightness-110 disabled:opacity-40" data-ins-id="${escapeHtml(it.id)}">提交归档</button>
  </div>
</div>
</div>`;
      }
    )
    .join('');

  return `
<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
<h1 class="font-headline-lg font-serif text-on-background">原始用户反馈</h1>
<div class="flex items-center gap-2 text-sm text-stone-500">
<span>数据轮次</span>
<select id="ins-history-round" class="rounded-lg border border-stone-200 bg-white px-2 py-1 text-sm text-on-background" aria-label="数据轮次">
${historyOptionsHtml()}
</select>
<span>按情绪筛选</span>
<span class="inline-flex shrink-0 text-stone-400" data-lc-icon="funnel" title="筛选"></span>
<select id="ins-filter-sentiment" class="rounded-lg border border-stone-200 bg-white px-2 py-1 text-sm text-on-background" aria-label="情绪筛选">
<option value="all">全部</option>
<option value="low">偏低（&lt;35%）</option>
<option value="mid">中性（35–59%）</option>
<option value="high">积极（≥60%）</option>
</select>
<button type="button" id="ins-open-archive-modal" class="ml-2 shrink-0 rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-xs font-semibold text-stone-600 transition-colors hover:border-primary/30 hover:bg-primary/5">归档记录</button>
</div>
</div>
<div id="ins-cards" class="space-y-4">${cardsHtml || '<p class="text-stone-500">暂无反馈条目。</p>'}</div>`;
}

function renderUserBubble(text) {
  const t = escapeHtml(text);
  return `<div class="mb-3 flex justify-end">
    <div class="max-w-[85%] rounded-2xl rounded-br-sm bg-primary/10 px-4 py-2.5 text-sm text-on-background">${t}</div>
  </div>`;
}

function renderLabGeneratingPlaceholder(label = '生成中…') {
  return `<div class="ins-lab-generating flex min-h-[8rem] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-primary/30 bg-primary/5 px-4 py-10">
    <span class="inline-flex h-2 w-2 shrink-0 animate-pulse rounded-full bg-primary/60" aria-hidden="true"></span>
    <p class="text-sm font-medium text-stone-600">${escapeHtml(label)}</p>
  </div>`;
}

function showToast(msg) {
  const el = document.getElementById('insights-toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.add('hidden'), 2200);
}

const ARCHIVE_CATEGORY_META = {
  responded: { label: '已回复' },
  notTarget: { label: '不是目标客户' }
};

let state = {
  items: [],
  selectedId: null,
  expandedIds: new Set(),
  archiveSelections: {},
  archiveNotes: {},
  archivedRecords: { responded: [], notTarget: [] },
  historyEntries: [],
  currentHistoryId: null
};
let refining = false;
/** 正在进行「分析学习痛点」请求 */
let analyzingPain = false;
let archiveModalCategory = 'responded';
/** @type {string | null} */
let expandedArchiveRowId = null;

function findItemIndexById(itemId) {
  const sid = String(itemId);
  return state.items.findIndex((x) => String(x.id) === sid);
}

function mergePainAnalysisIntoState(itemId, analysisText) {
  const idx = findItemIndexById(itemId);
  if (idx >= 0) {
    state.items[idx] = { ...state.items[idx], painAnalysis: analysisText };
    return true;
  }
  const cur = getSelectedItem();
  if (cur && String(cur.id) === String(itemId)) {
    cur.painAnalysis = analysisText;
    return true;
  }
  return false;
}

function applyForumReplyPayloadToState(itemId, data, chatMessage, chatHistory) {
  let idx = findItemIndexById(itemId);
  if (idx < 0) {
    const cur = getSelectedItem();
    if (cur && String(cur.id) === String(itemId)) idx = state.items.indexOf(cur);
  }
  if (idx < 0) return false;
  const { ok: _ok, id: _rid, ...parsed } = data;
  const existing = state.items[idx];
  const replyText = draftReplyFromForumParsed(parsed);
  /** chatHistory 约定为当前句之前的对话（不含本轮用户消息） */
  let updatedChatHistory;
  if (chatMessage) {
    const prior = Array.isArray(chatHistory) ? chatHistory : [];
    updatedChatHistory = [...prior, { role: 'user', content: chatMessage }];
    if (replyText) {
      updatedChatHistory.push({ role: 'assistant', content: replyText });
    }
  } else {
    updatedChatHistory = chatHistory?.length ? [...chatHistory] : [...(existing.aiLab?.chatHistory || [])];
  }
  let initialAiLabPatch = {};
  if (!chatMessage) {
    if (parsed?.aiLab && typeof parsed.aiLab === 'object') {
      initialAiLabPatch = { ...parsed.aiLab };
    }
    if (replyText) {
      initialAiLabPatch.draftReply = replyText;
    }
  }
  state.items[idx] = {
    ...existing,
    sentiment: Number.isFinite(Number(parsed.sentiment))
      ? Number(parsed.sentiment)
      : existing.sentiment,
    sentimentLabel: parsed.sentimentLabel || existing.sentimentLabel,
    painTag: parsed.painTag || existing.painTag,
    aiLab: {
      ...(existing.aiLab || {}),
      ...initialAiLabPatch,
      chatHistory: updatedChatHistory
    }
  };
  return true;
}

function applyFilter() {
  const sel = document.getElementById('ins-filter-sentiment');
  const mode = sel?.value || 'all';
  document.querySelectorAll('.ins-card').forEach((card) => {
    const id = card.getAttribute('data-ins-id');
    const it = state.items.find((x) => String(x.id) === String(id));
    if (!it) return;
    const n = Number(it.sentiment);
    let okSent = true;
    if (mode === 'low') okSent = n < 35;
    else if (mode === 'mid') okSent = n >= 35 && n < 60;
    else if (mode === 'high') okSent = n >= 60;
    card.classList.toggle('hidden', !okSent);
  });
}

function getSelectedItem() {
  return state.items.find((x) => String(x.id) === String(state.selectedId));
}

function formatArchiveTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function archiveChoiceHtml(itemId, value, label, checked = false) {
  return `<label class="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-stone-200 px-3 py-1.5 text-xs text-stone-700 transition-colors hover:border-primary/40 hover:bg-primary/5">
    <input type="checkbox" class="ins-archive-choice h-3.5 w-3.5 rounded border-stone-300 text-primary focus:ring-primary/30" data-ins-id="${escapeHtml(itemId)}" value="${value}" ${checked ? 'checked' : ''}/>
    <span>${label}</span>
  </label>`;
}

function renderArchiveDetailPanel(entry) {
  const parts = [];
  const n = Number(entry.sentiment);
  if (Number.isFinite(n) || (entry.sentimentLabel && String(entry.sentimentLabel).trim())) {
    const label = escapeHtml(String(entry.sentimentLabel || '').trim());
    parts.push(`<div class="mb-4">
      <p class="mb-1 text-[10px] font-bold uppercase tracking-wider text-stone-400">情绪</p>
      <p class="text-sm text-stone-800">${label}${Number.isFinite(n) ? ` <span class="tabular-nums text-stone-500">${Math.round(n)}%</span>` : ''}</p>
    </div>`);
  }
  if (entry.title && String(entry.title).trim()) {
    parts.push(`<div class="mb-4">
      <p class="mb-1 text-[10px] font-bold uppercase tracking-wider text-stone-400">标题</p>
      <p class="text-sm text-stone-800">${escapeHtml(String(entry.title).trim())}</p>
    </div>`);
  }
  if (entry.painTag && String(entry.painTag).trim()) {
    parts.push(`<div class="mb-4">
      <p class="mb-1 text-[10px] font-bold uppercase tracking-wider text-stone-400">核心痛点</p>
      <p class="text-sm text-stone-800">${escapeHtml(String(entry.painTag).trim())}</p>
    </div>`);
  }
  const fullQuote = String(entry.quote || '');
  parts.push(`<div class="mb-4">
    <p class="mb-1 text-[10px] font-bold uppercase tracking-wider text-stone-400">原文反馈</p>
    <div class="ins-archive-detail-quote rounded-lg border border-stone-100 bg-stone-50/90 p-3 text-sm leading-relaxed text-stone-800 break-words">${formatQuoteHtml(fullQuote) || '<span class="text-stone-400">无</span>'}</div>
  </div>`);
  if (entry.link && String(entry.link).trim()) {
    const href = escapeHtml(String(entry.link).trim());
    parts.push(`<div class="mb-4 flex flex-wrap items-center gap-2">
      <p class="mb-1 w-full text-[10px] font-bold uppercase tracking-wider text-stone-400">原帖</p>
      <a href="${href}" target="_blank" rel="noopener noreferrer" class="rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/5">查看原帖</a>
    </div>`);
  }
  const archNote = entry.archiveNote != null ? String(entry.archiveNote).trim() : '';
  if (archNote) {
    parts.push(`<div class="mb-4">
      <p class="mb-1 text-[10px] font-bold uppercase tracking-wider text-stone-400">归档备注</p>
      <div class="rounded-lg border border-stone-200 bg-white p-3 text-sm leading-relaxed text-stone-800 whitespace-pre-wrap">${escapeHtml(archNote)}</div>
    </div>`);
  }
  const draft = entry.aiLab?.draftReply != null ? String(entry.aiLab.draftReply).trim() : '';
  if (draft) {
    const draftMd = renderAssistantMarkdown(draft);
    const escapedForAttr = escapeHtmlAttr(draft);
    parts.push(`<div class="mb-4">
      <p class="mb-1 text-[10px] font-bold uppercase tracking-wider text-stone-400">AI 回复草稿</p>
      <div class="chat-md-scope rounded-r-lg border-l-4 border-primary bg-primary/5 p-3 text-sm leading-relaxed text-stone-800 break-words">${draftMd}</div>
      <div class="mt-2 flex justify-end">
        <button type="button" class="ins-copy-btn inline-flex shrink-0 items-center gap-1 rounded-md border border-stone-200/90 bg-white px-2 py-1 text-[10px] font-semibold text-stone-600 shadow-sm transition-colors hover:bg-primary/5 hover:text-primary" data-copy-text="${escapedForAttr}"><span class="inline-flex shrink-0" data-lc-icon="copy"></span>复制</button>
      </div>
    </div>`);
  } else {
    parts.push(`<div class="mb-4 rounded-lg border border-dashed border-stone-200 bg-stone-50/50 px-3 py-2 text-sm text-stone-400">归档时暂无 AI 回复草稿。若需要先润色，生成后再归档即可写入此处。</div>`);
  }
  const hist = entry.aiLab?.chatHistory;
  if (Array.isArray(hist) && hist.length > 0) {
    const blocks = hist
      .map((m) => {
        if (m.role === 'user') {
          return `<div class="rounded-xl bg-primary/10 px-3 py-2 text-sm text-on-background"><span class="text-[10px] font-bold text-primary/80">我</span><div class="mt-1 whitespace-pre-wrap leading-relaxed">${escapeHtml(String(m.content || ''))}</div></div>`;
        }
        if (m.role === 'assistant') {
          return `<div class="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700"><span class="text-[10px] font-bold text-stone-400">AI</span><div class="mt-1 whitespace-pre-wrap leading-relaxed">${escapeHtml(String(m.content || ''))}</div></div>`;
        }
        return '';
      })
      .filter(Boolean)
      .join('');
    if (blocks) {
      parts.push(`<div class="mb-4">
        <p class="mb-2 text-[10px] font-bold uppercase tracking-wider text-stone-400">润色对话记录</p>
        <div class="space-y-2 pr-1">${blocks}</div>
      </div>`);
    }
  }
  const analysis = entry.painAnalysis != null ? String(entry.painAnalysis).trim() : '';
  if (analysis) {
    const analysisMd = renderAssistantMarkdown(analysis);
    parts.push(`<div class="mb-1">
      <p class="mb-1 text-[10px] font-bold uppercase tracking-wider text-stone-400">学习痛点分析</p>
      <div class="chat-md-scope rounded-lg border border-stone-200 bg-amber-50/50 p-3 text-sm leading-relaxed text-stone-800 break-words">${analysisMd}</div>
    </div>`);
  }
  return `<div class="ins-archive-detail-panel border-t border-stone-100 bg-stone-50/30 px-2 py-1 text-left">${parts.join('')}</div>`;
}

function escapeHtmlAttr(s) {
  return escapeHtml(String(s)).replace(/\n/g, '&#10;');
}

function renderArchiveModalTable() {
  const list = Array.isArray(state.archivedRecords[archiveModalCategory]) ? state.archivedRecords[archiveModalCategory] : [];
  const tbody = document.getElementById('ins-archive-modal-table-body');
  if (!tbody) return;
  if (list.length === 0) {
    expandedArchiveRowId = null;
    tbody.innerHTML = `<tr>
      <td colspan="4" class="box-border px-6 py-14 text-center text-sm text-stone-400 font-serif">当前分类暂无归档记录。</td>
    </tr>`;
    return;
  }
  tbody.innerHTML = list
    .map((entry) => {
      const eid = String(entry.id || '');
      const user = escapeHtml(entry.userLabel || entry.id || '匿名用户');
      const quote = escapeHtml(String(entry.quote || '')).replace(/\n+/g, ' ').slice(0, 280);
      const source = escapeHtml(entry.source || '-');
      const archivedAt = formatArchiveTime(entry.archivedAt) || '-';
      const expanded = expandedArchiveRowId === eid;
      return `
<tr class="ins-archive-summary-row cursor-pointer align-top transition-colors hover:bg-stone-50/90" role="button" tabindex="0" data-archive-id="${escapeHtml(eid)}" aria-expanded="${expanded}">
  <td class="box-border px-4 py-3 align-top break-words font-semibold text-stone-800">${user}<span class="mt-1 block text-[10px] font-normal text-stone-400">${expanded ? '收起详情' : '点击展开全文'}</span></td>
  <td class="box-border px-4 py-3 align-top text-sm leading-relaxed text-stone-600 break-words">${quote}</td>
  <td class="box-border px-4 py-3 align-top text-sm text-stone-500 whitespace-nowrap">${source}</td>
  <td class="box-border px-4 py-3 align-top text-sm tabular-nums text-stone-500 whitespace-nowrap">${archivedAt}</td>
</tr>
<tr class="ins-archive-detail-row ${expanded ? '' : 'hidden'}" aria-hidden="${expanded ? 'false' : 'true'}" data-archive-detail="${escapeHtml(eid)}">
  <td colspan="4" class="box-border px-4 pb-4 pt-0">${renderArchiveDetailPanel(entry)}</td>
</tr>`;
    })
    .join('');
  mountLcIcons(tbody);
}

function syncArchiveModalTabs() {
  const tabs = document.querySelectorAll('#ins-archive-modal-tabs .ins-archive-tab-btn');
  tabs.forEach((btn) => {
    const category = btn.getAttribute('data-category');
    const active = category === archiveModalCategory;
    const count = Array.isArray(state.archivedRecords[category]) ? state.archivedRecords[category].length : 0;
    const countEl = btn.querySelector('[data-role="count"]');
    if (countEl) countEl.textContent = String(count);
    btn.classList.toggle('bg-primary', active);
    btn.classList.toggle('text-white', active);
    btn.classList.toggle('border', !active);
    btn.classList.toggle('border-stone-200', !active);
    btn.classList.toggle('bg-white', !active);
    btn.classList.toggle('text-stone-600', !active);
  });
}

function openArchiveModal() {
  const modal = document.getElementById('ins-archive-modal');
  if (!modal) return;
  const respondedCount = Array.isArray(state.archivedRecords.responded) ? state.archivedRecords.responded.length : 0;
  const notTargetCount = Array.isArray(state.archivedRecords.notTarget) ? state.archivedRecords.notTarget.length : 0;
  if (respondedCount === 0 && notTargetCount > 0) {
    archiveModalCategory = 'notTarget';
  } else if (notTargetCount === 0 && respondedCount > 0) {
    archiveModalCategory = 'responded';
  }
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('ins-archive-modal-active');
  expandedArchiveRowId = null;
  syncArchiveModalTabs();
  renderArchiveModalTable();
}

function closeArchiveModal() {
  const modal = document.getElementById('ins-archive-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('ins-archive-modal-active');
}

function rerenderMain() {
  const inner = document.getElementById('ins-main-inner');
  if (!inner) return;
  inner.innerHTML = renderMain(state.items);
  mountLcIcons(inner);
  applyFilter();
  if (state.selectedId && state.items.some((x) => String(x.id) === String(state.selectedId))) {
    highlightCard(state.selectedId);
    syncLabPanelFromState();
  } else {
    const first = state.items[0];
    state.selectedId = first ? first.id : null;
    syncLabPanelFromState();
    if (first) highlightCard(first.id);
  }
}

/** 「继续对话」输入区常驻显示（先有痛点即可在下方与 AI 多轮对话） */
function showLabChatArea() {
  const chatArea = document.getElementById('ins-chat-area');
  if (!chatArea) return;
  chatArea.classList.remove('hidden');
  chatArea.classList.add('flex');
}

/** 从 state 推导并渲染右侧正文（非流式） */
function syncLabPanelFromState() {
  const it = getSelectedItem();
  const labBody = document.getElementById('ins-lab-body');
  const labHeader = document.getElementById('ins-lab-header');

  if (labHeader) labHeader.classList.add('hidden');

  if (it?.painAnalysis) {
    showLabChatArea();
    if (labBody) {
      labBody.innerHTML = composeInsightsLabBodyHtml(it);
      mountLcIcons(labBody);
    }
    return;
  }

  if (labBody) {
    labBody.innerHTML = renderLabBody(it?.aiLab, { context: 'standalone' });
    mountLcIcons(labBody);
  }
  showLabChatArea();
}

function updateLabPanel() {
  syncLabPanelFromState();
}

function selectCard(id) {
  state.selectedId = id;
  syncLabPanelFromState();
  highlightCard(id);
}

function toggleCard(id) {
  if (state.expandedIds.has(id)) {
    state.expandedIds.delete(id);
  } else {
    state.expandedIds.add(id);
  }
  // Toggle via CSS class on the quote element — no re-render needed
  const card = document.querySelector(`.ins-card[data-ins-id="${CSS.escape(id)}"]`);
  if (!card) return;
  const quote = card.querySelector('.ins-card-quote');
  const btn = card.querySelector('.ins-card-toggle');
  const isExpanded = state.expandedIds.has(id);
  if (quote) {
    quote.classList.toggle('max-h-[4.5rem]', !isExpanded);
  }
  if (btn) {
    btn.textContent = isExpanded ? '收起' : '展开全文';
  }
  const archiveActions = card.querySelector('.ins-archive-actions');
  if (archiveActions) {
    archiveActions.classList.toggle('hidden', !isExpanded);
  }
}

function highlightCard(id) {
  document.querySelectorAll('.ins-card').forEach((c) => {
    const active = c.getAttribute('data-ins-id') === id;
    c.classList.toggle('ring-2', active);
    c.classList.toggle('ring-primary/30', active);
    c.classList.toggle('shadow-md', active);
  });
}

async function loadHistoryRound(roundId) {
  const round = state.historyEntries.find((entry) => entry.id === roundId);
  if (!round?.insightsPath) return;
  try {
    const res = await fetch(round.insightsPath, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.items = Array.isArray(data.items) ? data.items : [];
    state.currentHistoryId = round.id;
    state.selectedId = null;
    state.expandedIds.clear();
    state.archiveSelections = {};
    state.archiveNotes = {};
    rerenderMain();
    showToast(`已切换到第 ${state.historyEntries.indexOf(round) + 1} 轮`);
  } catch (error) {
    showToast(`读取历史轮次失败：${error.message}`);
  }
}

async function main() {
  mountLcIcons(document.body);
  let data;
  try {
    const res = await fetch('/api/forum-insights');
    data = await res.json();
  } catch {
    data = { meta: {}, frictionTags: [], items: [] };
  }
  try {
    const historyRes = await fetch('./data/history/index.json', { cache: 'no-store' });
    if (historyRes.ok) {
      const history = await historyRes.json();
      state.historyEntries = Array.isArray(history.rounds) ? history.rounds : [];
      state.currentHistoryId = state.historyEntries[0]?.id || null;
    }
  } catch {
    state.historyEntries = [];
    state.currentHistoryId = null;
  }
  state.items = data.items || [];
  state.archivedRecords = {
    responded: Array.isArray(data.archivedRecords?.responded) ? data.archivedRecords.responded : [],
    notTarget: Array.isArray(data.archivedRecords?.notTarget) ? data.archivedRecords.notTarget : []
  };
  const inner = document.getElementById('ins-main-inner');
  rerenderMain();

  const preferred = state.items.find((x) => x.selected) || state.items[0];
  if (preferred) {
    selectCard(preferred.id);
  }

  // n8n writes forum-raw.json, and serve.mjs rebuilds the UI payload. Poll the
  // payload version so an open page picks up new cards without manual refresh.
  let dataVersion = JSON.stringify([
    data.meta?.lastSyncNote || '',
    state.items.map((item) => [
      item.id,
      item.userLabel,
      item.timeAgo,
      item.sentiment,
      item.painTag
    ])
  ]);
  window.setInterval(async () => {
    if (document.hidden) return;
    try {
      const res = await fetch('/api/forum-insights', { cache: 'no-store' });
      if (!res.ok) return;
      const next = await res.json();
      const nextVersion = JSON.stringify([
        next.meta?.lastSyncNote || '',
        (next.items || []).map((item) => [
          item.id,
          item.userLabel,
          item.timeAgo,
          item.sentiment,
          item.painTag
        ])
      ]);
      if (nextVersion !== dataVersion) {
        const viewingLatest =
          state.historyEntries.length === 0 ||
          state.currentHistoryId === state.historyEntries[0]?.id;
        if (viewingLatest) {
          dataVersion = nextVersion;
          window.location.reload();
        }
      }
    } catch {
      // Keep the current UI when the local viewer is temporarily unavailable.
    }
  }, DATA_POLL_INTERVAL_MS);

  inner?.addEventListener('click', (e) => {
    if (e.target.closest('#ins-open-archive-modal')) {
      e.preventDefault();
      openArchiveModal();
      return;
    }
    const archiveSubmitBtn = e.target.closest?.('.ins-archive-submit');
    if (archiveSubmitBtn) {
      e.preventDefault();
      void handleArchiveSubmit(archiveSubmitBtn);
      return;
    }
    if (e.target.closest('.ins-archive-actions')) return;
    const card = e.target.closest?.('.ins-card');
    if (!card) return;
    const id = card.getAttribute('data-ins-id');
    if (!id) return;

    // 外链（查看原帖等）保持跳转，不参与折叠
    if (e.target.closest('a')) {
      return;
    }

    toggleCard(id);
    selectCard(id);
  });
  inner?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest?.('.ins-card');
    if (!card) return;
    const id = card.getAttribute('data-ins-id');
    if (!id) return;
    // 焦点在按钮/链接上时交给浏览器触发 click，避免与下方逻辑重复切换
    if (e.target.closest('.ins-card-toggle, a, .ins-archive-actions')) return;
    e.preventDefault();
    toggleCard(id);
    selectCard(id);
  });
  inner?.addEventListener('change', (e) => {
    if (e.target.id === 'ins-history-round') {
      void loadHistoryRound(e.target.value);
      return;
    }
    if (e.target.id === 'ins-filter-sentiment') {
      applyFilter();
      return;
    }
    const choice = e.target.closest?.('.ins-archive-choice');
    if (!choice) return;
    const id = choice.getAttribute('data-ins-id');
    if (!id) return;
    const selectedValue = choice.checked ? choice.value : null;
    if (selectedValue) {
      state.archiveSelections[id] = selectedValue;
    } else {
      delete state.archiveSelections[id];
    }
    const card = choice.closest('.ins-card');
    if (!card) return;
    card.querySelectorAll('.ins-archive-choice').forEach((el) => {
      if (el !== choice) el.checked = false;
    });
    const prevSelected = state.selectedId;
    rerenderMain();
    applyFilter();
    if (prevSelected && state.items.some((x) => String(x.id) === String(prevSelected))) {
      highlightCard(prevSelected);
    }
  });
  inner?.addEventListener('input', (e) => {
    const ta = e.target.closest?.('.ins-archive-note');
    if (!ta) return;
    const nid = ta.getAttribute('data-ins-id');
    if (!nid) return;
    state.archiveNotes[nid] = ta.value;
  });

  document.getElementById('ins-archive-modal-close')?.addEventListener('click', closeArchiveModal);
  document.getElementById('ins-archive-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'ins-archive-modal') closeArchiveModal();
  });
  document.querySelector('.ins-archive-modal-panel')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const modalRoot = document.getElementById('ins-archive-modal');
    const copyBtn = e.target.closest?.('.ins-copy-btn');
    if (copyBtn && modalRoot?.contains(copyBtn)) {
      const text = copyBtn.getAttribute('data-copy-text');
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        showToast('已复制');
      } catch {
        showToast('复制失败');
      }
      return;
    }
    const summary = e.target.closest?.('.ins-archive-summary-row');
    if (!summary) return;
    const rid = summary.getAttribute('data-archive-id');
    if (!rid) return;
    expandedArchiveRowId = expandedArchiveRowId === rid ? null : rid;
    renderArchiveModalTable();
  });
  document.querySelector('.ins-archive-modal-panel')?.addEventListener('keydown', (e) => {
    const row = e.target.closest?.('.ins-archive-summary-row');
    if (!row || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    const rid = row.getAttribute('data-archive-id');
    if (!rid) return;
    expandedArchiveRowId = expandedArchiveRowId === rid ? null : rid;
    renderArchiveModalTable();
  });
  document.getElementById('ins-archive-modal-tabs')?.addEventListener('click', (e) => {
    const tab = e.target.closest?.('.ins-archive-tab-btn');
    if (!tab) return;
    const category = tab.getAttribute('data-category');
    if (category !== 'responded' && category !== 'notTarget') return;
    archiveModalCategory = category;
    expandedArchiveRowId = null;
    syncArchiveModalTabs();
    renderArchiveModalTable();
  });

  // ── 分析学习痛点 ──

  document.getElementById('ins-btn-pain-analysis')?.addEventListener('click', async () => {
    if (analyzingPain) return;
    const it = getSelectedItem();
    if (!it) {
      showToast('请先选择一条反馈');
      return;
    }
    const quote = it.quote || '';
    if (!quote) {
      showToast('该反馈没有正文内容');
      return;
    }

    analyzingPain = true;
    const btn = document.getElementById('ins-btn-pain-analysis');
    const oldHtml = btn?.innerHTML || '';
    const sendBtn = document.getElementById('ins-chat-send');
    if (btn) {
      btn.innerHTML = '分析中...';
      btn.disabled = true;
    }
    if (sendBtn) sendBtn.disabled = true;

    const labBody = document.getElementById('ins-lab-body');
    const labHeader = document.getElementById('ins-lab-header');
    if (labHeader) labHeader.classList.add('hidden');
    showLabChatArea();

    if (labBody) {
      labBody.innerHTML = renderLabGeneratingPlaceholder('分析中…');
      mountLcIcons(labBody);
    }

    try {
      const res = await fetch('/api/forum-insights/pain-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: it.id, quote })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '请求失败');
      const analysis = data.analysis != null ? String(data.analysis) : '';
      mergePainAnalysisIntoState(it.id, analysis);
      syncLabPanelFromState();
      showToast('痛点分析完成');
    } catch (err) {
      showToast(err.message || '分析失败');
      syncLabPanelFromState();
    } finally {
      analyzingPain = false;
      if (btn) {
        btn.innerHTML = oldHtml || '分析学习痛点';
        btn.disabled = false;
        mountLcIcons(btn);
      }
      if (sendBtn) sendBtn.disabled = !document.getElementById('ins-chat-input')?.value?.trim();
    }
  });

  // Delegate click on copy buttons inside lab body
  document.getElementById('ins-lab-body')?.addEventListener('click', async (e) => {
    const btn = e.target.closest?.('.ins-copy-btn');
    if (!btn) return;
    const text = btn.getAttribute('data-copy-text');
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast('已复制');
    } catch {
      showToast('复制失败');
    }
  });

  // chat history is persisted in state.items[i].aiLab.chatHistory

  /** chatHistory：不含本轮用户句之前的对话记录（与 /api/forum-insights/reply 约定一致） */
  async function refineItem(chatMessage, chatHistory) {
    if (refining) return;
    const it = getSelectedItem();
    if (!it) {
      showToast('请先选择一条反馈');
      return;
    }
    refining = true;
    const sendBtn = document.getElementById('ins-chat-send');
    const painBtn = document.getElementById('ins-btn-pain-analysis');
    const oldPainBtnHtml = painBtn?.innerHTML || '';
    if (sendBtn) sendBtn.disabled = true;
    if (painBtn) painBtn.disabled = true;

    const labBody = document.getElementById('ins-lab-body');
    const labHeader = document.getElementById('ins-lab-header');
    labHeader?.classList.add('hidden');

    try {
      if (labBody) {
        const bubbleHtml = chatMessage ? renderUserBubble(chatMessage) : '';
        const genLabel = chatMessage ? '回复中…' : '生成中…';
        const coreHtml = it.painAnalysis
          ? composeInsightsLabBodyHtml(it)
          : renderLabBody(it?.aiLab, { context: 'standalone' });
        labBody.innerHTML = `${coreHtml}${bubbleHtml}${renderLabGeneratingPlaceholder(genLabel)}`;
        mountLcIcons(labBody);
      }

      const payload = {
        item: {
          id: it.id,
          title: it.title || '',
          source: it.source || '',
          timeAgo: it.timeAgo || '',
          quote: it.quote || ''
        }
      };
      if (chatMessage) {
        payload.chatMessage = chatMessage;
        payload.chatHistory = chatHistory || [];
      }

      const res = await fetch('/api/forum-insights/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '请求失败');
      if (!data.ok) throw new Error(data.error || 'AI 返回异常');
      applyForumReplyPayloadToState(it.id, data, chatMessage, chatHistory);
      showToast('已收到 AI 回复');
    } catch (err) {
      showToast(err.message || 'AI 对话失败');
    } finally {
      refining = false;
      if (painBtn) {
        painBtn.innerHTML = oldPainBtnHtml || '分析学习痛点';
        painBtn.disabled = false;
        mountLcIcons(painBtn);
      }
      if (sendBtn) sendBtn.disabled = !document.getElementById('ins-chat-input')?.value?.trim();
      mountLcIcons(document.body);
      syncLabPanelFromState();
    }
  }

  document.getElementById('ins-chat-send')?.addEventListener('click', async () => {
    const input = document.getElementById('ins-chat-input');
    const msg = input?.value?.trim();
    if (!msg || refining || analyzingPain) return;
    input.value = '';

    const it = getSelectedItem();
    if (!it) return;

    const idx = findItemIndexById(it.id);
    const priorChatHistory = idx >= 0 ? state.items[idx].aiLab?.chatHistory ?? [] : [];
    await refineItem(msg, priorChatHistory);
  });

  document.getElementById('ins-chat-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('ins-chat-send')?.click();
    }
  });

  document.getElementById('ins-chat-input')?.addEventListener('input', (e) => {
    const sendBtn = document.getElementById('ins-chat-send');
    if (sendBtn) sendBtn.disabled = !e.target.value.trim();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeArchiveModal();
  });

  async function handleArchiveSubmit(btn) {
    const id = btn.getAttribute('data-ins-id');
    if (!id) return;
    const category = state.archiveSelections[id];
    if (!category) {
      showToast('请先勾选归档分类');
      return;
    }
    const item = state.items.find((x) => String(x.id) === String(id));
    if (!item) return;

    btn.disabled = true;
    const oldText = btn.textContent;
    btn.textContent = '提交中...';
    try {
      const res = await fetch('/api/forum-insights/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          category,
          archiveNote: String(state.archiveNotes[id] ?? '').trim(),
          item: {
            id: item.id,
            userLabel: item.userLabel,
            source: item.source,
            timeAgo: item.timeAgo,
            quote: item.quote,
            painTag: item.painTag,
            link: item.link,
            title: item.title,
            sentiment: item.sentiment,
            sentimentLabel: item.sentimentLabel,
            aiLab: item.aiLab && typeof item.aiLab === 'object'
              ? {
                draftReply: item.aiLab.draftReply,
                chatHistory: item.aiLab.chatHistory
              }
              : undefined,
            painAnalysis: item.painAnalysis
          }
        })
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || '归档失败');

      if (payload.archivedRecords) {
        state.archivedRecords = {
          responded: Array.isArray(payload.archivedRecords.responded) ? payload.archivedRecords.responded : [],
          notTarget: Array.isArray(payload.archivedRecords.notTarget) ? payload.archivedRecords.notTarget : []
        };
      }
      state.items = state.items.filter((x) => String(x.id) !== String(id));
      state.expandedIds.delete(id);
      delete state.archiveSelections[id];
      delete state.archiveNotes[id];
      if (state.selectedId != null && String(state.selectedId) === String(id)) state.selectedId = state.items[0]?.id || null;
      archiveModalCategory = category;
      rerenderMain();
      syncArchiveModalTabs();
      renderArchiveModalTable();
      showToast(`已归档到「${ARCHIVE_CATEGORY_META[category]?.label || category}」`);
    } catch (err) {
      showToast(err.message || '归档失败');
    } finally {
      btn.disabled = false;
      btn.textContent = oldText || '提交归档';
    }
  }
}

main();
