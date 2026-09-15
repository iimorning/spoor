import { describe, it, expect } from 'vitest';
import {
  expandMarkdownSlice,
  normalizeExtractedPassage,
  sliceSourceMarkdownFromSelection,
} from '../../src/utils/sliceSourceMarkdownFromSelection';

const TABLE = [
  '| 阶段 | 核心动作 | 科技教育专属要求 |',
  '| --- | --- | --- |',
  '| 1. 前期准备 | 明确FDE目的 | 必须配备懂教培监管的法务 |',
  '| 2. 尽调执行 | 访谈与材料 | 核对办学许可 |',
].join('\n');

describe('sliceSourceMarkdownFromSelection', () => {
  it('maps rendered table cell text back to GFM pipes and separator row', () => {
    const visible = '阶段 核心动作 科技教育专属要求 1. 前期准备 明确FDE目的 必须配备懂教培监管的法务 2. 尽调执行 访谈与材料 核对办学许可';
    expect(sliceSourceMarkdownFromSelection(TABLE, visible)).toBe(TABLE);
  });

  it('expands a mid-table selection to the whole table block', () => {
    const visible = '1. 前期准备 明确FDE目的';
    expect(sliceSourceMarkdownFromSelection(TABLE, visible)).toBe(TABLE);
  });

  it('keeps a heading together with a following table when both are selected', () => {
    const source = `## 一、FDE实施全流程\n\n${TABLE}`;
    const visible = '一、FDE实施全流程 阶段 核心动作 科技教育专属要求 1. 前期准备';
    const sliced = sliceSourceMarkdownFromSelection(source, visible);
    expect(sliced).toContain('## 一、FDE实施全流程');
    expect(sliced).toContain('| 阶段 | 核心动作 | 科技教育专属要求 |');
    expect(sliced).toContain('| --- | --- | --- |');
  });

  it('returns null when the visible text is not in the source', () => {
    expect(sliceSourceMarkdownFromSelection(TABLE, '完全不相干的句子')).toBeNull();
  });
});

describe('expandMarkdownSlice', () => {
  it('grows to full lines', () => {
    const src = 'hello\nworld\n';
    expect(expandMarkdownSlice(src, 1, 4)).toBe('hello');
  });
});

describe('normalizeExtractedPassage', () => {
  it('preserves markdown tables instead of flattening whitespace', () => {
    expect(normalizeExtractedPassage(`  ${TABLE}\n`)).toBe(TABLE);
  });

  it('still flattens plain prose', () => {
    expect(normalizeExtractedPassage('  hello   world  ')).toBe('hello world');
  });
});
