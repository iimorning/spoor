import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db';
import {
  imageFileFromClipboard,
  spawnPastedImageNode,
} from '../../src/utils/spawnPastedImageNode';

function imageFile(name = 'paste.png', type = 'image/png') {
  return new File([new Uint8Array([137, 80, 78, 71])], name, { type });
}

/** 造一个只有指定槽的 DataTransfer 替身。 */
function clipboardWith(options: {
  items?: Array<{ kind: string; type: string; file: File | null }>;
  files?: File[];
}): DataTransfer {
  return {
    items: (options.items ?? []).map((i) => ({
      kind: i.kind,
      type: i.type,
      getAsFile: () => i.file,
    })),
    files: options.files ?? [],
  } as unknown as DataTransfer;
}

describe('imageFileFromClipboard', () => {
  it('finds the image sitting in the file slot', () => {
    // 复制一张图时 text/plain 是空的，东西在文件槽里。
    const file = imageFile();
    expect(imageFileFromClipboard(clipboardWith({ items: [{ kind: 'file', type: 'image/png', file }] })))
      .toBe(file);
    expect(imageFileFromClipboard(clipboardWith({ files: [file] }))).toBe(file);
  });

  it('ignores text and non-image files', () => {
    const text = clipboardWith({
      items: [
        { kind: 'string', type: 'text/plain', file: null },
        { kind: 'file', type: 'application/pdf', file: imageFile('a.pdf', 'application/pdf') },
      ],
    });
    expect(imageFileFromClipboard(text)).toBeNull();
  });

  it('survives a clipboard with nothing in it', () => {
    expect(imageFileFromClipboard(null)).toBeNull();
    expect(imageFileFromClipboard(clipboardWith({}))).toBeNull();
  });
});

describe('spawnPastedImageNode', () => {
  beforeEach(async () => {
    await db.nodes.clear();
  });

  it('puts an image card on the canvas where asked', async () => {
    const id = await spawnPastedImageNode({
      file: imageFile(),
      canvasId: 'c1',
      position: { x: 120, y: 240 },
    });

    const row = await db.nodes.get(id);
    expect(row?.type).toBe('image');
    expect(row?.canvasId).toBe('c1');
    expect(row?.x).toBe(120);
    expect(row?.y).toBe(240);
    expect(row?.fileType).toBe('image/png');
    // 内容按惯例存成 data URL——图片节点一直是这么存的。
    expect(row?.content.startsWith('data:image/png')).toBe(true);
  });

  it('gives every paste its own id', async () => {
    const a = await spawnPastedImageNode({
      file: imageFile('a.png'),
      canvasId: 'c1',
      position: { x: 0, y: 0 },
    });
    const b = await spawnPastedImageNode({
      file: imageFile('b.png'),
      canvasId: 'c1',
      position: { x: 0, y: 0 },
    });
    expect(a).not.toBe(b);
    expect(await db.nodes.count()).toBe(2);
  });
});
