/**
 * 数据分析页右侧「AI 草稿 / 痛点 / 对话」相关纯函数（无 DOM、可在 Node 中测试）。
 * 正文块级 Markdown 复用 chat-markdown（**粗体**、有序列表、标题等）。
 */

import { renderAssistantMarkdown } from './chat-markdown.mjs';

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeHtmlAttr(s) {
  return escapeHtml(String(s)).replace(/\n/g, '&#10;');
}

/** 是否存在已保存的 AI 草稿或可继续的对话记录（决定是否显示右侧「继续对话」） */
export function itemHasAiLabChat(it) {
  const lab = it?.aiLab;
  if (!lab) return false;
  if (lab.draftReply != null && String(lab.draftReply).trim() !== '') return true;
  return Array.isArray(lab.chatHistory) && lab.chatHistory.length > 0;
}

/** 论坛 /reply 接口 `done` 载荷中抽取草稿正文（兼容 `aiLab.draftReply` 或顶层别名） */
export function draftReplyFromForumParsed(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const raw = parsed.aiLab?.draftReply ?? parsed.draftReply ?? parsed.reply;
  const str = raw != null ? String(raw).trim() : '';
  return str || null;
}

export function renderPrimaryTextBlock(text, compactBottom = false) {
  const raw = String(text ?? '');
  const mbClass = compactBottom ? 'mb-0' : 'mb-4';
  let md;
  try {
    md = renderAssistantMarkdown(raw);
  } catch {
    md = escapeHtml(raw).replace(/\n/g, '<br/>');
  }
  const copyAttr = escapeHtmlAttr(raw);
  return `<div class="${mbClass} flex flex-col gap-2 rounded-r-lg border-l-4 border-primary bg-primary/5 p-4 pb-3 text-sm leading-relaxed text-stone-700">
    <div class="chat-md-scope text-sm leading-relaxed">${md}</div>
    <div class="flex justify-end pt-1">
      <button type="button" class="ins-copy-btn inline-flex shrink-0 items-center gap-1 rounded-md border border-stone-200/90 bg-white px-2 py-1 text-[10px] font-semibold text-stone-600 shadow-sm transition-colors hover:bg-primary/5 hover:text-primary" data-copy-text="${copyAttr}">
        <span class="inline-flex shrink-0" data-lc-icon="copy"></span>
        复制
      </button>
    </div>
  </div>`;
}

export function renderPainAnalysisSection(painAnalysis) {
  const t = String(painAnalysis ?? '').trim();
  if (!t) return '';
  return `<div class="mb-6 space-y-3 border-b border-stone-100 pb-6">
    <p class="text-[10px] font-bold uppercase tracking-wider text-stone-400">学习痛点分析</p>
    ${renderPrimaryTextBlock(t, true)}
  </div>
  <p class="mb-3 text-[10px] font-bold uppercase tracking-wider text-stone-400">继续对话</p>`;
}

/**
 * @param {object} [opts]
 * @param {'standalone'|'underPain'} [opts.context] standalone：无正文时的全屏占位；underPain：在痛点下方的轻提示（不遮挡已有对话气泡）
 */
export function renderLabBody(lab, { context = 'standalone' } = {}) {
  const draft = lab?.draftReply != null ? String(lab.draftReply).trim() : '';
  const chatHistory = Array.isArray(lab?.chatHistory) ? lab.chatHistory : [];

  const parts = [];
  if (draft) {
    parts.push(renderPrimaryTextBlock(draft));
  }

  for (const msg of chatHistory) {
    if (msg.role === 'user') {
      parts.push(`<div class="mb-3 flex justify-end">
        <div class="max-w-[85%] rounded-2xl rounded-br-sm bg-primary/10 px-4 py-2.5 text-sm text-on-background">
          ${escapeHtml(msg.content)}
        </div>
      </div>`);
    } else if (msg.role === 'assistant') {
      const rawA = String(msg.content || '');
      const mdA = renderAssistantMarkdown(rawA);
      const copyAttrA = escapeHtmlAttr(rawA);
      parts.push(`<div class="mb-3 flex justify-start">
        <div class="flex max-w-[85%] flex-col gap-2 rounded-2xl rounded-bl-sm border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700">
          <div class="chat-md-scope">${mdA}</div>
          <div class="flex justify-end">
            <button type="button" class="ins-copy-btn inline-flex shrink-0 items-center gap-1 rounded-md border border-stone-200/90 bg-stone-50 px-2 py-1 text-[10px] font-semibold text-stone-600 transition-colors hover:bg-primary/5 hover:text-primary" data-copy-text="${copyAttrA}">
              <span class="inline-flex shrink-0" data-lc-icon="copy"></span>
              复制
            </button>
          </div>
        </div>
      </div>`);
    }
  }

  if (parts.length === 0) {
    if (context === 'underPain') {
      return '<p class="py-2 text-xs text-stone-400">暂无对话记录。在下方输入后发送即可与 AI 继续交流。</p>';
    }
    return '<div class="flex min-h-[5rem] items-center justify-center px-2"><p class="text-center text-stone-400">请先「分析学习痛点」，或在下方与 AI 继续对话。</p></div>';
  }

  return parts.join('\n');
}

/**
 * 与 updateLabPanel 中非流式状态下的 #ins-lab-body 拼接规则一致（供测试）。
 * @param {object} [params]
 * @param {boolean} params.painPlusLabWhenEligible   若为 true：有痛点且 itemHasAiLabChat 时使用组合区块
 */
export function composeInsightsLabBodyHtml(it, { painPlusLabWhenEligible = true } = {}) {
  if (!it?.painAnalysis) {
    return renderLabBody(it?.aiLab, { context: 'standalone' });
  }
  if (painPlusLabWhenEligible && itemHasAiLabChat(it)) {
    return renderPainAnalysisSection(it.painAnalysis) +
      renderLabBody(it.aiLab, { context: 'underPain' });
  }
  return renderPrimaryTextBlock(it.painAnalysis);
}
