import {
  canonicalUrl,
  crawlerArticleHtml,
  jsonLdForRoute,
  matchGeoRoute,
  seoForRoute,
  type GeoRoute,
  type PolicyMarkdown,
} from './siteGeo';
import { SITE_OG_IMAGE_URL } from '../utils/siteSeo';

const GEO_STYLE = `<style id="spoor-geo-crawler-style">
#spoor-geo-crawler{
  position:absolute;
  width:1px;
  height:1px;
  padding:0;
  margin:-1px;
  overflow:hidden;
  clip:rect(0,0,0,0);
  white-space:nowrap;
  border:0;
}
#spoor-geo-crawler .spoor-geo-pre{white-space:pre-wrap}
</style>`;

export function applyGeoHtml(
  html: string,
  route: GeoRoute,
  policy?: PolicyMarkdown,
): string {
  const seo = seoForRoute(route);
  const canonical = canonicalUrl(route.path);
  const jsonLd = JSON.stringify(jsonLdForRoute(route));
  const article = crawlerArticleHtml(route, policy);
  let next = html;

  next = replaceTagContent(next, 'title', escapeText(seo.title));
  next = upsertMeta(next, 'name', 'description', seo.description);
  next = upsertMeta(next, 'name', 'robots', seo.noindex ? 'noindex, nofollow' : 'index, follow');
  next = upsertMeta(next, 'property', 'og:type', route.kind === 'guide' ? 'article' : 'website');
  next = upsertMeta(next, 'property', 'og:title', seo.title);
  next = upsertMeta(next, 'property', 'og:description', seo.description);
  next = upsertMeta(next, 'property', 'og:url', canonical);
  next = upsertMeta(next, 'property', 'og:image', SITE_OG_IMAGE_URL);
  next = upsertMeta(next, 'property', 'og:locale', 'en_US');
  next = upsertMeta(next, 'name', 'twitter:title', seo.title);
  next = upsertMeta(next, 'name', 'twitter:description', seo.description);
  next = upsertMeta(next, 'name', 'twitter:image', SITE_OG_IMAGE_URL);
  next = upsertLink(next, 'canonical', canonical);
  next = upsertJsonLd(next, jsonLd);
  next = upsertStyle(next);
  next = upsertArticle(next, article);
  next = next.replace(/<html\b([^>]*)>/i, (_all, attrs: string) => {
    const withoutLang = String(attrs).replace(/\s*lang="[^"]*"/i, '');
    return `<html lang="en"${withoutLang}>`;
  });
  return next;
}

export function applyGeoHtmlForPath(
  html: string,
  pathname: string,
  policy?: PolicyMarkdown,
): string | null {
  const route = matchGeoRoute(pathname);
  if (!route) return null;
  return applyGeoHtml(html, route, policy);
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;');
}

function replaceTagContent(html: string, tag: string, inner: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'i');
  if (re.test(html)) return html.replace(re, `<${tag}>${inner}</${tag}>`);
  return html.replace('</head>', `<${tag}>${inner}</${tag}>\n</head>`);
}

function upsertMeta(
  html: string,
  attr: 'name' | 'property',
  key: string,
  content: string,
): string {
  const re = new RegExp(
    `<meta\\s[^>]*${attr}=["']${escapeRegExp(key)}["'][^>]*>`,
    'i',
  );
  const tag = `<meta ${attr}="${key}" content="${escapeAttr(content)}" />`;
  if (re.test(html)) return html.replace(re, tag);
  return html.replace('</head>', `${tag}\n</head>`);
}

function upsertLink(html: string, rel: string, href: string): string {
  const re = new RegExp(`<link\\s[^>]*rel=["']${escapeRegExp(rel)}["'][^>]*>`, 'i');
  const tag = `<link rel="${rel}" href="${escapeAttr(href)}" />`;
  if (re.test(html)) return html.replace(re, tag);
  return html.replace('</head>', `${tag}\n</head>`);
}

function upsertJsonLd(html: string, json: string): string {
  const tagged =
    /<script type="application\/ld\+json" id="spoor-jsonld">[\s\S]*?<\/script>/i;
  const untagged = /<script type="application\/ld\+json">[\s\S]*?<\/script>/i;
  const block = `<script type="application/ld+json" id="spoor-jsonld">\n${json}\n    </script>`;
  if (tagged.test(html)) return html.replace(tagged, block);
  if (untagged.test(html)) return html.replace(untagged, block);
  return html.replace('</head>', `${block}\n</head>`);
}

function upsertStyle(html: string): string {
  if (html.includes('id="spoor-geo-crawler-style"')) return html;
  return html.replace('</head>', `${GEO_STYLE}\n</head>`);
}

function upsertArticle(html: string, article: string): string {
  const re = /<article id="spoor-geo-crawler">[\s\S]*?<\/article>/i;
  if (re.test(html)) return html.replace(re, article);
  if (html.includes('</body>')) {
    return html.replace('</body>', `${article}\n</body>`);
  }
  return `${html}\n${article}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
