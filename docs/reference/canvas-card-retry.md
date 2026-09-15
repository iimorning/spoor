# Reference: canvas-card in-place retry

V2 生图和失败重试都在侧栏。画布 AI / 配图卡上的 **Retry** 已关掉（`App` 在 V2 不传 `onRetry*`）。

这套虚线失败卡 + 原地重写同一 `nodeId` 的机制仍留在 V1，也值得以后做「画布上可重试的失败位」时复用。

## 何时再用

- 需要一张占位卡：失败时虚线框、原因、小字 Retry；点了仍写回同一张卡。
- 多轮讨论 / Ask 线程要重跑**其中一张**，而不是新开一轮。

V2 侧栏配图重试走 `retryChatDrawImage`（`src/services/fulfillDrawTool.ts`），不要和下面的画布路径混用。

## 视觉

失败卡：`border-2 border-dashed border-[#C2410C]/45`，底 `bg-[#C2410C]/5`。上方可保留用户原话（`userTurn`）。`AlertTriangle` + 失败标题 + 最多几行错误。Retry：`RefreshCw` + 文案，`text-[10px]`，`text-[#C2410C]`，`hover:bg-[#C2410C]/8`。点击 / pointerdown 都 `stopPropagation`，避免拖动画布。

配图进行中：虚线幽灵卡（`opacity-70`、`Loader2`）。超时后切到同一套失败 chrome，caption 右侧挂 Retry。

测试 id：`ai-generation-error`、`ai-retry`、`image-error`、`image-retry`、`image-generating`。

## UI 片段（从生产抽出备用）

```tsx
function RetryButton({
  nodeId,
  onRetry,
  label,
}: {
  nodeId: string;
  onRetry?: (id: string) => void;
  label: string;
}) {
  if (!onRetry) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onRetry(nodeId);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      title={label}
      aria-label={label}
      className="shrink-0 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-sans font-medium text-[#C2410C] hover:bg-[#C2410C]/8 transition-colors"
    >
      <RefreshCw className="h-3 w-3" aria-hidden />
      <span>{label}</span>
    </button>
  );
}

function FailedAiCardChrome({
  userTurn,
  errorText,
  onRetry,
  retryLabel,
}: {
  userTurn?: string;
  errorText: string;
  onRetry?: () => void;
  retryLabel: string;
}) {
  return (
    <div className="max-w-md px-3 py-2 overflow-hidden border-2 border-dashed border-[#C2410C]/45 bg-[#C2410C]/5">
      {userTurn ? (
        <div className="mb-2 w-fit max-w-full text-sm text-[#1a1a1a] font-serif leading-relaxed px-1 py-0.5 bg-white/50 rounded">
          {userTurn}
        </div>
      ) : null}
      <div className="flex flex-col items-start gap-1.5 py-1">
        <div className="flex items-center gap-1.5 text-[#C2410C]">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="text-[10px] font-sans font-medium">Generation failed</span>
        </div>
        <p className="text-[11px] font-sans text-[#C2410C]/80 leading-snug whitespace-pre-wrap line-clamp-6">
          {errorText}
        </p>
        {onRetry ? <RetryButton nodeId="unused" onRetry={() => onRetry()} label={retryLabel} /> : null}
      </div>
    </div>
  );
}
```

现网组件：`src/components/nodes/AiNode.tsx`（`showAiError`）、`src/components/nodes/ImageNode.tsx`（`RetryButton`）。无 `onRetry` 时只显示失败态、不显示按钮。

## 数据与机制

| 字段 | 作用 |
|------|------|
| `aiStatus` / `aiError` | AI 卡：`error`，或卡住的 `generating` 当 stale |
| `imageStatus` / `imageError` / `imageStartedAt` | 配图卡；超时见 `GPT_IMAGE_TIMEOUT_MS` |
| `userTurn` | 失败卡上展示的原问题 |
| `threadRootContextNodeId`、`threadAgentConfigId`、`threadDiscussion*` | 重试时找回上下文 |

入口：`retryAiCardGeneration(nodeId)`（`src/hooks/useAiActions.ts`）。

1. 忽略非 `ai`、以及非 `error`/`generating`。
2. 讨论卡：`spawnDiscussionTurns({ reuseNodeId, startTurnIndex: 该卡回合 })`。
3. 有 `userTurn` + Ask 根：`runAskCardGeneration(rootId, request, { reuseNodeId })`。
4. 否则：`triggerAgentAnalysis(..., { reuseNodeId })`。

`reuseNodeId` 表示**写回这张卡**，不新建。V2 新对话默认进侧栏，只有带 `reuseNodeId` 才会走画布写回——所以 V2 不能再露出这个按钮，否则迁移来的失败卡一点就回到 V1。

配图画布重试：`retryImageGeneration`（`fulfillDrawTool.ts`），原地换图。

接线（V1）：

```tsx
onRetryImageGeneration={retryImageGenerationFromCard}
onRetryAiGeneration={retryAiGenerationFromCard}
```

V2 这两项传 `undefined`（`src/App.tsx`）。

## 文案

`nodes.ai_retry` / `nodes.image_retry`；失败标题 `nodes.ai_generation_failed` / `nodes.image_generation_failed`。
