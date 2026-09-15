/** Split tour body copy into short lines for the red-dot list. */
export function onboardingBodyLines(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof raw !== 'string') return [];
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}
