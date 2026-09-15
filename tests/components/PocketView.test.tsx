import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PocketView } from '../../src/components/PocketView';
import { db } from '../../src/db';
import { createPocketNote, listPocketNotes, POCKET_CANVAS_ID } from '../../src/utils/pocketNotes';
import { AppDialogProvider } from '../../src/components/AppDialogProvider';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'pocket.title': '备忘',
        'pocket.placeholder': '想到什么就写。',
        'pocket.new': '新记一条',
        'pocket.empty': '备忘还是空的。',
        'pocket.place': '放到画布',
        'pocket.placed_on': `已放到「${opts?.name ?? ''}」`,
        'pocket.delete': '删除',
        'pocket.delete_confirm': `删除「${opts?.title ?? ''}」？`,
        'pocket.delete_n_confirm': `删除这 ${opts?.count ?? ''} 条备忘？`,
        'pocket.cancel_select': '取消',
        'pocket.untitled': '未命名备忘',
        'pocket.back': '返回',
        'cloud.signIn': '登录',
        'cloud.title': '云同步',
        'cloud.blurb': '登录后可将画布、便签与助手备份到云端。',
        'dialog.confirm': '确定',
        'dialog.cancel': '取消',
      };
      return translations[key] ?? key;
    },
    i18n: { language: 'zh' },
  }),
}));

function renderPocket(onOpenLogin = vi.fn()) {
  return {
    onOpenLogin,
    ...render(
      <AppDialogProvider>
        <PocketView onOpenLogin={onOpenLogin} />
      </AppDialogProvider>,
    ),
  };
}

describe('PocketView', () => {
  beforeEach(async () => {
    await db.nodes.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists existing memos and opens sign-in from the header', async () => {
    const id = await createPocketNote('地铁上想到的');
    const user = userEvent.setup();
    const { onOpenLogin } = renderPocket();
    expect(await screen.findByTestId(`pocket-item-${id}`)).toBeInTheDocument();
    expect(screen.getByText('地铁上想到的')).toBeInTheDocument();
    expect(screen.queryByTestId(`pocket-place-${id}`)).toBeNull();
    expect(screen.queryByTestId(`pocket-delete-${id}`)).toBeNull();
    await user.click(screen.getByTestId('pocket-sign-in'));
    expect(onOpenLogin).toHaveBeenCalled();
  });

  it('hides the sign-in button when login is not offered', async () => {
    const id = await createPocketNote('地铁上想到的');
    render(
      <AppDialogProvider>
        <PocketView />
      </AppDialogProvider>,
    );
    expect(await screen.findByTestId(`pocket-item-${id}`)).toBeInTheDocument();
    expect(screen.queryByTestId('pocket-sign-in')).toBeNull();
  });

  it('long-presses a memo to select it, then deletes from the bottom bar', async () => {
    const id = await createPocketNote('地铁上想到的');
    renderPocket();
    const card = await screen.findByTestId(`pocket-item-${id}`);
    vi.useFakeTimers();
    fireEvent.pointerDown(card, { button: 0, clientX: 10, clientY: 10, pointerType: 'touch' });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.pointerUp(card);
    vi.useRealTimers();
    expect(card).toHaveAttribute('data-selected', 'true');
    expect(screen.queryByTestId('pocket-new')).toBeNull();
    expect(screen.getByTestId('pocket-select-delete')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('pocket-select-delete'));
    expect(await screen.findByText('删除「地铁上想到的」？')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '确定' }));
    await waitFor(async () => {
      expect(await listPocketNotes()).toHaveLength(0);
    });
    expect(screen.queryByTestId('pocket-select-delete')).toBeNull();
  });

  it('cancels selection from the header', async () => {
    const id = await createPocketNote('地铁上想到的');
    const { onOpenLogin } = renderPocket();
    const card = await screen.findByTestId(`pocket-item-${id}`);
    vi.useFakeTimers();
    fireEvent.pointerDown(card, { button: 0, clientX: 10, clientY: 10, pointerType: 'touch' });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.pointerUp(card);
    vi.useRealTimers();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('pocket-cancel-select'));
    expect(onOpenLogin).not.toHaveBeenCalled();
    expect(card).toHaveAttribute('data-selected', 'false');
    expect(screen.getByTestId('pocket-new')).toBeInTheDocument();
  });

  it('creates a memo from the composer and keeps it in the pocket', async () => {
    const user = userEvent.setup();
    renderPocket();
    await user.click(await screen.findByTestId('pocket-new'));
    const editor = await screen.findByTestId('pocket-editor');
    expect(screen.queryByTestId('pocket-editor-place')).toBeNull();
    expect(screen.queryByTestId('pocket-editor-delete')).toBeNull();
    await user.type(editor, '回头放到墙上');
    await user.click(screen.getByTestId('pocket-back'));
    await waitFor(async () => {
      expect(await listPocketNotes()).toHaveLength(1);
    });
    expect(screen.getByText('回头放到墙上')).toBeInTheDocument();
    expect((await db.nodes.toArray()).every((n) => n.canvasId === POCKET_CANVAS_ID)).toBe(true);
  });

  it('closes the editor when the browser back button is pressed', async () => {
    const pushState = vi.spyOn(window.history, 'pushState').mockImplementation(() => {});
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const id = await createPocketNote('地铁上想到的');
    renderPocket();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId(`pocket-item-${id}`));
    expect(await screen.findByTestId('pocket-editor')).toBeInTheDocument();
    expect(pushState).toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    await waitFor(() => {
      expect(screen.queryByTestId('pocket-editor')).not.toBeInTheDocument();
    });
    expect(back).not.toHaveBeenCalled();
    pushState.mockRestore();
    back.mockRestore();
  });

  it('exits select mode when the browser back button is pressed', async () => {
    const pushState = vi.spyOn(window.history, 'pushState').mockImplementation(() => {});
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const id = await createPocketNote('地铁上想到的');
    renderPocket();
    const card = await screen.findByTestId(`pocket-item-${id}`);
    vi.useFakeTimers();
    fireEvent.pointerDown(card, { button: 0, clientX: 10, clientY: 10, pointerType: 'touch' });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.pointerUp(card);
    vi.useRealTimers();
    expect(card).toHaveAttribute('data-selected', 'true');
    expect(pushState).toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    await waitFor(() => {
      expect(card).toHaveAttribute('data-selected', 'false');
    });
    expect(screen.getByTestId('pocket-new')).toBeInTheDocument();
    expect(back).not.toHaveBeenCalled();
    pushState.mockRestore();
    back.mockRestore();
  });

  it('shows the account control when signed in', async () => {
    const id = await createPocketNote('地铁上想到的');
    render(
      <AppDialogProvider>
        <PocketView onOpenLogin={vi.fn()} accountSignedIn />
      </AppDialogProvider>,
    );
    expect(await screen.findByTestId(`pocket-item-${id}`)).toBeInTheDocument();
    expect(screen.getByTestId('pocket-sign-in')).toHaveAttribute('aria-label', '云同步');
  });

  it('shows the empty state when the pocket has no memos', async () => {
    renderPocket();
    expect(await screen.findByTestId('pocket-empty')).toBeInTheDocument();
  });
});
