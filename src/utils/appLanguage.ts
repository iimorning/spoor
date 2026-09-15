const SUPPORTED = new Set(['en', 'zh']);

export type AppLanguage = 'en' | 'zh';

export function isChineseLocale(tag: string): boolean {
  const normalized = tag.trim().toLowerCase().replace(/_/g, '-');
  return normalized === 'zh' || normalized.startsWith('zh-');
}

/** Saved preference wins; otherwise Chinese browser locales default to zh. */
export function resolveInitialLanguage(
  stored: string | null | undefined,
  browserLanguages: readonly string[] = [],
): AppLanguage {
  const saved = (stored ?? '').trim().toLowerCase();
  if (SUPPORTED.has(saved)) return saved as AppLanguage;
  for (const tag of browserLanguages) {
    if (isChineseLocale(tag)) return 'zh';
  }
  return 'en';
}

export function readBrowserLanguages(): string[] {
  if (typeof navigator === 'undefined') return [];
  const ordered: string[] = [];
  if (navigator.languages?.length) ordered.push(...navigator.languages);
  if (navigator.language) ordered.unshift(navigator.language);
  return ordered;
}
