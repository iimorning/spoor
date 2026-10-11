import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applyForumState,
  archiveForumItem,
  readForumState,
  saveForumReply,
  savePainAnalysis
} from '../lib/forum-state.mjs';

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spoor-forum-state-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('forum state persists pain analysis and AI conversation', (t) => {
  const root = tempRoot(t);
  savePainAnalysis(root, 'post-1', '核心痛点');
  saveForumReply(root, 'post-1', {
    draftReply: '回复草稿',
    chatHistory: [{ role: 'user', content: '请更简短' }]
  });

  const state = readForumState(root);
  assert.equal(state.items['post-1'].painAnalysis, '核心痛点');
  assert.equal(state.items['post-1'].aiLab.draftReply, '回复草稿');
  assert.equal(state.items['post-1'].aiLab.chatHistory.length, 1);
});

test('applyForumState merges enrichment and removes archived items', (t) => {
  const root = tempRoot(t);
  savePainAnalysis(root, 'keep', '分析结果');
  const state = archiveForumItem(root, {
    id: 'remove',
    category: 'responded',
    archiveNote: '已回复',
    item: { id: 'remove', quote: '原文' }
  });
  const applied = applyForumState({
    items: [{ id: 'keep' }, { id: 'remove' }]
  }, state);

  assert.deepEqual(applied.items.map((item) => item.id), ['keep']);
  assert.equal(applied.items[0].painAnalysis, '分析结果');
  assert.equal(applied.archivedRecords.responded[0].archiveNote, '已回复');
});

test('archiving the same id moves it between categories without duplicates', (t) => {
  const root = tempRoot(t);
  archiveForumItem(root, { id: 'post-1', category: 'responded', item: { id: 'post-1' } });
  const state = archiveForumItem(root, {
    id: 'post-1',
    category: 'notTarget',
    item: { id: 'post-1' }
  });

  assert.equal(state.archivedRecords.responded.length, 0);
  assert.equal(state.archivedRecords.notTarget.length, 1);
});
