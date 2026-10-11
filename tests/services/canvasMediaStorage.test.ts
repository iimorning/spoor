import { describe, expect, it } from 'vitest';
import {
  extensionForMime,
  isCanvasMediaUrl,
  isDataUrl,
  mimeFromDataUrl,
} from '../../src/services/canvasMediaStorage';

describe('canvasMediaStorage helpers', () => {
  it('detects data URLs and canvas-media public URLs', () => {
    expect(isDataUrl('data:image/png;base64,QUJD')).toBe(true);
    expect(isDataUrl('https://example.com/a.png')).toBe(false);
    expect(
      isCanvasMediaUrl(
        'https://proj.supabase.co/storage/v1/object/public/canvas-media/user/nodes/a/content.png',
      ),
    ).toBe(true);
  });

  it('maps mime types to file extensions', () => {
    expect(extensionForMime('image/jpeg')).toBe('jpg');
    expect(extensionForMime('audio/mpeg')).toBe('mp3');
    expect(mimeFromDataUrl('data:image/webp;base64,abc')).toBe('image/webp');
  });
});
