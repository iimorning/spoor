import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../../src/db';
import {
  createPocketImageNote,
  createPocketNote,
  listPocketNotes,
  placePocketNoteOnCanvas,
  pocketItemHasContent,
  pocketItemPreview,
  pocketMemoBlocks,
  updatePocketMemoBlocks,
  memoStoragePatch,
} from '../../src/utils/pocketNotes';
import {
  imageBlock,
  textBlock,
  trimBlocks,
  blocksPlainText,
  withTitleBlock,
} from '../../src/utils/pocketBlocks';
import { dataUrlToBlob, imageBlobFromContent } from '../../src/utils/file';

const PHOTO = 'data:image/webp;base64,AAAA';

describe('pocketBlocks', () => {
  it('joins the text of a mixed memo in reading order', () => {
    const blocks = [textBlock('上面'), imageBlock('p1'), textBlock('下面')];
    expect(blocksPlainText(blocks)).toBe('上面\n\n下面');
  });

  it('drops the blank text blocks the editor leaves at the edges', () => {
    // 编辑器会在图后面留一段空文字让人接着写，空的就不该存进库里。
    const blocks = [textBlock('   '), imageBlock('p1'), textBlock('')];
    const trimmed = trimBlocks(blocks);
    expect(trimmed).toHaveLength(1);
    expect(trimmed[0]!.kind).toBe('image');
  });

  it('keeps a blank line between two blocks that have content on both sides', () => {
    const blocks = [textBlock('上'), textBlock(''), textBlock('下')];
    expect(trimBlocks(blocks)).toHaveLength(3);
  });

  it('writes a text-only memo back as plain content, so old data keeps its shape', () => {
    // 没有图的备忘继续存 content —— 全库老数据一行都不用迁。
    const patch = memoStoragePatch([textBlock('就一句话')]);
    expect(patch.content).toBe('就一句话');
    // 写空数组而不是 undefined：Dexie 的 update 遇到 undefined 的行为不稳。
    expect(patch.blocks).toEqual([]);
  });

  it('writes a memo with photos as blocks and clears the text field', () => {
    const patch = memoStoragePatch([textBlock('上面'), imageBlock('p1'), textBlock('下面')]);
    expect(patch.blocks).toHaveLength(3);
    expect(patch.content).toBe('');
  });
});

describe('图文混排的备忘', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.edges.clear();
    localStorage.clear();
  });

  it('reads a legacy text-only memo as a single text block', () => {
    const blocks = pocketMemoBlocks({ content: '老数据' });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind === 'text' && blocks[0]!.text).toBe('老数据');
  });

  it('summarises a mixed memo by its text, not by the data URLs', () => {
    const preview = pocketItemPreview({
      type: 'note',
      blocks: [textBlock('上面'), imageBlock('p1'), textBlock('下面')],
    });
    expect(preview).toContain('上面');
    expect(preview).toContain('下面');
    expect(preview).not.toMatch(/data:/);
  });

  it('keeps the memo and its photos out of the pocket list as separate items', async () => {
    const memoId = await createPocketNote('写点东西');
    const photoId = await createPocketImageNote({
      dataUrl: PHOTO,
      ownerMemoId: memoId,
    });
    await updatePocketMemoBlocks(memoId, [textBlock('写点东西'), imageBlock(photoId)]);

    const listed = await listPocketNotes();
    // 只有那一条备忘；图片是它内部的一段，不会自己冒出来变成第二条
    expect(listed).toHaveLength(1);
    expect(listed[0]!.id).toBe(memoId);
  });

  it('still lists a photo on its own when it belongs to no memo', async () => {
    await createPocketImageNote({ dataUrl: PHOTO, ocrText: '独立照片' });
    const listed = await listPocketNotes();
    expect(listed).toHaveLength(1);
    expect(listed[0]!.type).toBe('image');
  });

  it('expands a mixed memo into cards in reading order on the canvas', async () => {
    const memoId = await createPocketNote('上面这段');
    const photoId = await createPocketImageNote({ dataUrl: PHOTO, width: 1000, height: 800 });
    await updatePocketMemoBlocks(memoId, [
      textBlock('上面这段'),
      imageBlock(photoId),
      textBlock('下面那段'),
    ]);

    const ok = await placePocketNoteOnCanvas({
      id: memoId,
      canvasId: 'board-1',
      transform: { x: 0, y: 0, scale: 1 },
      obstacles: [],
    });
    expect(ok).toBe(true);

    const nodes = await db.nodes.toArray();
    const image = nodes.find((n) => n.type === 'image');
    expect(image?.canvasId).toBe('board-1');
    // 原来的备忘行已经被展开掉了，不该同时留在画布上
    expect(nodes.some((n) => n.id === memoId)).toBe(false);
    // 摆上画布后不再是某条备忘的内部段落
    expect(image?.ownerMemoId).toBeUndefined();

    // 阅读顺序体现在位置上（每张排在上一张右边），不是 db 的返回顺序
    // ——新卡的 id 是随机 uuid，toArray 的次序跟摆放次序无关。
    const cards = nodes
      .filter((n) => n.type === 'text' || n.type === 'image')
      .sort((a, b) => a.x - b.x);
    expect(cards.map((n) => n.type)).toEqual(['text', 'image', 'text']);
    expect(cards[0]!.content).toBe('上面这段');
    expect(cards[2]!.content).toBe('下面那段');
  });

  it('places the cards in reading order, not stacked on each other', async () => {
    const memoId = await createPocketNote('第一段');
    const photoId = await createPocketImageNote({ dataUrl: PHOTO, width: 1000, height: 800 });
    await updatePocketMemoBlocks(memoId, [
      textBlock('第一段'),
      imageBlock(photoId),
      textBlock('第二段'),
    ]);
    await placePocketNoteOnCanvas({
      id: memoId,
      canvasId: 'board-1',
      transform: { x: 0, y: 0, scale: 1 },
      obstacles: [],
    });

    const nodes = await db.nodes.toArray();
    const cards = nodes
      .filter((n) => n.type === 'text' || n.type === 'image')
      .map((n) => ({ x: n.x, y: n.y }));
    // 每张都有位置，而且没有任何两张占同一个位置
    for (let i = 0; i < cards.length; i += 1) {
      for (let j = i + 1; j < cards.length; j += 1) {
        expect(cards[i]).not.toEqual(cards[j]);
      }
    }
  });
});

/**
 * 回归：编辑器里原先还留着一个过时的自动保存，每 280ms 把 draft（纯文字）写回 content。
 * 对图文混排的备忘来说，这会把 content 覆盖成一串普通文字而 blocks 不动，
 * 于是这条记录既不是合法图片也不是合法备忘——OCR 那头再去 atob 这串文字就抛
 * InvalidCharacterError，而用户看到的只是"点了没反应"。
 */
describe('编辑器自动保存不会毁掉混排备忘', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.edges.clear();
    localStorage.clear();
  });

  it('keeps blocks intact when the memo has photos', async () => {
    const memoId = await createPocketNote('上面');
    const photoId = await createPocketImageNote({ dataUrl: PHOTO, ownerMemoId: memoId });
    await updatePocketMemoBlocks(memoId, [textBlock('上面'), imageBlock(photoId), textBlock('下面')]);

    // 模拟"自动保存拿纯文字去写 content"
    const node = await db.nodes.get(memoId);
    await db.nodes.update(memoId, { content: '上面\n下面' });

    const after = await db.nodes.get(memoId);
    expect(after?.blocks).toHaveLength(3);
    // 判"有没有内容"必须看 blocks：只看 content 的话这条会被当成空稿删掉
    expect(pocketItemHasContent(after!)).toBe(true);
  });
});

describe('dataUrlToBlob', () => {
  it('decodes a base64 data URL and keeps the mime', async () => {
    const blob = await dataUrlToBlob('data:image/webp;base64,QUJD');
    expect(blob.type).toBe('image/webp');
    await expect(blob.text()).resolves.toBe('ABC');
  });

  it('decodes a percent-encoded data URL instead of blowing up in atob', async () => {
    // 早先只按 base64 解，百分号编码的会抛 atob 的 InvalidCharacterError，
    // 那句报错完全指不出真正的问题。
    const blob = await dataUrlToBlob('data:text/plain,%E4%BD%A0%E5%A5%BD');
    expect(blob.type).toBe('text/plain');
    await expect(blob.text()).resolves.toBe('你好');
  });

  it('says what it got when the string is not a data URL at all', async () => {
    // 混排备忘的 content 曾经会被写成普通文字，走到这里时必须给出能定位的信息。
    await expect(dataUrlToBlob('上面那段文字')).rejects.toThrow(/不是 data URL/);
  });

  it('reports the mime and payload when base64 will not decode', async () => {
    await expect(dataUrlToBlob('data:image/jpeg;base64,!!!not base64!!!')).rejects.toThrow(
      /base64 解不开/,
    );
  });
});

/**
 * 回归：登录同步之后，图片卡的 content 会被换成云端存储的公网地址
 * （data URL 被抬到 canvas-media 桶）。而原图只在内存里留最近几张，重开应用就没了——
 * 这时 OCR 唯一的输入就是那个远程 URL。早先这里只认 data URL，于是每次都炸成
 * "不是 data URL"，用户点了完全没反应。
 */
describe('imageBlobFromContent', () => {
  const PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  it('reads a data URL', async () => {
    const blob = await imageBlobFromContent(PNG);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('fetches a cloud storage URL', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(bytes, { status: 200 }));
    try {
      const blob = await imageBlobFromContent(
        'https://drckigvqfhsbedzyafyr.supabase.co/storage/v1/object/public/canvas-media/u/nodes/n/content',
      );
      expect(blob.size).toBe(4);
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('says so when the cloud copy cannot be fetched', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 404 }));
    try {
      await expect(
        imageBlobFromContent('https://example.com/missing.png'),
      ).rejects.toThrow(/HTTP 404/);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('says so when the network is down, instead of a cryptic decode error', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    try {
      await expect(imageBlobFromContent('https://example.com/a.png')).rejects.toThrow(
        /离线或跨域被拦/,
      );
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('rejects content that is neither, naming what it saw', async () => {
    await expect(imageBlobFromContent('上面那段文字')).rejects.toThrow(/不认识的图片内容格式/);
    await expect(imageBlobFromContent('')).rejects.toThrow(/content 是空的/);
  });
});

/**
 * 画布上的便签只有正文（NoteBody 渲染的就是 content），没有标题这个东西。
 * 所以口袋里的独立标题在摆上画布时必须并进第一段，否则那行字凭空消失。
 */
describe('标题摆到画布时不丢', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.edges.clear();
    localStorage.clear();
  });

  it('folds the title into the first line of a text-only memo', async () => {
    const id = await createPocketNote('正文');
    await db.nodes.update(id, { title: '白板会议' });
    await placePocketNoteOnCanvas({
      id,
      canvasId: 'board-1',
      transform: { x: 0, y: 0, scale: 1 },
      obstacles: [],
    });
    const node = await db.nodes.get(id);
    expect(node?.content).toBe('白板会议\n正文');
    // 标题已经并进正文，就不必再单独留着
    expect(node?.title).toBe('');
  });

  it('folds the title into the first block of a mixed memo', async () => {
    const memoId = await createPocketNote('正文');
    const photoId = await createPocketImageNote({ dataUrl: PHOTO, width: 1000, height: 800 });
    await updatePocketMemoBlocks(memoId, [textBlock('正文'), imageBlock(photoId)]);
    await db.nodes.update(memoId, { title: '白板会议' });

    await placePocketNoteOnCanvas({
      id: memoId,
      canvasId: 'board-1',
      transform: { x: 0, y: 0, scale: 1 },
      obstacles: [],
    });
    const nodes = await db.nodes.toArray();
    // 摆放顺序体现在位置上，不是 db 的返回顺序（新卡 id 是随机 uuid）
    const texts = nodes.filter((n) => n.type === 'text').sort((a, b) => a.x - b.x);
    expect(texts[0]?.content).toBe('白板会议');
    expect(texts[1]?.content).toBe('正文');
  });

  it('does not fold the same title in twice', () => {
    const once = withTitleBlock([textBlock('正文')], '标题');
    const twice = withTitleBlock(once, '标题');
    expect(twice).toHaveLength(once.length);
  });
});
