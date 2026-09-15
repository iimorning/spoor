import { describe, it, expect } from 'vitest';
import { ARTICLE_MEDIA_SCHEME } from '../../src/utils/articleMedia';
import {
  createHeadlessEssayEditor,
  normalizeEssayMarkdown,
} from '../../src/utils/essayEditorMarkdown';

function roundtrip(markdown: string): string {
  const editor = createHeadlessEssayEditor(markdown);
  try {
    return normalizeEssayMarkdown(editor.getMarkdown());
  } finally {
    editor.destroy();
  }
}

describe('essay markdown roundtrip', () => {
  it('keeps generated heading sections', () => {
    const md = '## 段一\n\n第一段正文。\n\n## 段二\n\n第二段正文。';
    const out = roundtrip(md);
    expect(out).toContain('段一');
    expect(out).toContain('第一段正文。');
    expect(out).toContain('段二');
    expect(out).toContain('第二段正文。');
  });

  it('keeps bold, lists, and links', () => {
    const md = 'See **bold** and a [label](https://example.com).\n\n- one\n- two';
    const out = roundtrip(md);
    expect(out).toContain('**bold**');
    expect(out).toContain('[label](https://example.com)');
    expect(out).toMatch(/[-*] one/);
    expect(out).toMatch(/[-*] two/);
  });

  it('serializes article media images without blob URLs', () => {
    const md = `![cover](${ARTICLE_MEDIA_SCHEME}abc-1)`;
    const out = roundtrip(md);
    expect(out).toContain(`${ARTICLE_MEDIA_SCHEME}abc-1`);
    expect(out).not.toMatch(/blob:/i);
  });

  it('normalizes an empty document to an empty string', () => {
    expect(roundtrip('')).toBe('');
    expect(roundtrip('   ')).toBe('');
    expect(normalizeEssayMarkdown('\u00a0\n')).toBe('');
  });

  it('does not throw on a GFM table', () => {
    expect(() => roundtrip('| a | b |\n| --- | --- |\n| 1 | 2 |')).not.toThrow();
  });
});
