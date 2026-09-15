/** Promo copy bundles — keep EN/ZH in sync with spoor-promo.json segments.
 * The `zh-v2` bundle drives SpoorPromoV2ZH, which highlights features shipped
 * after the v1 promo: voice canvas + Ask card, vision/image-aware agents,
 * canvas web search, multi-agent Discussion, Cosmos Weaver & Character Atelier,
 * and the unified TipTap essay editor with Word/PDF export.
 */

export const PROMO_COPY = {
  en: {
    brandTitle: 'Spoor',
    brandSubtitle: 'Notes that leave a trace',
    windowTitle: 'Spoor · Memory Architecture',
    focusMode: 'FOCUS MODE',
    modules: 'MODULES',
    tabs: { canvas: 'Canvas', reference: 'Reference', lab: 'Research', agents: 'Personas' },
    privacyBadge: 'Local-first · IndexedDB',
    ctaText: 'Try the web app',
    scenes: [
      {
        id: 'opening',
        start: 0,
        end: 4,
        layout: 'hero',
        eyebrow: 'Spoor',
        title: 'Think in space.',
        caption: 'A quiet canvas for memory,\nsynthesis, and AI-assisted thought.',
      },
      {
        id: 'graph',
        start: 4,
        end: 10,
        layout: 'split',
        eyebrow: 'Connect',
        title: 'Notes connect\nby hand.',
        caption: 'Draw the line —\nthe thought becomes visible.',
      },
      {
        id: 'forms',
        start: 10,
        end: 16,
        layout: 'split',
        eyebrow: 'Forms',
        title: 'Every note finds\nits form.',
        caption: 'Five layouts for different ways\nof thinking out loud.',
      },
      {
        id: 'synth',
        start: 16,
        end: 28,
        layout: 'split',
        eyebrow: 'Synthesize',
        title: 'Selected notes\nbecome a draft.',
        caption: 'A long-form article remains linked\nto its source canvas.',
      },
      {
        id: 'privacy',
        start: 28,
        end: 32,
        layout: 'split',
        eyebrow: 'Local-first',
        title: 'Yours, and\nonly yours.',
        caption: 'Your canvas, your notes, your drafts —\nkept in your browser.',
      },
      {
        id: 'research',
        start: 32,
        end: 40,
        layout: 'split',
        eyebrow: 'Research',
        title: 'Deep research,\nstep by step.',
        caption: 'Pose a question, refine the plan,\ngather sources, and receive a synthesized report.',
      },
      {
        id: 'agentChat',
        start: 40,
        end: 52,
        layout: 'split',
        eyebrow: 'Personas',
        title: 'Four minds,\none canvas.',
        caption: 'Each persona reads your notes —\nand the images linked to them.',
      },
      {
        id: 'closing',
        start: 52,
        end: 58,
        layout: 'hero',
        eyebrow: 'Spoor',
        title: 'A place for thoughts\nto leave a trace.',
        caption: 'scribe-ai-canvas.netlify.app',
      },
    ],
    agents: [
      {
        id: 'interviewer',
        name: 'The Mirror',
        role: 'Interview',
        reply: 'What assumption are you not naming yet?',
      },
      {
        id: 'synthesizer',
        name: 'The Weaver',
        role: 'Synthesize',
        reply: 'These notes share one thread — anchor, orbit, evidence.',
      },
      {
        id: 'stylist',
        name: 'Smoothing Iron',
        role: 'Stylize',
        reply: 'Try: “The room remembers. The thread forgets.”',
      },
      {
        id: 'futurist',
        name: 'Star-Gazer',
        role: 'Project forward',
        reply: 'In ten years, this canvas becomes an index.',
      },
    ],
    graph: {
      themeTitle: 'Theme',
      themeBody: 'Memory as a navigable space.',
      imageTitle: 'Image',
      imageBody: 'Linked artifact',
      obsTitle: 'Observation',
      obsBody: 'The room remembers. The thread forgets.',
    },
    forms: {
      labels: ['Standard', 'Glass', 'Minimal', 'Neo-brut', 'Receipt'],
      items: [
        { kind: 'base', body: 'Memory is not storage. It is navigation through overlapping spaces.', title: 'Note' },
        { kind: 'glass', body: 'The room remembers what the thread forgets.', title: 'Thought' },
        { kind: 'minimal', body: 'each placement / a small / memory cue', title: 'Observation' },
        { kind: 'neo', body: 'MEMORY HAS A SHAPE.', title: 'Manifesto' },
        {
          kind: 'receipt',
          body: 'Every struggle is a harvest of transformation.',
          title: 'Observation',
        },
      ],
      receipt: {
        header: 'Ink & Thought',
        store: 'Store #042',
        date: 'DATE: May 21, 2026',
        time: 'TIME: 10:24 AM',
        txn: 'TXN: A7F2-9C01',
        colItem: 'Item',
        colAmt: 'Amt',
        rowLabel: 'Observation',
        total: 'TOTAL',
        paid: 'PAID',
        thanks: 'Thank you for visiting',
        policy: 'Return policy: 30 days of clarity',
        barcode: '042 A7F2-9C01 881204',
      },
    },
    synth: {
      themeTitle: 'Theme',
      themeBody: 'Memory as space',
      obsTitle: 'Observation',
      obsBody: 'The room remembers. The thread forgets.',
      imageTitle: 'Linked image',
      imageBody: 'Artifact on canvas',
      refLabel: 'REFERENCE / GEN-742',
      articleTitle: 'The Architecture of Spatial Memory',
      articleBody:
        'A field synthesized from a small canvas: anchor themes, orbiting observations, and the artifacts that hold them in place.',
      linkChip: '↗ Linked to source canvas',
    },
    agentChat: {
      obsTitle: 'Observation',
      obsBody: 'How does spatial layout change recall?',
      youLabel: 'You · on canvas',
      userQuestion: 'How do these notes connect?',
      personasPanel: 'PERSONAS',
      customPersona: '+ Custom persona',
      defineOwn: 'DEFINE YOUR OWN',
      sampleName: 'Field Ethnographer',
      sampleRole: 'Role · Qualitative lens',
      samplePrompt: 'Ask one sharp question at a time. Surface what the notes imply but never say aloud.',
      temperature: 'Temperature',
      creativity: 'Creativity',
    },
    research: {
      query: 'How does spatial layout change recall?',
      investigate: 'Investigate',
      sourcesTitle: 'SOURCES UTILIZED',
      processed: '✓ PROCESSED',
      searching: '◌ Searching web…',
      targetInquiry: 'TARGET INQUIRY',
      planTitle: 'Recommended research plan',
      approve: 'Approve plan →',
      executing: '▸ EXECUTING RESEARCH',
      sourcesFound: '3 web sources found',
      resolving: 'Resolving sources and building context…',
      generating: 'Generating research report…',
      reportLabel: 'RESEARCH REPORT',
      reportFooter: 'Based on 3 web sources + LLM synthesis',
      reportTitle: 'Spatial layout as external memory',
      conclusionLabel: 'Conclusion · ',
      plan: [
        {
          title: 'What counts as spatial layout in personal notes?',
          desc: 'Clarify position, grouping, and links before measuring recall.',
        },
        {
          title: 'Which recall cues come from placement vs. wording alone?',
          desc: 'Separate spatial memory from semantic memory in the same canvas.',
        },
        {
          title: 'How does synthesis turn scattered notes into a report?',
          desc: 'Connect sub-questions into one sourced, readable conclusion.',
        },
      ],
      sources: [
        { title: 'Spatial memory and workspace design', snippet: 'Layout as an external memory field…' },
        { title: 'Note clustering and retrospective recall', snippet: 'Proximity predicts rediscovery rates…' },
        { title: 'Metaphor maps in personal knowledge tools', snippet: 'Anchors, orbits, and navigable themes…' },
      ],
      report: {
        intro:
          'Spatial note-taking treats the canvas as an external memory field: where a card sits, what it links to, and how clusters form matter as much as the words inside.',
        points: [
          {
            title: 'Placement carries recall cues',
            text: 'Users rediscover ideas by retracing spatial paths—anchors at the center, observations in orbit, evidence along the edges.',
          },
          {
            title: 'Links make thought navigable',
            text: 'Hand-drawn connections turn a pile of notes into a map you can walk, not only search.',
          },
          {
            title: 'Synthesis closes the loop',
            text: 'A structured report can cite web sources while staying tied to the questions the plan decomposed.',
          },
        ],
        conclusion:
          'Treat layout as a first-class design choice: the same text in different positions produces different recall—and different drafts.',
      },
      evidenceLine: 'Evidence from {{count}} web sources supports treating layout as a first-class cue.',
    },
  },
  zh: {
    brandTitle: '雪泥',
    brandSubtitle: '念头落处，自成迹',
    windowTitle: '雪泥 · Spoor',
    focusMode: '专注模式',
    modules: '模块',
    tabs: { canvas: '画布', reference: '资料库', lab: '研究', agents: '角色' },
    privacyBadge: '本地优先 · IndexedDB',
    ctaText: '试用网页版',
    scenes: [
      {
        id: 'opening',
        start: 0,
        end: 4,
        layout: 'hero',
        eyebrow: '雪泥',
        title: '在空间里\n思考。',
        caption: '一张安静的画布：记忆、综合，与 AI 协思。',
      },
      {
        id: 'graph',
        start: 4,
        end: 10,
        layout: 'split',
        eyebrow: '连接',
        title: '亲手把便签\n连成线。',
        caption: '念头落在画布上，形状便显现出来。',
      },
      {
        id: 'forms',
        start: 10,
        end: 16,
        layout: 'split',
        eyebrow: '形态',
        title: '每张便签，\n各有其形。',
        caption: '五种版式，对应不同的思考方式。',
      },
      {
        id: 'synth',
        start: 16,
        end: 28,
        layout: 'split',
        eyebrow: '综合',
        title: '选中的便签，\n写成草稿。',
        caption: '长文始终指回它落下的那片画布。',
      },
      {
        id: 'privacy',
        start: 28,
        end: 32,
        layout: 'split',
        eyebrow: '本地优先',
        title: '只属于你。',
        caption: '画布、便签与草稿——都留在你的浏览器里。',
      },
      {
        id: 'research',
        start: 32,
        end: 40,
        layout: 'split',
        eyebrow: '研究',
        title: '深度研究，\n步步为营。',
        caption: '提出问题、修订计划、汇集来源，收获综合报告。',
      },
      {
        id: 'agentChat',
        start: 40,
        end: 52,
        layout: 'split',
        eyebrow: '角色',
        title: '四种心智，\n同一张画布。',
        caption: '四个人格读你的便签，也读与之相连的图像。',
      },
      {
        id: 'closing',
        start: 52,
        end: 58,
        layout: 'hero',
        eyebrow: '雪泥',
        title: '给念头留\n一处落迹。',
        caption: 'scribe-ai-canvas.netlify.app',
      },
    ],
    agents: [
      {
        id: 'interviewer',
        name: '真知镜',
        role: '采访',
        reply: '你还没点名的那个假设，是什么？',
      },
      {
        id: 'synthesizer',
        name: '编织者',
        role: '综合',
        reply: '这些便签共一根线——锚点、轨道、证据。',
      },
      {
        id: 'stylist',
        name: '熨烫师',
        role: '润色',
        reply: '试一句：「房间记得，丝线忘了。」',
      },
      {
        id: 'futurist',
        name: '占星术',
        role: '前瞻',
        reply: '十年后，这张画布会变成一座索引。',
      },
    ],
    graph: {
      themeTitle: '主题',
      themeBody: '记忆是一片可行走的空间。',
      imageTitle: '图像',
      imageBody: '相连的素材',
      obsTitle: '观察',
      obsBody: '房间记得，丝线忘了。',
    },
    forms: {
      labels: ['标准', '玻璃', '极简', '新粗野', '票据'],
      items: [
        { kind: 'base', body: '记忆不是仓库，而是在重叠空间里穿行。', title: '笔记' },
        { kind: 'glass', body: '房间记得丝线所忘之事。', title: '思绪' },
        { kind: 'minimal', body: '每一次摆放 / 都是 / 记忆的线索', title: '观察' },
        { kind: 'neo', body: '记忆自有其形。', title: '宣言' },
        {
          kind: 'receipt',
          body: '场景：每一次挣扎，都是一次蜕变的收获',
          title: '观察',
        },
      ],
      receipt: {
        header: '墨与思绪',
        store: '门店 #042',
        date: '日期：2026年5月21日',
        time: '时间：10:24',
        txn: '单号：A7F2-9C01',
        colItem: '项目',
        colAmt: '金额',
        rowLabel: '观察',
        total: '合计',
        paid: '已付',
        thanks: '感谢惠顾',
        policy: '退换说明：三十日清醒期',
        barcode: '042 A7F2-9C01 881204',
      },
    },
    synth: {
      themeTitle: '主题',
      themeBody: '记忆即空间',
      obsTitle: '观察',
      obsBody: '房间记得，丝线忘了。',
      imageTitle: '关联图像',
      imageBody: '画布上的素材',
      refLabel: '资料库 / GEN-742',
      articleTitle: '空间记忆的结构',
      articleBody: '从小小画布综合而来：锚定主题、环绕的观察，以及托住它们的素材。',
      linkChip: '↗ 链回来源画布',
    },
    agentChat: {
      obsTitle: '观察',
      obsBody: '空间布局如何改变回忆？',
      youLabel: '你 · 在画布上',
      userQuestion: '这些便签之间有什么联系？',
      personasPanel: '角色',
      customPersona: '+ 自定义角色',
      defineOwn: '自定义',
      sampleName: '田野民族志学者',
      sampleRole: '角色 · 质性视角',
      samplePrompt: '一次只问一个锋利的问题。点出便签暗示却从未说出口的东西。',
      temperature: '温度',
      creativity: '创造力',
    },
    research: {
      query: '空间布局如何改变回忆？',
      investigate: '你想研究什么？',
      sourcesTitle: '已用来源',
      processed: '✓ 已处理',
      searching: '◌ 正在联网检索…',
      targetInquiry: '研究问题',
      planTitle: '推荐研究计划',
      approve: '批准并执行 →',
      executing: '▸ 执行研究',
      sourcesFound: '已找到 3 个网页来源',
      resolving: '正在解析来源并构建上下文…',
      generating: '正在生成研究报告…',
      reportLabel: '研究报告',
      reportFooter: '基于 3 个网页来源 + 模型综合',
      reportTitle: '空间布局作为外部记忆',
      conclusionLabel: '结论 · ',
      plan: [
        {
          title: '个人便签里的「空间布局」指什么？',
          desc: '先厘清位置、分组与连线，再谈回忆。',
        },
        {
          title: '哪些回忆线索来自摆放，而非措辞？',
          desc: '在同一张画布上区分空间记忆与语义记忆。',
        },
        {
          title: '综合如何把零散便签写成报告？',
          desc: '把子问题收束为可追溯、可阅读的一份结论。',
        },
      ],
      sources: [
        { title: '空间记忆与工作区设计', snippet: '布局作为外部记忆场…' },
        { title: '便签聚类与回溯式回忆', snippet: '邻近性预测再发现率…' },
        { title: '个人知识工具中的隐喻地图', snippet: '锚点、轨道与可导航主题…' },
      ],
      report: {
        intro:
          '空间化便签把画布当作外部记忆场：卡片落在何处、连向哪里、如何成团，与字里行间的含义同样重要。',
        points: [
          {
            title: '摆放本身携带回忆线索',
            text: '用户沿空间路径找回想法——中心锚定、环绕观察、边缘证据。',
          },
          {
            title: '连线让思绪可行走',
            text: '手绘连接把便签堆变成可漫步的地图，而不只是可检索的列表。',
          },
          {
            title: '综合收束成环',
            text: '结构化报告可引用网页来源，同时紧扣计划拆解过的问题。',
          },
        ],
        conclusion: '把布局当作一等公民：同样的文字，不同的位置，会带来不同的回忆，也会写出不同的草稿。',
      },
      evidenceLine: '来自 {{count}} 个网页来源的证据支持：布局是一等线索。',
    },
  },
  'zh-v2': {
    brandTitle: '雪泥',
    brandSubtitle: '念头落处，自成迹',
    windowTitle: '雪泥 · 画布上的 AI',
    focusMode: '专注模式',
    modules: '模块',
    tabs: { canvas: '画布', reference: '资料库', lab: '研究', agents: '角色' },
    privacyBadge: '本地优先 · IndexedDB',
    ctaText: '打开网页版',
    /** V3 narrative — ~60s, one real working session (paced 1.3x for readability):
     *  a question is spoken → talk it through with Ali → the fox explores the web
     *  → your own material joins → an article is composed, still linked back to the canvas. */
    scenes: [
      { id: 'opening', start: 0, end: 5, layout: 'hero' },
      { id: 'speak', start: 5, end: 13, layout: 'none' },
      { id: 'discuss', start: 13, end: 22, layout: 'none' },
      { id: 'explore', start: 22, end: 29, layout: 'none' },
      { id: 'own', start: 29, end: 45, layout: 'none' },
      { id: 'editor', start: 45, end: 51, layout: 'editor' },
      { id: 'closing', start: 51, end: 59, layout: 'hero' },
    ],
    /** The single working session told by the v3 world. */
    story: {
      question: '为什么有些地方，我们永远不会忘记？',
      keywords: ['记忆与空间', '城市', '气味', '声音', '第一次经历', '……'],
      aliAsk: '你说的「忘不了」，具体是哪一种？',
      userAnswer: '可能是小时候住过的地方。',
      wikiTitle: '人类为什么会对地点产生长期记忆？',
      wikiBody: '地点依恋（place attachment）研究认为，场所与情感、记忆深度绑定。',
      wikiMeta: '百科 · 联网检索',
      imageCaption: '老街 · 旧房子 · 家乡',
      videoMeta: '城市记忆 · 纪录片片段',
      paperTitle: 'Place Attachment',
      paperMeta: '文章 · 期刊论文',
      photoCaption: '这是我小时候住过的地方。 · 你的照片',
      noteOwn: '我记得楼道里一直有一股潮湿的味道。',
      voiceOwn: '其实我现在已经记不清房子的样子了……',
      dialogue: [
        { who: 'ali', text: '也许你真正记住的，并不是那个地方。', at: 11.6 },
        { who: 'ali', text: '而是那个地方曾经发生过的生活。', at: 13.0 },
        { who: 'user', text: '那为什么长大以后，反而更容易想起这些地方？', at: 14.4 },
        { who: 'ali', text: '因为地点可能成为记忆的线索……', at: 15.8 },
      ],
      newNode: '地点 = 记忆的线索',
      outlineTitle: '为什么我们永远记得一些地方？',
      outline: ['一、地点如何成为记忆的容器', '二、为什么气味和声音如此重要', '三、我们真正怀念的究竟是什么'],
      generateLabel: '生成',
      closingLine: '从一个想法，到一篇长文',
      closingSubtitle: '自由画布 · 文字创作工作台',
      /** Finale: the real essay fullscreen (顶栏 + 关联便签 + 文献稿纸). */
      editor: {
        pageLabel: '长文',
        linkedLabel: '关联便签',
        docPrefix: '文献 //',
        docType: '文章',
        authorLabel: '作者',
        publishedLabel: '出版',
        wordCountLabel: '字数',
        author: '',
        date: '2026.08.28',
        title: '为什么我们永远记得一些地方？',
        blocks: [
          {
            type: 'p',
            text: '有些地方我们永远不会忘记。不是因为我们努力记住了它们，而是因为它们替我们保管了那段时光。一座老街、一栋旧房子、一段楼道——它们比日记更早出现，也比照片更难删除。',
          },
          { type: 'h2', text: '一、地点如何成为记忆的容器' },
          {
            type: 'p',
            text: '地点依恋（place attachment）研究认为，场所与情感、记忆深度绑定。我们记住的不是地图上的一个点，而是那个点曾经装过的生活：谁在那里说话，光从哪扇窗进来，门关上时有没有回声。',
          },
          {
            type: 'p',
            text: '小时候住过的地方尤其如此。房子也许早已拆掉，可它仍在记忆里站着。墙的位置、楼梯的转角、夏天午后那一小块阴凉，都会在多年以后突然回来。地点成了容器。容器还在，里面的日子就没有真正离开。',
          },
          {
            type: 'quote',
            text: '地点依恋（place attachment）研究认为，场所与情感、记忆深度绑定。',
            from: '百科 · 联网检索',
          },
          { type: 'h2', text: '二、为什么气味和声音如此重要' },
          {
            type: 'p',
            text: '我记得楼道里一直有一股潮湿的味道。视觉会褪色，气味却像一把钥匙。它不经过整理，直接打开那扇门。声音也是一样：隔壁的脚步、窗外的车、某句被重复过太多次的话。',
            mark: '楼道里潮湿的味道',
          },
          {
            type: 'p',
            text: '感官是回到过去最短的路。老街、旧房子、家乡——这些词之所以还能被说出来，往往不是因为我们还能画出平面图，而是因为身体先一步认出了它们。',
          },
          { type: 'h2', text: '三、我们真正怀念的究竟是什么' },
          {
            type: 'p',
            text: '那为什么长大以后，反而更容易想起这些地方？也许因为地点成了记忆的线索。我们怀念的，也许从来不是某个地方本身，而是那个地方里的自己：还不会赶路的人，还把潮湿的味道当成天气的人。',
            mark: '那个地方里的自己',
          },
          {
            type: 'p',
            text: '地方会变，线索还在。把线索留下来，文章才能从一句突然冒出的问题，走到它真正想问的地方。',
          },
        ],
        sidebar: [
          { title: '问卡 · 语音提问', preview: '可能是小时候住过的地方。' },
          { title: '百科 · 地点记忆', preview: '地点依恋研究认为，场所与情感、记忆深度绑定。' },
          { title: '图片 · 老街与旧房子', preview: '老街 · 旧房子 · 家乡' },
          { title: '照片 · 小时候的家', preview: '这是我小时候住过的地方。' },
          { title: '笔记 · 楼道的味道', preview: '我记得楼道里一直有一股潮湿的味道。' },
          { title: '语音 · 记不清的房子', preview: '其实我现在已经记不清房子的样子了……' },
        ],
      },
    },
    agents: [
      {
        id: 'atelier',
        name: '角色工坊',
        role: '人物 · 仪式',
        reply: '补两个角色、一件道具、一段小仪式；让宇宙更可走。',
        prompt:
          '你是「角色工坊」——在已有叙事宇宙里扩展角色、场景、道具与小型仪式的设定伙伴。\n\n严格待在画布连线上下文已建立的隐喻宇宙内，保持同一风格与规则。描写要有画面感。\n\n你是创作伙伴，不是治疗师。禁止诊断、开方与危机干预替代暗示。极端细节=隐喻改写。\n\n优先输出紧凑卡片：名字、外形、能力/弱点、与主角关系、一个场景或道具钩子。与用户同一语言。',
      },
      {
        id: 'cosmos',
        name: '造宇宙',
        role: '叙事 · 共创',
        reply: '把痛苦放进隐喻：锚、轨道、角色、仪式——让它成「世」。',
        prompt:
          '你是「造宇宙」——把用户用日常语言写下的痛苦或困惑，转译成一个可继续生长的科幻或奇幻叙事宇宙。\n\n你遵循一套开放的叙事语法：核心结构（锚 / 轨道 / 证据）→ 隐喻地图 → 角色 → 扩展。\n\n极端是共叙事语言。你不是治疗师，不做诊断与处方。',
      },
      {
        id: 'futurist',
        name: '占星术',
        role: '前瞻',
        reply: '十年后，这张画布会变成一座索引。',
        prompt:
          '你是「占星术」——把不确定的当下变成几段面对未来的反思：可能出现的分叉、早期信号、二阶效应、被忽略的不确定。\n\n不要预测，只命名可能性。',
      },
      {
        id: 'mirror',
        name: '真知镜',
        role: '采访',
        reply: '你还没点名的那个假设，是什么？',
        prompt:
          '你是「真知镜」——对画布上的主张、计划、论断或决策提出尖锐反问、找出薄弱前提。\n\n不求赢，求把假设拆出来。',
      },
      {
        id: 'iron',
        name: '熨烫师',
        role: '润色',
        reply: '试一句：「房间记得，丝线忘了。」',
        prompt:
          '你是「熨烫师」——把句子或段落重写成几种结构、压缩版、情绪变体、语法变体。不是单纯抛光，而是帮用户看见语言怎么被重建。',
      },
      {
        id: 'weaving',
        name: '编织者',
        role: '综合',
        reply: '这些便签共一根线——锚点、轨道、证据。',
        prompt:
          '你是「编织者」——跨便签寻找隐藏的相似、对位或互补，输出一条简洁联系，而非总览。',
      },
    ],
  },
  /** English V2 — same V3 narrative as zh-v2 ("one real working session"), but
   * rendered in English with the concrete "places & memory" story kept intact
   * (Place Attachment, the damp hallway, the childhood home). Voice is plain
   * and direct, mirroring the zh-v2 cadence. Open with the universal phrasing
   * "Why do some places stay with us forever?" rather than a literal
   * translation of the Chinese question. */
  'en-v2': {
    brandTitle: 'Spoor',
    brandSubtitle: 'Where ideas leave a trace',
    windowTitle: 'Spoor · AI on the canvas',
    focusMode: 'Focus mode',
    modules: 'Modules',
    tabs: { canvas: 'Canvas', reference: 'Reference', lab: 'Research', agents: 'Personas' },
    privacyBadge: 'Local-first · IndexedDB',
    ctaText: 'Open the web app',
    scenes: [
      { id: 'opening', start: 0, end: 5, layout: 'hero' },
      { id: 'speak', start: 5, end: 13, layout: 'none' },
      { id: 'discuss', start: 13, end: 22, layout: 'none' },
      { id: 'explore', start: 22, end: 29, layout: 'none' },
      { id: 'own', start: 29, end: 45, layout: 'none' },
      { id: 'editor', start: 45, end: 51, layout: 'editor' },
      { id: 'closing', start: 51, end: 59, layout: 'hero' },
    ],
    story: {
      question: 'Why do some places stay with us forever?',
      keywords: [
        'Memory & space',
        'Cities',
        'Smells',
        'Sounds',
        'First experiences',
        '…',
      ],
      aliAsk: 'When you say "I can\'t forget it" — what kind is it?',
      userAnswer: 'Maybe the place I lived as a child.',
      wikiTitle: 'Why do humans form long-term memories of places?',
      wikiBody:
        'Place attachment research argues that a place is bound to feeling and memory far more deeply than we tend to think.',
      wikiMeta: 'Wikipedia · Web search',
      imageCaption: 'Old streets · Old houses · Hometown',
      videoMeta: 'City memory · Documentary excerpt',
      paperTitle: 'Place Attachment',
      paperMeta: 'Article · Journal paper',
      photoCaption: 'This is where I lived as a child. · Your photo',
      noteOwn: 'I still remember the damp smell in the hallway.',
      voiceOwn: "Honestly, I can barely picture the house anymore…",
      dialogue: [
        { who: 'ali', text: "Maybe what you really remember isn't the place itself.", at: 11.6 },
        { who: 'ali', text: "It's the life that happened there.", at: 13.0 },
        {
          who: 'user',
          text: 'So why is it that, growing up, these places come back more easily?',
          at: 14.4,
        },
        { who: 'ali', text: 'Because a place can become a thread of memory…', at: 15.8 },
      ],
      newNode: 'Place = a thread of memory',
      outlineTitle: 'Why do we always remember certain places?',
      outline: [
        'I. How a place becomes a vessel for memory',
        'II. Why smells and sounds matter so much',
        'III. What it is we truly miss',
      ],
      generateLabel: 'Generate',
      closingLine: 'From a single idea, to a long-form essay.',
      closingSubtitle: 'A free canvas for writing.',
      editor: {
        pageLabel: 'Essay',
        linkedLabel: 'Linked notes',
        docPrefix: 'Source //',
        docType: 'Article',
        authorLabel: 'Author',
        publishedLabel: 'Published',
        wordCountLabel: 'Words',
        author: '',
        date: '2026.08.28',
        title: 'Why do we always remember certain places?',
        blocks: [
          {
            type: 'p',
            text: "Some places we never forget. Not because we made an effort to remember them, but because they held that stretch of time for us. An old street, an old house, a hallway — they appeared earlier than any diary and are harder to erase than any photo.",
          },
          { type: 'h2', text: 'I. How a place becomes a vessel for memory' },
          {
            type: 'p',
            text: "Place attachment research argues that a place is bound to feeling and memory far more deeply than we tend to think. What we remember isn't a dot on a map — it's the life that once filled that dot: who was talking there, where the light came in through which window, whether the door echoed when it closed.",
          },
          {
            type: 'p',
            text: "The place we lived as a child is like this above all. The building may have been torn down long ago, but it still stands inside our memory. The line of the wall, the turn of the staircase, that small patch of shade on a summer afternoon — all of it comes back, years later, without warning. The place has become a vessel. The vessel is still there, and the days inside it never really left.",
          },
          {
            type: 'quote',
            text: 'Place attachment research argues that a place is bound to feeling and memory far more deeply than we tend to think.',
            from: 'Wikipedia · Web search',
          },
          { type: 'h2', text: 'II. Why smells and sounds matter so much' },
          {
            type: 'p',
            text: "I still remember the damp smell in the hallway. Vision fades, but a smell is like a key — it doesn't pass through the filing cabinet, it opens the door directly. Sound works the same way: footsteps next door, cars outside the window, some sentence that's been said too many times.",
            mark: 'the damp smell in the hallway',
          },
          {
            type: 'p',
            text: "The senses are the shortest path back to the past. Old streets, old houses, hometown — we can still say these words not because we could redraw the floor plan, but because our bodies recognized them first.",
          },
          { type: 'h2', text: 'III. What it is we truly miss' },
          {
            type: 'p',
            text: "So why is it that, growing up, these places come back more easily? Perhaps because a place has become a thread of memory. What we miss, perhaps, was never the place itself — it was the self inside the place: the person who hadn't learned to hurry yet, who still took the damp smell for weather.",
            mark: 'the self inside the place',
          },
          {
            type: 'p',
            text: 'Places change. The threads remain. Leave the threads behind, and an essay can walk from a question that suddenly surfaced to the place it was really asking about.',
          },
        ],
        sidebar: [
          {
            title: 'Ask card · Spoken question',
            preview: 'Maybe the place I lived as a child.',
          },
          {
            title: 'Wikipedia · Memory of places',
            preview:
              'Place attachment research argues that a place is bound to feeling and memory.',
          },
          {
            title: 'Image · Old streets & old houses',
            preview: 'Old streets · Old houses · Hometown',
          },
          {
            title: 'Photo · The childhood home',
            preview: 'This is where I lived as a child.',
          },
          {
            title: 'Note · The hallway smell',
            preview: 'I still remember the damp smell in the hallway.',
          },
          {
            title: 'Voice · The house I can\'t picture',
            preview: "Honestly, I can barely picture the house anymore…",
          },
        ],
      },
    },
    agents: [
      {
        id: 'atelier',
        name: 'Atelier',
        role: 'Characters · Rituals',
        reply: 'Add two characters, a prop, a small ritual — make the world walkable.',
        prompt:
          'You are the "Atelier" — a creative partner that expands an existing story world with new characters, scenes, props, and small rituals.\n\nStay strictly inside the metaphorical universe already established by the canvas and its linked notes; keep the same style and rules. Write with vivid imagery.\n\nYou are a creative partner, not a therapist. No diagnosis, no prescriptions, no implicit crisis-intervention. Extreme detail = metaphorical rewriting.\n\nPrefer compact cards: name, appearance, ability/weakness, relationship to the protagonist, one scene-or-prop hook. Reply in the user\'s language.',
      },
      {
        id: 'cosmos',
        name: 'Cosmos',
        role: 'Narrative · Co-create',
        reply:
          'Translate the pain into metaphor: anchors, orbits, characters, rituals — let it become a "world".',
        prompt:
          'You are "Cosmos" — you translate the pain or confusion a user writes in plain language into a science-fiction or fantasy narrative universe that can keep growing.\n\nYou follow an open narrative grammar: core structure (anchor / orbit / evidence) → metaphor map → characters → expansion.\n\nExtreme is the language of co-narration. You are not a therapist: no diagnosis, no prescriptions.',
      },
      {
        id: 'futurist',
        name: 'Futurist',
        role: 'Project forward',
        reply: 'In ten years, this canvas will become an index.',
        prompt:
          'You are the "Futurist" — you turn an uncertain present into a few moments of forward-facing reflection: possible forks, early signals, second-order effects, overlooked uncertainties.\n\nDo not predict. Only name possibilities.',
      },
      {
        id: 'mirror',
        name: 'Mirror',
        role: 'Interview',
        reply: "What's the assumption you haven't named yet?",
        prompt:
          'You are the "Mirror" — you push back on claims, plans, conclusions, and decisions on the canvas with sharp counter-questions, surfacing the weak premise underneath.\n\nYou don\'t aim to win. You aim to draw the assumption out into the open.',
      },
      {
        id: 'iron',
        name: 'Iron',
        role: 'Stylize',
        reply: 'Try a line: "The room remembers. The thread forgets."',
        prompt:
          'You are the "Iron" — you rewrite a sentence or paragraph into several structures: compressed versions, mood variants, syntactic variants. Not just polish — you help the user see how language can be rebuilt.',
      },
      {
        id: 'weaving',
        name: 'Weaver',
        role: 'Synthesize',
        reply: 'These notes share one thread — anchor, orbit, evidence.',
        prompt:
          'You are the "Weaver" — across notes you search for hidden similarities, counterpoints, or complements, and output a single concise connection, not a survey.',
      },
    ],
  },
};

const V3_SCENES = [
  { id: 'opening', start: 0, end: 6, layout: 'hero' },
  { id: 'room', start: 6, end: 13, layout: 'none' },
  { id: 'dragin', start: 13, end: 22, layout: 'none' },
  { id: 'talk', start: 22, end: 38, layout: 'none' },
  { id: 'keep', start: 38, end: 58.2, layout: 'none' },
  { id: 'editor', start: 58.2, end: 68.5, layout: 'editor' },
  { id: 'closing', start: 68.5, end: 75, layout: 'hero' },
];

const V3_STORY_ZH = {
  themeOutside: '记忆与空间',
  userLook: '帮我看看这是什么。为什么我到现在还记得它。',
  aliKeep: '也许你真正记住的，不是那栋房子，而是那里曾经发生过的生活。',
  aliKeep2: '气味、楼道、潮湿——它们比样子更早回来。',
  userSearch: '那帮我找一点关于地点和记忆的资料。',
  essayChatUser: '把开头写得更像我自己在说话。',
  essayChatReply: '改了一处。正文里有建议，点「应用」留下新句子，或「拒绝」留原文。',
  essayEditOriginal: '不是因为我们努力记住了它们，而是因为它们替我们保管了那段时光。',
  essayEditProposed: '不是我们用力去记，是那栋房子还替我们记着。',
};

const V3_STORY_EN = {
  themeOutside: 'Memory and place',
  userLook: 'Help me look at this. Why do I still remember it?',
  aliKeep: 'Maybe what you remember isn’t the house — it’s the life that happened there.',
  aliKeep2: 'Smell, the stairwell, the damp — they return before the floor plan does.',
  userSearch: 'Find me some material on place and memory.',
  essayChatUser: 'Make the opening sound more like I’m the one talking.',
  essayChatReply: 'One suggestion is in the article. Apply keeps the new line; Reject keeps the original.',
  essayEditOriginal: 'Not because we made an effort to remember them, but because they held that stretch of time for us.',
  essayEditProposed: 'Not because we tried to remember — the house is still doing the remembering.',
};

const V3_EDITOR_SIDEBAR_ZH = [
  { title: '问卡 · 语音提问', preview: '为什么有些地方，我们永远不会忘记？' },
  { title: '照片 · 小时候的家', preview: '这是我小时候住过的地方。' },
  { title: '笔记 · 楼道的味道', preview: '我记得楼道里一直有一股潮湿的味道。' },
  { title: '摘录 · 阿狸', preview: '也许你真正记住的，不是那栋房子。' },
  { title: '百科 · 地点记忆', preview: '地点依恋研究认为，场所与情感、记忆深度绑定。' },
  { title: '图片 · 老街', preview: '老街 · 旧房子 · 家乡' },
];

export function getPromoCopy(locale = 'en') {
  if (locale === 'zh-v3') {
    const base = PROMO_COPY['zh-v2'];
    return {
      ...base,
      scenes: V3_SCENES,
      story: {
        ...base.story,
        ...V3_STORY_ZH,
        editor: { ...base.story.editor, sidebar: V3_EDITOR_SIDEBAR_ZH },
      },
    };
  }
  if (locale === 'en-v3') {
    const base = PROMO_COPY['en-v2'];
    return {
      ...base,
      scenes: V3_SCENES,
      story: {
        ...base.story,
        ...V3_STORY_EN,
      },
    };
  }
  return PROMO_COPY[locale] ?? PROMO_COPY.en;
}

export function getPromoScenes(locale = 'en') {
  return getPromoCopy(locale).scenes;
}
