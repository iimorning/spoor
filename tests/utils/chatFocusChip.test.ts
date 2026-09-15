import { describe, expect, it } from 'vitest';
import { chatFocusChipFromNode } from '../../src/utils/chatFocusChip';
import type { CanvasNode } from '../../src/db';

function node(partial: Partial<CanvasNode> & Pick<CanvasNode, 'id' | 'type' | 'x' | 'y'>): CanvasNode {
  return { content: '', ...partial };
}

describe('chatFocusChipFromNode', () => {
  it('uses description then truncates the title', () => {
    const chip = chatFocusChipFromNode(
      node({
        id: 'n1',
        type: 'note',
        x: 0,
        y: 0,
        description: 'spoor 视频封面 简洁版 还有更多字',
      }),
      '卡片',
    );
    expect(chip.id).toBe('n1');
    expect(chip.title.endsWith('…')).toBe(true);
    expect(chip.title.length).toBeLessThanOrEqual(16);
  });

  it('attaches an image thumbnail when the card is an image URL', () => {
    const chip = chatFocusChipFromNode(
      node({
        id: 'img',
        type: 'image',
        x: 0,
        y: 0,
        content: 'https://example.com/cover.png',
        description: '封面',
      }),
      '卡片',
    );
    expect(chip.thumbnailSrc).toBe('https://example.com/cover.png');
    expect(chip.title).toBe('封面');
  });
});
