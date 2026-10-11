import { Editor, mergeAttributes, type NodeViewRenderer } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { AiDeletionMark } from '../components/essay/AiDeletionMark';
import { AiEssayEditNode } from '../components/essay/AiEssayEditNode';
import { AiSuggestionActions } from '../components/essay/AiSuggestionActions';
import { EssayFocusMarks } from '../components/essay/EssayFocusMarks';
import { AiTransitionMark } from '../components/essay/AiTransitionMark';
import { ARTICLE_MEDIA_SCHEME } from './articleMedia';

export const ESSAY_IMAGE_HTML_CLASS = 'max-w-full h-auto rounded-md my-4';

/**
 * `<img>` 该写哪些属性：**内部图片引用不能进 `src`**。
 *
 * `spoor-article-media:legacy-3` 不是 URL——真图在这篇文章的 `media` 里，由
 * `EssayImageView` 解析成 blob 地址。但编辑器构造节点默认 DOM 时先走 schema 的
 * `toDOM`（也就是这里），那一刻节点视图还没接手。一旦内部引用被写进 `<img src>`，
 * 浏览器立刻就去请求它，控制台刷满 ERR_UNKNOWN_URL_SCHEME；元素随后被节点视图
 * 替换掉，所以它不在文档里、DOM 上也查不到，但请求已经发出去了。
 *
 * 实测每次打开长文、每张图各请求一次。摘掉 `src` 就干净了，宽高/类名等照旧。
 *
 * 剪贴板走的是同一套 `toDOM`。只摘 `src` 的话，剪切出去的是一张没有地址的
 * `<img>`，而图片节点只认 `img[src]`，Ctrl+V 就贴不回来。内部引用改放到
 * `data-spoor-src`：浏览器不会拿它发请求，粘贴时再读回 `src`。
 */
export function essayImageHtmlAttributes(
  src: string,
  htmlAttributes: Record<string, unknown>,
  defaults?: Record<string, unknown>,
): Record<string, unknown> {
  const internal = src.startsWith(ARTICLE_MEDIA_SCHEME);
  const base = internal
    ? Object.fromEntries(Object.entries(htmlAttributes).filter(([key]) => key !== 'src'))
    : htmlAttributes;
  const merged = mergeAttributes(base, defaults ?? {});
  if (internal) merged['data-spoor-src'] = src;
  return merged;
}

const EssayImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
        parseHTML: (element) => {
          const internal = element.getAttribute('data-spoor-src');
          if (internal?.startsWith(ARTICLE_MEDIA_SCHEME)) return internal;
          return element.getAttribute('src');
        },
      },
      width: {
        default: null,
        parseHTML: (element) => {
          const raw =
            element.getAttribute('width') ||
            (element as HTMLElement).style.width;
          if (!raw) return null;
          const parsed = parseInt(String(raw).replace(/px$/i, ''), 10);
          return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
        },
        renderHTML: (attributes) =>
          attributes.width ? { width: attributes.width } : {},
      },
      height: {
        default: null,
        parseHTML: (element) => {
          const raw =
            element.getAttribute('height') ||
            (element as HTMLElement).style.height;
          if (!raw) return null;
          const parsed = parseInt(String(raw).replace(/px$/i, ''), 10);
          return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
        },
        renderHTML: (attributes) =>
          attributes.height ? { height: attributes.height } : {},
      },
    };
  },
  parseHTML() {
    return [
      { tag: 'img[data-spoor-src]' },
      ...(this.parent?.() ?? []),
    ];
  },
  renderMarkdown(node) {
    const attrs = node.attrs ?? {};
    const src = String(attrs.src ?? '');
    const alt = String(attrs.alt ?? '');
    const title = String(attrs.title ?? '');
    const width = attrs.width;
    const height = attrs.height;
    if (width || height) {
      const parts = [
        `src="${src}"`,
        alt ? `alt="${alt}"` : '',
        width ? `width="${width}"` : '',
        height ? `height="${height}"` : '',
        'class="rounded-md my-4"',
      ].filter(Boolean);
      return `<img ${parts.join(' ')} />`;
    }
    return title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`;
  },
  /**
   * 内部图片引用（`spoor-article-media:`）不是真 URL，不能写进 `src`——
   * 否则编辑器构造默认 DOM 时浏览器立刻就去请求它。详见
   * `essayImageHtmlAttributes` 的说明。
   */
  renderHTML({ node, HTMLAttributes }) {
    return [
      'img',
      essayImageHtmlAttributes(
        String(node.attrs?.src ?? ''),
        HTMLAttributes as Record<string, unknown>,
        this.options.HTMLAttributes as Record<string, unknown>,
      ),
    ];
  },
});

export function createEssayImageExtension(nodeView?: NodeViewRenderer) {
  const Extension = nodeView
    ? EssayImage.extend({
        addNodeView() {
          return nodeView;
        },
      })
    : EssayImage;
  return Extension.configure({
    inline: false,
    allowBase64: true,
    HTMLAttributes: { class: ESSAY_IMAGE_HTML_CLASS },
  });
}

export function normalizeEssayMarkdown(markdown: string): string {
  return (markdown ?? '').replace(/ /g, ' ').trim();
}

export function createEssayEditorExtensions(options?: {
  placeholder?: string;
  imageExtension?: ReturnType<typeof Image.extend> | typeof Image;
  aiEssayEditExtension?: ReturnType<typeof AiEssayEditNode.extend> | typeof AiEssayEditNode;
  /**
   * Whether to register AI suggestion marks (transitions + deletions).
   * Defaults to true. Set false in tests or for essays that pre-date the feature.
   */
  aiTransition?: boolean;
  /**
   * 正文里的 AI 标注高亮。默认关：它要靠 `editor.storage.essayFocusMarks.marks` 里
   * 的标注列表才有内容，没喂给它就是个空 DecorationSet，纯属白跑一趟。
   */
  essayFocus?: boolean;
}) {
  const includeAiTransition = options?.aiTransition ?? true;
  const essayEdit = options?.aiEssayEditExtension ?? AiEssayEditNode;
  return [
    // Suggestion marks must come first so `priority: 50` registers ahead of
    // StarterKit's defaults (which sit at 1000); this lets them wrap other marks
    // when serialized.
    ...(includeAiTransition
      ? [essayEdit, AiTransitionMark, AiDeletionMark, AiSuggestionActions]
      : []),
    ...(options?.essayFocus ? [EssayFocusMarks] : []),
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https',
      },
    }),
    Markdown.configure({
      markedOptions: {
        gfm: true,
        breaks: true,
      },
    }),
    options?.imageExtension ?? createEssayImageExtension(),
    Placeholder.configure({
      placeholder: options?.placeholder ?? '',
    }),
  ];
}

export function createHeadlessEssayEditor(markdown: string, placeholder = ''): Editor {
  return new Editor({
    extensions: createEssayEditorExtensions({ placeholder }),
    content: markdown,
    contentType: 'markdown',
  });
}
