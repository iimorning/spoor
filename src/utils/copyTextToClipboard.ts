/**
 * 写纯文本，可选同时写一份富文本。
 *
 * 剪贴板可以同时持有多种格式，由接收方挑：认 `text/html` 的（Word、飞书、
 * Google Docs…）拿到 `html`，只认纯文本的（记事本、终端、多数聊天工具）拿
 * `text/plain`。所以给上 html 不会让纯文本场景变脏。
 *
 * 没有 html 时行为和以前逐字节一致。
 */
export async function copyTextToClipboard(
  text: string,
  options?: { html?: string },
): Promise<void> {
  const html = options?.html;
  const canWriteRich =
    html !== undefined &&
    typeof window !== 'undefined' &&
    typeof window.ClipboardItem === 'function' &&
    navigator.clipboard?.write !== undefined;

  if (canWriteRich && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ]);
      return;
    } catch {
      // 有些环境（权限、非安全上下文）不支持 write：退回只写纯文本。
    }
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document === 'undefined') {
    throw new Error('clipboard unavailable');
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  const exec = typeof document.execCommand === 'function' ? document.execCommand('copy') : false;
  textarea.remove();
  if (!exec) throw new Error('copy failed');
}