import fs from 'fs';
import path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Plugin, PreviewServer, ResolvedConfig, ViteDevServer } from 'vite';
import { applyGeoHtml } from '../src/geo/applyGeoHtml';
import {
  geoRoutes,
  LLMS_FULL_TXT_PATH,
  LLMS_TXT_PATH,
  matchGeoRoute,
  renderLlmsFullTxt,
  renderLlmsTxt,
  sitemapXml,
  type PolicyMarkdown,
} from '../src/geo/siteGeo';

function readPolicyMarkdown(root: string): PolicyMarkdown {
  const docs = path.join(root, 'docs');
  const read = (name: string) => fs.readFileSync(path.join(docs, name), 'utf8');
  return {
    privacyEn: read('PRIVACY_POLICY.md'),
    privacyZh: read('PRIVACY_POLICY.zh.md'),
    termsEn: read('TERMS_OF_SERVICE.md'),
    termsZh: read('TERMS_OF_SERVICE.zh.md'),
    aupEn: read('ACCEPTABLE_USE_POLICY.md'),
    aupZh: read('ACCEPTABLE_USE_POLICY.zh.md'),
  };
}

function pathnameOf(url: string | undefined): string {
  try {
    return new URL(url ?? '/', 'http://localhost').pathname;
  } catch {
    return '/';
  }
}

function wantsHtml(req: IncomingMessage): boolean {
  const accept = req.headers.accept ?? '';
  if (!accept || accept.includes('text/html')) return true;
  return false;
}

function sendText(res: ServerResponse, body: string, type: string, status = 200): void {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.end(body);
}

function attachLlms(server: ViteDevServer | PreviewServer): void {
  server.middlewares.use((req, res, next) => {
    const pathname = pathnameOf(req.url);
    if (pathname === LLMS_TXT_PATH) {
      sendText(res, renderLlmsTxt(), 'text/plain; charset=utf-8');
      return;
    }
    if (pathname === LLMS_FULL_TXT_PATH) {
      sendText(res, renderLlmsFullTxt(), 'text/plain; charset=utf-8');
      return;
    }
    if (pathname === '/sitemap.xml') {
      sendText(res, sitemapXml(), 'application/xml; charset=utf-8');
      return;
    }
    next();
  });
}

function attachDevGeoHtml(server: ViteDevServer, root: string): void {
  const policy = readPolicyMarkdown(root);
  const indexPath = path.join(root, 'index.html');

  server.middlewares.use(async (req, res, next) => {
    const pathname = pathnameOf(req.url);
    const route = matchGeoRoute(pathname);
    if (!route || pathname === '/' || !wantsHtml(req) || path.extname(pathname)) {
      next();
      return;
    }

    try {
      const raw = fs.readFileSync(indexPath, 'utf8');
      const transformed = await server.transformIndexHtml(pathname, raw);
      sendText(res, applyGeoHtml(transformed, route, policy), 'text/html; charset=utf-8');
    } catch {
      next();
    }
  });
}

function distFileForRoute(distDir: string, routePath: string): string {
  if (routePath === '/') return path.join(distDir, 'index.html');
  return path.join(distDir, routePath.replace(/^\//, ''), 'index.html');
}

function writeGeoOutputs(outDir: string, root: string): number {
  const builtIndex = path.join(outDir, 'index.html');
  if (!fs.existsSync(builtIndex)) {
    throw new Error(`spoor-geo-prerender: missing ${builtIndex}`);
  }

  const policy = readPolicyMarkdown(root);
  const template = fs.readFileSync(builtIndex, 'utf8');
  const routes = geoRoutes();

  for (const route of routes) {
    const outFile = distFileForRoute(outDir, route.path);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, applyGeoHtml(template, route, policy), 'utf8');
  }

  fs.writeFileSync(path.join(outDir, 'llms.txt'), renderLlmsTxt(), 'utf8');
  fs.writeFileSync(path.join(outDir, 'llms-full.txt'), renderLlmsFullTxt(), 'utf8');
  fs.writeFileSync(path.join(outDir, 'sitemap.xml'), sitemapXml(), 'utf8');
  return routes.length;
}

export function geoPrerenderPlugin(): Plugin {
  let config: ResolvedConfig | undefined;

  return {
    name: 'spoor-geo-prerender',
    configResolved(resolved) {
      config = resolved;
    },
    configureServer(server) {
      const root = server.config.root;
      attachLlms(server);
      attachDevGeoHtml(server, root);
    },
    configurePreviewServer(server) {
      attachLlms(server);
    },
    closeBundle: {
      sequential: true,
      order: 'post',
      handler() {
        if (!config || config.command !== 'build' || config.build.ssr) return;
        const outDir = path.resolve(config.root, config.build.outDir);
        const n = writeGeoOutputs(outDir, config.root);
        config.logger.info(`[spoor-geo] prerendered ${n} marketing pages → ${outDir}`);
      },
    },
  };
}
