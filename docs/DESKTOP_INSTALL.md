# 雪泥 · Spoor — 桌面版安装（Windows）

## 普通用户：一键安装

1. 打开 GitHub Releases：  
   **https://github.com/iimorning/spoor/releases**
2. 下载最新版的 **`Spoor_*_x64-setup.exe`**（NSIS 安装程序）。
3. 双击运行安装向导 → 完成 → 从开始菜单或桌面打开 **Spoor** / **雪泥**。
4. 首次使用：在应用内 **设置** 中配置 AI 服务商与 API Key（与网页版相同，密钥只存在本机）。

> **说明：** 安装包不包含本地 GGUF 模型。若要用本机 `llama.cpp` 推理，请另按 [LOCAL_LLM.md](./LOCAL_LLM.md) 放置二进制与模型文件。

---

## 数据存在哪？

- 画布与便签：**本机 IndexedDB**（`%LOCALAPPDATA%\com.spoor.app\` 下的 WebView 数据）。
- 与旧版标识 `com.spatialnodes.app` 不互通；迁移见 [DATA_RECOVERY.md](./DATA_RECOVERY.md)。

---

## 维护者：发布新安装包

### 方式 A — GitHub Actions（推荐，需账户 Actions 可用）

```bash
git tag v0.1.0
git push origin v0.1.0
```

推送 `v*` 标签后，[`.github/workflows/release-desktop.yml`](../.github/workflows/release-desktop.yml) 会自动构建并上传 `Spoor_*_x64-setup.exe`。

若 Actions 失败并提示 **billing issue**，请到 GitHub **Settings → Billing** 处理，或改用下方手动发布：[`scripts/upload-release-manual.md`](../scripts/upload-release-manual.md)。

### 方式 B — 本机打包

**需要：** Node.js 20+、Rust stable、`x86_64-pc-windows-msvc`、Visual Studio 2022 **「使用 C++ 的桌面开发」**。

```bat
npm install
scripts\tauri-build-release.cmd
```

产物：

- `src-tauri\target\release\bundle\nsis\Spoor_0.1.0_x64-setup.exe`

把该文件上传到 GitHub Releases 即可。

---

## 系统要求

| 项目 | 要求 |
|------|------|
| 系统 | Windows 10/11，64 位 |
| 磁盘 | 约 50–150 MB（视依赖而定） |
| 网络 | 使用云端 AI / 画布联网搜索时需要 |
| 本地 LLM | 可选，见 [LOCAL_LLM.md](./LOCAL_LLM.md) |
