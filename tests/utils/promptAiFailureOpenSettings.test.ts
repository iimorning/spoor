import { describe, it, expect, vi } from 'vitest';
import i18n from '../../src/i18n';
import { promptAiFailureOpenSettings } from '../../src/utils/promptAiFailureOpenSettings';

describe('promptAiFailureOpenSettings', () => {
  it('opens settings when the user confirms', async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const onOpenSettings = vi.fn();
    await i18n.changeLanguage('zh');
    await promptAiFailureOpenSettings({
      confirm,
      t: i18n.t.bind(i18n),
      errorMessage: '服务器代理调用失败 (500: internal_error)',
      onOpenSettings,
    });
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'AI 生成失败',
        confirmLabel: '去登录',
      }),
    );
    expect(String(confirm.mock.calls[0]![0].message)).toContain('500: internal_error');
    expect(String(confirm.mock.calls[0]![0].message)).toContain('打开设置登录');
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('does not open settings when the user cancels', async () => {
    const onOpenSettings = vi.fn();
    await promptAiFailureOpenSettings({
      confirm: vi.fn().mockResolvedValue(false),
      t: i18n.t.bind(i18n),
      errorMessage: 'boom',
      onOpenSettings,
    });
    expect(onOpenSettings).not.toHaveBeenCalled();
  });
});
