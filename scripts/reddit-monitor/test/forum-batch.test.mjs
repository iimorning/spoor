import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  collectFreshBatch,
  parseRedditAtom,
  readSeenPostIds,
  takeFreshItems
} from '../lib/forum-batch.mjs';

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spoor-forum-batch-'));
  fs.mkdirSync(path.join(root, 'data', 'history'), { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('parseRedditAtom maps and filters note-taking pain entries', () => {
  const xml = `<feed>
    <entry>
      <id>t3_new</id>
      <title>Obsidian sync is broken</title>
      <content><![CDATA[My notes keep losing sync and I am frustrated.]]></content>
      <link rel="alternate" href="https://www.reddit.com/r/ObsidianMD/comments/new/post/" />
      <author><name>reader</name></author>
      <published>2026-08-24T00:00:00Z</published>
    </entry>
    <entry>
      <id>t3_irrelevant</id>
      <title>A pleasant unrelated day</title>
      <content>No note-taking problem here.</content>
    </entry>
  </feed>`;
  const parsed = parseRedditAtom(xml);
  assert.equal(parsed.entryCount, 2);
  assert.equal(parsed.lastCursor, 't3_irrelevant');
  assert.deepEqual(parsed.items.map((item) => item.id), ['reddit_t3_new']);
  assert.equal(parsed.items[0].author, 'reader');
});

test('readSeenPostIds combines every historical round and the cache', (t) => {
  const root = tempRoot(t);
  fs.writeFileSync(
    path.join(root, 'data', 'history', 'one.raw.json'),
    JSON.stringify({ items: [{ id: 'old-1' }, { id: 'old-2' }] })
  );
  fs.writeFileSync(
    path.join(root, 'data', 'seen-post-ids.json'),
    JSON.stringify({ ids: ['cached-1'] })
  );
  assert.deepEqual(
    [...readSeenPostIds(root)].sort(),
    ['cached-1', 'old-1', 'old-2']
  );
});

test('takeFreshItems removes historical and within-batch duplicates', () => {
  const result = takeFreshItems(
    [{ id: 'old' }, { id: 'new-1' }, { id: 'new-1' }, { id: 'new-2' }],
    new Set(['old']),
    13
  );
  assert.deepEqual(result.items.map((item) => item.id), ['new-1', 'new-2']);
  assert.equal(result.duplicateCount, 2);
});

test('collectFreshBatch keeps fetching until the target contains only new ids', async (t) => {
  const root = tempRoot(t);
  fs.writeFileSync(
    path.join(root, 'data', 'history', 'previous.raw.json'),
    JSON.stringify({ items: [{ id: 'old-1' }, { id: 'old-2' }] })
  );
  const pages = [
    {
      items: [{ id: 'old-2' }, { id: 'new-2' }],
      lastCursor: 'cursor-1',
      entryCount: 2
    },
    {
      items: [{ id: 'new-3' }, { id: 'new-4' }],
      lastCursor: 'cursor-2',
      entryCount: 2
    }
  ];
  let calls = 0;
  const result = await collectFreshBatch(root, [
    { id: 'old-1' },
    { id: 'new-1' }
  ], {
    targetCount: 4,
    pageDelayMs: 0,
    fetchPage: async () => pages[calls++]
  });

  assert.deepEqual(
    result.items.map((item) => item.id),
    ['new-1', 'new-2', 'new-3', 'new-4']
  );
  assert.equal(result.stats.actualCount, 4);
  assert.equal(result.stats.shortfall, 0);
  assert.equal(result.stats.pagesFetched, 2);
});
