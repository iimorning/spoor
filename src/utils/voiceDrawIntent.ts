/**
 * Detect spoken/typed requests to generate an illustration.
 * Returns a short prompt fragment when the user asks to draw / illustrate.
 */
export function parseVoiceDrawIntent(raw: string): { prompt: string } | null {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return null;

  const patterns: RegExp[] = [
    /(?:画一张|画一幅|帮我画|生成一张图|生成图片|配一张图|配图|画个|画个图|文生图)\s*[:：]?\s*(.+)$/i,
    /(?:请)?(?:帮我)?生成(?:一[张幅个])?(?:一下)?(.+?)(?:的)?(?:图片|插画|配图|示意图|海报)$/i,
    /(?:draw|illustrate|generate\s+(?:an?\s+)?(?:image|picture|illustration))\s*[:：]?\s*(.+)$/i,
    /^(.+?)(?:的)?(?:插画|配图|示意图)$/i,
  ];

  for (const re of patterns) {
    const m = text.match(re);
    const captured = m?.[1]?.trim();
    if (captured && captured.length >= 2) {
      return { prompt: captured.slice(0, 280) };
    }
  }

  // Bare trigger with no payload — caller may fall back to recent context.
  if (
    /^(?:画一张|画一幅|帮我画|生成一张图|生成图片|配一张图|配图|文生图|draw|illustrate)[.!。！]?$/i.test(
      text,
    )
  ) {
    return { prompt: '' };
  }

  return null;
}

/** Follow-up that chases a missing picture instead of naming a new subject. */
export function isDrawChaseUp(raw: string): boolean {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text || text.length > 80) return false;
  return /在哪里|在哪儿|图呢|图片呢|附件|调用.?302|不是可以|你画了|出图/.test(text);
}
