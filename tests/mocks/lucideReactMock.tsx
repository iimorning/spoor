import React from 'react';

/**
 * lucide-react 的测试替身：每个图标换成一个占位 `<svg data-testid="icon-名字">`。
 *
 * 为什么从**真实模块**的导出建这份表，而不是手抄名单、也不是用 Proxy：
 * - 手抄名单少写一个图标，就会 `createElement(undefined)` 把整棵组件树打挂，
 *   报错却是"找不到某个按钮"，非常难查（历史上踩过好几次）。
 * - 用 Proxy 兜底也不行：ESM 具名导入要靠模块导出的键集合来解析，
 *   一个没有 ownKeys 的 Proxy 在 vitest 眼里是"没有导出"，整个测试文件会
 *   收集不到用例——而且是静默跳过（退出码 0），比报错更危险。
 *
 * `importOriginal` 拿到真实导出，所以键集合永远和 lucide 同步，谁都不用再维护。
 */
export async function lucideReactMock(
  importOriginal: <T = Record<string, unknown>>() => Promise<T>,
): Promise<Record<string, unknown>> {
  const actual = await importOriginal<Record<string, unknown>>();

  const icons: Record<string, unknown> = {};
  for (const name of Object.keys(actual)) {
    // 只替换组件（函数）与图标对象；其它导出原样保留。
    if (typeof actual[name] !== 'function' && typeof actual[name] !== 'object') continue;
    if (name === 'default') continue;
    icons[name] = (props: Record<string, unknown>) => (
      <svg data-testid={`icon-${name}`} {...props} />
    );
  }
  return icons;
}
