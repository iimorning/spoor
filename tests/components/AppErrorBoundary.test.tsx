import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppErrorBoundary } from '../../src/components/AppErrorBoundary';

function BrokenComponent(): never {
  throw new Error('startup boom');
}

describe('AppErrorBoundary', () => {
  it('shows a recoverable error without clearing local data', async () => {
    localStorage.setItem('keep-note-data', 'safe');
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <AppErrorBoundary>
        <BrokenComponent />
      </AppErrorBoundary>,
    );

    expect(screen.getByText('雪泥没有正常启动')).toBeInTheDocument();
    expect(localStorage.getItem('keep-note-data')).toBe('safe');
    await userEvent.click(screen.getByRole('button', { name: '复制错误信息' }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('startup boom'));
  });
});
