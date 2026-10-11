# 跑测试的操作手册

这份只讲一件事：**怎么在这个仓库里花最少的时间，拿到可信的红/绿结论**。
内容都是实测踩过的坑，照着做就行。

## 当前状态（2026-10-11 实测）

| 项目 | 结果 |
|------|------|
| 测试文件 | 353 |
| 用例 | 3184（3164 通过 / 17 跳过 / **3 失败**） |
| 全量耗时 | 约 4.4 分钟 |
| `npx tsc --noEmit`（`src/`） | **0 错误** |
| `npm run build` | 成功 |

那 3 个失败是 `tests/components/NodeRenderer.test.tsx` 里主题卡的断言
（`themeTag` / 已持久化的 `description` / `LATENT_SPACE` 页脚），是主题卡重设计后
测试没跟着改导致的既有欠账，与最近的功能改动无关。要认这三条红的完整断言：

```bash
npx vitest run tests/components/NodeRenderer.test.tsx
```

`tests/` 目录下另有 33 条类型错误（测试代码自身），同样早于当前功能改动，
不影响 `src/` 的干净结论。

## TL;DR

```bash
# 改完一处：只跑相关的文件（秒级~一分钟）
npx vitest run tests/utils/personaChatRoom.test.ts

# 只跑其中几条：-t 是测试名里的片段（支持正则）
npx vitest run tests/App.test.tsx -t "AI 助手工作室"

# 收尾：整仓一次（约 4–5 分钟，3184 个用例）
npx vitest run
```

顺序永远是：**定向 → 绿 → 全量一次收尾**。别一上来就 `npx vitest run`。

## 时间预算（本机实测，别按"应该很快"估计）

| 跑什么 | 大致耗时 | 为什么 |
|--------|----------|--------|
| 单文件（utils / service / 小 hook） | 5–30 秒 | — |
| `tests/components/*`、`tests/hooks/useAiActions.test.ts` | 10–60 秒 | — |
| `tests/hooks/useVoiceWritingMode.test.ts` | 30–60 秒 | 有真实定时器（1.5s 静默窗口）的用例 |
| `tests/App.test.tsx` | **1–3 分钟**（71 个用例） | 每个用例都把整个 App 连 fake-indexeddb 渲染一遍 |
| `tests/onboarding-integration.test.tsx` | 30–60 秒 | 同上 |
| 全仓 `npx vitest run` | **约 4–5 分钟**（353 个文件） | 耗时主要花在 jsdom 环境与模块 transform，不是断言 |

所以"改了三个字，测试跑了五分钟"通常是**范围选错**，不是测试坏。

## 硬规则：这几件事会让时间翻好几倍

1. **不要同时跑两个 vitest。** 每次运行都会起自己的 worker + esbuild，两个并行不是"快一倍"，
   而是互相抢 CPU，最后两边都变慢。一次一条命令。
2. **不要把 vitest 放后台**（`nohup … &`、`… &`）。命令返回后后台进程会被收走，日志永远停在
   `RUN v4.1.5` 一行，看起来像"卡死"，其实进程早没了。要后台就用工具自带的后台任务，
   并且**只在完成通知里看结果**，不要反复去取输出（等不到就是没跑完）。
3. **不要用管道看进度。** `npx vitest run … | grep …` 在进程结束前一个字节都不会输出（缓冲）。
   想看进度就重定向到文件再读：
   ```bash
   npx vitest run tests/App.test.tsx > /tmp/t.log 2>&1   # 另开一条命令读 /tmp/t.log
   ```
   不在乎进度就直接让它跑完，用 `grep -aE "Test Files|Tests |FAIL "` 看结论。
4. **中止过一次运行后，清掉它留下的 vitest 进程树**，否则它们会一直占着 CPU 拖慢后面每一步。
   **只按命令行杀 vitest 自己的进程，绝对不要 `taskkill //IM esbuild.exe`** ——
   Vite dev server 也在用 esbuild 做 transform，按进程名杀会把它的服务一起杀掉，
   浏览器里就出现 `[plugin:vite:esbuild] The service is no longer running`（不是代码错，
   只能重启 dev server 才能恢复）：
   ```bash
   # Windows / Git Bash：按命令行精确清理（先看，再杀）
   powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"name='node.exe'\" | Where-Object { $_.CommandLine -match 'vitest|forks\.js' } | Select-Object ProcessId,CommandLine"
   powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"name='node.exe'\" | Where-Object { $_.CommandLine -match 'vitest|forks\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
   ```
   判断跑没跑完，看这个数字而不是猜：`... | Where-Object { $_.CommandLine -match 'vitest' }).Count`
5. **不要用 `--reporter=basic`**：这个版本的 vitest 没有它，会以 "Failed to load custom Reporter"
   直接退出（退出码 1），看起来像测试失败。默认 reporter 就好。

## 别动正在跑的 dev server

上面第 4 条只在"你自己刚起过测试、而且用户没在跑 `npm run dev`"时执行。
dev server 和 vitest 都会拉 esbuild worker；按进程名杀会顺手把它打死，
前端立刻报 `[plugin:vite:esbuild] The service is no longer running`，
重启 dev server 才能恢复（代码本身没问题，别去改代码）。

## 测试替身：lucide 图标（最容易整片红的地方）

`lucide-react` 在测试里被 mock 掉。**如果 mock 里没有组件实际用到的图标名，会返回 `undefined`，
`createElement(undefined)` 直接把整棵组件树打挂** —— 报错却是"找不到某个按钮/输入框"，
跟图标毫无关系，非常难猜。

已经不再手抄名单了：用到它的测试文件统一写成

```ts
vi.mock('lucide-react', async (importOriginal) =>
  (await import('../mocks/lucideReactMock')).lucideReactMock(importOriginal),
);
```

替身从**真实模块的导出**建表，所以键集合永远和 lucide 同步，谁都不用维护。
（别用 Proxy 兜底：ESM 具名导入靠模块导出的键集合解析，没有 ownKeys 的 Proxy
在 vitest 眼里等于"没有导出"，见下面那节。）

**症状→原因**：某文件整片红、报"Unable to find an element"，而该组件本身没问题 →
先怀疑这次改动新加了图标（历史踩雷：`ChevronDown` 角色工作室、`UserPlus` 房间参与者、
`Smartphone` 加桌面入口、`LayoutTemplate`/`CopyPlus` 模板页…）。现在这种情况不会再有；
若哪天又出现，检查是不是有文件又自己抄了一份名单。

## 最危险的一种"绿"：文件被静默跳过

如果 `vi.mock` 工厂返回的东西没有可枚举的导出（典型是 Proxy 兜底），ESM 具名导入解析不到，
**整个测试文件会在收集阶段失败、一条用例都不跑** —— 而 vitest 的汇总可能只显示
`Tests no tests`、`Test Files (1)`，**退出码还是 0**。看起来像通过，实际什么都没测。

所以看完汇总要确认两件事：

```bash
npx vitest run <file> 2>&1 | grep -E "Test Files|Tests "
# 1) Tests 后面是"有数字的用例数"，不是 no tests
# 2) 用例数和你印象里的一致（新增用例后应该变多）
```

要逐条看跑了哪些，加 `--reporter=verbose`（每个用例一行，卡在哪一条一眼就看得到——
上面那次"跑了 25 分钟没结果"就是靠它定位的）。

## 类型检查

`npx tsc --noEmit` 现在是**干净的**（2026-10-06 清零：那次之前 HEAD 上积了 76 处，
分布在 `src/`、`vite-plugins/` 和二十几个测试文件里，
从 2026-08-04 到 09-12 跨几十次提交累积而成）。所以它现在**可以**当门槛用：

```bash
npx tsc --noEmit          # 期望：无输出
```

### 一个必须知道的坑：tsconfig 没开 `strict`

`tsconfig.json` 里没有 `strict` / `strictNullChecks`。直接后果是**判别联合在真假分支上
不收窄**，而且不报错，只是收不进去：

```ts
type R = { ok: true; text: string } | { ok: false; status: number };
if (result.ok) {
  result.text;   // 收窄成功
} else {
  result.status; // TS2339：Property 'status' does not exist on type '{ ok: true; … }'
}
```

在分支里用 `in` 代替真假判断就能过（`in` 的收窄不受影响）：

```ts
if ('status' in result) { result.status; } else { result.text; }
```

别为此去开 `strictNullChecks`：一开会冒出一大批新的空值检查错误（清理之前实测是 164 条），
那是一次独立的、量很大的迁移，不该和别的事混在一起做。

### 改动完之后怎么确认没引入新错误

```bash
npx tsc --noEmit 2>&1 | grep -E "^src/(你改的文件)"
# 无输出 = 你改的地方类型是干净的
```


## 会偶发红的时间敏感用例

这几类在机器忙的时候会红、闲着的时候绿（同一次改动反复跑颜色不同，别急着改代码）：

- `tests/onboarding-integration.test.tsx` 的"重新播放引导"：重启导览是异步的
  （新建导览画布 → 切换 → 等房间与材料就位），已经把它那段的等待放宽到 4 秒。
- `tests/hooks/useVoiceWritingMode.test.ts` 里断言"恰好调用一次"的用例（麦克风/ASR 启动计数）：
  并行跑多个文件时最容易红。

判断办法：**单独重跑一次**（`npx vitest run <file>`），绿了就按偶发处理；要复现就先把它和别的文件
一起跑。真要修，朝"给它更真实的等待预算"改，不要靠加长 sleep 蒙。

## 改完之后怎么算"过了"

1. 相关文件定向绿；
2. `npx tsc --noEmit` 里**没有**自己碰过的文件；
3. 收尾跑一次全量，全绿（或只剩上面"偶发"里那几类，单独重跑确认）。

## 想加新用例

- 放在 `tests/` 下与源码对应的目录里（`tests/utils/`、`tests/hooks/`、`tests/components/`）。
- 需要整个 App 的集成用例才放 `tests/App.test.tsx` —— 它很慢，一个用例几秒起步。
- 需要 mock `lucide-react` 时用 `tests/mocks/lucideReactMock.tsx`，别再抄名单。
