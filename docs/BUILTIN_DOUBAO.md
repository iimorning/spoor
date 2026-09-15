# 内置豆包 API Key（托管给所有用户）

## 原理

构建时通过环境变量 `VITE_BUILTIN_DOUBAO_API_KEY` 写入前端包。用户**未在设置里填写**豆包密钥时，`callUniversalAI` 自动使用该 Key 调用火山方舟 OpenAI 兼容接口（`POST /api/v3/chat/completions`）。

- 用户自填 Key **优先**（可覆盖内置 Key）
- 网页仍走 `/api/doubao` 代理（仅解决跨域，不隐藏 Key）
- **密钥会出现在 `dist` JS 里**，任何人可在浏览器开发者工具或下载的桌面安装包中提取 — 仅适合你愿意承担额度被盗用的场景

默认模型（`model` 字段）：`doubao-seed-2-0-lite-260428`  
上一版（turbo）：`doubao-seed-2-1-turbo-260628`  
更早（pro）：`doubao-seed-2-1-pro-260628`  
更早（mini）：`doubao-seed-2-0-mini-260428`  
更早推理接入点（切回时用）：`ep-20260218175314-xrnrn`  
默认 Base URL：`https://ark.cn-beijing.volces.com/api/v3`

## 配置步骤

### 本地 / 桌面打包

在项目根目录创建 `.env.local`（已在 `.gitignore`，勿提交）：

```env
VITE_BUILTIN_DOUBAO_API_KEY=ark-你的密钥
```

然后：

```bash
npm run build          # 网页
npm run tauri:build    # Windows 安装包
```

或使用：

```bash
npm run setup:doubao-key -- ark-你的密钥
```

### Netlify（网页，线上用户免配置的关键步骤）

`git push` **不会**上传 `.env.local`（已在 `.gitignore`）。若 Netlify 构建时没有该变量，线上包内就没有内置 Key，用户会看到「豆包 API Key 未配置」——这不是要让用户自己填，而是**部署漏了注入**。

1. 打开 Netlify → 你的 Spoor 站点 → **Site configuration → Environment variables**
2. 新增 **`VITE_BUILTIN_DOUBAO_API_KEY`** = `ark-...`（与本地 `.env.local` 相同）
3. **Deploys → Trigger deploy → Clear cache and deploy site**（必须重新构建，旧 dist 里没有 Key）

验证：部署完成后，在浏览器打开站点 → F12 → Network，触发一次 AI，请求应为 `/api/doubao/chat/completions` 且返回 200（不是立刻弹 Key 未配置）。

### 不设内置 Key

不配置该变量即可：用户必须在设置中粘贴自己的 ark- 密钥。

## 安全提示

- 不要将真实 Key 提交到 Git
- Key 泄露后请在火山方舟控制台轮换
- 无用量限制 = 被盗用后账单风险由你承担；若以后要限流需改为服务端代理（非本方案）
