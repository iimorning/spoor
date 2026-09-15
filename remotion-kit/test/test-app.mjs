import express from 'express';
import path from 'path';
import fs from 'fs';
import remotionRoutes from '../routes/remotion.mjs';

/**
 * 最小 Express 应用（仅 JSON + Remotion 路由），供 kit 内测试使用。
 * 新项目请把 `remotionRoutes` 挂到自己已有的 `app` 上，并挂载静态资源（见 README）。
 */
export function createMinimalRemotionApp(projectRoot) {
  const app = express();
  app.use(express.json({ limit: '512kb' }));
  const outputDir = path.join(projectRoot, 'output');
  if (fs.existsSync(outputDir)) {
    app.use('/output', express.static(outputDir));
  }
  remotionRoutes(app, { projectRoot });
  return app;
}
