import { describe, it, expect, vi } from 'vitest';
import { createLatestWinsWriter } from '../../src/utils/latestWinsWriter';

describe('createLatestWinsWriter', () => {
  it('writes the latest payload when calls overlap', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const write = vi.fn(async (value: string) => {
      if (write.mock.calls.length === 1) await gate;
      void value;
    });
    const enqueue = createLatestWinsWriter(write);

    const first = enqueue('a');
    await vi.waitFor(() => expect(write).toHaveBeenCalledWith('a'));
    const second = enqueue('b');
    const third = enqueue('c');
    release();
    await Promise.all([first, second, third]);

    expect(write.mock.calls.map((c) => c[0])).toEqual(['a', 'c']);
  });
});
