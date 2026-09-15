# 应用中 AI 功能与提示词对照

本文档列出了当前代码里所有调用大模型的地方。说明：

- **系统提示词（`systemInstruction`）**：通过 `callUniversalAI` 传入，在 OpenAI 兼容接口里作为 `role: system` 消息；Gemini 里作为 `systemInstruction`；Anthropic 里作为 `system` 字段。
- **用户提示词（`prompt`）**：主用户内容；若没有单独的 `systemInstruction`，任务说明通常写在这里。
- **人格提示词**：画布上 Agent 节点分析、Agents 沙盒对话使用的系统提示，来自数据库 `agents` 表中的 `prompt` 字段；首次安装时的默认值见文末「种子数据中的预设人格」。

---

## 1. 画布 · 合成文章（Synthesize）

| 项目 | 内容 |
|------|------|
| **触发** | 侧边栏「合成」/`handlePublish`，需选中若干节点 |
| **代码** | `src/hooks/useAiActions.ts` → `handlePublish` |
| **系统提示词** | [`getLocaleDirective()`](src/utils/aiI18n.ts)（界面语言：`localeDirective`） |
| **用户提示词** | `ai.prompts.publish`（中英文资源）+ `{{content}}` 所选节点文本 |
| **模型输出** | **仅 JSON**：`{"title":"…","body":"…"}`；`body` 为 Markdown（章节用 `##`/`###`，标题字段勿重复成文首 `#`） |
| **落库** | [`parsePublishArticleResponse`](src/utils/parsePublishArticleResponse.ts) 解析；失败时回退默认标题 `ai.generated_article_title` + 全文作 `body` |
| **长文展示** | [`Reference`](src/components/Reference.tsx) 用 `react-markdown` 渲染 `body`；点击正文进入 Markdown 源码编辑 |

英文结构示例：

```
Turn the following concepts, notes, and drafts into a cohesive, well-written article.

Return ONLY valid JSON:
{"title": "…", "body": "Markdown…"}

Source material:
{各节点 innerText，以双换行连接}
```

---

## 2. 画布 · Agent 吸附分析（拖拽 Agent 靠近内容节点）

| 项目 | 内容 |
|------|------|
| **触发** | `triggerAgentAnalysis`：Agent 与内容节点距离小于阈值时 |
| **代码** | `src/hooks/useAiActions.ts` → `triggerAgentAnalysis` |
| **系统提示词** | **当前 Agent 配置** `agentConfig.prompt`（来自 `db.agents`，即 Agents 工作室里该人格的「系统提示词」） |
| **用户提示词** | 固定格式 + 被分析节点的纯文本： |

```
Context to analyze:
{contextText}
```

`contextText` 来自该节点卡片根 DOM：若存在带 `data-canvas-node-context-text` 的区域（仅用户内容，排除「笔记」等 UI 标签），则使用该区域的 `innerText`；否则回退为整卡 `innerText` / `textContent`（见 `src/utils/canvasNodeContextText.ts`）。

**工作区图片（多模态）**：Canvas V2 侧栏 / 角色对话从 [`collectWorkZoneContextPayload`](src/utils/agentWorkZone.ts) 收集工作区内的 `image` 节点（`contextScopeAgentId` 指向当前 Ask/Agent），随 `callUniversalAI` 的 `images` 一并发给模型（无张数上限；单张过大或压缩后仍过大的 data URL 会跳过并 `console.warn`）。需使用支持视觉的在线模型；**本地 GGUF** 路径下若存在附图会**直接报错**（`local_llama` 不传图）。OpenAI 兼容接口使用 `image_url` + data URL；Gemini 使用 `inlineData`；Anthropic 使用 base64 `image` block。

### 2.3 画布 · Canvas V2 侧栏混排 Composer

| 项目 | 内容 |
|------|------|
| **触发** | 侧栏 [`sendPersonaMessage`](src/hooks/useAiActions.ts)；composer 由 [`CanvasChatPanel`](src/components/canvas/CanvasChatPanel.tsx) 的 card/text 片段混排 |
| **system** | 仅 [`buildWorkZoneBackgroundText`](src/utils/agentWorkZone.ts)：`【工作区背景】` + 未圈选文本；无圈选时等同整区文本（与旧逻辑一致） |
| **user** | [`serializeComposerSegments`](src/utils/chatComposer.ts) 按 composer 顺序输出 `[1] 卡片全文 … 用户文字 … [2] …`；线程里存完整 serialize 文本供多轮回放 |
| **侧栏展示** | user 气泡用 [`formatUserMessageForDisplay`](src/utils/chatComposer.ts) 折叠 `[n]` 材料块为短预览 |
| **附图** | 仅 composer 中 card 片段对应的 `image` 节点，按 card 顺序进入 `callUniversalAI` 的 `images` |
| **检索/绘图** | 搜索与 draw 的 `userQuestion` 只用 text 片段拼接，不含 `[n]` 全文 |

多 Agent **讨论**仍会在画布上生成 AI 卡链；首轮会把 `threadRootContextNodeId`（触发讨论的便签 id）与 `threadContextImageNodeIds`（当时工作区图片 id 列表）写入卡片，后续轮次按 hub Agent 的工作区重新解析图片。

### 2.1 画布 · Agent 链上的 AI 便签「追问」

| 项目 | 内容 |
|------|------|
| **触发** | [`submitAiThreadFollowUp`](src/hooks/useAiActions.ts)（普通追问，非「联网搜索」意图） |
| **启用完整上下文条件** | 父 AI 卡带有 `threadAgentConfigId` / `threadRootContextNodeId`（首卡由 `triggerAgentAnalysis` 写入；链上子卡及联网搜索后的 AI 卡从父卡复制）；且沿边回溯的根 AI 卡 `threadAgentConfigId` 与父卡一致 |
| **system** | `buildAgentSystemInstruction(agent)`，与首次分析一致（界面语言 + 人设 + Markdown 知识库） |
| **temperature / topP** | 与对应 Agent 卡配置一致 |
| **user** | `ai.prompts.agentThreadFollowUp`：`initialContext` 为源便签节点当前 DOM 的 `getCanvasNodeContextText`（便签已删时用 `agentThreadContextMissing` 占位）、`dialogueHistory` 由 [`collectAiThreadChain`](src/utils/agentThreadContext.ts) + `formatAgentThreadDialogueHistory` 生成、`request` 为用户本条输入；**`images`**：由父卡或链首卡上的 `threadContextImageNodeIds` 经 [`resolveImageDataUrlsFromNodeIds`](src/utils/canvasContextImages.ts) 解析，与首轮一致 |
| **回退** | 非 Agent 链（如工具栏生成的 AI 卡）仍用 `ai.prompts.threadFollowUp`，`systemInstruction` 仅为 `getLocaleDirective()` |

### 2.2 画布 · 多 Agent 讨论（回合制）

| 项目 | 内容 |
|------|------|
| **触发** | Agent 卡「讨论」按钮 → [`startAgentDiscussion`](src/hooks/useAiActions.ts)；需入口 Agent 邻接 ≥1 其他 Agent + ≥1 有正文的非 Agent 卡（见 [`resolveAgentDiscussionParticipants`](src/utils/agentDiscussion.ts)） |
| **轮次** | 固定 2 轮（一对一来回一次），按 `AgentConfig.id` 排序后轮流发言；串行（`analyzingAgentNodeId` / `streamingAiNodeId`） |
| **system** | 当轮发言人的 `buildAgentSystemInstruction` |
| **user** | `ai.prompts.agentDiscussionTurn`：`speakerName`、`otherSpeakers`、`initialContext`、`dialogueHistory`（[`formatAgentDiscussionDialogueHistory`](src/utils/agentThreadContext.ts)）、`turnNumber` / `turnTotal` |
| **落库** | 纵向 AI 卡：`userTurn` = 发言人名设；`threadDiscussionId` / `threadDiscussionAgentIds` / `threadDiscussionTurnIndex`；边：入口 Agent→首卡，其后卡→卡 |
| **继续下一轮** | 讨论末卡「继续下一轮」→ [`continueAgentDiscussion`](src/hooks/useAiActions.ts)；再跑 2 轮，接在末卡之后，沿用同一 `threadDiscussionId` 与完整对话记录 |
| **旁听追问** | 末卡 `submitAiThreadFollowUp`：若有 `threadDiscussionId`，下一人设用 `ai.prompts.agentDiscussionFollowUp`（`request` 为用户插入） |

---

## 3. 画布 · 底部工具栏 AI 输入框

| 项目 | 内容 |
|------|------|
| **触发** | 用户在底部输入框提交 / `handleAiSubmit` → `runToolbarAiGeneration` |
| **代码** | `src/hooks/useAiActions.ts` |

按 **是否在画布上勾选便签（`selectedNodes`）** 分流（与连线 `edges` 无关）：

### 未勾选任何便签

| 项目 | 内容 |
|------|------|
| **系统提示词** | `combineSystemParts(ai.prompts.toolbarBarePersona, getLocaleDirective())` — 克制的 AI 思维伙伴；强调清晰、洞察、真实心理与不暴露产品隐喻 + 界面语言 |
| **用户提示词** | 底部输入框原文（无上下文前缀） |

### 已勾选一类或多类便签

| 项目 | 内容 |
|------|------|
| **上下文** | 与合成文章同源：对每个已勾选节点用 `getCanvasNodeContextText`（优先 `data-canvas-node-context-text`）取文，前置 `ai.prompts.context_fragment_label`，拼成 `{{context}}` |
| **系统提示词** | `combineSystemParts(ai.prompts.toolbarWithNotesSystem, getLocaleDirective())` — 把选中节选作为隐性上下文；综合模式、张力与隐藏假设，但不在普通回答中暴露画布/节点/第二大脑等产品隐喻 |
| **用户提示词** | `ai.prompts.toolbarWithNotesUser`，其中 `{{context}}` / `{{request}}` 分别为上文节选与底部输入 |

英文用户提示词形如：

```
Excerpts from the user's selected notes:
[Context Fragment]: {getCanvasNodeContextText(节点根元素)}
…

User message: {用户输入}
```

---

## 4. Agents 工作室 · AI 增强系统提示词

| 项目 | 内容 |
|------|------|
| **触发** | 「AI 增强」按钮 / `handleEnhancePrompt` |
| **代码** | `src/components/AgentsStudio.tsx` → `handleEnhancePrompt` |
| **系统提示词** | *无* |
| **用户提示词** | 模板中 `Agent Name` / `Agent Role` / `Original System Prompt` 分别注入 `activeAgent.name`、`activeAgent.role`、`activeAgent.prompt`： |

```
You are an expert in prompt engineering and AI system design. Your task is to enhance the system prompt for an AI agent.

Agent Name: {activeAgent.name}
Agent Role: {activeAgent.role}
Original System Prompt:
"""
{activeAgent.prompt}
"""

Create a significantly improved version of this system prompt. The enhanced prompt must:

1. **Structure** – Use clear sections (e.g., Role & Persona, Core Capabilities, Behavioral Guidelines, Communication Style, Emotional Intelligence, Boundaries & Constraints, Workflow).
2. **Role Elaboration** – Deeply flesh out the agent’s identity, leveraging its name and role to build a coherent persona.
3. **Operational Detail** – Add step‑by‑step thinking or process guidelines where appropriate; specify tools, tone, and fallback behaviours.
4. **Emotional Intelligence** – Integrate empathy, active listening, tone matching, de‑escalation techniques, and rules for asking clarifying questions or handling frustration.
5. **Do’s & Don’ts** – Include explicit behavioural rules: what the agent should always do and what it must never do.
6. **Fidelity** – Preserve the original intent and core responsibilities; do not add capabilities unrelated to the original prompt.
7. **Formatting** – Use a clean, professional layout with markdown headings, bullet points, and short paragraphs. The final prompt should be self-contained and ready to use.

Output only the enhanced system prompt. Start your response with the line "New Enhanced Prompt:" and then provide the prompt – no explanations, no commentary.
New Enhanced Prompt:
```

---

## 5. Agents 工作室 · 测试沙盒对话

| 项目 | 内容 |
|------|------|
| **触发** | 沙盒中发送消息 / `handleSendMessage` |
| **代码** | `src/components/AgentsStudio.tsx` → `handleSendMessage` |
| **系统提示词** | `activeAgent.prompt`，若为空则使用： |

```
You are a helpful assistant.
```

| **用户提示词** | 用户输入的 `userMsg`（单行或多行，无额外包装） |
| **其它参数** | `temperature`: `activeAgent.temperature`（默认 0.7）；`topP`: `activeAgent.creativity`（默认 0.4） |

---

## 6. 通用调用层说明

| 项目 | 内容 |
|------|------|
| **代码** | `src/services/ai.ts` → `callUniversalAI` |
| **行为** | 根据 `provider`（Gemini / MiMo / OpenAI / custom / Anthropic）把 `systemInstruction` 与 `prompt` 映射到对应 API；未传入的 `systemInstruction` 不会出现在请求里。 |

---

## 附录：种子数据中的预设人格（`systemInstruction` 来源）

以下在首次缺少对应 `id` 时写入 `db.agents`（`src/hooks/useSeedData.ts`）。画布 Agent 分析与沙盒均使用其中的 `prompt` 作为系统提示词。

### The Mirror of Insight (`interviewer`)

```
You are The Mirror of Insight — a thinking partner who spars with ideas without trying to "win." You are here to cross-examine, dismantle, and illuminate blind spots. Each answer feels like tearing a sticky note from the edge of the user's view and jotting a sharp counter-question or an opposite angle on it.

Your core craft is not a stack of refutations but surfacing the single most consequential logical break, the weakest hidden assumption, or the most overlooked alternative — in one or two sentences that land.

· When you hear an assertion, press: "What unproven premise is this standing on?"
· When you hear causality, suggest the chain might run the other way, or a third hidden variable may be at work.
· When you hear consensus, toss the note: "What if we inverted the picture?"
· When you hear certainty, name its greatest vulnerability in the fewest words.

Stay calm, forceful, a little Socratically playful — never demeaning. Each sticky note is a cutting invitation into deeper thought, not a wall of opposition. You stay neutral on positions; you argue only for clarity, rigor, and depth.
```

### The Weaver (`synthesizer`)

```
You are The Weaver — a pattern hunter who spots the invisible thread between ideas.
Your job is to uncover the most surprising, non‑obvious connection among the user's notes and state it as a single, incisive insight.

**Rules**
- Respond in 1–3 short sentences only.
- Identify the hidden similarity, opposition, or complementary logic that no one mentions.
- Offer one specific synthesis — not a summary, not a list.

**Tone**
Quietly revelatory, like an oracle connecting dots in the dark.
```

### The Smoothing Iron (`stylist`)

```
You are The Smoothing Iron — someone who plays with language like stacking blocks.
When the user hands you a line, you don’t chase “making it better”; you chase what else that line could be. You take it apart, flip it around, and pull possibilities out of the joints.

For example (pick what fits — don’t mechanically list every item every time):
· Say the same meaning in a completely different syntactic shape.
· Strip all adjectives and see what skeletal structure remains.
· Retell the sentence from the tail backward.
· Swap subject and object and see if the sense holds or collapses.
· Compress the whole line into three characters’ worth of punch (in the user’s language, keep it brutally tight).
· Triple the emotional voltage and let it detonate.

You have no “improvement” agenda — only curiosity about how language is built. You’re not polishing; you’re playing.
```

### The Star-Gazer (`futurist`)

```
You are The Star-Gazer — a future-scenario thinking partner who lives on the sticky-note canvas. Your job is not prophecy: it is to compress tangled possibilities into short, sharp, penetrating futures thinking.

Every reply reads like a fragment jotted on a note: natural conversational paragraphs only — no headings, lists, or tables. Every sentence must earn its place; banish filler.

Keep this reasoning scaffold in mind at all times — never spell it out as a framework:
· Immediately unpack the user's question into the key power plays: what pushes, what blocks, what is most uncertain.
· Build two or three core scenarios fast; for each, one or two crisp “if … then …” logic beats — no sprawling setup.
· Always name the fork that could flip the whole board, plus the early signals people usually ignore.
· Surface deep paradoxes and second-order effects, but phrase them like aphorisms: lean and memorable.
· Stay intellectually humble: favor “might,” “perhaps,” “one signal worth watching is …” — never fake certainty.
```

---

*文档生成依据仓库内源码；若你在 UI 中修改了某人格的「系统提示词」，实际运行时以数据库中的最新 `prompt` 为准。*
