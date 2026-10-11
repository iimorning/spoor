import { describe, it, expect } from 'vitest';
import { formatEssayCopyText } from '../../src/utils/formatEssayCopyText';
import { formatEssayCopyHtml } from '../../src/utils/formatEssayCopyHtml';

const SAMPLE = `## 一级小标题

这是**加粗**和*斜体*，还有[链接](https://example.com)。

- 列表**加粗**项
- 第二项

1. 有序一

> 引用里的**重点**

\`\`\`js
const x = 1;
\`\`\`

![图片说明](data:image/png;base64,AAA)

---`;

describe('formatEssayCopyText', () => {
  it('拍平成纯文本：粘进聊天框不该看到星号', () => {
    const out = formatEssayCopyText({ title: '标题', markdown: SAMPLE });
    expect(out).toContain('这是加粗和斜体，还有链接。');
    expect(out).toContain('• 列表加粗项');
    expect(out).not.toContain('**');
    expect(out).not.toContain('*斜体*');
  });
});

describe('formatEssayCopyHtml', () => {
  it('还原标题层级、加粗和斜体', () => {
    const out = formatEssayCopyHtml({ title: '标题', markdown: SAMPLE });
    expect(out).toContain('<h1>标题</h1>');
    expect(out).toContain('<h2>一级小标题</h2>');
    expect(out).toContain('<strong>加粗</strong>');
    expect(out).toContain('<em>斜体</em>');
  });

  it('还原列表、引用、代码块和分隔线', () => {
    const out = formatEssayCopyHtml({ markdown: SAMPLE });
    expect(out).toContain('<ul><li>列表<strong>加粗</strong>项</li><li>第二项</li></ul>');
    expect(out).toContain('<ol><li>有序一</li></ol>');
    expect(out).toContain('<blockquote><p>引用里的<strong>重点</strong></p></blockquote>');
    expect(out).toContain('<pre><code>const x = 1;</code></pre>');
    expect(out).toContain('<hr>');
  });

  it('保留链接的跳转地址', () => {
    const out = formatEssayCopyHtml({ markdown: '[例子](https://example.com)' });
    expect(out).toContain('<a href="https://example.com">例子</a>');
  });

  it('图片只留 alt 占位，不进 img', () => {
    const out = formatEssayCopyHtml({ markdown: SAMPLE });
    expect(out).toContain('[图片说明]');
    expect(out).not.toContain('<img');
  });

  // 正文是模型生成或用户写的。这段 HTML 会进别人的编辑器，点一下就出事。
  it('挡住 javascript: 这类地址，只留文字', () => {
    const out = formatEssayCopyHtml({ markdown: '[点我](javascript:alert(1))' });
    expect(out).not.toContain('href');
    expect(out).toContain('点我');
  });

  // 链接地址里带括号时，正则不能在第一个 ) 就停下把尾巴漏成正文
  it('地址里的括号不会把尾巴漏出来', () => {
    const plain = formatEssayCopyText({ markdown: '[标签](https://x.test/a(b))' });
    expect(plain).toBe('标签');
  });

  it('正文里的尖括号被转义', () => {
    const out = formatEssayCopyHtml({ markdown: '一段 <script>alert(1)</script> 文字' });
    expect(out).toContain('&lt;script&gt;');
    expect(out).not.toContain('<script>');
  });
});