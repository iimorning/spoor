/** 至少要有一个字母或数字，才算"说了话"。 */
const SUBSTANTIVE = /[\p{L}\p{N}]/u;

/**
 * 这段文字是不是真的说了话。
 *
 * 模型偶尔会用「…」「...」「—」交差：它在信封里必须填 `message`，又不确定该写什么，
 * 就塞一个省略号。这种回复比没有更糟——它占了一个气泡、还把上一句好好写完的答案
 * 顶掉了，用户只看到一个点。
 *
 * 汉字、字母、数字都算内容；纯标点、纯省略号、空白不算。
 */
export function hasSubstantiveText(text: string | null | undefined): boolean {
  return SUBSTANTIVE.test(text ?? '');
}
