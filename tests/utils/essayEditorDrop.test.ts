import { describe, expect, it, vi } from 'vitest';
import { resolveEssayEditorDrop } from '../../src/utils/essayEditorDrop';

describe('resolveEssayEditorDrop', () => {
  it('returns null when the pointer is outside the prose area', () => {
    const prose = document.createElement('div');
    prose.dataset.testid = 'essay-body-editor-prose';
    Object.defineProperty(prose, 'getBoundingClientRect', {
      value: () => ({ left: 100, right: 400, top: 80, bottom: 500 }),
    });
    document.body.appendChild(prose);

    const editor = {
      view: {
        posAtCoords: vi.fn(),
        coordsAtPos: vi.fn(),
      },
    } as never;

    expect(resolveEssayEditorDrop(editor, 50, 200)).toBeNull();
    prose.remove();
  });

  it('maps viewport coordinates to a document position and caret', () => {
    const prose = document.createElement('div');
    prose.dataset.testid = 'essay-body-editor-prose';
    Object.defineProperty(prose, 'getBoundingClientRect', {
      value: () => ({ left: 100, right: 400, top: 80, bottom: 500 }),
    });
    document.body.appendChild(prose);

    const editor = {
      view: {
        posAtCoords: vi.fn(() => ({ pos: 42 })),
        coordsAtPos: vi.fn(() => ({ left: 180, top: 160, bottom: 182, right: 180 })),
      },
    } as never;

    expect(resolveEssayEditorDrop(editor, 220, 170)).toEqual({
      pos: 42,
      caret: { left: 180, top: 160, height: 22 },
    });
    prose.remove();
  });
});
