import { readBrowserLanguages, resolveInitialLanguage } from './appLanguage';

/** Labels for in-editor Apply / Reject chips. Avoids useTranslation inside TipTap
 *  NodeViews, which mount outside I18nextProvider and fall back to English. */
export function essayEditorActionLabels(): {
  apply: string;
  reject: string;
  deleteLabel: string;
} {
  const stored =
    typeof localStorage === 'undefined' ? null : localStorage.getItem('app_language');
  const lang = resolveInitialLanguage(stored, readBrowserLanguages());
  if (lang === 'zh') {
    return { apply: '应用', reject: '拒绝', deleteLabel: '（删除）' };
  }
  return { apply: 'Apply', reject: 'Reject', deleteLabel: '(delete)' };
}
