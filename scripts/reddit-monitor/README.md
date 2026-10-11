# Spoor Reddit Monitor

Standalone Reddit monitoring workflow for Spoor. Mirrors the data shape that
`content-factory/forum-raw-reddit-merge.json` produced, but stripped down to
**zero runtime dependencies** — only Node built-ins (`https` / `fs` / `path` /
`http`). Tested on Node ≥ 18.

The frontend (`insights.html` + `insights.js` + icons + lib modules) is **lifted
directly from `content-factory/`** — same Tailwind theme, same card layout,
same AI-lab sidebar, same archive modal. Only the data source differs:
content-factory's `routes/forum.mjs` (Express) is replaced by a tiny inline
fetch interceptor that reads `./data/forum-insights.json`.

## Quick start

Windows 一键启动（启动 Docker 中的 n8n、立即执行工作流、启动并打开前端）：

```powershell
.\start-monitor.ps1
# 或双击 start-monitor.cmd
# 或运行 npm run start:all
```

脚本默认按名称查找 `Spoor · Reddit RSS monitor (note-taking pain points)`。
如果工作流改了名字，可以传 `-WorkflowName`；也可以通过
`-WorkflowId <id>` 或环境变量 `SPOOR_N8N_WORKFLOW_ID` 指定。只启动服务、不立即
抓取时使用 `-SkipRun`。

```bash
# from this directory
node fetch.mjs --dry-run     # preview the plan (may fail if Reddit blocked)
node fetch.mjs --stats       # print current data/forum-raw.json stats
node fetch.mjs               # fetch everything in subreddits.mjs

# view the data in a browser (works with fixture data even if Reddit blocked)
node serve.mjs               # opens http://localhost:3780/

# run tests
npm test
```

## View in browser

After `node fetch.mjs` (or your own n8n pipeline) writes the JSON files, start
the bundled static server:

```bash
node serve.mjs                  # default: http://localhost:3780/
node serve.mjs --port=8080      # custom port
node serve.mjs --host=127.0.0.1 # only local
```

The viewer is `insights.html` — lifted from `content-factory` with one
change: a 7-line fetch interceptor at the top rewrites `/api/forum-insights`
to read `./data/forum-insights.json` directly. Everything else (cards, AI-lab
sidebar, archive modal, sentiment filter, pain tags) is the real
content-factory code.

Features:

- **顶部标题 + 通知图标** — content-factory 标准头部
- **左侧主区**：按情绪筛选（偏低 / 中性 / 积极）+ 反馈卡片列表（用户、来源、情绪徽章、核心痛点 chip、展开/收起全文、归档分类勾选）
- **右侧 AI 草稿栏**：选中卡片后显示「AI 回复草稿」+ 「继续对话…」输入区
- **「分析学习痛点」按钮** — 通过本地服务端调用 OpenAI 兼容模型
- **「归档记录」模态框** — 已回复 / 不是目标客户 两个分类，持久化到本地状态文件
- **Emoji / 情绪徽章** — 红（偏低）/ 橙（中性）/ 绿（积极）

A starter fixture is included at `data/forum-insights.json` so you can
`node serve.mjs` immediately and see the full UI before fetching real data.

### 配置 AI 分析与对话

AI Key 只保存在 `scripts/reddit-monitor/.env.local`，由本地 `serve.mjs`
读取，不会发送给浏览器或写进前端资源。首次使用运行：

```powershell
cd scripts/reddit-monitor
.\setup-monitor-ai.ps1
```

脚本会隐藏 Key 输入，默认配置豆包方舟
`doubao-seed-2-1-turbo-260628`。其他 OpenAI 兼容服务可指定：

```powershell
.\setup-monitor-ai.ps1 `
  -BaseUrl 'https://你的服务/v1' `
  -Model '你的模型名' `
  -Provider '供应商名称'
```

配置后重启 `start-monitor.cmd`。可通过
`GET http://127.0.0.1:3780/api/forum-insights/health` 检查
`ai.configured`；响应不会包含 Key。服务默认仅监听 `127.0.0.1`，避免局域网
设备消耗你的 AI 额度。

### 历史轮次

`serve.mjs` 每次检测到 n8n 更新 `forum-raw.json`，都会在
`data/history/` 保存一份 append-only 快照：

- `<timestamp>.raw.json`：该轮完整原始数据
- `<timestamp>.insights.json`：该轮前端投影
- `index.json`：按新到旧排列的轮次索引

页面中“数据轮次”的第 1 轮永远表示最新快照，第 2、3…轮依次更早。历史目录
默认不自动清理，并已从 Git 排除。它位于宿主机项目目录，因此重启或重建
Docker 容器不会删除；删除项目目录、手动清理或磁盘损坏仍会导致丢失，重要
数据应另外备份。

每一轮现在是一个最多 13 条的**全新增量批次**。服务会汇总全部历史快照和
`data/seen-post-ids.json` 中的帖子 id，删除 n8n 候选池中的跨轮次重复项；
不足 13 条时继续从 Reddit RSS 向更早页面抓取，直到收满或最多检查 10 页。
如果 Reddit 限流或符合条件的帖子确实耗尽，`batch.shortfall` 会记录缺口，
不会用重复帖子补齐。n8n 单次候选池已扩大到最近一年最多 100 条。

### Standalone 模式 vs 完整 content-factory 模式

| 功能                | standalone (本仓库)                       | content-factory (express)               |
|---------------------|--------------------------------------------|------------------------------------------|
| 读取帖子数据        | `GET /api/forum-insights` → 本地 JSON     | Express `GET /api/forum-insights`        |
| AI 拟回复           | ✅ 服务端 OpenAI 兼容接口                   | ✅ DeepSeek / Doubao 流式生成            |
| 学习痛点分析        | ✅ AI 分析 + 本地持久化                     | ✅ AI 流式分析 + 写入本地 JSON            |
| 归档（已回复等）    | ✅ 写入 gitignored 本地状态                 | ✅ 写入 `forum-insights.json`            |
| 卡片渲染 / 情绪筛选 | ✅                                          | ✅                                        |
| 主题 / 字体 / 图标  | ✅ 同源                                     | ✅                                        |

AI 分析、草稿、对话记录和归档保存到 `data/forum-state.json`；n8n 后续刷新
`forum-raw.json` 时，服务会按帖子 id 合并这些状态，不会覆盖已完成的研究工作。

## What it does

```
Reddit search feed ─► pain/context filter ─► format binary ─► data/forum-raw.json
                                                          │
                                                          ▼
                                       buildInsightsFromRaw ─► data/forum-insights.json
                                                          │
                                                          ▼
                                       insights.html + local AI API (serve.mjs)
```

- **Map Raw Fields** — flatten `data.children` into `{id, title, content, link, isoDate, source, author}`
- **mergeForumRaw** — by-id dedup, time-desc sort, cap at 1500 items, drop titles shorter than 20 chars
- **buildInsightsFromRaw** — project top 24, add `sentiment` (positive/negative word count) and `painTag` (regex-based), aggregate `frictionTags` (top 8 pain tags by frequency)
- **insights.html** — content-factory 真实前端 + 一个 fetch 拦截器读本地 JSON

The same merge / normalize / insights functions are exposed under `lib/` so the
project can re-use them in browser code (e.g. an in-app "Reddit radar" panel)
without re-implementing.

## Layout

```
scripts/reddit-monitor/
├── fetch.mjs              # main fetcher (CLI; can be skipped if you use n8n)
├── serve.mjs              # zero-dep local static + JSON API server
├── start-monitor.ps1      # Windows one-click: n8n run + viewer + browser
├── start-monitor.cmd      # double-click wrapper for start-monitor.ps1
├── setup-monitor-ai.ps1   # securely save server-side AI configuration
├── insights.html          # ← content-factory 数据分析页原版
├── insights.js            # ← content-factory 数据分析页原版
├── icons.mjs              # ← content-factory icon 注册表
├── tailwind.config.mjs    # ← content-factory 主题（也内联在 insights.html <script> 里）
├── styles/
│   └── tailwind.input.css # ← content-factory 自定义层（zen-shadow / scrollbar）
├── subreddits.mjs         # target subreddits, by scenario
├── package.json           # no deps; npm scripts are convenience aliases
├── lib/
│   ├── forum-raw.mjs      # normalize / merge / project
│   ├── forum-insights.mjs # default insights payload
│   ├── forum-ai.mjs       # OpenAI-compatible analysis and reply adapter
│   ├── forum-state.mjs    # AI enrichment + archive persistence
│   ├── forum-insights-lab-render.mjs   # ← from content-factory
│   ├── chat-markdown.mjs  # ← from content-factory
│   └── sentiment.mjs      # pain-tag inference + sentiment scoring
├── data/
│   ├── forum-raw.json     # output: full deduped set
│   ├── forum-insights.json# output: top-24 for UI (starter fixture included)
│   ├── forum-state.json   # local AI/archive state (gitignored)
│   ├── seen-post-ids.json # global cross-round dedupe cache (gitignored)
│   ├── history/           # append-only local snapshots (gitignored)
│   └── .gitkeep
├── n8n-workflow.json      # alternative automation path (Spoor-flavored)
├── test/                  # node:test unit and API tests (no deps)
│   ├── forum-ai.test.mjs
│   ├── forum-raw.test.mjs
│   ├── forum-state.test.mjs
│   ├── sentiment.test.mjs
│   └── serve.test.mjs
└── README.md              # you are here
```

## Categories in `subreddits.mjs`

| category                  | scenario                                            | count |
|---------------------------|-----------------------------------------------------|-------|
| `notes_pkm`               | notes / PKM / Obsidian / Notion / Roam refugees     | 8     |
| `sea_turtle_soup`         | lateral thinking puzzles / AI hosts                 | 8     |
| `narrative_reflection`    | journaling / Stoicism / mindfulness                 | 8     |
| `philosophy`              | philosophy / Socratic dialogue / consciousness      | 6     |
| `selfhosted_ai`           | self-hosters / local LLM / open source              | 5     |
| `show_and_tell`           | SideProject / IndieHackers / build-in-public        | 4     |

Each entry carries a `searchQuery` (Reddit search keywords), a `promotion` note
(per-subreddit self-promo rules from the mod sidebar), and a `rules` summary.
Use `findBySubreddit('r/ObsidianMD')` to look up a single entry.

## Rate limits

- 4 concurrent requests, 15 s timeout per request, polite `User-Agent`
- 30 posts per subreddit by default (`--limit=N`, max 100)
- if Reddit returns HTTP 429, the failure is logged but other subreddits still proceed

## Alternative: n8n workflow

`n8n-workflow.json` runs one combined search across `r/NoteTaking`, `r/PKMS`,
`r/ObsidianMD`, and `r/productivity`, then keeps only posts containing both
note-taking context and pain/switching terms. It runs every 30 minutes and can
also be executed immediately by `start-monitor.ps1`.

Reddit's anonymous JSON endpoint currently returns HTTP 403 from Docker-hosted
traffic even with a custom User-Agent. The workflow therefore uses the combined
search RSS endpoint through an HTTP Request node (custom User-Agent, retry, and
backoff). For JSON API access, configure Reddit OAuth credentials instead of
relying on anonymous `search.json`.

## Cross-reference

See `docs/REDDIT_MONITORING.md` for the operational playbook:
how often to run, what to do with the output, posting etiquette per subreddit,
and how to extend the pain-tag taxonomy.

