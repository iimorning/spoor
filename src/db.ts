import Dexie, { type Table } from 'dexie';
import type { AskSearchHit } from './utils/askSearchHits';
import type { ComposerSegment } from './utils/chatComposer';
import type { TurtleSoupRound } from './utils/turtleSoupRound';
import type { PocketBlock } from './utils/pocketBlocks';

export interface CanvasNode {
  id: string;
  canvasId?: string;
  type: string;
  content?: string;
  description?: string;
  /** Unix ms when this card was first inserted on a canvas. Omitted on cards created before this field existed. */
  createdAt?: number;
  /** Theme card footer label (editable); default differs by layout when unset/empty */
  themeTag?: string;
  agentConfigId?: string;
  fileType?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  /** User-set card rotation in degrees (canvas space). */
  rotation?: number;
  layout?: number;
  /** 画布 AI 对话卡：本回合用户追问（上半区）；`content` 为 AI 回复（下半区） */
  userTurn?: string;
  /**
   * AI 回复卡：本回合模型的深度思考原文（从 `<think>` 抽出，不展示在正文里）。
   * 用户可通过卡片右下角脑子图标回看。随整卡 `data` JSONB 同步，无字段白名单。
   */
  thinkingTrace?: string;
  /** 旧版卡片内追问框用过；现已改为右侧问 AI，字段仅兼容已有数据 */
  followUpSent?: boolean;
  /** Agent 分析链：首张 AI 卡记录源便签 id；追问链上子卡从父卡复制 */
  threadRootContextNodeId?: string;
  /** Agent 分析链：首张 AI 卡记录 `AgentConfig.id`；子卡从父卡复制 */
  threadAgentConfigId?: string;
  /**
   * 海龟汤：本线程隐藏裁判包（汤底 / key_facts）。只写在 AI 回复卡上，画布不展示。
   */
  turtleSoupRound?: TurtleSoupRound;
  /** Agent 分析链：首轮附带的多模态图片节点 id（便签/Agent 邻接 image）；子卡从父卡复制 */
  /**
   * Optional template-local key (e.g. `'theme-howto'`, `'agent-host'`) stamped
   * when this card was materialized from a `CanvasTemplateDoc`. Lets UI code
   * (e.g. canvas onboarding tour) anchor to template-original cards even
   * after their UUIDs have been remapped.
   */
  templateKey?: string;
  threadContextImageNodeIds?: string[];
  /**
   * AI 多轮对话：本卡在 threadRootContextNodeId 所属对话中的轮次（0-based）。
   * 0 = 首轮回复（"笔记 A 说什么"），1 = 第一轮追问回复（"那 A 第 2 段呢?"），以此类推。
   * 仅 AI 卡有值；Ask 卡和被引用为上下文的笔记卡永远为 undefined。
   */
  threadRound?: number;
  /** Ask 卡：多轮回复是否叠放收起（最新一轮在最上面） */
  askThreadCollapsed?: boolean;
  /**
   * AI 回复卡：相对 Ask 卡的展开态位置（折叠前写入，再展开时恢复）。
   * 存的是 `reply.x - ask.x` / `reply.y - ask.y`。
   */
  askThreadExpandedOffsetX?: number;
  askThreadExpandedOffsetY?: number;
  /** 多 Agent 讨论：同场讨论共享 id */
  threadDiscussionId?: string;
  /** 多 Agent 讨论：发言顺序（AgentConfig.id，2–3 个） */
  threadDiscussionAgentIds?: string[];
  /** 多 Agent 讨论：本卡轮次（0-based） */
  threadDiscussionTurnIndex?: number;
  /** AI 卡：联网搜索来源卡是否叠放收起 */
  webSearchSourcesCollapsed?: boolean;
  /** 文本卡：所属联网搜索回答卡 id（来源卡标记） */
  webSearchParentId?: string;
  /** 文本卡：在来源列中的顺序（0-based） */
  webSearchIndex?: number;
  /**
   * 联网搜索来源卡：相对父卡的展开态位置（折叠前写入，再展开时恢复，避免覆盖用户拖拽）。
   * 存的是 `source.x - parent.x` / `source.y - parent.y`。
   */
  webSearchExpandedOffsetX?: number;
  webSearchExpandedOffsetY?: number;
  /** 图片卡：联网搜图来源页 URL（可跳转） */
  sourceUrl?: string;
  /**
   * 备忘标题：口袋编辑器顶上那个单独的输入框。
   * 画布上的便签没有标题概念，所以摆放时会把它并进正文第一段，不会丢。
   */
  title?: string;
  /**
   * 备忘卡：一串按顺序排的文字段 / 图片段。
   * 只有图文混排的备忘才有；纯文字备忘仍旧是 `content` 一段文本，
   * 所以老数据一行都不用迁。两者互斥，见 utils/pocketBlocks。
   */
  blocks?: PocketBlock[];
  /**
   * 图片卡：它属于哪条备忘。属于某条备忘的图片是那条备忘里的一段，
   * 口袋列表里必须跟着备忘一起显示，不能自己冒成独立一条。
   */
  ownerMemoId?: string;
  /**
   * 图片卡：端侧 OCR 识别出的文字（口袋拍照时写入）。
   * 单独一个字段而不是塞 description：description 在 ImageNode 里是单行标题，会被截断。
   * 摆放到画布时用它长出一张关联便签。
   */
  ocrText?: string;
  /** 联网网页来源卡：维基 pageimage / og:image 预览 */
  previewImageUrl?: string;
  /** 图片卡：由 302 GPT-Image-2 等模型生成（非联网搜图） */
  aiGenerated?: boolean;
  /**
   * AI 回复卡：生成状态。`undefined` = 已就绪。
   * `generating` 期间正文为空，画布上显示思考占位；失败后变为 `error` 并保留卡片供重试。
   */
  aiStatus?: 'generating' | 'error';
  /** AI 回复卡：生成失败原因（`empty` / `stale` 为可翻译代码，其余为接口原文） */
  aiError?: string;
  /** AI 回复卡：本次生成开始时刻（重试会刷新） */
  aiStartedAt?: number;
  /**
   * 图片卡：生成状态。`undefined` = 已就绪，所以联网搜图卡与历史生成卡无需迁移。
   * `generating` 期间 `content` 为空串，画布上显示虚影占位卡。
   */
  imageStatus?: 'generating' | 'error';
  /** 图片卡：生成失败原因，展示在错误卡上（`timeout` / `stale` 为可翻译代码） */
  imageError?: string;
  /** 图片卡：生图提示词（成功后仍保留，提问时作为生成思路） */
  imagePrompt?: string;
  /** 图片卡：本次生成开始时刻（重试会刷新；用于等待时长 / 超时 UI） */
  imageStartedAt?: number;
  /** 图片卡：生成时源 AI 卡的可见说明（不含隐藏思维链） */
  imageSourceNote?: string;
  /** 主题卡：相连便签 / 书籍展开分支是否叠放收起 */
  bookExpandBranchesCollapsed?: boolean;
  /** 文本卡：所属主题卡 id（书籍展开或手动相连后折叠时写入） */
  bookExpandParentId?: string;
  /** 文本卡：在主题分支中的顺序（0-based） */
  bookExpandIndex?: number;
  /**
   * 主题相连便签：相对主题卡的展开态位置（折叠前写入，再展开时恢复）。
   * 存的是 `note.x - theme.x` / `note.y - theme.y`。
   */
  bookExpandExpandedOffsetX?: number;
  bookExpandExpandedOffsetY?: number;
  /** 长文卡：合成用来源卡是否叠放收起（最先生成/选中的在最上面） */
  essaySourcesCollapsed?: boolean;
  /**
   * 长文卡：合成时的来源卡 id，按当时顺序（先选/先生成的在前）。
   * 有值时画布叠放不再读 Article.sourceCards。
   */
  essaySourceNodeIds?: string[];
  /** 来源卡：所属长文卡 id（折叠时写入） */
  essaySourceParentId?: string;
  /** 来源卡：在长文来源叠放中的顺序（0-based，0 在最上面） */
  essaySourceIndex?: number;
  /**
   * 来源卡：相对长文卡的展开态位置（折叠前写入，再展开时恢复）。
   * 存的是 `source.x - essay.x` / `source.y - essay.y`。
   */
  essaySourceExpandedOffsetX?: number;
  essaySourceExpandedOffsetY?: number;
  /**
   * 自由叠卡枢纽：成员 id（含自己），写作顺序从底到顶 = 从先到后。
   * 最后叠上去的在最上面，也是长文的最后一段。
   */
  notePileCollapsed?: boolean;
  notePileMemberIds?: string[];
  /** 叠卡原点（枢纽叠放前的位置）；整摞拖动时随 delta 平移。 */
  notePileOriginX?: number;
  notePileOriginY?: number;
  /** 成员：所属叠卡枢纽 id（枢纽自己也写自己的 id） */
  notePileParentId?: string;
  /** 成员：写作顺序（0-based，0 = 长文最先 / 视觉最底下） */
  notePileIndex?: number;
  notePileExpandedOffsetX?: number;
  notePileExpandedOffsetY?: number;
  /** 书籍卡：当前阅读页/章索引（0-based），刷新后恢复 */
  bookPageIndex?: number;
  /** 书籍卡：当前页正文滚动位置（px），与 bookPageIndex 一并恢复 */
  bookScrollTop?: number;
  /**
   * 书籍卡：这本书自己的摘抄列表。只留在这本书上，不生成画布卡片。
   * 书籍卡不参与同步（沿用 `thinkingTrace` 的整卡无白名单约定）。
   */
  bookExcerpts?: BookExcerpt[];
  /**
   * 书籍卡：AI 伴读在正文里标出来的重点段落。
   *
   * 存的是从原文逐字复制的引文，不是偏移量：正文按 blocks 渲染、PDF 干脆是一整块
   * 纯文本，偏移量对不上任何一边，引文却能一字不差地找回来（见 bookPassage.ts）。
   */
  bookFocusMarks?: BookFocusMark[];
  /**
   * 书籍卡：用户手动删过标注的章节。
   *
   * 没有这道闸的话，最后一条被删掉的那一章会立刻被当成"还没标过"，
   * 1.5 秒后自动重标——用户明明说了不要，它又自己长回来了。
   */
  bookFocusDismissedUnits?: number[];
  /** 书籍卡：右侧栏 AI 对话线程（未索引嵌套数组）。 */
  bookChatMessages?: BookChatMessage[];
  /** 书籍卡：归档的侧栏对话（最新在前）。 */
  bookChatSessionArchive?: BookChatSession[];
  /** 书籍卡：侧栏房间里的角色（`AgentConfig.id`，首位是主持人）。空 = 沿用内置助手。 */
  bookChatPersonaIds?: string[];
  /** 书籍卡：侧栏房间里被禁言的角色 id。 */
  bookChatMutedPersonaIds?: string[];
  /**
   * V2：归属哪个角色卡的工作区（默认上下文范围）。
   * 仅用户明确拖入工作区时写入；拖出可清空。非永久记忆。
   */
  contextScopeAgentId?: string;
  /**
   * 角色卡：上一次主动发言时，这个房间的内容指纹（见 `utils/roomProactive.ts`）。
   *
   * 指纹一样就不再动手。**模型选择沉默时也要照样写这里**——不然同一份内容会
   * 一次又一次送去问模型，白花钱，而且模型多半每次都回同样的沉默。
   * 只有"这一趟作废了"（用户期间说了话、或者中途被关掉）才不写。
   */
  proactiveLastSignature?: string;
  /** V2 摘录卡：来源侧栏对话 thread id */
  sourceThreadId?: string;
  /** V2 摘录卡：来源消息 id */
  sourceMessageId?: string;
}

/** V2：用户在画布上绘制的工作区矩形，绑定到角色卡（agent / Ask）。 */
/**
 * 音色试听的音频缓存：一条 = 一句样句的 WAV。
 * 合成一次要一两秒，缓存下来后重复试听是本地播放，瞬间出声。
 */
export interface VoicePreviewClip {
  /** `${model}::${voiceId}::${样句}`，见 utils/voicePreviewCache.ts */
  id: string;
  /**
   * WAV 字节。存 TypedArray 而不是 Blob：Blob 能不能原样过一遍 IndexedDB 取决于运行环境
   * （jsdom/fake-indexeddb 里读回来是个空对象），字节到处都是稳的，播放时再拼回 Blob。
   */
  data: Uint8Array;
  /** MIME（`audio/wav`），拼回 Blob 时用。 */
  type: string;
  updatedAt: number;
}

export interface CanvasWorkZone {
  id: string;
  canvasId: string;
  /** 归属的角色卡节点 id（`agent` 或 `ask`）。未绑定时省略。 */
  personaNodeId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  createdAt: number;
}

/** How the canvas was created; omitted / \`blank\` = empty workspace. */
export type CanvasTemplate = 'blank' | 'cosmos';

export interface Canvas {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Optional starter layout; \`cosmos\` = Trauma Inner Cosmos zones + agents. */
  template?: CanvasTemplate;
  /** History-popover folder; omitted = unfiled. */
  folderId?: string;
  /** Manual order among sibling canvases in the history list. */
  sortOrder?: number;
}

/** Custom folders in the canvas history popover. */
export interface CanvasFolder {
  id: string;
  name: string;
  createdAt: number;
  sortOrder: number;
}

export interface SourceCardSegment {
  /** 原画布卡片 id（回链用，可能已被删除） */
  nodeId: string;
  /** 来源画布 id */
  canvasId: string;
  /** 卡片类型，用于侧栏图标（note/text/ai/image/video/book/theme/document/agent...） */
  kind: string;
  /** 侧栏显示标题 */
  title: string;
  /** 该卡对应的正文 Markdown 段（卡片原文 verbatim，不含 AI 过渡） */
  segmentText: string;
  /**
   * `false` = collected onto the essay but not yet dropped into the body.
   * Omit / `true` = already in the article (publish, or dragged into the editor).
   */
  inBody?: boolean;
  /**
   * AI 加的过渡句数组（插入在本卡 segmentText 之前；opener 仅放第一张卡）。
   * 用户在编辑器里采用后从该数组中删除，删掉的也会从该数组移除。
   */
  transitions?: string[];
  /**
   * AI 建议从 segmentText 中删掉的原文子串（编辑器里删除线高亮）。
   * 接受后从正文移除；拒绝后保留原文并去掉高亮。
   */
  deletions?: string[];
}

/** Binary media embedded by reference in a generated article. */
export interface ArticleMedia {
  /** Stable id used by `spoor-article-media:` Markdown URLs. */
  id: string;
  /** Original canvas image node, when known. */
  sourceNodeId?: string;
  mimeType: string;
  /** Blob avoids Base64 inflation and is loaded by the browser without parsing text. */
  blob: Blob;
  /** Public Storage URL after first cloud upload; avoids re-uploading the Blob. */
  cloudStorageUrl?: string;
}

export interface Article {
  id: string;
  title: string;
  content: string;
  date: string;
  type: string;
  author?: string;
  tags?: string[];
  privateNotes?: string;
  linkedCanvasIds?: string[];
  /** AI 合成时按选中顺序生成的来源卡片分段；存在且未手改正文时由其拼接驱动 */
  sourceCards?: SourceCardSegment[];
  /** True while outline→article generation is still streaming into `content`. */
  generating?: boolean;
  /**
   * After the user edits the unified body editor, `content` is canonical.
   * Absent/false keeps legacy behavior: join `sourceCards` even if `content` is stale.
   */
  contentDrivesBody?: boolean;
  /** Local image payloads referenced from content/sourceCards, stored once as Blobs. */
  media?: ArticleMedia[];
  /** Sidebar AI rewrite thread for this article (unindexed nested array). */
  chatMessages?: EssayChatMessage[];
  /** Archived sidebar chat sessions for this article (newest first). */
  chatSessionArchive?: EssayChatSession[];
  /** 侧栏房间里的角色（`AgentConfig.id`，首位是主持人）。空 = 沿用内置助手。 */
  chatPersonaIds?: string[];
  /** 侧栏房间里被禁言的角色 id。 */
  chatMutedPersonaIds?: string[];
  /** AI 标出来的行。空 = 还没标过。全局关掉时这些也还在，只是不往外端。 */
  essayFocusMarks?: EssayFocusMark[];
  /** 上一次读到第几个字，用来判断该不该再跑一趟。 */
  essayFocusLastScanChars?: number;
}

/** One archived AI editor chat for an article. */
export interface EssayChatSession {
  id: string;
  createdAt: number;
  endedAt: number;
  /** Short label from the first user turn. */
  preview: string;
  messages: EssayChatMessage[];
}

export interface EssayChatAttachmentMeta {
  name: string;
  kind: 'image' | 'document';
  /** Image preview for the chat sidebar (data URL). */
  previewUrl?: string;
}

export interface EssayChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
  /** How many placeholder edits this assistant turn inserted into the body. */
  editCount?: number;
  /** Files the user attached when sending this turn. */
  attachments?: EssayChatAttachmentMeta[];
  /** Inline illustrations from the draw tool (excerpt inserts into the editor). */
  images?: CanvasChatGeneratedImage[];
  /** Live web-search hits for this turn (excerpt inserts into the editor). */
  searchHits?: AskSearchHit[];
  /** Clickable related questions shown under this assistant reply. */
  suggestedFollowUps?: string[];
  /** 侧栏房间：这一条是谁说的（`AgentConfig.id`）。单角色时为空。 */
  speakerAgentId?: string;
  /** 侧栏房间：显示用的名字。留空时气泡不显示说话人前缀。 */
  speakerName?: string;
}

/**
 * 书籍卡的一条摘抄。只存在这本书上，不生成画布卡片。
 * `unitIndex` / `unitLabel` 供「跳回原文」使用；`bookTitle` 是快照，
 * 书被改名或重新导入后，这条摘抄仍能说清自己来自哪本书哪一章。
 */
export interface BookExcerpt {
  id: string;
  /** 选中的原文。 */
  text: string;
  /**
   * 摘抄来源。`book` = 正文里选中的原文，可以跳回；`chat` = 右栏对话里的内容
   * （AI 回复、检索结果），没有对应的原文位置。
   * 缺省按 `book` 处理——加这个字段之前的摘抄都来自正文。
   */
  source?: 'book' | 'chat';
  /** 摘抄发生时所在章节索引（0-based，对应 BookPayload.units）；`chat` 来源写 -1。 */
  unitIndex: number;
  /** 章节标题，或 `5 / 21` 这样的位置快照；`chat` 来源留空。 */
  unitLabel: string;
  /** 书名快照。 */
  bookTitle: string;
  /**
   * 用户自己写在摘抄下面的想法；没有想法时不写这个键。
   * 放上画布时和摘抄正文合成同一张卡，伴读对话里也一并送给模型。
   */
  note?: string;
  createdAt: number;
}

/** One archived sidebar AI chat for a book card. */
export interface BookChatSession {
  id: string;
  createdAt: number;
  endedAt: number;
  /** Short label from the first user turn. */
  preview: string;
  messages: BookChatMessage[];
}

/**
 * AI 在长文正文里标出来的一行。
 *
 * 和 `BookFocusMark` 同一套纪律：`quote` 必须是正文里**逐字**出现过的一段，且只出现
 * 一次；定位靠它，不靠偏移量。用户后来把这句话改了，标注就定位不到、直接不显示——
 * 和书籍那边一样，不迁移也不报错。
 *
 * 差别是它不挂在 offset 上也不落在文档里：渲染走 ProseMirror 的 Decoration（视图
 * 状态），所以用户保存下来的 markdown 干干净净，不会混进标注标记。
 */
export interface EssayFocusMark {
  id: string;
  quote: string;
  /** AI 为什么觉得这一行值得再看一遍。挂在句子上，不是挂在整篇上。 */
  note: string;
  createdAt: number;
}

/**
 * AI 伴读在正文里标出来的一段重点。
 *
 * `quote` 必须是正文里**逐字**出现过的一段，且只出现一次；定位靠它，不靠偏移量。
 */
export interface BookFocusMark {
  id: string;
  unitIndex: number;
  quote: string;
  /** 这一条为什么值得停下来看。挂在句子上，不是挂在章节上。 */
  note: string;
  createdAt: number;
  /**
   * 这条高亮是谁留下的。
   *
   * `ai`（缺省）是伴读自己标的，带一段说明、点开有脚注、进清单和待读角标。
   * `translate` 是读者自己划词翻译留下的。译文存在 `note` 里，再点高亮时
   * 打开初次那张浮层，不走伴读脚注。
   *
   * 必须分开：伴读靠"这一章有没有 AI 标注"决定还读不读，翻译高亮要是被算
   * 进去，翻过一次翻译的章节就再也不会被伴读标了。
   */
  origin?: 'ai' | 'translate';
}

/**
 * 书籍卡侧栏 AI 对话的一条消息。
 * 对齐 `EssayChatMessage`，去掉书籍没有的 `editCount`：书籍正文只读，不写占位符。
 */
export interface BookChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
  /** Inline illustrations from the draw tool. */
  images?: CanvasChatGeneratedImage[];
  /** Live web-search hits for this turn (shown in the panel, not as canvas cards). */
  searchHits?: AskSearchHit[];
  /** Clickable related questions shown under this assistant reply. */
  suggestedFollowUps?: string[];
  /** 侧栏房间：这一条是谁说的（`AgentConfig.id`）。单角色时为空。 */
  speakerAgentId?: string;
  /** 侧栏房间：显示用的名字。留空时气泡不显示说话人前缀。 */
  speakerName?: string;
}

/** Markdown 知识：文件内容持久化在 IndexedDB，调用模型时整段注入 system（非 RAG）。 */
export interface AgentMarkdownKnowledgeFile {
  name: string;
  content: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  role: string;
  prompt: string;
  temperature?: number;
  creativity?: number;
  color?: string;
  knowledgeMarkdownFiles?: AgentMarkdownKnowledgeFile[];
  /** GPT-Image-2 literary illustration used as the canvas agent card background. */
  coverImageUrl?: string;
  /**
   * 这个角色朗读用的 MiniMax 音色。空 = 跟随全局设置与界面语言默认。
   * 可选值见 `src/constants/minimaxVoices.ts`（只收国内版的中英文音色）。
   */
  voiceId?: string;
  /** Stable key for deduping personas imported from community / official templates. */
  communityPersonaKey?: string;
}

export interface Edge {
  id: string;
  canvasId?: string;
  from: string;
  to: string;
  /** Optional free-text note describing the relationship between the two cards. */
  note?: string;
}

/** AI 助手「测试沙盒」：按人设 id 持久化多轮对话（仅本地 IndexedDB）。 */
export interface AgentSandboxThread {
  agentId: string;
  messages: { role: 'user' | 'model'; text: string }[];
  updatedAt: number;
}

/** V2: per-agent side-panel chat on a canvas. */
export interface CanvasChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  thinkingTrace?: string;
  createdAt: number;
  excerptedNodeId?: string;
  /** Inline illustrations from the draw tool (not canvas cards until dragged out). */
  images?: CanvasChatGeneratedImage[];
  /** Live web-search hits for this turn (shown in the side panel, not as canvas cards). */
  searchHits?: AskSearchHit[];
  /** Clickable related questions shown under this assistant reply. */
  suggestedFollowUps?: string[];
  /** 海龟汤隐藏裁判包。只存在会话里，侧栏和摘录都不展示。 */
  turtleSoupRound?: TurtleSoupRound;
  /**
   * 多角色房间：这条回复由哪张角色卡说出，以及发言时的名字快照
   * （角色卡被删或改名后，历史仍能显示是谁说的）。
   * 房间里只有主 Agent 时不写。
   */
  speakerNodeId?: string;
  speakerName?: string;
}

export type CanvasChatGeneratedImage = {
  id: string;
  title: string;
  prompt: string;
  url?: string;
  status: 'generating' | 'ready' | 'error';
  error?: string;
  orientation?: 'landscape' | 'portrait' | 'square' | 'poster' | 'strip' | 'banner-mid' | 'banner';
};

/** One archived side-panel chat for a canvas persona thread. */
export interface CanvasChatSession {
  id: string;
  createdAt: number;
  endedAt: number;
  preview: string;
  messages: CanvasChatMessage[];
}

export interface CanvasPersonaThread {
  id: string;
  canvasId: string;
  agentNodeId: string;
  messages: CanvasChatMessage[];
  /** Archived side-panel chats for this persona (newest first). */
  sessionArchive?: CanvasChatSession[];
  /** Unsent composer text. Restored when the side panel reopens. */
  composerDraft?: string;
  /** Mixed card/text composer segments for the side panel. */
  composerSegments?: ComposerSegment[];
  /**
   * 多角色房间：被拉进这个对话框一起讨论的其他角色卡节点 id
   * （有序，不含主 Agent）。空/缺省 = 单人对话，行为与旧版一致。
   */
  participantNodeIds?: string[];
  /** 多角色房间：本轮不发言（禁言）的参与者节点 id。 */
  mutedNodeIds?: string[];
  /** 多角色房间：一次"开始讨论"跑几轮（一轮 = 每个未禁言的声音各说一次）。 */
  roomDiscussionRounds?: number;
  updatedAt: number;
}

/** 知识存档里的自定义文件夹。 */
export interface ArchiveFolder {
  id: string;
  name: string;
  createdAt: number;
  sortOrder: number;
}

/** 画布卡片归档：整卡快照入库复用；原卡仍留在画布上。 */
export interface ArchivedCard {
  id: string;
  archivedAt: number;
  sourceCanvasId?: string;
  sourceCanvasName?: string;
  /** Snapshot of the canvas node at archive time (original node.id kept for provenance). */
  node: CanvasNode;
  /** Essay cards: article body snapshot so content survives off-canvas. */
  article?: Article;
  /** Custom archive folder; omitted = unfiled. */
  folderId?: string;
}

/** Card kinds a CanvasTemplateDoc can spawn. */
export type TemplateNodeType = 'theme' | 'note' | 'agent' | 'ask';

/**
 * User/built-in canvas templates: a saved bundle of personas + starter
 * cards + connections. Position fractions are of a 1200×800 design canvas,
 * applied at instantiate time by the helper in `src/utils/canvasTemplate.ts`.
 */
export interface CanvasTemplateDoc {
  id: string;
  /** Display name (already localized for system templates). */
  name: string;
  description?: string;
  /** `system` = baked-in constant; `user` = created/cloned in the Agents Studio UI. */
  origin: 'system' | 'user';
  /** Built-in key for system templates (e.g. `'cosmos'`); `null` for user templates. */
  builtinKey: string | null;
  /** When false, keep the template for legacy spawn but do not list it as a default. */
  listed?: boolean;
  /** Personas bundled into canvases made from this template, by AgentConfig.id. */
  personaIds: string[];
  nodes: TemplateNode[];
  edges: TemplateEdge[];
  createdAt: number;
  updatedAt: number;
}

export interface TemplateNode {
  /** Template-local key; used by `TemplateEdge.fromKey/toKey`. Minted to a UUID at instantiate. */
  key: string;
  type: TemplateNodeType;
  /** i18n key whose lookup becomes the spawned node's `content`. */
  contentKey?: string;
  /** Literal fallback if `contentKey` is missing or unresolvable. */
  contentText?: string;
  /** Optional body for `theme` cards (`CanvasNode.description`). */
  descriptionText?: string;
  /** Required when `type === 'agent'`; references an existing AgentConfig.id. */
  agentConfigId?: string;
  /** Position in 1200×800 design coords (0..1). */
  xFrac: number;
  yFrac: number;
  /** Width/height fractions. Optional; renderer falls back to per-type defaults. */
  wFrac?: number;
  hFrac?: number;
}

export interface TemplateEdge {
  fromKey: string;
  toKey: string;
  /** i18n key whose lookup becomes the edge note. */
  noteKey?: string;
  noteText?: string;
}

/** Local-only cache used to keep authenticated/anonymous workspaces isolated. */
export interface WorkspacePartitionRecord {
  ownerId: string;
  snapshot: unknown;
  updatedAt: number;
}

export interface WorkspaceStateRecord {
  key: 'activeOwner';
  value: string;
}

export class MyDatabase extends Dexie {
  nodes!: Table<CanvasNode>;
  articles!: Table<Article>;
  agents!: Table<AgentConfig>;
  edges!: Table<Edge>;
  canvases!: Table<Canvas>;
  canvasFolders!: Table<CanvasFolder>;
  agentSandboxThreads!: Table<AgentSandboxThread>;
  canvasPersonaThreads!: Table<CanvasPersonaThread, string>;
  canvasWorkZones!: Table<CanvasWorkZone, string>;
  archivedCards!: Table<ArchivedCard>;
  archiveFolders!: Table<ArchiveFolder>;
  canvasTemplates!: Table<CanvasTemplateDoc, string>;
  workspacePartitions!: Table<WorkspacePartitionRecord, string>;
  workspaceState!: Table<WorkspaceStateRecord, string>;
  voicePreviewClips!: Table<VoicePreviewClip, string>;

  constructor() {
    super('CortexLocalDB');
    this.version(1).stores({
      nodes: '++id, type, agentConfigId',
      articles: '++id, type, date',
      agents: '++id, role',
      edges: '++id, from, to'
    });

    this.version(2).stores({
      nodes: '++id, type, agentConfigId, canvasId',
      edges: '++id, from, to, canvasId',
      canvases: '++id, name, createdAt'
    });

    this.version(3).stores({
      researchSessions: 'id, createdAt',
    });

    this.version(4).stores({
      agentSandboxThreads: 'agentId',
    });

    this.version(5).stores({
      // sourceCards 为嵌套数组，无需索引；升级仅容纳 Article 新字段
      articles: '++id, type, date',
    });

    // Drop legacy Research Lab sessions (feature removed).
    this.version(6).stores({
      researchSessions: null,
    });

    this.version(7).stores({
      archivedCards: 'id, archivedAt',
    });

    this.version(8).stores({
      archiveFolders: 'id, createdAt, sortOrder',
      archivedCards: 'id, archivedAt, folderId',
    });

    this.version(9).stores({
      canvasTemplates: 'id, builtinKey, createdAt, updatedAt',
    });

    this.version(10).stores({
      canvases: '++id, name, createdAt, folderId',
      canvasFolders: 'id, createdAt, sortOrder',
    });

    this.version(11).stores({
      workspacePartitions: 'ownerId, updatedAt',
      workspaceState: 'key',
    });

    this.version(12).stores({
      canvasPersonaThreads: 'id, canvasId, agentNodeId, updatedAt',
    });

    this.version(13).stores({
      canvasWorkZones: 'id, canvasId, personaNodeId',
    });

    // 音色试听的小音频缓存（几十 KB 一条，最多留 60 条，见 voicePreviewCache）。
    this.version(14).stores({
      voicePreviewClips: 'id, updatedAt',
    });

    // v15 在带云同步的构建里是 articleSyncBase（"上次和云端谈拢的那一版"）。
    // 开源版没有云端，留一个空版本占号：Dexie 只要求版本号递增，
    // 跳号会让已经升到 v14 的旧库对不上这里的 schema 版本。
    this.version(15).stores({});
  }
}

export const db = new MyDatabase();
