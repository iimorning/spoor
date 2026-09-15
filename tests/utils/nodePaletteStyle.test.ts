import { describe, it, expect } from 'vitest';
import {
  applyPalettePatchToAppliers,
  paletteTargetIds,
} from '../../src/utils/nodePaletteStyle';

describe('paletteTargetIds', () => {
  it('单卡或未圈选时只返回当前卡片', () => {
    expect(paletteTargetIds('a', new Set())).toEqual(['a']);
    expect(paletteTargetIds('a', new Set(['a']))).toEqual(['a']);
    expect(paletteTargetIds('a', new Set(['b', 'c']))).toEqual(['a']);
  });

  it('圈选多卡且当前卡在选区里时返回全部选中 id', () => {
    expect(paletteTargetIds('b', new Set(['a', 'b', 'c'])).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('applyPalettePatchToAppliers', () => {
  it('对每个目标 id 调用已注册的 applier', () => {
    const seen: string[] = [];
    const appliers = new Map([
      ['a', (patch: { bg?: string }) => seen.push(`a:${patch.bg}`)],
      ['b', (patch: { bg?: string }) => seen.push(`b:${patch.bg}`)],
    ]);
    applyPalettePatchToAppliers(['a', 'b', 'missing'], appliers, { bg: '#fff' });
    expect(seen).toEqual(['a:#fff', 'b:#fff']);
  });
});
