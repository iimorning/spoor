export type WorkspaceSyncTable =
  | 'canvases'
  | 'nodes'
  | 'edges'
  | 'articles'
  | 'agents'
  | 'agent_sandbox_threads'
  | 'archived_cards'
  | 'archive_folders'
  | 'canvas_folders'
  | 'canvas_work_zones'
  | 'canvas_persona_threads';

export type PendingCloudDelete = {
  table: WorkspaceSyncTable;
  id: string;
};

const PREFIX = 'spoor_pending_cloud_deletes:';
const RESTORE_PREFIX = 'spoor_pending_cloud_restores:';
const KNOWN_TOMBSTONE_PREFIX = 'spoor_known_cloud_tombstones:';

function key(prefix: string, userId: string): string {
  return `${prefix}${userId}`;
}

function readRows(prefix: string, userId: string): PendingCloudDelete[] {
  if (!userId || typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(key(prefix, userId)) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (row): row is PendingCloudDelete =>
        Boolean(
          row &&
            typeof row === 'object' &&
            typeof (row as PendingCloudDelete).table === 'string' &&
            typeof (row as PendingCloudDelete).id === 'string',
        ),
    );
  } catch {
    return [];
  }
}

function write(prefix: string, userId: string, rows: PendingCloudDelete[]): void {
  if (!userId || typeof localStorage === 'undefined') return;
  try {
    if (rows.length === 0) localStorage.removeItem(key(prefix, userId));
    else localStorage.setItem(key(prefix, userId), JSON.stringify(rows));
  } catch {
    /* private mode / quota */
  }
}

export function readPendingCloudDeletes(userId: string): PendingCloudDelete[] {
  return readRows(PREFIX, userId);
}

export function readPendingCloudRestores(userId: string): PendingCloudDelete[] {
  return readRows(RESTORE_PREFIX, userId);
}

export function readKnownCloudTombstones(userId: string): PendingCloudDelete[] {
  return readRows(KNOWN_TOMBSTONE_PREFIX, userId);
}

export function queuePendingCloudDelete(
  userId: string,
  table: WorkspaceSyncTable,
  id: string,
): void {
  const normalizedId = String(id);
  const rows = readPendingCloudDeletes(userId);
  if (rows.some((row) => row.table === table && row.id === normalizedId)) return;
  write(PREFIX, userId, [...rows, { table, id: normalizedId }]);
  cancelPendingCloudRestore(userId, table, normalizedId);
}

export function cancelPendingCloudDelete(
  userId: string,
  table: WorkspaceSyncTable,
  id: string,
): void {
  const normalizedId = String(id);
  write(
    PREFIX,
    userId,
    readPendingCloudDeletes(userId).filter(
      (row) => row.table !== table || row.id !== normalizedId,
    ),
  );
}

export function clearPendingCloudDeletes(
  userId: string,
  completed: PendingCloudDelete[],
): void {
  const done = new Set(completed.map((row) => `${row.table}\0${row.id}`));
  write(
    PREFIX,
    userId,
    readPendingCloudDeletes(userId).filter(
      (row) => !done.has(`${row.table}\0${row.id}`),
    ),
  );
}

export function queuePendingCloudRestore(
  userId: string,
  table: WorkspaceSyncTable,
  id: string,
): void {
  const normalizedId = String(id);
  const rows = readPendingCloudRestores(userId);
  if (rows.some((row) => row.table === table && row.id === normalizedId)) return;
  write(RESTORE_PREFIX, userId, [...rows, { table, id: normalizedId }]);
  cancelPendingCloudDelete(userId, table, normalizedId);
}

export function cancelPendingCloudRestore(
  userId: string,
  table: WorkspaceSyncTable,
  id: string,
): void {
  const normalizedId = String(id);
  write(
    RESTORE_PREFIX,
    userId,
    readPendingCloudRestores(userId).filter(
      (row) => row.table !== table || row.id !== normalizedId,
    ),
  );
}

export function clearPendingCloudRestores(
  userId: string,
  completed: PendingCloudDelete[],
): void {
  const done = new Set(completed.map((row) => `${row.table}\0${row.id}`));
  write(
    RESTORE_PREFIX,
    userId,
    readPendingCloudRestores(userId).filter(
      (row) => !done.has(`${row.table}\0${row.id}`),
    ),
  );
}

export function markKnownCloudTombstones(
  userId: string,
  tombstones: PendingCloudDelete[],
): void {
  const rows = readKnownCloudTombstones(userId);
  const seen = new Set(rows.map((row) => `${row.table}\0${row.id}`));
  for (const row of tombstones) {
    const id = String(row.id);
    const token = `${row.table}\0${id}`;
    if (!seen.has(token)) {
      rows.push({ table: row.table, id });
      seen.add(token);
    }
  }
  write(KNOWN_TOMBSTONE_PREFIX, userId, rows);
}

export function forgetKnownCloudTombstones(
  userId: string,
  restored: PendingCloudDelete[],
): void {
  const done = new Set(restored.map((row) => `${row.table}\0${row.id}`));
  write(
    KNOWN_TOMBSTONE_PREFIX,
    userId,
    readKnownCloudTombstones(userId).filter(
      (row) => !done.has(`${row.table}\0${row.id}`),
    ),
  );
}

export function isKnownCloudTombstone(
  userId: string,
  table: WorkspaceSyncTable,
  id: string,
): boolean {
  const normalizedId = String(id);
  return readKnownCloudTombstones(userId).some(
    (row) => row.table === table && row.id === normalizedId,
  );
}

export function resetPendingCloudStateForTests(): void {
  if (typeof localStorage === 'undefined') return;
  const prefixes = [PREFIX, RESTORE_PREFIX, KNOWN_TOMBSTONE_PREFIX];
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const itemKey = localStorage.key(i);
    if (itemKey && prefixes.some((prefix) => itemKey.startsWith(prefix))) keys.push(itemKey);
  }
  for (const itemKey of keys) localStorage.removeItem(itemKey);
}
