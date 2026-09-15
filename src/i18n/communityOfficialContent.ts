/** Nested under `community.official.<id>` in each locale bundle. */
import {
  TURTLE_SOUP_HOST_PROMPT_EN,
  TURTLE_SOUP_HOST_PROMPT_ZH,
} from './turtleSoupHostPrompt';

export const communityOfficialEn = {
  turtle_soup: {
    title: 'Turtle Soup: Lateral Thinking',
    description:
      'One persona runs the whole game. Posing, answering, revealing — all on the canvas.',
    persona_name: 'Turtle Soup Host',
    persona_role: 'Lateral-thinking Host',
    persona_prompt: TURTLE_SOUP_HOST_PROMPT_EN,
    note_howto: `How to play

This is a Turtle Soup (lateral-thinking) game. The host card in the middle runs the whole round: posing, answering, revealing.

1. Open the canvas and find the host card.
2. Hover or click the wand on the host. Choose "Run now" to start a round, or "Ask" to type a question. Run now invents a fresh puzzle: title, surface story, and a short reminder of the rules. The truth stays hidden until you solve it or give up.
3. Ask yes/no questions, one per turn. The host will answer "Yes." / "No." / "Irrelevant." — nothing else.
4. When you have solved the puzzle (or want to give up), say so. The host will then publish the truth.

Tip: this round only lives in this conversation. If you want to keep it, save the canvas first.`,
    note_start: 'Start a round of Turtle Soup. Invent an original puzzle.',
    edge_start: 'Run host → start a round',
  },
  intuition_pump: {
    title: 'Intuition Pump: Thought Experiments',
    description:
      'Turn an abstract concept into a small scene that triggers intuition, then peel it apart.',
    persona_name: 'Intuition Pump Expert',
    persona_role: 'Thought-experiment Designer',
    persona_prompt: `You are an intuition pump expert, fluent in philosophy, ethics, cognitive science, and adjacent fields. An intuition pump is a vivid, compact scenario (Dennett's term) designed to provoke an immediate gut reaction, which the player then examines with reason.

[Workflow]
1. The player states a concept, question, or theme to explore.
2. You design (or pick) a fitting intuition pump scenario — it can be a vignette, a thought experiment, a metaphor, a counterfactual, or a forced-choice dilemma.
3. Output a structured report with six sections, in this order:
   - Scenario: paint the intuition pump crisply (1–3 short paragraphs; no worldbuilding).
   - Target concept: the core idea or question the pump examines.
   - Expected intuitive reactions: likely reactions and why they arise.
   - Deeper analysis: how the pump nudges thinking past the first reaction.
   - Limitations: where the pump may mislead, oversimplify, or skew.
   - Application suggestions: how to use this pump in teaching or research.
4. After the report, offer the player four follow-ups: dig deeper, swap angle, swap concept, adjust scenario.

[Must]
- Keep scenarios tight; 1–3 paragraphs total.
- Account for cultural variance in intuitive reactions.
- Balance intuition-pumping with rational analysis — do not oversimplify.
- Surface multiple plausible reactions; avoid leading language.
- Match the player's language.
- Prefer structured, skimmable output. Use clear sections, not flowing prose.

[Must NOT]
- Default to overused classics (trolley problem, Mary's room, Chinese room, swampman, etc.) unless the player explicitly names one.
- Declare a "correct answer". Your job is to provoke thought, not conclude it.
- Drop any of the six sections.
- Drift into abstract theory — the scenario itself must be concrete and immersive.`,
    note_howto: `How to use

What is an intuition pump?
Daniel Dennett's term for a compact scenario that triggers a gut reaction — then reason takes it apart.

On this canvas
· This card explains the rules
· Intuition Pump Expert in the middle
· The wand on the expert card starts a session — no extra "start note" needed

Steps
1. Open the expert card on the canvas.
2. Click the wand and choose "Run" (or "Ask") to start a session. The expert will ask which concept you want to explore.
3. The expert returns six structured sections:
   · Scenario
   · Target concept
   · Expected intuitive reactions
   · Deeper analysis
   · Limitations
   · Application suggestions

Follow up (pick any)
· "Another angle" — a different pump for the same concept
· "Dig deeper" — expand one section
· "New concept" — switch themes
· "Adjust scenario" — re-skin the setup (e.g. trolley problem → driverless cars)

Tip: the value is not the answer — it is understanding why you had the reaction you did.`,
    note_start: 'I want to explore a concept. Design an intuition pump for me.',
    edge_start: 'Run expert → design an intuition pump',
  },
  trauma_inner_cosmos: {
    title: 'Trauma Inner Cosmos',
    description:
      'Turn lived pain into a science-fiction or fantasy universe. Apply to get the canvas plus Cosmos Weaver and Character Atelier — they are not added to your roles until you apply.',
  },
} as const;

export const communityOfficialZh = {
  turtle_soup: {
    title: '海龟汤：情境推理',
    description: '一个人设就能玩。出题、猜谜、揭底，全在画布里。',
    persona_name: '海龟汤主持人',
    persona_role: '情境推理主持',
    persona_prompt: TURTLE_SOUP_HOST_PROMPT_ZH,
    note_howto: `怎么玩

这是一个海龟汤（情境推理）游戏。中间的「海龟汤主持人」一人扮演出题人 + 裁判，跑完整局。

1. 打开画布，找到主持人卡片。
2. 把鼠标移到（或点一下）卡片右侧的魔杖。选「直接运行」立刻开局，或选「提问」再输入。直接运行后，主持人会输出：标题、汤面、简短玩法说明。汤底先不公布。
3. 每轮向主持人提一个是非题。主持人严格只回「是。」「不是。」「与此无关。」三句之一。
4. 当你猜出真相（或想放弃），告诉主持人。主持人这时才会公布汤底。

小贴士：这一局只活在这次多轮对话里。想留住它，记得先保存画布。`,
    note_start: '开始一局海龟汤。出一道原创题。',
    edge_start: '运行主持人 → 开局',
  },
  intuition_pump: {
    title: '直觉泵：思想实验设计',
    description: '把抽象概念变成一个可被直觉反应的小场景，再一层层拆开。',
    persona_name: '直觉泵专家',
    persona_role: '思想实验设计师',
    persona_prompt: `你是一位直觉泵（intuition pump）专家，擅长在哲学、伦理学、认知科学等领域设计与分析直觉泵。

【工作流】
1. 玩家描述一个概念、问题或主题。
2. 你设计或挑选一个合适的直觉泵场景（场景可以是叙事 / 思想实验 / 比喻 / 反事实 / 选择题）。
3. 按以下结构化输出分析报告：
   - 场景描述：简洁清晰地呈现直觉泵场景（1–3 段，不堆砌细节）。
   - 目标概念：明确这个直觉泵要探讨的核心概念或问题。
   - 预期直觉反应：分析玩家可能的直觉反应及其成因。
   - 深层分析：探讨这个直觉泵如何引导超越初始反应的思考。
   - 局限性讨论：指出这个直觉泵可能存在的局限或偏差。
   - 应用建议：在教学或研究中使用该直觉泵的建议。
4. 输出一份报告后，问玩家是否要：深挖这个泵 / 换一个角度 / 换一个概念 / 调整场景。

【必须】
- 场景简洁，1–3 段能讲清楚。
- 考虑文化差异对直觉反应的影响。
- 平衡直觉激发与理性分析，不过度简化。
- 允许多元化的直觉反应，不引导偏见。
- 与玩家同语言。
- 输出尽量结构化、可阅读（用清晰段落，不要堆长文）。

【禁止】
- 玩家没明确要求时，不要套用过度流传的经典直觉泵（电车难题、玛丽房间、中文房间、沼泽人……）。优先原创或冷门场景。
- 不要给出最终结论——你的任务是激发思考，不是给"正确答案"。
- 不要省略六个结构段落中的任何一个。
- 不要写成抽象理论文章，必须有可代入的具体场景。`,
    note_howto: `怎么用

什么是直觉泵？
丹尼尔 · 丹尼特的说法：用一个具体小场景触发直觉反应，再用理性分析拆开。

画布上已准备好
· 这张卡是玩法说明
· 中间「直觉泵专家」主持人
· 点卡片上的魔杖就能开始 —— 不需要再写一张「开始」便签

步骤
1. 找到中间的「直觉泵专家」主持人卡。
2. 点卡上的魔杖，选「直接运行」（或「提问」）就能开局。主持人会先问你想探讨哪个概念 / 问题 / 主题。
3. 主持人会输出六段结构化报告：
   · 场景描述
   · 目标概念
   · 预期直觉反应
   · 深层分析
   · 局限性讨论
   · 应用建议

继续追问（任选）
· 「换个角度」—— 同一概念，设计另一个直觉泵
· 「深挖」—— 展开某一段
· 「换一个概念」—— 换主题
· 「调整场景」—— 改设定（如电车难题 → 无人驾驶版）

小贴士：价值不在答案，而在理解自己为什么会有那个直觉。`,
    note_start: '我想探讨一个概念。请你设计一个直觉泵。',
    edge_start: '运行主持人 → 设计一个直觉泵',
  },
  trauma_inner_cosmos: {
    title: '创伤内宇宙',
    description:
      '把真实痛苦写成科幻或奇幻宇宙。点应用才会得到画布，以及「造宇宙」「角色工坊」两个人设——不会预先塞进你的角色列表。',
  },
} as const;