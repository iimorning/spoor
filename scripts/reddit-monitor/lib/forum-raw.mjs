import fs from 'fs';
import path from 'path';

/**
 * 归一化 Reddit JSON 条目为统一结构：
 *   { id, title, content, link, isoDate, source, author }
 *
 * 旧 JSON（content-factory 的 /api/forum-raw payload）也能直接喂进来，字段缺省时
 * 用空字符串 / 'Reddit' / 当前时间兜底。空 title 且空 content 的条目会被丢弃。
 */
export function normalizeForumRawItems(items, defaultSource = 'reddit') {
  const arr = Array.isArray(items) ? items : [];
  return arr
    .map((it, idx) => ({
      id: String(it?.id || `raw-${idx + 1}`),
      title: String(it?.title || ''),
      content: String(it?.content || ''),
      link: String(it?.link || ''),
      isoDate: String(it?.isoDate || new Date().toISOString()),
      source: String(it?.source || defaultSource),
      author: String(it?.author || '')
    }))
    .filter((it) => (it.content || it.title).trim().length > 0);
}

/**
 * 读取 data/forum-raw.json。文件不存在 / 解析失败时返回空 payload，
 * 调用方应当把空 payload 当作"首次运行"处理。
 */
export function readForumRawPayload(projectRoot) {
  const jsonPath = path.join(projectRoot, 'data', 'forum-raw.json');
  if (!fs.existsSync(jsonPath)) {
    return { fetchedAt: null, source: 'reddit', items: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const defaultSource =
      parsed && parsed.source != null && String(parsed.source).trim()
        ? String(parsed.source)
        : 'reddit';
    const normalized = normalizeForumRawItems(parsed?.items, defaultSource);
    return {
      fetchedAt:
        parsed && parsed.fetchedAt != null && String(parsed.fetchedAt).trim()
          ? String(parsed.fetchedAt)
          : null,
      source: defaultSource,
      items: normalized
    };
  } catch {
    return { fetchedAt: null, source: 'reddit', items: [] };
  }
}

export function loadForumRaw(projectRoot) {
  const payload = readForumRawPayload(projectRoot);
  if (payload.items.length === 0) return null;
  return {
    fetchedAt: payload.fetchedAt || new Date().toISOString(),
    source: payload.source,
    items: payload.items
  };
}

/**
 * 把 fetch 阶段收集到的新条目合并进旧 payload：按 id 去重，按时间倒序，截到
 * MAX_ITEMS。和 content-factory 的 n8n workflow 同款语义，搬过来保证抓取层
 * 和分析层共用同一份规则。
 */
export function mergeForumRaw(oldPayload, newItems, { maxItems = 1500, minTextLen = 20 } = {}) {
  const existingItems = Array.isArray(oldPayload?.items) ? oldPayload.items : [];
  const byId = new Map();

  function textOf(p) {
    const c = String(p?.content ?? '').trim();
    const t = String(p?.title ?? '').trim();
    return (c || t).trim();
  }

  function push(p) {
    const id = String(p?.id ?? '').trim();
    if (!id) return;
    const rawText = textOf(p);
    if (!rawText || rawText.length < minTextLen) return;
    byId.set(id, {
      id,
      title: String(p?.title ?? ''),
      content: String(p?.content ?? ''),
      link: String(p?.link ?? ''),
      isoDate: String(p?.isoDate ?? new Date().toISOString()),
      source: String(p?.source ?? 'Reddit'),
      author: String(p?.author ?? '')
    });
  }

  for (const p of existingItems) push(p);
  for (const p of newItems) push(p);

  let merged = Array.from(byId.values());
  merged.sort((a, b) => {
    const ta = Date.parse(a.isoDate);
    const tb = Date.parse(b.isoDate);
    return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
  });
  if (merged.length > maxItems) merged = merged.slice(0, maxItems);

  return {
    fetchedAt: new Date().toISOString(),
    source: 'reddit',
    items: merged
  };
}

/**
 * 把 raw payload 投影成 UI-friendly insights：
 *   - 截前 24 条（够人眼看，不会塞爆）
 *   - 加 sentiment / painTag / timeAgo / userLabel
 *   - 统计 frictionTags 热度（painTag 频次 top 8）
 *
 * 这一层是纯函数，可重复跑。AI 二次分析由 applyAiAnalysis 接管（未来扩展位）。
 */
import { inferPainTag, sentimentFromText, sentimentLabel } from './sentiment.mjs';

function toTimeAgo(isoDate) {
  const ts = Date.parse(String(isoDate || ''));
  if (!Number.isFinite(ts)) return '刚刚';
  const diffMin = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  if (diffMin < 60) return `${diffMin || 1} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  return `${Math.floor(diffHour / 24)} 天前`;
}

export function buildInsightsFromRaw(raw) {
  const srcItems = Array.isArray(raw?.items) ? raw.items : [];
  const items = srcItems.slice(0, 24).map((it, idx) => {
    const text = `${it.title || ''}\n${it.content || ''}`.trim();
    const score = sentimentFromText(text);
    const painTag = inferPainTag(text);
    const author = String(it.author || '').replace(/^\/?u\//i, '');
    return {
      id: String(it.id || `raw-${idx + 1}`),
      title: String(it.title || ''),
      userLabel: author ? `u/${author}` : `用户 #${String(idx + 1).padStart(4, '0')}`,
      source: it.source || 'Reddit',
      timeAgo: toTimeAgo(it.isoDate),
      sentiment: score,
      sentimentLabel: sentimentLabel(score),
      quote: String(it.content || it.title || ''),
      painTag,
      link: it.link || '',
      aiLab: null
    };
  });

  const tagCount = new Map();
  items.forEach((it) => tagCount.set(it.painTag, (tagCount.get(it.painTag) || 0) + 1));
  const frictionTags = [...tagCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([tag]) => tag);

  if (items[0]) items[0].selected = true;

  return {
    meta: {
      title: 'Spoor 论坛痛点雷达',
      subtitle: '本地 fetch · Reddit 多版块',
      lastSyncNote: raw?.fetchedAt || new Date().toISOString(),
      n8nConnected: false
    },
    frictionTags,
    items
  };
}

/**
 * 把 AI 分析层（未来接 Doubao / OpenAI）的结果合并回 base insights。
 * 当前 fetch.mjs 不调用，留作扩展位。
 */
export function applyAiAnalysis(baseInsights, aiResult) {
  const out = structuredClone(baseInsights);
  if (Array.isArray(aiResult?.frictionTags) && aiResult.frictionTags.length > 0) {
    out.frictionTags = aiResult.frictionTags.slice(0, 8).map((x) => String(x));
  }
  const byId = new Map((aiResult?.items || []).map((x) => [String(x.id), x]));
  out.items = out.items.map((it) => {
    const ai = byId.get(String(it.id));
    if (!ai) return it;
    return {
      ...it,
      sentiment: Number.isFinite(Number(ai.sentiment)) ? Number(ai.sentiment) : it.sentiment,
      sentimentLabel: ai.sentimentLabel ? String(ai.sentimentLabel) : it.sentimentLabel,
      painTag: ai.painTag ? String(ai.painTag) : it.painTag,
      aiLab: ai.aiLab?.draftReply
        ? { draftReply: String(ai.aiLab.draftReply) }
        : null
    };
  });
  return out;
}
