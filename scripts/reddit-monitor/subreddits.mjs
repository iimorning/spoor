/**
 * Spoor 增长目标的 Reddit 子版块数据库。
 *
 * 与情感疗愈/英语学习的数据库区分：本表聚焦于
 *   1) 笔记 / PKM（Obsidian / Notion / Roam / Logseq 难民 + 自我提升）
 *   2) 海龟汤 / 横向思维谜题（lateral thinking puzzles / AI 主持人）
 *   3) 自我反思 / 哲学思辨（journaling · Stoicism · 叙事反思）
 *   4) 本地优先 / 开源 / 本地 LLM（self-hosted · PolyForm 受众）
 *
 * 每个条目对应一个搜索关键词组合 + 版规提示。版规提示来自版块 /about/rules，
 * 用于在 Reddit 上发帖前先做合规自检（详见 docs/REDDIT_MONITORING.md）。
 *
 * searchQuery 字段使用 Reddit 搜索语法：多个 OR 关键词会被拼到 `q=` 参数里。
 * Reddit 旧 JSON API (`/search.json`) 不支持任意长度的布尔查询，单个 q= 字符串
 * 通常 ≤512 字符就够了；太长的关键词组合请拆成多条 fetch 调用。
 */

export const CATEGORIES = [
  'notes_pkm',                 // 笔记 / 个人知识管理
  'sea_turtle_soup',           // 海龟汤 / 横向思维谜题
  'narrative_reflection',      // 自我反思 / journaling / Stoicism
  'philosophy',                // 哲学
  'selfhosted_ai',             // 本地优先 / 开源 / 本地 LLM
  'show_and_tell'              // 独立项目 / SideProject / Indie
];

const rawData = [
  // ============================================================
  // 1. 笔记 / PKM
  // ============================================================
  {
    subreddit: 'r/productivity',
    category: 'notes_pkm',
    promotion: '严格 9:1 — 90% 评论/帮助，10% 自己内容',
    description: '23M+ 用户。工具帖会迅速被识别为营销。',
    intro: 'Reddit productivity hub — broad but very spam-sensitive.',
    searchQuery: '"looking for" OR "alternative to" OR (note AND canvas) OR (Obsidian AND AI)',
    rules: `Reddit-wide + product mention rule. Self-promotion must be context-rich.`,
    url: 'https://www.reddit.com/r/productivity'
  },
  {
    subreddit: 'r/ObsidianMD',
    category: 'notes_pkm',
    promotion: 'Tool 帖允许但必须含工作流细节',
    description: 'Obsidian 重度用户群，AI 是高频话题。',
    intro: 'Obsidian power users — many are AI-curious but plugin-fatigued.',
    searchQuery: 'AI OR Copilot OR "Smart Connections" OR canvas OR alternative OR local',
    rules: `No outright promotion without context. Workflow / migration stories welcome.`,
    url: 'https://www.reddit.com/r/ObsidianMD'
  },
  {
    subreddit: 'r/NoteTaking',
    category: 'notes_pkm',
    promotion: '有条件允许（强调使用场景）',
    description: '笔记工具的核心圈。',
    intro: 'General note-taking community.',
    searchQuery: 'canvas OR spatial OR AI OR "open source" OR local',
    rules: `Sub must stay tool-agnostic. Frame as workflow, not product plug.`,
    url: 'https://www.reddit.com/r/NoteTaking'
  },
  {
    subreddit: 'r/PKMS',
    category: 'notes_pkm',
    promotion: '有条件允许（方法论帖欢迎）',
    description: '小而精准，对 Zettelkasten、白板、空间笔记敏感。',
    intro: 'Personal Knowledge Management — smaller, more method-oriented.',
    searchQuery: 'canvas OR spatial OR zettelkasten OR AI OR persona',
    rules: `Method posts welcome. Direct tool plugs need use-case framing.`,
    url: 'https://www.reddit.com/r/PKMS'
  },
  {
    subreddit: 'r/logseq',
    category: 'notes_pkm',
    promotion: '有条件允许',
    description: 'Logseq 用户对 outliner/block 范式敏感。',
    intro: 'Logseq community — block-based, open-source friendly.',
    searchQuery: 'AI OR alternative OR canvas OR migration',
    rules: `Migration stories and tool comparisons are tolerated; avoid press-release tone.`,
    url: 'https://www.reddit.com/r/logseq'
  },
  {
    subreddit: 'r/Notion',
    category: 'notes_pkm',
    promotion: '工具对比帖受欢迎',
    description: 'Notion AI 重度用户的迁移痛点。',
    intro: 'Notion users — many are frustrated with Notion AI cost/quality.',
    searchQuery: '"Notion AI" OR alternative OR local OR canvas OR "looking for"',
    rules: `Honest comparison is OK; no outright plugs without value.`,
    url: 'https://www.reddit.com/r/Notion'
  },
  {
    subreddit: 'r/NotebookLM',
    category: 'notes_pkm',
    promotion: '中性 — Google 工具讨论',
    description: 'Google NotebookLM 用户，对多模态/AI 笔记敏感。',
    intro: 'NotebookLM fans — they value AI as thinking partner.',
    searchQuery: 'canvas OR spatial OR persona OR multi-perspective OR local',
    rules: `Cross-tool discussion is fair game; just label product as yours.`,
    url: 'https://www.reddit.com/r/NotebookLM'
  },
  {
    subreddit: 'r/Zettelkasten',
    category: 'notes_pkm',
    promotion: '方法论帖允许',
    description: '卡片盒笔记方法论圈，对 AI 处理链接敏感。',
    intro: 'Zettelkasten method community — they care about AI handling links.',
    searchQuery: 'AI OR canvas OR spatial OR persona OR "linking"',
    rules: `Methodology-first, not product-first.`,
    url: 'https://www.reddit.com/r/Zettelkasten'
  },

  // ============================================================
  // 2. 海龟汤 / 横向思维谜题
  // ============================================================
  {
    subreddit: 'r/lateralthinking',
    category: 'sea_turtle_soup',
    promotion: '小版块 — AI 主持人帖可首发',
    description: '横向思维谜题英文主场之一。',
    intro: 'Lateral thinking puzzles — perfect for "AI host that never spoils".',
    searchQuery: 'host OR game OR AI OR puzzle OR "yes/no"',
    rules: `Small, friendly. Spoiler-tag everything.`,
    url: 'https://www.reddit.com/r/lateralthinking'
  },
  {
    subreddit: 'r/BlackStories',
    category: 'sea_turtle_soup',
    promotion: '桌游圈 — 体验帖受欢迎',
    description: 'Black Stories 桌游玩家。',
    intro: 'Black Stories board game fans.',
    searchQuery: 'AI OR host OR digital OR play',
    rules: `Compare/contrast with analog game is welcome.`,
    url: 'https://www.reddit.com/r/BlackStories'
  },
  {
    subreddit: 'r/puzzles',
    category: 'sea_turtle_soup',
    promotion: '中性',
    description: 'puzzles 大版块，对"新型玩法"开放。',
    intro: 'General puzzles community.',
    searchQuery: '"lateral thinking" OR "situation puzzle" OR AI OR host',
    rules: `No outright promotion. Demo GIF earns attention.`,
    url: 'https://www.reddit.com/r/puzzles'
  },
  {
    subreddit: 'r/BrainTeasers',
    category: 'sea_turtle_soup',
    promotion: '演示帖受欢迎',
    description: '互动式谜题。',
    intro: 'Brain teasers — interactive formats get upvoted.',
    searchQuery: '"lateral thinking" OR host OR AI OR game',
    rules: `Lead with the puzzle, not the tool.`,
    url: 'https://www.reddit.com/r/BrainTeasers'
  },
  {
    subreddit: 'r/AIDungeon',
    category: 'sea_turtle_soup',
    promotion: 'AI 互动叙事圈友好',
    description: 'AI Dungeon 用户对"严格约束下的 AI 叙事"天然感兴趣。',
    intro: 'AI Dungeon players — love constrained AI storytelling.',
    searchQuery: 'host OR game OR "turn-based" OR "yes/no" OR puzzle',
    rules: `AI tool comparisons are accepted; no spam.`,
    url: 'https://www.reddit.com/r/AIDungeon'
  },
  {
    subreddit: 'r/CharacterAI',
    category: 'sea_turtle_soup',
    promotion: '角色扮演圈',
    description: 'Character AI 用户 — 对"AI 主持"敏感。',
    intro: 'Character AI roleplay fans.',
    searchQuery: 'host OR game OR puzzle OR "yes/no" OR persona',
    rules: `Frame as storytelling/roleplay, not product plug.`,
    url: 'https://www.reddit.com/r/CharacterAI'
  },
  {
    subreddit: 'r/DMAcademy',
    category: 'sea_turtle_soup',
    promotion: 'DM 工具帖欢迎',
    description: 'D&D DM 群体 — 海龟汤是经典团前破冰。',
    intro: 'D&D Dungeon Masters — perfect lateral-thinking audience.',
    searchQuery: '"lateral thinking" OR puzzle OR "ice breaker" OR AI',
    rules: `Tool posts allowed if they help DMing.`,
    url: 'https://www.reddit.com/r/DMAcademy'
  },
  {
    subreddit: 'r/Solo_Roleplaying',
    category: 'sea_turtle_soup',
    promotion: '单人 RPG 工具帖允许',
    description: '单人 RPG — 对"AI 主持人"需求强。',
    intro: 'Solo roleplaying community — strong need for AI GMs.',
    searchQuery: 'AI OR GM OR host OR puzzle OR oracle',
    rules: `Honest tooling discussion is welcome.`,
    url: 'https://www.reddit.com/r/Solo_Roleplaying'
  },

  // ============================================================
  // 3. 自我反思 / journaling / Stoicism
  // ============================================================
  {
    subreddit: 'r/journaling',
    category: 'narrative_reflection',
    promotion: '工具帖有条件允许（强调用法）',
    description: 'journaling 主力圈 — 反思工具用户。',
    intro: 'Journaling community — receptive to AI prompting prompts.',
    searchQuery: 'prompt OR AI OR "structured" OR reflection OR canvas',
    rules: `Tool reviews welcome if tied to journaling practice.`,
    url: 'https://www.reddit.com/r/journaling'
  },
  {
    subreddit: 'r/InnerWork',
    category: 'narrative_reflection',
    promotion: '小版块，氛围友好',
    description: '内省类社区 — narrative re-authoring 天然契合。',
    intro: 'Inner work community — narrative re-authoring fits.',
    searchQuery: 'reflection OR reframe OR story OR AI OR canvas',
    rules: `No clinical claims. Stay in self-help / reflection frame.`,
    url: 'https://www.reddit.com/r/InnerWork'
  },
  {
    subreddit: 'r/Stoicism',
    category: 'narrative_reflection',
    promotion: '哲学工具帖可接受',
    description: '斯多葛 journaling 传统很成熟 — 加一个 AI 提问者天然契合。',
    intro: 'Stoicism community — journaling tradition is mature.',
    searchQuery: 'journal OR reflection OR AI OR socratic OR persona',
    rules: `Keep claims modest — never "this will make you virtuous".`,
    url: 'https://www.reddit.com/r/Stoicism'
  },
  {
    subreddit: 'r/Mindfulness',
    category: 'narrative_reflection',
    promotion: '中 — 强调非治疗定位',
    description: '正念反思 — 与提问式 AI 助手契合。',
    intro: 'Mindfulness community.',
    searchQuery: 'reflection OR prompt OR AI OR "guided" OR journal',
    rules: `Avoid clinical or therapeutic claims. Stay self-help framed.`,
    url: 'https://www.reddit.com/r/Mindfulness'
  },
  {
    subreddit: 'r/MindfulnessMeditation',
    category: 'narrative_reflection',
    promotion: '中',
    description: '冥想反思圈。',
    intro: 'Meditation community.',
    searchQuery: 'reflection OR AI OR journal OR question',
    rules: `Same — never claim therapeutic benefit.`,
    url: 'https://www.reddit.com/r/MindfulnessMeditation'
  },
  {
    subreddit: 'r/DecidingToBeBetter',
    category: 'narrative_reflection',
    promotion: '工具帖敏感 — 慎发',
    description: '自我改变工具 — 版规有时严。',
    intro: 'Self-improvement — strict on tools.',
    searchQuery: 'reflection OR story OR AI OR canvas',
    rules: `Frame as discussion, not product plug.`,
    url: 'https://www.reddit.com/r/DecidingToBeBetter'
  },
  {
    subreddit: 'r/digitalminimalism',
    category: 'narrative_reflection',
    promotion: '工具帖有空间',
    description: '数字极简 — 反思工具的天然土壤。',
    intro: 'Digital minimalism — receptive to non-addictive tools.',
    searchQuery: 'reflection OR local OR offline OR "no notifications" OR canvas',
    rules: `Tools that reduce screen time are welcome.`,
    url: 'https://www.reddit.com/r/digitalminimalism'
  },
  {
    subreddit: 'r/simpleliving',
    category: 'narrative_reflection',
    promotion: '工具帖偶尔可',
    description: '极简生活圈。',
    intro: 'Simple living.',
    searchQuery: 'reflection OR journal OR AI OR local',
    rules: `Keep tone humble.`,
    url: 'https://www.reddit.com/r/simpleliving'
  },

  // ============================================================
  // 4. 哲学
  // ============================================================
  {
    subreddit: 'r/philosophy',
    category: 'philosophy',
    promotion: '中性 — 长文 / 链接帖',
    description: '哲学大版块，深度讨论。',
    intro: 'Academic-leaning philosophy hub.',
    searchQuery: 'AI OR socratic OR persona OR "thinking partner" OR canvas',
    rules: `Direct tool plugs get removed; participate first, post later.`,
    url: 'https://www.reddit.com/r/philosophy'
  },
  {
    subreddit: 'r/askphilosophy',
    category: 'philosophy',
    promotion: 'Q&A — 工具分享可参与',
    description: '严格 Q&A 学术版块。',
    intro: 'Strict Q&A — answers expected to cite sources.',
    searchQuery: 'AI OR persona OR "thinking partner" OR socratic',
    rules: `Answers must be sourced. Tool mentions should be context-rich.`,
    url: 'https://www.reddit.com/r/askphilosophy'
  },
  {
    subreddit: 'r/Existentialism',
    category: 'philosophy',
    promotion: '工具帖可作为讨论入口',
    description: '存在主义 — 自由、意义、责任。',
    intro: 'Existentialism — meaning-making and reflection.',
    searchQuery: 'reflection OR AI OR canvas OR story OR "multi-perspective"',
    rules: `Modest claims only.`,
    url: 'https://www.reddit.com/r/Existentialism'
  },
  {
    subreddit: 'r/AcademicPhilosophy',
    category: 'philosophy',
    promotion: '工具帖敏感 — 慎发',
    description: '研究生/学者圈，对工具的批判性强。',
    intro: 'Academic philosophy — high bar for evidence.',
    searchQuery: 'AI OR persona OR "thinking partner" OR critique',
    rules: `Be ready for deep technical critique.`,
    url: 'https://www.reddit.com/r/AcademicPhilosophy'
  },
  {
    subreddit: 'r/consciousness',
    category: 'philosophy',
    promotion: '工具帖可作为讨论',
    description: '心灵哲学。',
    intro: 'Philosophy of mind / consciousness.',
    searchQuery: 'AI OR persona OR "thinking partner" OR multi-perspective',
    rules: `Stay philosophical, not promotional.`,
    url: 'https://www.reddit.com/r/consciousness'
  },
  {
    subreddit: 'r/SocraticMethod',
    category: 'philosophy',
    promotion: '小 — 精准受众',
    description: '苏格拉底方法论圈。',
    intro: 'Socratic method — fits Spoor "AI asks, not answers".',
    searchQuery: 'AI OR persona OR dialogue OR prompt',
    rules: `Small but receptive.`,
    url: 'https://www.reddit.com/r/SocraticMethod'
  },

  // ============================================================
  // 5. 本地优先 / 开源 / 本地 LLM
  // ============================================================
  {
    subreddit: 'r/selfhosted',
    category: 'selfhosted_ai',
    promotion: '工具帖欢迎（强调自托管）',
    description: '强烈偏好本地优先、开源、自托管。',
    intro: 'Self-hosters — privacy-first crowd.',
    searchQuery: 'local OR "self-host" OR canvas OR "BYO key" OR privacy',
    rules: `Open source + Docker-friendly posts do well.`,
    url: 'https://www.reddit.com/r/selfhosted'
  },
  {
    subreddit: 'r/LocalLLaMA',
    category: 'selfhosted_ai',
    promotion: '硬件/推理帖受欢迎',
    description: '本地 LLM 圈 — 极度在意延迟、隐私、context window。',
    intro: 'Local LLM users — hardware and inference matters.',
    searchQuery: 'canvas OR "thinking partner" OR "BYO key" OR GGUF OR prompt OR persona',
    rules: `Be ready for hardware benchmarks and VRAM questions.`,
    url: 'https://www.reddit.com/r/LocalLLaMA'
  },
  {
    subreddit: 'r/coolgithubprojects',
    category: 'selfhosted_ai',
    promotion: '项目展示帖允许',
    description: 'PolyForm 协议 + 开源 — 必去的展示场。',
    intro: 'Cool GitHub projects showcase.',
    searchQuery: 'canvas OR AI OR note OR privacy OR local',
    rules: `Tag with language, license, and stars.`,
    url: 'https://www.reddit.com/r/coolgithubprojects'
  },
  {
    subreddit: 'r/opensource',
    category: 'selfhosted_ai',
    promotion: '项目里程碑公告',
    description: '开源项目里程碑公告。',
    intro: 'Open source community.',
    searchQuery: 'canvas OR AI OR note OR "PolyForm" OR "local-first"',
    rules: `Major version / launch posts welcome.`,
    url: 'https://www.reddit.com/r/opensource'
  },
  {
    subreddit: 'r/programming',
    category: 'selfhosted_ai',
    promotion: '技术深度文',
    description: '技术深度文（IndexedDB / Dexie / Tauri 实践）。',
    intro: 'Programming community.',
    searchQuery: 'IndexedDB OR Tauri OR Dexie OR canvas OR local-first',
    rules: `Code snippets + writeups earn traction.`,
    url: 'https://www.reddit.com/r/programming'
  },

  // ============================================================
  // 6. 独立项目 / SideProject / Indie
  // ============================================================
  {
    subreddit: 'r/SideProject',
    category: 'show_and_tell',
    promotion: 'Show & Tell 氛围浓厚',
    description: '周更 Show & Tell 氛围。',
    intro: 'Weekly show-and-tell vibe.',
    searchQuery: 'canvas OR AI OR note OR local OR "BYO key"',
    rules: `Be honest about stack, traction, and what you learned.`,
    url: 'https://www.reddit.com/r/SideProject'
  },
  {
    subreddit: 'r/IndieHackers',
    category: 'show_and_tell',
    promotion: '商业模式讨论',
    description: 'indie makers — 商业模式讨论。',
    intro: 'Indie hackers — revenue and licensing questions welcome.',
    searchQuery: '"PolyForm" OR "open source" OR "BYO key" OR monetization',
    rules: `Be ready for licensing and revenue model questions.`,
    url: 'https://www.reddit.com/r/IndieHackers'
  },
  {
    subreddit: 'r/buildinpublic',
    category: 'show_and_tell',
    promotion: '持续更新进展',
    description: '持续更新进展，沉淀粉丝。',
    intro: 'Build-in-public community.',
    searchQuery: 'canvas OR AI OR note OR local OR "PolyForm"',
    rules: `Show progress, not just launches.`,
    url: 'https://www.reddit.com/r/buildinpublic'
  },
  {
    subreddit: 'r/InternetIsBeautiful',
    category: 'show_and_tell',
    promotion: '单图/视频引流',
    description: '酷炫工具单图引流。',
    intro: 'Internet is beautiful — single-image hooks work.',
    searchQuery: 'canvas OR spatial OR AI OR "thinking partner"',
    rules: `Single image + one-line description, not a press release.`,
    url: 'https://www.reddit.com/r/InternetIsBeautiful'
  }
];

export default rawData;

/** 按分类筛选；`category === '全部'` 或省略时返回全部 */
export function getByCategory(category) {
  if (!category || category === '全部' || category === 'all') return rawData;
  return rawData.filter((s) => s.category === category);
}

/** 按 subreddit 名字查单个条目（带前缀 `r/`） */
export function findBySubreddit(name) {
  const needle = String(name || '').toLowerCase();
  const target = needle.startsWith('r/') ? needle : `r/${needle}`;
  return rawData.find((s) => s.subreddit.toLowerCase() === target) || null;
}
