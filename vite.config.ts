import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv, type Plugin} from 'vite';
import {volcAsrProxyPlugin} from './vite-plugins/volcAsrProxyPlugin';
import {minimaxTtsProxyPlugin} from './vite-plugins/minimaxTtsProxyPlugin';
import {fetchPageProxyPlugin} from './vite-plugins/fetchPageProxyPlugin';
import {geoPrerenderPlugin} from './vite-plugins/geoPrerenderPlugin';
import {ortWasmPlugin} from './vite-plugins/ortWasmPlugin';

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
      ortWasmPlugin(),
    ],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    optimizeDeps: {
      // 端侧 OCR 的 SDK 用 `new URL('./assets/worker-entry-*.js', import.meta.url)` 造 Worker。
      // 一旦这个依赖被 esbuild 预打包，import.meta.url 就指向 .vite/deps/，
      // 那个 assets 路径不存在，Worker 起来就报 "OCR worker failed"，而且只在 dev 出现
      // （build 走的是 rollup 的 new URL 处理，是好的）。所以必须排除掉，让它按原样 ESM 提供。
      exclude: ['@paddleocr/paddleocr-js'],
      // 被排除的包，它的 CJS 依赖也就不再走 esbuild 的 interop 了：
      // clipper-lib / opencv-js / js-yaml 都只有一个 default 导出，按原样 ESM 提供时
      // 浏览器会报 "does not provide an export named 'default'"。所以把依赖逐个捞回来预打包。
      // 这几个就是 @paddleocr/paddleocr-js 的全部 dependencies（见它的 package.json）。
      include: ['clipper-lib', '@techstark/opencv-js', 'js-yaml', 'onnxruntime-web'],
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
