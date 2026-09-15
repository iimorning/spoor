import { describe, it, expect } from 'vitest';
import { stampNewCard, stampNewCards } from '../../src/utils/stampNewCard';

describe('stampNewCard', () => {
  it('writes createdAt, overwriting any previous value', () => {
    const at = 123;
    expect(stampNewCard({ id: 'a' }, at)).toEqual({ id: 'a', createdAt: 123 });
    expect(stampNewCard({ id: 'a', createdAt: 1 }, at).createdAt).toBe(123);
  });

  it('defaults to Date.now()', () => {
    const before = Date.now();
    const stamped = stampNewCard({ id: 'a' });
    const after = Date.now();
    expect(stamped.createdAt).toBeGreaterThanOrEqual(before);
    expect(stamped.createdAt).toBeLessThanOrEqual(after);
  });

  it('stampNewCards shares one timestamp across the batch', () => {
    const at = 99;
    const rows = stampNewCards([{ id: 'a' }, { id: 'b' }], at);
    expect(rows.map((r) => r.createdAt)).toEqual([99, 99]);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
  });
});
