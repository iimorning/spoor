import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function remotionCliJs(projectRoot) {
  return path.join(projectRoot, 'node_modules', '@remotion', 'cli', 'remotion-cli.js');
}

function ensureOutputDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function encodeRelativeUrl(relPath) {
  return String(relPath || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function normalizeSegments(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s) => s && Number.isFinite(Number(s.startSec)) && Number.isFinite(Number(s.endSec)))
    .map((s) => ({
      startSec: Math.max(0, Number(s.startSec)),
      endSec: Math.max(0, Number(s.endSec)),
      en: String(s.en || '').slice(0, 500),
      zh: String(s.zh || '').slice(0, 500)
    }))
    .filter((s) => s.endSec > s.startSec)
    .slice(0, 500);
}

export function buildRemotionInputProps(req, projectRoot) {
  const raw = req.body?.inputProps && typeof req.body.inputProps === 'object' ? req.body.inputProps : {};
  const title = String(raw.title || 'JustTalk').trim().slice(0, 120) || 'JustTalk';
  const subtitle = String(raw.subtitle || '').trim().slice(0, 180);
  const audioPath = String(raw.audioPath || '').trim().replace(/\\/g, '/');
  const segments = normalizeSegments(raw.timestampSegments);
  const totalDurationSec = segments.length > 0 ? Math.max(...segments.map((s) => s.endSec)) : 5;
  const props = {
    title,
    subtitle,
    audioUrl: '',
    audioPath: '',
    timestampSegments: segments,
    totalDurationSec,
    generatedAt: new Date().toISOString()
  };

  if (audioPath && !audioPath.includes('..')) {
    const abs = path.resolve(projectRoot, audioPath.split('/').join(path.sep));
    const rel = path.relative(projectRoot, abs);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel) && fs.existsSync(abs)) {
      const origin = `${req.protocol}://${req.get('host')}`;
      props.audioPath = audioPath;
      props.audioUrl = `${origin}/${encodeRelativeUrl(audioPath)}`;
    }
  }

  return props;
}

/**
 * @param {import('express').Application} app
 * @param {{ projectRoot: string }} ctx
 */
export default function remotionRoutes(app, ctx) {
  const projectRoot = ctx?.projectRoot;
  if (!projectRoot || typeof projectRoot !== 'string') {
    throw new Error('remotionRoutes(app, { projectRoot }) — projectRoot 必填');
  }

  const outputDir = path.join(projectRoot, 'output');
  ensureOutputDir(outputDir);

  /**
   * POST /api/remotion/render
   * Body: { compositionId: string, outputName: string, inputProps?: object }
   * SSE: event log | done | error
   */
  app.post('/api/remotion/render', (req, res) => {
    const { compositionId, outputName } = req.body || {};

    if (!compositionId || !outputName) {
      res.status(400).json({ error: '缺少 compositionId 或 outputName' });
      return;
    }

    const safeName = path.basename(outputName.replace(/[^a-zA-Z0-9._-]/g, '_'));
    const outputPath = path.join(outputDir, safeName);

    const cli = remotionCliJs(projectRoot);
    if (!fs.existsSync(cli)) {
      res.status(503).json({
        error: '未找到 @remotion/cli，请在项目根目录执行 npm install（需 devDependencies 含 @remotion/cli）'
      });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });

    const entry = path.join(projectRoot, 'remotion', 'index.js');
    const inputProps = buildRemotionInputProps(req, projectRoot);

    const cliArgs = [cli, 'render', entry, compositionId, outputPath, '--props', JSON.stringify(inputProps)];
    const browserExecutable = String(process.env.REMOTION_BROWSER_EXECUTABLE || '').trim();
    if (browserExecutable) {
      cliArgs.push('--browser-executable', browserExecutable);
    }
    const chromeMode = String(process.env.REMOTION_CHROME_MODE || '').trim();
    if (chromeMode) {
      cliArgs.push('--chrome-mode', chromeMode);
    }

    const child = spawn(process.execPath, cliArgs, {
      cwd: projectRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let errBuf = '';
    let completed = false;

    child.stdout.on('data', (data) => {
      const lines = data.toString('utf-8').trim();
      if (lines) {
        res.write(`event: log\ndata: ${JSON.stringify(lines)}\n\n`);
      }
    });

    child.stderr.on('data', (data) => {
      errBuf += data.toString('utf-8');
      const lines = errBuf.trim();
      if (lines) {
        res.write(`event: log\ndata: ${JSON.stringify(lines)}\n\n`);
      }
    });

    child.on('error', (e) => {
      res.write(`event: error\ndata: ${JSON.stringify(e.message)}\n\n`);
      res.end();
    });

    child.on('close', (code) => {
      completed = true;
      if (code === 0) {
        res.write(`event: done\ndata: ${JSON.stringify({ outputUrl: `/output/${safeName}` })}\n\n`);
      } else {
        res.write(
          `event: error\ndata: ${JSON.stringify(errBuf || `渲染失败，退出码 ${code}`)}\n\n`
        );
      }
      res.end();
    });

    res.on('close', () => {
      if (!completed && !child.killed) {
        child.kill();
      }
    });
  });
}
