import { describe, it, expect } from 'vitest';
import { droppedImageFiles, droppedImageDataUrls } from '../../src/utils/essayDropImages';
import { dataImageUrlToBlob } from '../../src/utils/articleMedia';
import { readFileAsDataURL } from '../../src/utils/file';

/**
 * jsdom 的 `DataTransfer` 装不下真实文件，手工造一个形状对得上的对象即可——
 * 拖放路径只读 `files` / `types` / `getData('text/html')`。
 */
function transferWith(files: File[], html = ''): DataTransfer {
  return {
    files,
    items: [],
    types: files.length ? ['Files'] : [],
    getData: (type: string) => (type === 'text/html' ? html : ''),
  } as unknown as DataTransfer;
}

const png = () => new File([new Uint8Array([137, 80, 78, 71])], 'a.png', { type: 'image/png' });

describe('droppedImageFiles', () => {
  it('keeps image files and drops everything else', () => {
    const note = new File(['hi'], 'note.txt', { type: 'text/plain' });
    const image = png();
    expect(droppedImageFiles(transferWith([note, image]))).toEqual([image]);
  });

  it('keeps drag order so multi-image drops insert top to bottom', () => {
    const a = png();
    const b = new File([new Uint8Array([1, 2, 3])], 'b.jpg', { type: 'image/jpeg' });
    expect(droppedImageFiles(transferWith([b, a]))).toEqual([b, a]);
  });

  it('tolerates a missing or empty transfer', () => {
    expect(droppedImageFiles(null)).toEqual([]);
    expect(droppedImageFiles(undefined)).toEqual([]);
    expect(droppedImageFiles(transferWith([]))).toEqual([]);
  });
});

describe('droppedImageDataUrls', () => {
  it('reads dropped bytes back as data URLs', async () => {
    const file = png();
    const urls = await droppedImageDataUrls(transferWith([file]));
    expect(urls).toEqual([await readFileAsDataURL(file)]);
  });

  it('falls back to inline html images when the drag carries no files', async () => {
    const dataUrl = await readFileAsDataURL(png());
    const html = `<img src="${dataUrl}">`;
    expect(await droppedImageDataUrls(transferWith([], html))).toEqual([dataUrl]);
  });

  it('prefers real files over html so a file drag never loses its bytes', async () => {
    const file = png();
    const fileUrl = await readFileAsDataURL(file);
    const otherUrl = await readFileAsDataURL(new File([new Uint8Array([9])], 'b.png', { type: 'image/png' }));
    const html = `<img src="${otherUrl}">`;
    expect(await droppedImageDataUrls(transferWith([file], html))).toEqual([fileUrl]);
  });

  it('returns nothing for a drag with no images at all', async () => {
    const doc = new File(['%PDF'], 'paper.pdf', { type: 'application/pdf' });
    expect(await droppedImageDataUrls(transferWith([doc]))).toEqual([]);
  });

  it('the bytes survive the round trip into a Blob', async () => {
    const [url] = await droppedImageDataUrls(transferWith([png()]));
    const blob = await dataImageUrlToBlob(url);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(4);
  });
});