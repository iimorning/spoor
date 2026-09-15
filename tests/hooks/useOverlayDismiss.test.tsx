import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import React from 'react';
import { useOverlayDismiss } from '../../src/hooks/useOverlayDismiss';

function Probe({ active, onDismiss }: { active: boolean; onDismiss: () => void }) {
  const { onBackdropMouseDown } = useOverlayDismiss(active, onDismiss);
  return (
    <div data-testid="backdrop" onMouseDown={onBackdropMouseDown}>
      <div data-testid="panel" onMouseDown={(e) => e.stopPropagation()}>
        panel
      </div>
    </div>
  );
}

describe('useOverlayDismiss', () => {
  it('Escape 触发 onDismiss', () => {
    const onDismiss = vi.fn();
    render(<Probe active onDismiss={onDismiss} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('点击遮罩触发 onDismiss，点击内容区不触发', () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(<Probe active onDismiss={onDismiss} />);
    fireEvent.mouseDown(getByTestId('panel'));
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.mouseDown(getByTestId('backdrop'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('未激活时不响应 Escape', () => {
    const onDismiss = vi.fn();
    render(<Probe active={false} onDismiss={onDismiss} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
