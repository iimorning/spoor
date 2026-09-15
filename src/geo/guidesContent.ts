import { AI_BRAINSTORMING_MARKDOWN } from './guides/aiBrainstormingMarkdown';
import { AI_BRAINSTORMING_MARKDOWN_ZH } from './guides/aiBrainstormingMarkdown.zh';
import { AI_WRITING_MARKDOWN } from './guides/aiWritingMarkdown';
import { AI_WRITING_MARKDOWN_ZH } from './guides/aiWritingMarkdown.zh';
import { AI_WORLDBUILDING_MARKDOWN } from './guides/aiWorldbuildingMarkdown';
import { AI_WORLDBUILDING_MARKDOWN_ZH } from './guides/aiWorldbuildingMarkdown.zh';
import { CHATGPT_ALTERNATIVES_MARKDOWN } from './guides/chatgptAlternativesMarkdown';
import { CHATGPT_ALTERNATIVES_MARKDOWN_ZH } from './guides/chatgptAlternativesMarkdown.zh';
import { HOW_TO_DEVELOP_IDEA_MARKDOWN } from './guides/howToDevelopIdeaMarkdown';
import { HOW_TO_DEVELOP_IDEA_MARKDOWN_ZH } from './guides/howToDevelopIdeaMarkdown.zh';

export const GUIDES_PATH = '/guides';

export type GuideSlug =
  | 'ai-brainstorming-tools'
  | 'ai-writing-tools'
  | 'chatgpt-alternatives-for-writers'
  | 'ai-worldbuilding-tools'
  | 'how-to-develop-an-idea-with-ai';

export type GuideSection = {
  heading: string;
  paragraphs: string[];
  /** Bullet lists shown after the paragraph at `after` (0 = after the first paragraph). */
  lists?: Array<{ after: number; items: string[] }>;
};

export type GuideDoc = {
  slug: GuideSlug;
  title: string;
  titleZh: string;
  description: string;
  descriptionZh: string;
  h1: string;
  h1Zh: string;
  lede: string;
  ledeZh: string;
  related: GuideSlug[];
  sections: GuideSection[];
  closer: string;
  /** When set, this markdown is the article body (React + crawler HTML). */
  bodyMarkdown?: string;
  bodyMarkdownZh?: string;
};

export const GUIDE_INDEX_TITLE = 'Guides — Thinking, Writing & Research with AI | Spoor';
export const GUIDE_INDEX_DESCRIPTION =
  'Practical guides for brainstorming, writing, research, worldbuilding, and developing ideas with AI.';
export const GUIDE_INDEX_TITLE_ZH = '指南 — 用 AI 思考、写作与研究 | 雪泥 Spoor';
export const GUIDE_INDEX_DESCRIPTION_ZH =
  '关于头脑风暴、写作、研究、世界观，以及怎样用 AI 把一个想法做完的实用短文。';

export const GUIDES: readonly GuideDoc[] = [
  {
    slug: 'ai-brainstorming-tools',
    title: '7 AI Brainstorming Tools for Different Ways of Thinking',
    titleZh: '7 种 AI 头脑风暴工具，对应不同的想事情方式',
    description:
      'There is no single best AI brainstorming tool. The difference is where the thinking lives after the first conversation — generating ideas versus developing them on a persistent canvas.',
    descriptionZh:
      '没有一种最好的 AI 头脑风暴工具。差别在第一轮对话之后思考落在哪里——生成点子，还是在持久画布上把点子发展下去。',
    h1: '7 AI Brainstorming Tools for Different Ways of Thinking',
    h1Zh: '7 种 AI 头脑风暴工具，对应不同的想事情方式',
    lede: 'There is no single best AI brainstorming tool. The better question is what you want to happen to an idea after the first conversation.',
    ledeZh: '没有一种最好的 AI 头脑风暴工具。更值得问的是：第一轮对话之后，这个想法要去哪儿。',
    related: ['how-to-develop-an-idea-with-ai', 'ai-writing-tools'],
    sections: [],
    closer: '',
    bodyMarkdown: AI_BRAINSTORMING_MARKDOWN,
    bodyMarkdownZh: AI_BRAINSTORMING_MARKDOWN_ZH,
  },
  {
    slug: 'ai-writing-tools',
    title: 'AI Writing Tools: When AI Should Help You Think, Not Just Write',
    titleZh: 'AI 写作工具：什么时候该让 AI 帮你想，而不只是帮你写',
    description:
      'Generation-first tools produce a draft. Development-first workflows use AI to develop ideas, material, and arguments before the writing — so the writer still decides what the piece says.',
    descriptionZh:
      '生成优先的工具产出草稿。发展优先的工作流先用 AI 发展想法、材料和论点，再动笔——成品说什么，仍由写作者决定。',
    h1: 'AI Writing Tools: When AI Should Help You Think, Not Just Write',
    h1Zh: 'AI 写作工具：什么时候该让 AI 帮你想，而不只是帮你写',
    lede: 'AI writing tools have made it extremely easy to produce a draft. The harder job is developing the thinking behind the text.',
    ledeZh: 'AI 写作工具让产出草稿变得极其容易。更难的是发展文字背后的思考。',
    related: ['how-to-develop-an-idea-with-ai', 'chatgpt-alternatives-for-writers'],
    sections: [],
    closer: '',
    bodyMarkdown: AI_WRITING_MARKDOWN,
    bodyMarkdownZh: AI_WRITING_MARKDOWN_ZH,
  },
  {
    slug: 'chatgpt-alternatives-for-writers',
    title: 'ChatGPT Alternatives for Writers: Different Ways to Work with AI',
    titleZh: '写作者的 ChatGPT 替代：换模型，还是换工作方式',
    description:
      'A ChatGPT alternative for writers is not always another chatbot. Sometimes the real change is the workspace: keeping notes, research, and AI replies visible while the idea is still unfinished.',
    descriptionZh:
      '写作者要的 ChatGPT 替代，不一定是另一个聊天机器人。有时真正该换的是工作区：想法还没做完时，笔记、研究和 AI 回复都还看得见。',
    h1: 'ChatGPT Alternatives for Writers: Different Ways to Work with AI',
    h1Zh: '写作者的 ChatGPT 替代：换模型，还是换工作方式',
    lede: 'ChatGPT is already a very capable tool for writers. For some kinds of writing the problem is not the model — it is the workspace.',
    ledeZh: 'ChatGPT 对写作者已经很能用。有些写作，问题不在模型，而在工作区。',
    related: ['ai-writing-tools', 'how-to-develop-an-idea-with-ai'],
    sections: [],
    closer: '',
    bodyMarkdown: CHATGPT_ALTERNATIVES_MARKDOWN,
    bodyMarkdownZh: CHATGPT_ALTERNATIVES_MARKDOWN_ZH,
  },
  {
    slug: 'ai-worldbuilding-tools',
    title: 'AI Worldbuilding Tools: How to Develop a Fictional World Without Losing the Threads',
    titleZh: 'AI 世界观工具：怎样发展一个虚构世界，而不把线索弄丢',
    description:
      'Worldbuilding is not mainly a generation problem. It is a development and relationship problem — keeping characters, places, factions, and story threads visible while the world is still changing.',
    descriptionZh:
      '世界观主要不是生成问题，而是发展和关系问题——世界还在变时，角色、地点、势力和故事线都还看得见。',
    h1: 'AI Worldbuilding Tools: How to Develop a Fictional World Without Losing the Threads',
    h1Zh: 'AI 世界观工具：怎样发展一个虚构世界，而不把线索弄丢',
    lede: 'AI can generate a fictional character in seconds. The harder problem is keeping the relationships visible as the world grows.',
    ledeZh: 'AI 可以在几秒里生成一个虚构角色。更难的是世界长大时，把关系一直摊开看见。',
    related: ['how-to-develop-an-idea-with-ai', 'ai-brainstorming-tools'],
    sections: [],
    closer: '',
    bodyMarkdown: AI_WORLDBUILDING_MARKDOWN,
    bodyMarkdownZh: AI_WORLDBUILDING_MARKDOWN_ZH,
  },
  {
    slug: 'how-to-develop-an-idea-with-ai',
    title: 'How to Develop an Idea with AI Without Letting AI Take Over',
    titleZh: '怎样用 AI 发展一个想法，而不把主导权交给 AI',
    description:
      'Treat AI as thinking partners, not a machine for the final answer: start incomplete, gather material, ask different questions, keep useful replies, rearrange, then decide — with you still directing the work.',
    descriptionZh:
      '把 AI 当思考搭档，而不是给出最终答案的机器：从不完整开始，收集材料，问不同的问题，留下有用回复，重排，再决定——方向仍由你主导。',
    h1: 'How to Develop an Idea with AI Without Letting AI Take Over',
    h1Zh: '怎样用 AI 发展一个想法，而不把主导权交给 AI',
    lede: 'AI is very good at finishing things. Before that, there is another kind of work: finding out what an unfinished idea could become.',
    ledeZh: 'AI 很擅长把事情做完。在那之前还有另一种工作：弄清楚一个未完成的想法可以变成什么。',
    related: ['ai-writing-tools', 'chatgpt-alternatives-for-writers', 'ai-worldbuilding-tools'],
    sections: [],
    closer: '',
    bodyMarkdown: HOW_TO_DEVELOP_IDEA_MARKDOWN,
    bodyMarkdownZh: HOW_TO_DEVELOP_IDEA_MARKDOWN_ZH,
  },
];

export function guidePath(slug: GuideSlug): string {
  return `${GUIDES_PATH}/${slug}`;
}

export function getGuide(slug: string | null | undefined): GuideDoc | null {
  if (!slug) return null;
  return GUIDES.find((guide) => guide.slug === slug) ?? null;
}

export function isGuideZh(language?: string | null): boolean {
  return Boolean(language?.startsWith('zh'));
}

export function guideCopy(guide: GuideDoc, language?: string | null) {
  const zh = isGuideZh(language);
  return {
    title: zh ? guide.titleZh : guide.title,
    description: zh ? guide.descriptionZh : guide.description,
    h1: zh ? guide.h1Zh : guide.h1,
    lede: zh ? guide.ledeZh : guide.lede,
    bodyMarkdown: zh ? guide.bodyMarkdownZh : guide.bodyMarkdown,
  };
}

export function guideIndexCopy(language?: string | null) {
  const zh = isGuideZh(language);
  return {
    title: zh ? GUIDE_INDEX_TITLE_ZH : GUIDE_INDEX_TITLE,
    description: zh ? GUIDE_INDEX_DESCRIPTION_ZH : GUIDE_INDEX_DESCRIPTION,
  };
}

export function guideIndexItems(): Array<{ href: string; title: string; description: string }> {
  return GUIDES.map((guide) => ({
    href: guidePath(guide.slug),
    title: guide.h1,
    description: guide.description,
  }));
}
