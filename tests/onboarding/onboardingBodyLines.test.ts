import { describe, it, expect } from 'vitest';
import { onboardingBodyLines } from '../../src/onboarding/onboardingBodyLines';

describe('onboardingBodyLines', () => {
  it('splits newline-separated copy into trimmed lines', () => {
    expect(
      onboardingBodyLines(
        '点文件图标可上传图片、视频、PDF / EPUB 电子书。\n也支持 txt、Markdown、Word。\n也可把文件直接拖到画布空白处，会在落点生成对应卡片。',
      ),
    ).toEqual([
      '点文件图标可上传图片、视频、PDF / EPUB 电子书。',
      '也支持 txt、Markdown、Word。',
      '也可把文件直接拖到画布空白处，会在落点生成对应卡片。',
    ]);
  });

  it('accepts an array from i18next returnObjects', () => {
    expect(onboardingBodyLines(['  a  ', '', 'b'])).toEqual(['a', 'b']);
  });
});
