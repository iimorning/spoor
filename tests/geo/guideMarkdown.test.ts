import { describe, expect, it } from 'vitest';
import { getGuide } from '../../src/geo/guidesContent';
import { guideMarkdownToHtml, prepareGuideMarkdown } from '../../src/geo/guideMarkdown';

describe('guideMarkdown', () => {
  it('demotes extra H1s and keeps the page title out of the body', () => {
    const guide = getGuide('ai-brainstorming-tools');
    expect(guide?.bodyMarkdown).toBeTruthy();
    const prepared = prepareGuideMarkdown(guide!.bodyMarkdown!, guide!.h1);
    expect(prepared).not.toMatch(/^# 7 AI Brainstorming/);
    expect(prepared).toContain('## 1. ChatGPT — conversational brainstorming');
    expect(prepared).toContain('### Generation-first');
  });

  it('renders lists, quotes, and the comparison table', () => {
    const guide = getGuide('ai-brainstorming-tools');
    const html = guideMarkdownToHtml(prepareGuideMarkdown(guide!.bodyMarkdown!, guide!.h1));
    expect(html).toContain('<h2>The short answer</h2>');
    expect(html).toContain('<strong>ChatGPT</strong>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<th>Consider</th>');
    expect(html).toContain('<td>Spoor</td>');
    expect(html).toContain('You have an idea that is not finished yet');
  });

  it('prepares the Chinese article the same way', () => {
    const guide = getGuide('ai-brainstorming-tools');
    expect(guide?.bodyMarkdownZh).toBeTruthy();
    const prepared = prepareGuideMarkdown(guide!.bodyMarkdownZh!, guide!.h1Zh);
    expect(prepared).not.toMatch(/^# 7 种 AI/);
    expect(prepared).toContain('## 1. ChatGPT — 对话式头脑风暴');
    const html = guideMarkdownToHtml(prepared);
    expect(html).toContain('<h2>简短结论</h2>');
    expect(html).toContain('<td>雪泥 Spoor</td>');
  });
});
