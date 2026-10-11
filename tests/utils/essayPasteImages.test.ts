import { describe, it, expect } from 'vitest';
import {
  nextPastedMediaId,
  pastedHtmlImageUrls,
  pastedImageDataUrls,
  pastedImageFiles,
  pastedText,
  shouldInterceptPaste,
} from '../../src/utils/essayPasteImages';
import { dataImageUrlsInText, dataImageUrlToBlob } from '../../src/utils/articleMedia';

const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_DATA_URL = `data:image/png;base64,${PNG_1PX}`;

/** A ClipboardEvent stand-in: jsdom's DataTransfer can't hold items. */
function pasteEvent(options: {
  files?: File[];
  items?: Array<{ kind: string; type: string; file: File | null }>;
  html?: string;
  text?: string;
}) {
  const files = options.files ?? [];
  return {
    clipboardData: {
      items: (options.items ?? []).map((item) => ({
        kind: item.kind,
        type: item.type,
        getAsFile: () => item.file,
      })),
      files,
      getData: (type: string) => {
        if (type === 'text/html') return options.html ?? '';
        if (type === 'text/plain') return options.text ?? '';
        return '';
      },
    },
  } as unknown as ClipboardEvent;
}

const imageFile = (name = 'shot.png') =>
  new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' });

describe('pastedImageFiles', () => {
  it('reads images out of items before files', () => {
    // 部分浏览器里 files 对剪贴板图片是空的，items 才拿得到。
    const fromItems = imageFile('from-items.png');
    const event = pasteEvent({ items: [{ kind: 'file', type: 'image/png', file: fromItems }] });
    expect(pastedImageFiles(event)).toEqual([fromItems]);
  });

  it('falls back to files and ignores non-images', () => {
    const file = imageFile();
    const text = new File(['x'], 'x.txt', { type: 'text/plain' });
    expect(pastedImageFiles(pasteEvent({ files: [text, file] }))).toEqual([file]);
  });

  it('does not list the same file twice when items and files both carry it', () => {
    const file = imageFile();
    const event = pasteEvent({
      files: [file],
      items: [{ kind: 'file', type: 'image/png', file }],
    });
    expect(pastedImageFiles(event)).toEqual([file]);
  });

  it('tolerates an event with no clipboardData', () => {
    expect(pastedImageFiles({ clipboardData: null } as unknown as ClipboardEvent)).toEqual([]);
  });
});

describe('pastedHtmlImageUrls', () => {
  it('finds Base64 images in the html flavour', () => {
    const event = pasteEvent({ html: `<p><img src="${PNG_DATA_URL}"></p>` });
    expect(pastedHtmlImageUrls(event)).toEqual([PNG_DATA_URL]);
  });

  it('returns nothing for an html paste with no images', () => {
    expect(pastedHtmlImageUrls(pasteEvent({ html: '<p>hello</p>' }))).toEqual([]);
  });
});

describe('shouldInterceptPaste', () => {
  it('is false for plain text so the default paste stays untouched', () => {
    expect(shouldInterceptPaste(pasteEvent({ html: '<p>hello</p>' }))).toBe(false);
    expect(
      shouldInterceptPaste(pasteEvent({ files: [new File(['x'], 'a.txt', { type: 'text/plain' })] })),
    ).toBe(false);
  });

  it('is true for an image file or an html image', () => {
    expect(shouldInterceptPaste(pasteEvent({ files: [imageFile()] }))).toBe(true);
    expect(shouldInterceptPaste(pasteEvent({ html: `<img src="${PNG_DATA_URL}">` }))).toBe(true);
  });

  it('leaves an image + text paste to the editor, so the text is not swallowed', () => {
    // 从网页复制一段带插图的段落：clipboard 同时有 html 和 text/plain。我们只会
    // 插图片，拦下来就等于把人复制来的正文悄悄吃掉。宁可放行。
    const event = pasteEvent({
      html: `<p>段落 <img src="${PNG_DATA_URL}"></p>`,
      text: '段落 ',
    });
    expect(shouldInterceptPaste(event)).toBe(false);
  });

  it('treats whitespace-only text as no text', () => {
    const event = pasteEvent({ files: [imageFile()], text: '  \n ' });
    expect(pastedText(event)).toBe('');
    expect(shouldInterceptPaste(event)).toBe(true);
  });
});

describe('pastedImageDataUrls', () => {
  it('prefers real files and converts them to data URLs', async () => {
    const event = pasteEvent({ files: [imageFile()] });
    const [url] = await pastedImageDataUrls(event);
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('falls back to the html flavour when there is no file', async () => {
    const event = pasteEvent({ html: `<img src="${PNG_DATA_URL}">` });
    expect(await pastedImageDataUrls(event)).toEqual([PNG_DATA_URL]);
  });
});

describe('nextPastedMediaId', () => {
  it('never repeats, even inside the same millisecond', () => {
    const ids = new Set([nextPastedMediaId(), nextPastedMediaId(), nextPastedMediaId()]);
    expect(ids.size).toBe(3);
    for (const id of ids) expect(id.startsWith('paste-')).toBe(true);
  });
});

describe('dataImageUrlsInText', () => {
  it('dedupes repeated URLs', () => {
    expect(dataImageUrlsInText(`${PNG_DATA_URL} and ${PNG_DATA_URL}`)).toEqual([PNG_DATA_URL]);
  });

  it('is not fooled by a previous match leaving lastIndex mid-string', () => {
    // 正则是 /g 的，两次连续调用之间 lastIndex 必须复位，否则第二次就什么都找不到。
    expect(dataImageUrlsInText(`![a](${PNG_DATA_URL})`)).toHaveLength(1);
    expect(dataImageUrlsInText(`![a](${PNG_DATA_URL})`)).toHaveLength(1);
  });

  it('ignores non-image data URLs', () => {
    expect(dataImageUrlsInText('data:text/plain;base64,aGk=')).toEqual([]);
  });
});

describe('reading pasted files', () => {
  it('produces a data URL the media store can decode back', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'x.png', { type: 'image/png' });
    const [url] = await pastedImageDataUrls(pasteEvent({ files: [file] }));
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    const blob = await dataImageUrlToBlob(url);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(4);
  });
});