import { describe, it, expect } from 'vitest';
import { essayImageHtmlAttributes } from '../../src/utils/essayEditorMarkdown';

/**
 * 编辑器构造节点默认 DOM 时会先走 schema 的 `toDOM`（`renderHTML`），那一刻我们的
 * 节点视图还没接手。内部引用一旦被写进 `<img src>`，浏览器立刻就去请求它，控制台
 * 刷满 ERR_UNKNOWN_URL_SCHEME —— 而元素随后被节点视图替换掉，DOM 上查不到、错误
 * 事件也抓不到，只有网络面板能看见。真图地址由 `EssayImageView` 从 media 里解析。
 */
describe('essayImageHtmlAttributes', () => {
  it('内部引用不进 src（这就是那些报错的来源）', () => {
    const attrs = essayImageHtmlAttributes('spoor-article-media:legacy-3', {
      src: 'spoor-article-media:legacy-3',
      alt: '',
      class: 'max-w-full h-auto rounded-md my-4',
    });
    expect(attrs.src).toBeUndefined();
    expect(attrs['data-spoor-src']).toBe('spoor-article-media:legacy-3');
  });

  it('内部引用被摘掉时，其余属性原样保留', () => {
    const attrs = essayImageHtmlAttributes('spoor-article-media:paste-x-1', {
      src: 'spoor-article-media:paste-x-1',
      alt: '说明',
      width: 320,
      height: 200,
    });
    expect(attrs).toMatchObject({ alt: '说明', width: 320, height: 200 });
    expect(attrs['data-spoor-src']).toBe('spoor-article-media:paste-x-1');
    expect(attrs.src).toBeUndefined();
  });

  it('真 URL 照常写进 src，不受影响', () => {
    const attrs = essayImageHtmlAttributes('https://example.test/a.png', {
      src: 'https://example.test/a.png',
      alt: '远程图',
    });
    expect(attrs.src).toBe('https://example.test/a.png');
    expect(attrs['data-spoor-src']).toBeUndefined();
  });

  it('默认属性（如类名）始终带上', () => {
    const withInternal = essayImageHtmlAttributes(
      'spoor-article-media:m1',
      { src: 'spoor-article-media:m1' },
      { class: 'rounded-md' },
    );
    const withUrl = essayImageHtmlAttributes(
      'https://example.test/a.png',
      { src: 'https://example.test/a.png' },
      { class: 'rounded-md' },
    );
    expect(withInternal.class).toBe('rounded-md');
    expect(withUrl.class).toBe('rounded-md');
  });

  it('前缀相似但不是内部引用的地址不当成内部引用', () => {
    // 只认完整前缀：`spoor-article-mediafoo:` 不是我们的协议
    const attrs = essayImageHtmlAttributes('spoor-article-mediafoo:x', {
      src: 'spoor-article-mediafoo:x',
    });
    expect(attrs.src).toBe('spoor-article-mediafoo:x');
  });
});
