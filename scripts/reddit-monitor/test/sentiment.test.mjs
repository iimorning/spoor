import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  inferPainTag,
  sentimentFromText,
  sentimentLabel
} from '../lib/sentiment.mjs';

test('inferPainTag maps "switching from Obsidian" to tool switching', () => {
  const tag = inferPainTag('I am switching from Obsidian because the AI plugins keep breaking.');
  assert.equal(tag, 'tool switching');
});

test('inferPainTag maps VRAM talk to performance', () => {
  const tag = inferPainTag('Running out of VRAM on my 8GB card when using GGUF.');
  assert.equal(tag, 'performance');
});

test('inferPainTag defaults to general feedback', () => {
  const tag = inferPainTag('This is a regular update post about my workflow.');
  assert.equal(tag, 'general feedback');
});

test('inferPainTag matches philosophy-flavored text', () => {
  const tag = inferPainTag('Looking for an AI that does socratic dialogue on the canvas.');
  assert.equal(tag, 'thinking workflow');
});

test('sentimentFromText drops for negative words', () => {
  const score = sentimentFromText('I am frustrated and stuck, this is hard and I want to give up.');
  assert.ok(score < 35, `expected < 35, got ${score}`);
});

test('sentimentFromText rises for positive words', () => {
  const score = sentimentFromText('I love this app, it is amazing and the best.');
  assert.ok(score > 60, `expected > 60, got ${score}`);
});

test('sentimentFromText stays within bounds', () => {
  for (const text of ['', 'love love love', 'fail fail fail fail fail fail fail fail fail fail fail']) {
    const score = sentimentFromText(text);
    assert.ok(score >= 8 && score <= 92, `${text} -> ${score}`);
  }
});

test('sentimentLabel returns 偏低 / 中性 / 积极 buckets', () => {
  assert.equal(sentimentLabel(20), '偏低');
  assert.equal(sentimentLabel(50), '中性');
  assert.equal(sentimentLabel(80), '积极');
});
