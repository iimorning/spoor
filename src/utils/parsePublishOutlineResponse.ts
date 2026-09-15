import { parseLenientLlmJson } from './llmJson';
import { stripThinking } from './stripThinking';

export interface PublishOutlineSection {
  /** 对齐来源卡片；用户新增的条目可为空字符串 */
  cardId: string;
  /** 该段小标题 */
  heading: string;
  /** 该段要写什么（一两句） */
  summary: string;
}

export interface PublishOutline {
  title: string;
  sections: PublishOutlineSection[];
}

/** 从模型输出解析大纲；只接受 JSON。非 JSON 返回 null（不要按行拆成假段落）。请用 resolvePublishOutline 兜底。 */
export function parsePublishOutlineResponse(raw: string, fallbackTitle: string): PublishOutline | null {
  const trimmed = stripThinking((raw ?? '').trim());
  if (!trimmed) return null;

  try {
    const data = parseLenientLlmJson(trimmed) as {
      title?: unknown;
      sections?: unknown;
    };
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const title = typeof data.title === 'string' ? data.title.trim() : '';
      const sectionsRaw = Array.isArray(data.sections) ? data.sections : null;
      if (sectionsRaw) {
        const sections: PublishOutlineSection[] = [];
        for (const seg of sectionsRaw) {
          if (!seg || typeof seg !== 'object' || Array.isArray(seg)) continue;
          const s = seg as { cardId?: unknown; heading?: unknown; summary?: unknown };
          const cardId = typeof s.cardId === 'string' ? s.cardId.trim() : '';
          const heading = typeof s.heading === 'string' ? s.heading.trim() : '';
          const summary = typeof s.summary === 'string' ? s.summary.trim() : '';
          sections.push({ cardId, heading, summary });
        }
        if (sections.length > 0) {
          return { title: title || fallbackTitle, sections };
        }
      }
    }
  } catch {
    /* not JSON */
  }

  return null;
}

/** Selection / pile order when the model does not return usable JSON. */
export function outlineFromCardIds(title: string, cardIds: string[]): PublishOutline {
  const ids = [...new Set(cardIds.map((id) => (id || '').trim()).filter(Boolean))];
  return {
    title: (title || '').trim(),
    sections: ids.map((cardId) => ({ cardId, heading: '', summary: '' })),
  };
}

/**
 * Keep the model's order for cards it named. Missing selected cards are
 * inserted before the next later-in-selection card already in the list (not
 * dumped at the end). Unknown ids are removed. Empty slots stay.
 */
export function mergeOutlineWithSourceCards(
  outline: PublishOutline,
  sourceCardIds: string[],
): PublishOutline {
  const known = [...new Set(sourceCardIds.map((id) => (id || '').trim()).filter(Boolean))];
  const rank = new Map(known.map((id, i) => [id, i]));
  const seen = new Set<string>();
  const sections: PublishOutlineSection[] = [];
  for (const s of outline.sections) {
    const id = (s.cardId || '').trim();
    if (!id) {
      sections.push({ cardId: '', heading: s.heading, summary: '' });
      continue;
    }
    if (!rank.has(id) || seen.has(id)) continue;
    seen.add(id);
    sections.push({ cardId: id, heading: '', summary: '' });
  }
  for (const id of known) {
    if (seen.has(id)) continue;
    const r = rank.get(id)!;
    const insertAt = sections.findIndex((s) => {
      if (!s.cardId) return false;
      const other = rank.get(s.cardId);
      return other != null && other > r;
    });
    const row: PublishOutlineSection = { cardId: id, heading: '', summary: '' };
    if (insertAt >= 0) sections.splice(insertAt, 0, row);
    else sections.push(row);
    seen.add(id);
  }
  return { title: outline.title, sections };
}

/**
 * JSON-only parse returns null on junk (thinking / markdown). Call this so a
 * forgotten null check cannot drop the user's cards — never split non-JSON
 * into fake heading rows.
 */
export function resolvePublishOutline(
  parsed: PublishOutline | null,
  fallbackTitle: string,
  sourceCardIds: string[],
): PublishOutline {
  const title = ((parsed?.title || fallbackTitle) || '').trim();
  if (parsed && parsed.sections.length > 0) {
    return mergeOutlineWithSourceCards(
      { ...parsed, title: parsed.title.trim() || title },
      sourceCardIds,
    );
  }
  return outlineFromCardIds(title, sourceCardIds);
}

/**
 * Drop AI paraphrases: keep card order + title. Heading is only kept for empty
 * slots the user added (no cardId).
 */
export function asCardOrderOutline(outline: PublishOutline): PublishOutline {
  return {
    title: outline.title,
    sections: outline.sections.map((s) => ({
      cardId: s.cardId,
      heading: s.cardId ? '' : s.heading,
      summary: '',
    })),
  };
}

/** 把大纲序列化成给 AI 看的紧凑文本（带 cardId 标注，便于修订时保持对齐） */
export function serializeOutlineForPrompt(outline: PublishOutline): string {
  const head = `# ${outline.title}`;
  const body = outline.sections
    .map((s, i) => {
      const card = s.cardId ? `【cardId:${s.cardId}】` : '';
      const label = s.cardId ? s.cardId : (s.heading || '(slot)');
      return `${card}${i + 1}. ${label}`;
    })
    .join('\n');
  return `${head}\n${body}`;
}

/** User-requested restore to canvas selection / pile order. AI order stays until this. */
export function orderOutlineSectionsByCardIds(
  outline: PublishOutline,
  cardIds: string[],
): PublishOutline {
  const rank = new Map(cardIds.map((id, i) => [id, i]));
  const sections = outline.sections.slice().sort((a, b) => {
    const ia = a.cardId && rank.has(a.cardId) ? rank.get(a.cardId)! : Number.MAX_SAFE_INTEGER;
    const ib = b.cardId && rank.has(b.cardId) ? rank.get(b.cardId)! : Number.MAX_SAFE_INTEGER;
    return ia - ib;
  });
  return { ...outline, sections };
}
