import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { AppDialogProvider, useAppDialog } from '../../src/components/AppDialogProvider';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh', changeLanguage: vi.fn() },
  }),
}));

function Probe() {
  const { confirm, alert } = useAppDialog();
  return (
    <div>
      <button type="button" onClick={() => void confirm({ message: 'delete me?', variant: 'danger' })}>
        open-confirm
      </button>
      <button type="button" onClick={() => void alert({ message: 'oops' })}>
        open-alert
      </button>
    </div>
  );
}

describe('AppDialogProvider', () => {
  it('确认框居中展示且确定/取消可点击', async () => {
    const user = userEvent.setup();
    render(
      <AppDialogProvider>
        <Probe />
      </AppDialogProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'open-confirm' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('delete me?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'dialog.confirm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'dialog.cancel' })).toBeInTheDocument();
  });

  it('提示框仅显示确定按钮', async () => {
    const user = userEvent.setup();
    render(
      <AppDialogProvider>
        <Probe />
      </AppDialogProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'open-alert' }));

    expect(screen.getByText('oops')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'dialog.ok' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'dialog.cancel' })).toBeNull();
  });

  it('Escape 和点击遮罩可关闭确认框', async () => {
    const user = userEvent.setup();
    render(
      <AppDialogProvider>
        <Probe />
      </AppDialogProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'open-confirm' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'open-confirm' }));
    fireEvent.mouseDown(screen.getByTestId('app-dialog-backdrop'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Escape 和点击遮罩可关闭提示框', async () => {
    const user = userEvent.setup();
    render(
      <AppDialogProvider>
        <Probe />
      </AppDialogProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'open-alert' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'open-alert' }));
    fireEvent.mouseDown(screen.getByTestId('app-dialog-backdrop'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
