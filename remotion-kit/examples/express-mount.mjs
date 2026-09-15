/**
 * 将 Remotion 挂进 Express 的最小示例（与 content-factory 的 app.mjs 思路一致）。
 *
 * 使用：在项目根目录（含 remotion/、routes/remotion.mjs、node_modules）下
 *   node examples/express-mount.mjs
 *
 * 若你把 kit 放在子目录，请把 projectRoot 改成你的仓库根路径。
 */
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import remotionRoutes from '../routes/remotion.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const app = express();
app.use(express.json({ limit: '512kb' }));
app.use(express.static(projectRoot));

const outputDir = path.join(projectRoot, 'output');
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
app.use('/output', express.static(outputDir));

remotionRoutes(app, { projectRoot });

const port = Number(process.env.PORT) || 3999;
app.listen(port, () => {
  console.log(`Remotion API: http://127.0.0.1:${port}/api/remotion/render`);
  console.log(`Static + output: projectRoot=${projectRoot}`);
});
