# Remotion  kit（从 content-factory 抽取）

本目录可 **整体复制** 到你的新仓库根目录（或先复制再按需改名路径），用于：

- 本地调色：`npx remotion studio remotion/index.js`
- CLI 导出：`npx remotion render remotion/index.js PromoVertical out.mp4`
- 服务端无头渲染：`POST /api/remotion/render`（Server-Sent Events 流式日志）

内含两套成片：

| Composition ID   | 分辨率    | 用途           |
|------------------|-----------|----------------|
| `MyComposition`  | 1920×1080 | 横屏推广（JustTalk 示例） |
| `PromoVertical`  | 1080×1920 | 竖屏推广       |
| `SpoorPromo` | 1920×1080 | 雪泥 · Spoor 产品介绍（约 60s） |
| `SpoorPromoZH` | 1920×1080 | 同上，中文版 |
| `SpoorPromoV2` | 1920×1080 | 雪泥 2.0 升级版（新增语音 / 视觉 / 多角色对谈 / 长文综合） |
| `SpoorPromoV2ZH` | 1920×1080 | 同上，中文版（默认 props：`spoor-promo-v2-zh.json`） |
| `SpoorPromoV3` / `SpoorPromoV3ZH` | 1920×1080 | 画布 V2 行为：房间、侧栏对话、拖入/拖出、75s |

二者均支持通过 `inputProps` 传入标题、副标题、**音频 URL（由服务端根据 `audioPath` 生成）**、双语字幕片段时间轴。

> 渲染 V2 中文版：
> ```
> cd remotion-kit
> npm install   # 首次
> npm run remotion:render:spoor-v2-zh
> # 产物写入 ../output/spoor-promo-v2-zh.mp4
> ```
> 当前 V2 默认静音（`audioUrl=""`）。如需配音，把 `audio/zh-v2.wav`
> 放到 `remotion-kit/remotion/assets/audio/` 下，并把 JSON 里的
> `audioUrl` 改成 `"audio/zh-v2.wav"`。

---

## 1. 安装依赖

在**新项目的 package.json** 中至少加入（版本可按需对齐升级）：

```json
{
  "type": "module",
  "dependencies": {
    "react": "^19.2.5",
    "react-dom": "^19.2.5",
    "remotion": "^4.0.422"
  },
  "devDependencies": {
    "@remotion/cli": "^4.0.422"
  }
}
```

说明：`@remotion/cli` 放在 `devDependencies` 即可；**服务端 spawn 时仍需要**已安装好的 `node_modules/@remotion/cli`，生产环境若要服务器渲染请确保安装该包。

```bash
npm install
```

---

## 2. 目录布局（推荐与 content-factory 一致）

把你的应用根目录记为 `PROJECT_ROOT`：

```
PROJECT_ROOT/
  remotion/
    index.js
    Root.jsx
    Composition.jsx
    PromoVertical.jsx
  routes/
    remotion.mjs          ← 来自本 kit
  output/                 ← 渲染输出（gitignore）
  node_modules/
```

将本 kit 中的 `remotion/`、`routes/remotion.mjs`、`test/`、`examples/` 复制到对应位置。

---

## 3. 接入 Express

- 注册 JSON 中间件：`app.use(express.json({ limit: '512kb' }))`
- 挂载静态：**整个项目根**或至少包含音频文件的目录，以便 Remotion 在渲染时通过 HTTP 拉取 `<Audio src={audioUrl} />`（`buildRemotionInputProps` 会根据请求 host 拼出绝对 URL）
- 创建 `output` 并挂载：`app.use('/output', express.static(path.join(projectRoot, 'output')))`
- 安装路由：`remotionRoutes(app, { projectRoot })`

完整最小示例见 `examples/express-mount.mjs`。

---

## 4. 渲染 API

`POST /api/remotion/render`

请求体 JSON：

- `compositionId`：`MyComposition` 或 `PromoVertical`
- `outputName`：输出文件名，如 `promo.mp4`（仅 basename，非法字符会被替换）
- `inputProps`（可选）：
  - `title`、`subtitle`
  - `audioPath`：相对 `projectRoot` 的路径，使用 `/`，不得含 `..`
  - `timestampSegments`：`{ startSec, endSec, en, zh }[]`

响应：`text/event-stream`（SSE）

- `event: log` — CLI 日志
- `event: done` — `data: {"outputUrl":"/output/xxx.mp4"}`
- `event: error` — 失败信息

---

## 5. 环境变量（可选）

- `REMOTION_BROWSER_EXECUTABLE`：自定义 Chromium 路径（服务器无 GUI 时常用）
- `REMOTION_CHROME_MODE`：传给 Remotion CLI，见官方文档

---

## 6. 使用「项目资产」（图片 / 字体 / 其他）

1. **HTTP 静态资源**：与音频相同，把文件放在 `projectRoot` 下由 Express `static` 提供，在组件里用**绝对 URL**（或 `staticFile()` 相对 Remotion `public/`）引用。
2. **Remotion `public/`**：在条目 `remotion/index.js` 旁配置 `publicDir`（见 [Remotion 文档](https://www.remotion.dev/docs)），用 `staticFile('img/logo.png')` 引用。
3. 修改 `Composition.jsx` / `PromoVertical.jsx` 即可接入你的品牌素材；本 kit 未绑定 content-factory 专有路径。

---

## 7. npm scripts（可复制到主项目 package.json）

```json
{
  "scripts": {
    "remotion:studio": "remotion studio remotion/index.js",
    "remotion:render": "remotion render remotion/index.js MyComposition out.mp4",
    "remotion:render:promo": "remotion render remotion/index.js PromoVertical promo-vertical.mp4",
    "remotion:render:spoor": "remotion render remotion/index.js SpoorPromo ../../output/spoor-promo.mp4 --props=remotion/spoor-promo.json"
  }
}
```

---

## 8. 本 kit 内自测

```bash
cd remotion-kit
npm install
npm test
```

说明：`remotion-api` 测试中会对临时目录写入**极简 stub** 的 CLI 文件以验证路由与 SSE；真实渲染仍需完整安装 `@remotion/cli` 并能在本机启动 Chromium。

---

## 与主仓库的差异

- `routes/remotion.mjs` 使用 `ctx.projectRoot` 推导 `output/` 与 `@remotion/cli` 路径，避免测试临时目录与路由文件物理位置不一致。
- 若 `node_modules/@remotion/cli` 不存在，接口返回 **503** 与提示文案。

主仓库 `content-factory` 仍保留原有 `routes/remotion.mjs`；同步时可手动对齐上述 `projectRoot` 逻辑。
