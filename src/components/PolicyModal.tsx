/**
 * PolicyModal — modal dialog for legal documents (Terms / Privacy).
 *
 * Prefer dedicated routes `/terms`, `/privacy`, `/aup`, and `/report` for stable reviewer URLs;
 * this modal remains for in-flow previews where needed.
 */

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  POLICY_DOCS,
  PolicyDocumentBody,
  pickInitialPolicyLocale,
  type PolicyKind,
  type PolicyLocale,
} from './policyContent';
import './policy-modal.css';

export type { PolicyKind, PolicyLocale };

interface PolicyModalProps {
  kind: PolicyKind | null;
  onClose: () => void;
}

export function PolicyModal({ kind, onClose }: PolicyModalProps) {
  const { t, i18n } = useTranslation();
  const [locale, setLocale] = useState<PolicyLocale>(() => pickInitialPolicyLocale(i18n.language));

  useEffect(() => {
    if (!kind) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [kind, onClose]);

  useEffect(() => {
    if (kind) {
      setLocale(pickInitialPolicyLocale(i18n.language));
    }
  }, [kind, i18n.language]);

  if (!kind) return null;

  const doc = POLICY_DOCS[kind][locale];
  const title = t(doc.titleKeyEn);

  const modal = (
    <div
      className="policy-modal"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div className="policy-modal__panel" onClick={(e) => e.stopPropagation()}>
        <header className="policy-modal__head">
          <h2 className="policy-modal__title">{title}</h2>
          <div className="policy-modal__lang" role="group" aria-label={t('policy.lang_toggle')}>
            <button
              type="button"
              className={`policy-modal__lang-btn ${locale === 'en' ? 'is-active' : ''}`}
              aria-pressed={locale === 'en'}
              onClick={() => setLocale('en')}
            >
              EN
            </button>
            <button
              type="button"
              className={`policy-modal__lang-btn ${locale === 'zh' ? 'is-active' : ''}`}
              aria-pressed={locale === 'zh'}
              onClick={() => setLocale('zh')}
            >
              中文
            </button>
            <button
              type="button"
              onClick={onClose}
              className="policy-modal__close"
              aria-label={t('policy.close')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>
        <div className="policy-modal__body">
          <PolicyDocumentBody source={doc.source} />
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
