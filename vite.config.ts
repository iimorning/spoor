import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv, type Plugin} from 'vite';
import {volcAsrProxyPlugin} from './vite-plugins/volcAsrProxyPlugin';
import {minimaxTtsProxyPlugin} from './vite-plugins/minimaxTtsProxyPlugin';
import {fetchPageProxyPlugin} from './vite-plugins/fetchPageProxyPlugin';
import {geoPrerenderPlugin} from './vite-plugins/geoPrerenderPlugin';

/** 与 tp- Token 套餐控制台一致；开发代理转发到此前缀 */
const MIMO_PROXY_TARGET = 'https://token-plan-cn.xiaomimimo.com/v1';
/** DeepSeek OpenAI-compatible API proxy target */
const DEEPSEEK_PROXY_TARGET = 'https://api.deepseek.com/v1';
/** 秘塔搜索 API 代理目标 */
const METASO_PROXY_TARGET = 'https://metaso.cn';
/** Volcengine Ark (Doubao) OpenAI-compatible API proxy target */
const DOUBAO_PROXY_TARGET = 'https://ark.cn-beijing.volces.com/api/v3';
/** MiniMax OpenAPI (China) */
const MINIMAX_PROXY_TARGET = 'https://api.minimaxi.com';
/** 302.AI China (Flux-2-Klein-4b, etc.) — CN host is more reachable domestically */
const API302_PROXY_TARGET = 'https://api.302ai.cn';

const apiProxy = {
  '/api/mimo': {
    target: MIMO_PROXY_TARGET,
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/api\/mimo/, ''),
  },
  '/api/deepseek': {
    target: DEEPSEEK_PROXY_TARGET,
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/api\/deepseek/, ''),
  },
  '/api/doubao': {
    target: DOUBAO_PROXY_TARGET,
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/api\/doubao/, ''),
  },
  '/api/metaso': {
    target: METASO_PROXY_TARGET,
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/api\/metaso/, ''),
  },
  '/api/minimax': {
    target: MINIMAX_PROXY_TARGET,
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/api\/minimax/, ''),
  },
  '/api/302': {
    target: API302_PROXY_TARGET,
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/api\/302/, ''),
  },
  '/api/openrouter': {
    target: 'https://openrouter.ai/api/v1',
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/api\/openrouter/, ''),
  },
  // Generated-image CDNs (not the JSON API). Prefixes must not start with /api/302.
  '/api/file-302cn': {
    target: 'https://file.302ai.cn',
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/api\/file-302cn/, ''),
  },
  '/api/file-302ai': {
    target: 'https://file.302.ai',
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/api\/file-302ai/, ''),
  },
};

/**
 * Chrome sometimes answers Vite's 304 with net::ERR_CACHE_READ_FAILURE
 * (corrupt disk cache) and the page stays blank. Never 304 /src modules in
 * dev; always send a body with Cache-Control: no-store.
 */
function disableChromeModule304(): Plugin {
  return {
    name: 'disable-chrome-module-304',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (
          url.includes('/src/') ||
          url.includes('/@fs/') ||
          url.includes('/@vite/') ||
          url.includes('/@react-refresh') ||
          url.includes('/node_modules/')
        ) {
          delete req.headers['if-none-match'];
          delete req.headers['if-modified-since'];
          res.setHeader('Cache-Control', 'no-store');
        }
        next();
      });
    },
  };
}

export default defineConfig(({mode, command}) => {
  const env = loadEnv(mode, '.', '');
  const hostedDoubaoKey = (env.VITE_BUILTIN_DOUBAO_API_KEY ?? '').trim();
  if (command === 'build' && !hostedDoubaoKey) {
    console.warn(
      '\n[Spoor] VITE_BUILTIN_DOUBAO_API_KEY is not set — the built site will NOT include hosted Doubao for end users.\n' +
        '  Local: npm run setup:doubao-key -- ark-... then npm run build\n' +
        '  Netlify: Site configuration → Environment variables → add VITE_BUILTIN_DOUBAO_API_KEY → redeploy\n',
    );
  }
  return {
    plugins: [
      disableChromeModule304(),
      react(),
      tailwindcss(),
      volcAsrProxyPlugin(),
      minimaxTtsProxyPlugin(),
      fetchPageProxyPlugin(),
      geoPrerenderPlugin(),
    ],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      headers: {
        'Cache-Control': 'no-store',
      },
      proxy: apiProxy,
    },
    preview: {
      proxy: apiProxy,
    },
  };
});
