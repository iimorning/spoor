import { SITE_PUBLIC_ORIGIN } from '../constants/siteLegal';
import {
  communityListingId,
  isAppPath,
  isAupPath,
  isCommunityPath,
  isGuidesPath,
  isPricingPath,
  isPrivacyPath,
  isReportPath,
  isTermsPath,
  guideSlug,
} from './appRoute';
import { getGuide, guideCopy, guideIndexCopy } from '../geo/guidesContent';

export const SITE_OG_IMAGE_PATH = '/og.png';
export const SITE_OG_IMAGE_URL = `${SITE_PUBLIC_ORIGIN}${SITE_OG_IMAGE_PATH}`;

export type SeoLanguage = 'en' | 'zh';

export type DocumentSeoSpec = {
  title: string;
  description: string;
  canonicalPath: string;
  noindex: boolean;
  language: SeoLanguage;
};

const COPY: Record<
  SeoLanguage,
  Record<
    'home' | 'pricing' | 'community' | 'privacy' | 'terms' | 'aup' | 'report' | 'app',
    { title: string; description: string }
  >
> = {
  en: {
    home: {
      title: 'Spoor — A Local-First Infinite Canvas for Thinking, Writing & Research',
      description:
        'Spoor is a local-first infinite canvas for thinking, writing, research, and creative work. Capture records on your phone; turn notes, references, and AI replies into editable pieces of the same workspace.',
    },
    pricing: {
      title: 'Spoor pricing — Free and Pro',
      description:
        'Start free on a local canvas. Upgrade to Pro for cloud backup and a monthly hosted allowance. WeChat and card checkout.',
    },
    community: {
      title: 'Spoor community — shared canvases and AI personas',
      description:
        'Browse starter canvases with their personas and apply a listing to your own Spoor workspace in one click.',
    },
    privacy: {
      title: 'Spoor Privacy Policy',
      description: 'How Spoor handles canvas data, local storage, optional sync, and third-party AI providers.',
    },
    terms: {
      title: 'Spoor Terms of Service',
      description: 'Terms that govern use of the Spoor web app, desktop app, and paid plans.',
    },
    aup: {
      title: 'Spoor Acceptable Use Policy',
      description: 'Content rules for generated media, prohibited uses, and how to report a violation.',
    },
    report: {
      title: 'Report a content violation — Spoor',
      description: 'Report NSFW, violence, hate, child-safety, deepfake, or IP issues to the Spoor AUP mailbox.',
    },
    app: {
      title: 'Spoor',
      description: 'Spoor canvas — local-first spatial notes with AI personas.',
    },
  },
  zh: {
    home: {
      title: '雪泥 Spoor — 本地优先的无限画布，用于思考、写作与研究',
      description:
        '雪泥是本地优先的思考与创作画布。手机上也能打开记录、随手记下；笔记、资料和 AI 回复都留在同一工作区里，让想法生长而不是消失在对话里。',
    },
    pricing: {
      title: '雪泥 Spoor 价格 — Free 与 Pro',
      description: '免费在本地画布开始。升级 Pro 可云端备份，并获得按月重置的托管额度。支持微信与信用卡支付。',
    },
    community: {
      title: '雪泥社区 — 共享画布与 AI 人设',
      description: '浏览带人设的起始画布，一键应用到你自己的雪泥工作区。',
    },
    privacy: {
      title: '雪泥隐私政策',
      description: '雪泥如何处理画布数据、本地存储、可选同步，以及第三方 AI 服务。',
    },
    terms: {
      title: '雪泥服务条款',
      description: '规范雪泥网页版、桌面版与付费套餐的使用条款。',
    },
    aup: {
      title: '雪泥可接受使用政策',
      description: '生成内容的使用规则、禁止事项，以及如何举报违规。',
    },
    report: {
      title: '举报内容违规 — 雪泥',
      description: '就色情、暴力、仇恨、儿童安全、深度伪造或侵权问题向雪泥 AUP 邮箱举报。',
    },
    app: {
      title: '雪泥 Spoor',
      description: '雪泥画布 — 本地优先的空间便签与 AI 角色。',
    },
  },
};

export function seoLanguage(tag: string | undefined): SeoLanguage {
  return tag?.startsWith('zh') ? 'zh' : 'en';
}

export function resolveDocumentSeo(input: {
  pathname: string;
  language?: string;
  listingTitle?: string | null;
  listingDescription?: string | null;
}): DocumentSeoSpec {
  const language = seoLanguage(input.language);
  const copy = COPY[language];
  const pathname = input.pathname || '/';

  if (isAppPath(pathname)) {
    return {
      ...copy.app,
      canonicalPath: pathname.startsWith('/app') ? pathname : '/app',
      noindex: true,
      language,
    };
  }

  if (isPricingPath(pathname)) {
    return { ...copy.pricing, canonicalPath: '/pricing', noindex: false, language };
  }

  if (isPrivacyPath(pathname)) {
    return { ...copy.privacy, canonicalPath: '/privacy', noindex: false, language };
  }

  if (isTermsPath(pathname)) {
    return { ...copy.terms, canonicalPath: '/terms', noindex: false, language };
  }

  if (isAupPath(pathname)) {
    return { ...copy.aup, canonicalPath: '/aup', noindex: false, language };
  }

  if (isReportPath(pathname)) {
    return { ...copy.report, canonicalPath: '/report', noindex: false, language };
  }

  if (isGuidesPath(pathname)) {
    const slug = guideSlug(pathname);
    const guide = getGuide(slug);
    const index = guideIndexCopy(language);
    if (guide) {
      const copy = guideCopy(guide, language);
      const suffix = language === 'zh' ? '雪泥 Spoor' : 'Spoor';
      return {
        title: `${copy.title} | ${suffix}`,
        description: copy.description,
        canonicalPath: `/guides/${guide.slug}`,
        noindex: false,
        language,
      };
    }
    if (!slug) {
      return {
        title: index.title,
        description: index.description,
        canonicalPath: '/guides',
        noindex: false,
        language,
      };
    }
    return {
      title: index.title,
      description: index.description,
      canonicalPath: '/guides',
      noindex: true,
      language,
    };
  }

  if (isCommunityPath(pathname)) {
    const id = communityListingId(pathname);
    const listingTitle = input.listingTitle?.trim();
    if (id && listingTitle) {
      const extra = input.listingDescription?.trim();
      return {
        title: `${listingTitle} — ${language === 'zh' ? '雪泥社区' : 'Spoor community'}`,
        description: extra || copy.community.description,
        canonicalPath: `/community/${id}`,
        noindex: false,
        language,
      };
    }
    return { ...copy.community, canonicalPath: '/community', noindex: false, language };
  }

  return { ...copy.home, canonicalPath: '/', noindex: false, language };
}

function upsertMeta(selector: string, attrs: Record<string, string>): void {
  if (typeof document === 'undefined') return;
  let el = document.head.querySelector(selector) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement('meta');
    document.head.appendChild(el);
  }
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
}

function upsertLink(rel: string, href: string): void {
  if (typeof document === 'undefined') return;
  let el = document.head.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

export function applyDocumentSeo(spec: DocumentSeoSpec): void {
  if (typeof document === 'undefined') return;

  document.title = spec.title;
  document.documentElement.lang = spec.language === 'zh' ? 'zh-CN' : 'en';

  const canonical = `${SITE_PUBLIC_ORIGIN}${spec.canonicalPath === '/' ? '/' : spec.canonicalPath}`;
  upsertLink('canonical', canonical);

  upsertMeta('meta[name="description"]', { name: 'description', content: spec.description });
  upsertMeta('meta[name="robots"]', {
    name: 'robots',
    content: spec.noindex ? 'noindex, nofollow' : 'index, follow',
  });

  upsertMeta('meta[property="og:type"]', {
    property: 'og:type',
    content: spec.canonicalPath.startsWith('/guides/') ? 'article' : 'website',
  });
  upsertMeta('meta[property="og:site_name"]', { property: 'og:site_name', content: 'Spoor' });
  upsertMeta('meta[property="og:title"]', { property: 'og:title', content: spec.title });
  upsertMeta('meta[property="og:description"]', { property: 'og:description', content: spec.description });
  upsertMeta('meta[property="og:url"]', { property: 'og:url', content: canonical });
  upsertMeta('meta[property="og:image"]', { property: 'og:image', content: SITE_OG_IMAGE_URL });
  upsertMeta('meta[property="og:locale"]', {
    property: 'og:locale',
    content: spec.language === 'zh' ? 'zh_CN' : 'en_US',
  });

  upsertMeta('meta[name="twitter:card"]', { name: 'twitter:card', content: 'summary' });
  upsertMeta('meta[name="twitter:title"]', { name: 'twitter:title', content: spec.title });
  upsertMeta('meta[name="twitter:description"]', { name: 'twitter:description', content: spec.description });
  upsertMeta('meta[name="twitter:image"]', { name: 'twitter:image', content: SITE_OG_IMAGE_URL });
}
