import { describe, it, expect } from 'vitest';
import type { CanvasNode } from '../../src/db';
import {
  CANVAS_FILE_UPLOAD_ACCEPT,
  filesFromDataTransfer,
  personaChatUploadOrigin,
} from '../../src/utils/chatPanelFileUpload';
import { DEFAULT_NODE_SIZE } from '../../src/utils/canvas';

const persona: CanvasNode = {
  id: 'ask-1',
  canvasId: 'c1',
  type: 'ask',
  x: 100,
  y: 200,
  content: '',
  width: 320,
  height: 180,
};

describe('chatPanelFileUpload', () => {
  it('exports the same accept list as the toolbar', () => {
    expect(CANVAS_FILE_UPLOAD_ACCEPT).toContain('image/*');
    expect(CANVAS_FILE_UPLOAD_ACCEPT).toContain('.pdf');
  });

  it('places uploads beside the persona card', () => {
    const nodesRef = { current: {} as Record<string, HTMLElement | null> };
    const pos = personaChatUploadOrigin(persona, [persona], nodesRef);
    expect(pos.x).toBeGreaterThan(persona.x);
    expect(pos.y).toBeGreaterThanOrEqual(persona.y);
  });

  it('reads clipboard files from DataTransfer.items', () => {
    const file = new File(['x'], 'shot.png', { type: 'image/png' });
    const data = {
      files: [file],
      items: [{ kind: 'file', getAsFile: () => file }],
    } as unknown as DataTransfer;
    expect(filesFromDataTransfer(data)).toEqual([file]);
  });

  it('grid origin lands beside the persona card', () => {
    const nodesRef = { current: {} as Record<string, HTMLElement | null> };
    const origin = personaChatUploadOrigin(persona, [persona], nodesRef);
    expect(origin.x).toBeGreaterThan(persona.x + persona.width!);
    expect(origin.y).toBeGreaterThanOrEqual(persona.y - DEFAULT_NODE_SIZE.height);
    expect(DEFAULT_NODE_SIZE.width).toBeGreaterThan(0);
  });
});
