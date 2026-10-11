import fs from 'node:fs';
import path from 'node:path';

const EMPTY_ARCHIVE = { responded: [], notTarget: [] };

function statePath(projectRoot) {
  return path.join(projectRoot, 'data', 'forum-state.json');
}

function normalizeState(parsed) {
  return {
    version: 1,
    updatedAt: parsed?.updatedAt || null,
    items: parsed?.items && typeof parsed.items === 'object' ? parsed.items : {},
    archivedRecords: {
      responded: Array.isArray(parsed?.archivedRecords?.responded)
        ? parsed.archivedRecords.responded
        : [],
      notTarget: Array.isArray(parsed?.archivedRecords?.notTarget)
        ? parsed.archivedRecords.notTarget
        : []
    }
  };
}

export function readForumState(projectRoot) {
  const target = statePath(projectRoot);
  if (!fs.existsSync(target)) return normalizeState(null);
  try {
    return normalizeState(JSON.parse(fs.readFileSync(target, 'utf8')));
  } catch {
    return normalizeState(null);
  }
}

export function writeForumState(projectRoot, state) {
  const target = statePath(projectRoot);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const normalized = normalizeState({
    ...state,
    updatedAt: new Date().toISOString()
  });
  fs.writeFileSync(target, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return normalized;
}

export function applyForumState(baseInsights, state) {
  const normalized = normalizeState(state);
  const archivedIds = new Set(
    [...normalized.archivedRecords.responded, ...normalized.archivedRecords.notTarget]
      .map((record) => String(record?.id || record?.item?.id || ''))
      .filter(Boolean)
  );
  return {
    ...baseInsights,
    archivedRecords: normalized.archivedRecords || EMPTY_ARCHIVE,
    items: (baseInsights?.items || [])
      .filter((item) => !archivedIds.has(String(item.id)))
      .map((item) => {
        const saved = normalized.items[String(item.id)];
        return saved ? { ...item, ...saved, aiLab: saved.aiLab || item.aiLab } : item;
      })
  };
}

export function savePainAnalysis(projectRoot, id, analysis) {
  const state = readForumState(projectRoot);
  const key = String(id);
  state.items[key] = {
    ...(state.items[key] || {}),
    painAnalysis: String(analysis || '')
  };
  return writeForumState(projectRoot, state);
}

export function saveForumReply(projectRoot, id, { draftReply, chatHistory }) {
  const state = readForumState(projectRoot);
  const key = String(id);
  const previous = state.items[key] || {};
  state.items[key] = {
    ...previous,
    aiLab: {
      ...(previous.aiLab || {}),
      ...(draftReply ? { draftReply: String(draftReply) } : {}),
      chatHistory: Array.isArray(chatHistory) ? chatHistory : previous.aiLab?.chatHistory || []
    }
  };
  return writeForumState(projectRoot, state);
}

export function archiveForumItem(projectRoot, { id, category, archiveNote, item }) {
  if (category !== 'responded' && category !== 'notTarget') {
    const error = new Error('无效归档分类');
    error.statusCode = 400;
    throw error;
  }
  const state = readForumState(projectRoot);
  const key = String(id || item?.id || '');
  if (!key) {
    const error = new Error('归档条目缺少 id');
    error.statusCode = 400;
    throw error;
  }

  state.archivedRecords.responded = state.archivedRecords.responded.filter(
    (record) => String(record?.id || record?.item?.id || '') !== key
  );
  state.archivedRecords.notTarget = state.archivedRecords.notTarget.filter(
    (record) => String(record?.id || record?.item?.id || '') !== key
  );
  state.archivedRecords[category].unshift({
    id: key,
    category,
    archiveNote: String(archiveNote || ''),
    archivedAt: new Date().toISOString(),
    item: item && typeof item === 'object' ? item : { id: key }
  });
  return writeForumState(projectRoot, state);
}
