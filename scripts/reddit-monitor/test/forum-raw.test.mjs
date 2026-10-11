import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeForumRawItems,
  mergeForumRaw,
  buildInsightsFromRaw
} from '../lib/forum-raw.mjs';

test('normalizeForumRawItems drops empty rows', () => {
  const out = normalizeForumRawItems([
    { id: 'a', title: 'real title', content: '', source: 'Reddit' },
    { id: 'b', title: '', content: 'real content' },
    { id: 'c', title: '', content: '' }, // dropped
    { id: 'd', title: 'real', content: 'real' }
  ]);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((x) => x.id), ['a', 'b', 'd']);
});

test('normalizeForumRawItems fills defaults', () => {
  const out = normalizeForumRawItems([{ id: 'x', title: 'placeholder with enough text to survive' }]);
  assert.equal(out[0].id, 'x');
  assert.equal(out[0].title, 'placeholder with enough text to survive');
  assert.equal(out[0].content, '');
  assert.equal(out[0].source, 'reddit');
  assert.equal(out[0].author, '');
});

test('mergeForumRaw dedupes by id and keeps the newer row', () => {
  const oldPayload = {
    fetchedAt: '2026-08-01T00:00:00.000Z',
    source: 'reddit',
    items: [
      { id: 'r1', title: 'old entry', content: 'old body content that is long enough', isoDate: '2026-07-01T00:00:00.000Z' },
      { id: 'r2', title: 'keep entry', content: 'keep body content that is long enough', isoDate: '2026-07-15T00:00:00.000Z' }
    ]
  };
  const newItems = [
    { id: 'r1', title: 'updated entry', content: 'updated body content that is long enough', isoDate: '2026-08-20T00:00:00.000Z' },
    { id: 'r3', title: 'brand new entry', content: 'fresh body content that is long enough', isoDate: '2026-08-22T00:00:00.000Z' }
  ];
  const merged = mergeForumRaw(oldPayload, newItems);
  assert.equal(merged.items.length, 3);
  const r1 = merged.items.find((x) => x.id === 'r1');
  assert.equal(r1.title, 'updated entry');
  // sorted desc
  assert.equal(merged.items[0].id, 'r3');
});

test('mergeForumRaw drops short rows', () => {
  const merged = mergeForumRaw({ items: [] }, [
    { id: 'a', title: 'short', content: 'tiny' } // < 20 chars combined
  ]);
  assert.equal(merged.items.length, 0);
});

test('mergeForumRaw caps at MAX_ITEMS', () => {
  const big = Array.from({ length: 100 }, (_, i) => ({
    id: `r${i}`,
    title: `title-${i}`,
    content: 'x'.repeat(40),
    isoDate: new Date(2026, 0, 1, 0, i).toISOString()
  }));
  const merged = mergeForumRaw({ items: [] }, big, { maxItems: 10 });
  assert.equal(merged.items.length, 10);
});

test('buildInsightsFromRaw projects top 24 + frictionTags', () => {
  const raw = {
    fetchedAt: '2026-08-23T12:00:00.000Z',
    items: Array.from({ length: 30 }, (_, i) => ({
      id: `r${i}`,
      title: `Looking for alternative ${i}`,
      content: 'switching from obsidian to a new AI canvas tool, frustrated and stuck',
      isoDate: new Date(2026, 0, 1, 0, i).toISOString(),
      author: i === 0 ? '/u/u0' : `u${i}`
    }))
  };
  const insights = buildInsightsFromRaw(raw);
  assert.equal(insights.items.length, 24);
  assert.equal(insights.items[0].userLabel, 'u/u0');
  assert.equal(insights.frictionTags[0], 'tool switching');
  assert.ok(insights.items[0].selected === true);
  assert.equal(insights.meta.title, 'Spoor 论坛痛点雷达');
});
