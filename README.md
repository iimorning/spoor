<div align="center">

<img src="./LOGO.png" alt="Spoor" width="120" />

# Spoor

**A local-first spatial notes canvas with AI personas.**

Place notes, screenshots, documents, research findings, and AI responses on one infinite canvas. Then use different AI personas to question, connect, rewrite, and research your ideas.

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Netlify-00C7B7?style=for-the-badge)](https://scribe-ai-canvas.netlify.app/)
[![Windows Download](https://img.shields.io/badge/Windows-Releases-C2410C?style=for-the-badge)](https://github.com/iimorning/spoor/releases/latest)
[![License](https://img.shields.io/badge/License-PolyForm%20Noncommercial-blue?style=flat-square)](LICENSE)

[Live Demo](https://scribe-ai-canvas.netlify.app/) · [Windows Release](https://github.com/iimorning/spoor/releases/latest) · [Issues](https://github.com/iimorning/spoor/issues)

</div>

---

## What It Does

- **Infinite canvas notes** — arrange ideas spatially instead of burying them in folders or chat history.
- **AI personas on the canvas** — use different agents for critique, synthesis, language exploration, and future scenarios.
- **Context-aware AI notes** — select notes, ask an agent to analyze them, and keep the AI response as an editable canvas note.
- **Long-form synthesis** — combine selected notes into article-style drafts or structured explanations.
- **Local-first storage** — canvas data stays in IndexedDB in the browser or desktop WebView; user API keys are saved locally.
- **Web and Windows desktop** — try the hosted web demo or install the Tauri desktop app.

## Example Workflow

Imagine you are writing about how AI changes independent creators:

1. Put rough notes on the canvas: creator workflows, platform risks, writing tools, and personal style.
2. Ask **The Mirror of Insight** to challenge a weak assumption.
3. Ask **The Weaver** to find the hidden connection between several notes.
4. Use **The Smoothing Iron** to rewrite a key sentence in different tones.
5. Synthesize the selected notes into a draft.

The key difference from a chatbot: every AI response becomes part of your visual workspace, so ideas can keep growing instead of disappearing into a transcript.

## Default AI Personas

- **The Mirror of Insight** — challenges assumptions and pressure-tests claims.
- **The Weaver** — finds surprising connections across notes.
- **The Smoothing Iron** — transforms sentences and explores language variants.
- **The Star-Gazer** — explores future scenarios, uncertainty, and second-order effects.

## Quick Start

| Mode | Best for | How |
|------|----------|-----|
| **Web demo** | Quick trial | Open **[scribe-ai-canvas.netlify.app](https://scribe-ai-canvas.netlify.app/)** |
| **Windows desktop** | Daily local workspace | Download `Spoor_*_x64-setup.exe` from **[Releases](https://github.com/iimorning/spoor/releases/latest)** |
| **Local development** | Contributors and builders | Follow the developer steps below |

First use: open the app, go to **Settings**, choose an AI provider, and paste your API key. User-provided keys are stored locally.

### Web vs Desktop

| | Web | Windows Desktop |
|---|-----|-----------------|
| Install | Open the link | NSIS installer |
| Data location | Browser IndexedDB | `%LOCALAPPDATA%\com.spoor.app\` |
| Local GGUF model | Not supported | Optional, see [LOCAL_LLM.md](docs/LOCAL_LLM.md) |
| Release entry | In-app settings / website | GitHub Releases |

Upgrading from the older **Spatial Notes** build (`com.spatialnodes.app`)? See [DATA_RECOVERY.md](docs/DATA_RECOVERY.md).

---

## Developers

Requirements: Node.js 20+. Desktop builds also require Rust stable and Visual Studio Desktop development with C++ on Windows.

```bash
git clone https://github.com/iimorning/spoor.git
cd spoor
npm install
```

Run the web app:

```bash
# Optional: set GEMINI_API_KEY in .env.local
npm run dev
# → http://localhost:3000
```

Run the desktop app:

```bash
npm run tauri:dev
```

Build the Windows installer:

```bash
npm run tauri:build
# Output: src-tauri/target/release/bundle/nsis/Spoor_*_x64-setup.exe
```

Release notes and manual upload instructions: [DESKTOP_INSTALL.md](docs/DESKTOP_INSTALL.md), [scripts/upload-release-manual.md](scripts/upload-release-manual.md).

Built-in Doubao (Volcengine Ark) key option: see [BUILTIN_DOUBAO.md](docs/BUILTIN_DOUBAO.md), or run `npm run setup:doubao-key -- ark-your-key` before `npm run build`. Legacy MiMo: [BUILTIN_MIMO.md](docs/BUILTIN_MIMO.md).

### Deploy Web App to Netlify

`npm run build` outputs to `dist`. Canvas data remains in the visitor's browser IndexedDB; Netlify only hosts the static app.

1. Connect this repository to [Netlify](https://app.netlify.com). The root [`netlify.toml`](netlify.toml) provides the build command and publish directory.
2. **Required for default hosted Doubao** (end users should not paste API keys): in Netlify → **Environment variables**, set `VITE_BUILTIN_DOUBAO_API_KEY` = `ark-...`, then **redeploy**. See [BUILTIN_DOUBAO.md](docs/BUILTIN_DOUBAO.md). Pushing code alone does not upload `.env.local`.
3. Keep the `netlify.toml` edge rewrites so `/api/doubao/*`, `/api/mimo/*`, and `/api/metaso/*` behave like the local Vite proxy.
4. Optional: set `GEMINI_API_KEY` as another build-time default. User overrides still stay in browser local storage.

---

## Documentation

| Document | Purpose |
|----------|---------|
| [AGENT.md](AGENT.md) | AI agent design and workflow |
| [SKILL.md](SKILL.md) | Capability summary for submission |
| [APP.md](APP.md) | App overview for submission |
| [DESKTOP_INSTALL.md](docs/DESKTOP_INSTALL.md) | Desktop install and release notes |
| [LOCAL_LLM.md](docs/LOCAL_LLM.md) | Local llama.cpp / GGUF setup |
| [DATA_RECOVERY.md](docs/DATA_RECOVERY.md) | Migration from older desktop identifier |
| [AI-PROMPTS.md](docs/AI-PROMPTS.md) | AI prompts and agent behavior notes |
| [TERMS_OF_SERVICE.md](docs/TERMS_OF_SERVICE.md) | Terms of Service |
| [PRIVACY_POLICY.md](docs/PRIVACY_POLICY.md) | Privacy Policy |

---

## Tech Stack

React · TypeScript · Vite · Dexie (IndexedDB) · Tauri 2 · Rust · Tailwind CSS · i18next · Netlify

---

## 中文说明

Spoor 是一个带 AI 的无限便签画布。你可以把想法、资料、截图、网页搜索结果都放在画布上，再让不同性格的 AI 助手帮你提问、联想、改写和做研究。

它和普通聊天机器人的区别是：AI 的回答不会只停留在聊天记录里，而是会变成画布上的新便签，可以继续移动、连接、编辑和追问。

### 能做什么

- **无限画布便签** — 拖拽、缩放、连线，把想法铺在空间里，而不是塞进文件夹。
- **多个人格 Agent** — 真知镜负责反问，编织者负责联想，熨烫师负责文字实验，占星术负责情景推演。
- **上下文 AI 便签** — 选中便签后让 AI 分析，结果会作为新便签留在画布上。
- **长文综合** — 把多张便签整理成文章草稿、项目说明或研究总结。
- **本地优先** — 画布数据保存在本机 IndexedDB，API Key 保存在本地设置中。
- **网页和 Windows 桌面版** — 可在线试用，也可安装桌面版长期使用。

### 一个例子

如果你想写一篇关于“AI 如何改变独立创作者”的文章，可以先把零散想法放成便签：AI 写作、个人品牌、平台依赖、真实经验。然后让真知镜找逻辑漏洞，让编织者找隐藏联系，让熨烫师改写关键句，最后把这些便签合成为文章草稿。

### 快速开始

| 方式 | 适合谁 | 怎么做 |
|------|--------|--------|
| **网页版** | 想马上体验 | 打开 **[scribe-ai-canvas.netlify.app](https://scribe-ai-canvas.netlify.app/)** |
| **Windows 桌面** | 日常主力、本机数据 | 从 **[Releases](https://github.com/iimorning/spoor/releases/latest)** 下载 `Spoor_*_x64-setup.exe` 并安装 |
| **本地开发** | 贡献者 / 二次开发 | 见上方 Developers |

首次使用：打开应用，进入 **Settings / 设置**，选择 AI 服务商并填入 API Key。密钥不会上传到 Spoor 自己的服务器。

---

## License / 许可证

This project uses the [PolyForm Noncommercial License 1.0.0](LICENSE).

本项目采用 [PolyForm Noncommercial License 1.0.0](LICENSE)。

- **允许：** 个人学习、研究、测试、爱好项目及其他**非商业**用途。
- **未经书面授权不得：** 商业使用、商业部署、商业集成或商业再分发。

Commercial licensing: contact via [GitHub @iimorning](https://github.com/iimorning).

商业授权请联系：[GitHub @iimorning](https://github.com/iimorning).
