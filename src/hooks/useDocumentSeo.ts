import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { isTauriRuntime } from '../utils/isTauriRuntime';
import { applyDocumentSeo, resolveDocumentSeo } from '../utils/siteSeo';

export function useDocumentSeo(
  pathname: string,
  options?: {
    disabled?: boolean;
    listingTitle?: string | null;
    listingDescription?: string | null;
  },
): void {
  const { i18n } = useTranslation();
  const disabled = options?.disabled === true;
  const listingTitle = options?.listingTitle;
  const listingDescription = options?.listingDescription;

  useEffect(() => {
    if (disabled) return;
    if (isTauriRuntime()) {
      document.title = 'Spoor';
      return;
    }
    applyDocumentSeo(
      resolveDocumentSeo({
        pathname,
        language: i18n.language,
        listingTitle,
        listingDescription,
      }),
    );
  }, [disabled, pathname, i18n.language, listingTitle, listingDescription]);
}
