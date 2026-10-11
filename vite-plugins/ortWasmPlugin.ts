/**
 * 端侧 OCR 用的 onnxruntime-web wasm 托管。
 *
 * 为什么要自己发：@paddleocr/paddleocr-js 的默认 `wasmPaths` 写死在
 * `cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/`，而 npm 装进来的是 1.30.0。
 * 让 1.30.0 的 JS 胶水去加载 1.24.3 的 .wasm 是版本错配，属于运行期才炸的坑。
 * 所以按"当前装着的那个版本"把 .wasm / .mjs 发出去，engine 里再把 wasmPaths 指过来。
 *
 * 为什么不直接把文件提交进 public/：.wasm 有 14MB，仓库里 public/fonts 的大字体
 * 已经是 .gitignore 掉的（见 .gitignore），同理。dev 用中间件直读 node_modules，
 * build 时拷进 dist，preview 再从 dist 读。
 */
import { createReadStream, existsSync } from 'node:fs';
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite';

/** 引擎里 ortOptions.wasmPaths 写的就是这个前缀。 */
export const ORT_WASM_URL_PREFIX = '/ort/';
const ORT_PACKAGE_DIST = join('node_modules', 'onnxruntime-web', 'dist');

/**
 * 要托管的 ORT 文件。
 *
 * 注意是 **.jsep** 这一对，不是体积小一半的同名非 jsep 版：
 * onnxruntime-web 的 bundle 把加载器文件名写死成 `ort-wasm-simd-threaded.jsep.mjs`
 * （`let i = "ort-wasm-simd-threaded.jsep.mjs", a = t ?? Nf(i, e)`），跟 backend 设成什么无关；
 * 而 paddleocr-js 的 worker 里把 ORT 整个内联了，够不着 import，也就没法把 alias 改成
 * `onnxruntime-web/wasm` 去蹭那份 14MB 的小包。实测报的就是这个文件的 404。
 *
 * 非 jsep 那对（14.2MB）一起留着兜底：ORT 万一改了硬编码的名字还能接住。
 * 两者都在 dist 里，但用户只会下载 ORT 实际请求的那一个。
 */
const ORT_FILES = [
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.mjs',
] as const;
type OrtAsset = (typeof ORT_FILES)[number];

const MIME: Record<string, string> = {
  '.wasm': 'application/wasm',
  '.mjs': 'text/javascript',
};

function isOrtAsset(name: string): name is OrtAsset {
  return (ORT_FILES as readonly string[]).includes(name);
}

function contentType(name: string): string {
  return MIME[name.slice(name.lastIndexOf('.'))] ?? 'application/octet-stream';
}

/** dev / preview 共用：把目录里的 ORT 资源挂到 ORT_WASM_URL_PREFIX。 */
function serveOrtAssets(dir: string) {
  return (req: IncomingMessage, res: ServerResponse, next: (e?: unknown) => void) => {
    const raw = (req.url ?? '').split('?')[0].replace(/^\/+/, '');
    // 先按字面判一次再解码：畸形转义（`/ort/%`）会让 decodeURIComponent 抛 URIError，
    // 而 connect 中间件链上并没有兜底的错误处理，抛出去就是挂请求。
    if (!(ORT_FILES as readonly string[]).includes(raw)) return next();
    const name = decodeURIComponent(raw);
    const file = isOrtAsset(name) ? join(dir, name) : null;
    if (!file || !existsSync(file)) return next();
    res.setHeader('Content-Type', contentType(name));
    res.setHeader('Cache-Control', 'no-cache');
    createReadStream(file).pipe(res);
  };
}

const MISSING =
  '[spoor-ort-wasm] 找不到 onnxruntime-web 的 wasm，端侧 OCR 会不可用：\n' +
  '  引擎里把 wasmPaths 写死成了 /ort/，没有它就是 404，**不会**自动退回 CDN。';

export function ortWasmPlugin(): Plugin {
  let sourceDir = '';
  let outDir = '';
  let isDevServer = false;

  return {
    name: 'spoor-ort-wasm',
    configResolved(config: ResolvedConfig) {
      // 插件文件在 <repo>/vite-plugins/，往上一级才是仓库根。
      sourceDir = join(dirname(fileURLToPath(import.meta.url)), '..', ORT_PACKAGE_DIST);
      outDir = join(config.build.outDir, ORT_WASM_URL_PREFIX.replace(/^\/|\/$/g, ''));
    },
    configureServer(server: ViteDevServer) {
      isDevServer = true;
      if (!existsSync(sourceDir)) {
        server.config.logger.warn(`${MISSING}\n  查找路径：${sourceDir}`);
        return;
      }
      server.middlewares.use(ORT_WASM_URL_PREFIX, serveOrtAssets(sourceDir));
    },
    configurePreviewServer(server) {
      if (!existsSync(outDir)) return;
      server.middlewares.use(ORT_WASM_URL_PREFIX, serveOrtAssets(outDir));
    },
    async closeBundle() {
      if (isDevServer) return;
      // 静默跳过等于把一个坏包发出去：线上 /ort/ 404，OCR 全废，构建却报成功。
      // 这里必须出声。
      if (!existsSync(sourceDir)) {
        this.warn(`${MISSING}\n  查找路径：${sourceDir}`);
        return;
      }
      const entries = await readdir(sourceDir);
      const missing = ORT_FILES.filter((f) => !entries.includes(f));
      if (missing.length > 0) {
        this.error(`${MISSING}\n  ${sourceDir} 里缺：${missing.join(', ')}`);
        return;
      }
      await mkdir(outDir, { recursive: true });
      for (const name of ORT_FILES) {
        await copyFile(join(sourceDir, name), join(outDir, name));
      }
    },
  };
}
