# Spoor v0.3.0 — Release notes / 雪泥 v0.3.0 发布说明

## Download (Windows) / 下载（Windows）

| Asset | Description |
|-------|-------------|
| **Spoor_0.3.0_x64-setup.exe** | Recommended — NSIS installer, 64-bit Windows 10/11 / 推荐：NSIS 安装包，Windows 10/11 64 位 |

**Install / 安装：** run the `.exe` → follow the wizard → open **Spoor** from the Start menu.  
双击安装 → 完成向导 → 从开始菜单打开 **Spoor / 雪泥**。

**Latest release / 最新版：** https://github.com/iimorning/spoor-pro/releases/latest

---

## What's new in v0.3.0 / v0.3.0 新内容

This is the first desktop release after **Canvas V2**. If you used v0.2.0, the canvas workflow changed in a few important ways.

这是 **Canvas V2** 之后的首个桌面版。若你用过 v0.2.0，画布工作流有几处重要变化：

### Canvas V2 — work zones & side-panel chat / 工作区与侧栏对话

- Draw **work zones** on the canvas and drop notes or personas into a room — scoped context follows the room, not loose edges.  
  在画布上**绘制工作区**，把便签或角色卡拖进房间 — 上下文按房间归属，不再靠临时连线。
- Persona chat opens in a **right-side panel** (Ask / agents). Replies can be **excerpted back onto the canvas**.  
  角色对话在**右侧侧栏**打开（阿狸 / Agent）；回复可**摘录回画布**。
- Work zones and persona threads **sync across devices** when cloud sync is enabled.  
  开启云同步后，工作区与侧栏对话可**跨设备同步**。

### Also in this build / 本版还包含

- Redesigned onboarding and essay-side AI chat.  
  重做的新手引导、长文侧栏 AI 改写。
- Phone memo capture (Pocket) and archive integration.  
  手机备忘（Pocket）与归档库整合。
- Landing promo videos (zh/en), voice and sync fixes since v0.2.0.  
  落地页中英文宣传片，以及 v0.2.0 以来的语音与同步修复。

---

## First launch / 首次使用

1. Open **Settings** and choose an AI provider (Gemini, OpenAI-compatible, etc.).  
   打开**设置**，选择 AI 服务商（Gemini、OpenAI 兼容等）。
2. Paste your API key — stored **only on this machine**.  
   粘贴 API Key — **仅存本机**。
3. Optional local GGUF via llama.cpp — see [LOCAL_LLM.md](./LOCAL_LLM.md) (not bundled).  
   可选本机 GGUF（llama.cpp），见 [LOCAL_LLM.md](./LOCAL_LLM.md)（安装包不含模型）。

The app UI supports **English and 中文** — switch language in the top bar on the landing page or in settings.  
应用界面支持**英文与中文** — 可在落地页顶栏或设置中切换语言。

---

## System requirements / 系统要求

| | |
|---|---|
| OS / 系统 | Windows 10/11, 64-bit |
| Disk / 磁盘 | ~50–150 MB |
| Network / 网络 | Required for cloud AI / web search when used / 使用云端 AI 或联网搜索时需要 |

---

## Web vs desktop / 网页版 vs 桌面版

| | Web | Desktop |
|---|-----|---------|
| Install | Browser / 浏览器 | One-click `.exe` / 一键安装 |
| Data | Browser IndexedDB | `%LOCALAPPDATA%\com.spoor.app\` |
| Metaso / some APIs | Netlify redirects | Native Tauri proxy |

---

## Upgrading from v0.2.0 / 从 v0.2.0 升级

Install over the previous build — your local canvas data is kept. Opening a canvas once may run a one-time migration to V2 work-zone scopes.  
直接覆盖安装即可，本地画布数据保留。首次打开旧画布时会做一次 V2 工作区迁移。

---

## License / 许可

[PolyForm Noncommercial License 1.0.0](../LICENSE) — personal and noncommercial use.

---

## Build info / 构建信息

- Version: **0.3.0**
- Tauri identifier: `com.spoor.app`
- Built with `scripts/tauri-build-release.cmd` (Windows NSIS)
