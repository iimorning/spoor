import Dexie, { type Table } from 'dexie';
import type { AskSearchHit } from './utils/askSearchHits';
import type { ComposerSegment } from './utils/chatComposer';
import type { TurtleSoupRound } from './utils/turtleSoupRound';

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
   * V2：归属哪个角色卡的工作区（默认上下文范围）。
   * 仅用户明确拖入工作区时写入；拖出可清空。非永久记忆。
   */
  contextScopeAgentId?: string;
  /** V2 摘录卡：来源侧栏对话 thread id */
  sourceThreadId?: string;
  /** V2 摘录卡：来源消息 id */
  sourceMessageId?: string;
}

/** V2：用户在画布上绘制的工作区矩形，绑定到角色卡（agent / Ask）。 */
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
  /** 海龟汤隐藏裁判包。只存在会话里，侧栏和摘录都不展示。 */
  turtleSoupRound?: TurtleSoupRound;
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
  }
}

export const db = new MyDatabase();
