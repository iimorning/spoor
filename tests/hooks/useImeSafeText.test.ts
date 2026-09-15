import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { useImeSafeText } from '../../src/hooks/useImeSafeText';

function Harness({
  sourceKey,
  sourceValue,
  onPersist,
}: {
  sourceKey: string;
  sourceValue: string;
  onPersist: (value: string) => void;
}) {
  const field = useImeSafeText(sourceKey, sourceValue, onPersist);
  return React.createElement('textarea', { 'data-testid': 'ime-field', ...field.bind });
}

describe('useImeSafeText', () => {
  it('does not persist IME composition, and keeps draft if sourceValue stays stale', () => {
    const onPersist = vi.fn();
    const { rerender } = render(
      React.createElement(Harness, { sourceKey: 'agent-1', sourceValue: '', onPersist }),
    );
    const field = screen.getByTestId('ime-field');

    fireEvent.compositionStart(field);
    fireEvent.change(field, { target: { value: 'ru' } });
    expect(onPersist).not.toHaveBeenCalled();

    rerender(React.createElement(Harness, { sourceKey: 'agent-1', sourceValue: '', onPersist }));
    expect(screen.getByTestId('ime-field')).toHaveValue('ru');

    fireEvent.change(field, { target: { value: '如果' } });
    fireEvent.compositionEnd(field);
    expect(onPersist).toHaveBeenCalledTimes(1);
    expect(onPersist).toHaveBeenCalledWith('如果');
    expect(screen.getByTestId('ime-field')).toHaveValue('如果');
  });

  it('persists Latin typing immediately', () => {
    const onPersist = vi.fn();
    render(React.createElement(Harness, { sourceKey: 'agent-1', sourceValue: '', onPersist }));
    fireEvent.change(screen.getByTestId('ime-field'), { target: { value: 'hello' } });
    expect(onPersist).toHaveBeenCalledWith('hello');
  });
});
