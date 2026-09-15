import { describe, it, expect, vi, afterEach } from 'vitest';
import { pastePlainText } from '../../src/utils/pastePlainText';

describe('pastePlainText', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'execCommand');
  });

  it('prevents default and inserts clipboard plain text', () => {
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      writable: true,
      value: execCommand,
    });

    const preventDefault = vi.fn();
    const clipboardData = {
      getData: vi.fn((type: string) => (type === 'text/plain' ? 'plain only' : '<b>html</b>')),
    } as unknown as DataTransfer;

    pastePlainText({ preventDefault, clipboardData });

    expect(preventDefault).toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledWith('insertText', false, 'plain only');
  });

  it('does nothing when plain text is empty', () => {
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      writable: true,
      value: execCommand,
    });

    const preventDefault = vi.fn();
    const clipboardData = {
      getData: vi.fn(() => ''),
    } as unknown as DataTransfer;

    pastePlainText({ preventDefault, clipboardData });

    expect(preventDefault).toHaveBeenCalled();
    expect(execCommand).not.toHaveBeenCalled();
  });
});
