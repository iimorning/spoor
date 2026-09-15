import React from 'react';
import ReactMarkdown from 'react-markdown';
import tosEn from '../../docs/TERMS_OF_SERVICE.md?raw';
import tosZh from '../../docs/TERMS_OF_SERVICE.zh.md?raw';
import privacyEn from '../../docs/PRIVACY_POLICY.md?raw';
import privacyZh from '../../docs/PRIVACY_POLICY.zh.md?raw';
import aupEn from '../../docs/ACCEPTABLE_USE_POLICY.md?raw';
import aupZh from '../../docs/ACCEPTABLE_USE_POLICY.zh.md?raw';
import {
  markdownGfmPlugins,
  markdownRehypePlugins,
  markdownBodyComponents,
} from './markdownBody';

export type PolicyKind = 'tos' | 'privacy' | 'aup';
export type PolicyLocale = 'en' | 'zh';

interface PolicyDoc {
  source: string;
  titleKeyEn: string;
  titleKeyZh: string;
}

export const POLICY_DOCS: Record<PolicyKind, Record<PolicyLocale, PolicyDoc>> = {
  tos: {
    en: { source: tosEn, titleKeyEn: 'policy.title_tos', titleKeyZh: 'policy.title_tos' },
    zh: { source: tosZh, titleKeyEn: 'policy.title_tos', titleKeyZh: 'policy.title_tos' },
  },
  privacy: {
    en: { source: privacyEn, titleKeyEn: 'policy.title_privacy', titleKeyZh: 'policy.title_privacy' },
    zh: { source: privacyZh, titleKeyEn: 'policy.title_privacy', titleKeyZh: 'policy.title_privacy' },
  },
  aup: {
    en: { source: aupEn, titleKeyEn: 'policy.title_aup', titleKeyZh: 'policy.title_aup' },
    zh: { source: aupZh, titleKeyEn: 'policy.title_aup', titleKeyZh: 'policy.title_aup' },
  },
};

export function pickInitialPolicyLocale(i18nLang: string | undefined): PolicyLocale {
  return i18nLang?.startsWith('zh') ? 'zh' : 'en';
}

interface PolicyBodyProps {
  source: string;
}

interface PolicyErrorBoundaryProps {
  children: React.ReactNode;
  source: string;
}

interface PolicyErrorBoundaryState {
  error: Error | null;
}

class PolicyErrorBoundary extends React.Component<
  PolicyErrorBoundaryProps,
  PolicyErrorBoundaryState
> {
  state: PolicyErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): PolicyErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="policy-modal__error">
          <p className="policy-modal__error-title">Couldn&apos;t render this document.</p>
          <p className="policy-modal__error-msg">{this.state.error.message}</p>
          <details className="policy-modal__error-details">
            <summary>Show raw source</summary>
            <pre className="policy-modal__error-pre">
              {this.props.source.slice(0, 4000)}
              {this.props.source.length > 4000 ? '\n\n…(truncated)' : ''}
            </pre>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}

function PolicyBody({ source }: PolicyBodyProps) {
  return (
    <ReactMarkdown
      remarkPlugins={markdownGfmPlugins}
      rehypePlugins={markdownRehypePlugins}
      components={markdownBodyComponents}
    >
      {source}
    </ReactMarkdown>
  );
}

export function PolicyDocumentBody({ source }: PolicyBodyProps) {
  return (
    <PolicyErrorBoundary source={source}>
      <PolicyBody source={source} />
    </PolicyErrorBoundary>
  );
}
