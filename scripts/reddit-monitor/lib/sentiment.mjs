/**
 * 极简 sentiment + painTag 推断。
 *
 * 这是 content-factory/lib/forum-raw.mjs 里 inferPainTag / sentimentFromText
 * 的「Spoor 适配版」——关键词集合针对笔记 / PKM / AI 工具 / 海龟汤 / 哲学 /
 * 自我反思 重写。Reddit 自带 search 已经按 searchQuery 过滤过一次，所以这层
 * 推断只是粗分类，方便人工浏览；不要把它当 ML 模型。
 *
 * 痛点标签按热度累计后会输出到 `insights.frictionTags`。
 */

const PAIN_KEYWORDS = [
  // 工具迁移 / 比较 —— 列出常见 -ing/-ed 变体以避免 word boundary 漏匹配
  { tag: 'tool switching', test: /\b(leav(es|ing)|switch(es|ing|ed)?|migrat(e|ing|ion)|alternativ(es|ely)?|vs\.?|compar(es?|ed|ing)|replac(e|ing|ement)|dropp?(ed|ing)|ditc?h(ed|ing)?)\b/i },
  // 性能 / 延迟 —— 排在 model support 前面，让 VRAM / 内存 等资源关键词先命中
  { tag: 'performance', test: /\b(slow|lag|freeze|crashes?|hang|performance|memory|CPU|context\s+window|token\s+limit|VRAM|out\s+of\s+memory|hangs?|freezes?)\b/i },
  // 笔记同步 / 移动端
  { tag: 'sync issues', test: /\b(sync|conflict|merge|version|multi[-\s]?device|cross[-\s]?device)\b/i },
  { tag: 'mobile missing', test: /\b(mobile|ios|iphone|android|ipad)\b/i },
  // 隐私 / 数据所有权
  { tag: 'privacy concerns', test: /\b(privacy|private|leak|exfiltrat|telemetry|tracking|surveil|data\s+ownership)\b/i },
  { tag: 'data lock-in', test: /\b(lock[-\s]?in|export|vendor|proprietary|closed[-\s]?source|cannot\s+migrate)\b/i },
  // AI 质量
  { tag: 'AI quality', test: /\b(hallucinat|fabricat|made\s+up|invented|wrong|incorrect|inaccurate|garbage|low\s+quality)\b/i },
  // 模型支持 —— 注意：VRAM / memory / context window 已被 performance 抢占
  { tag: 'model support', test: /\b(which\s+model|GPT|Claude|Gemini|DeepSeek|Llama|Mistral|Ollama|GGUF|llama\.cpp|local\s+model|API\s+key|BYO\s*key)\b/i },
  // 上手成本
  { tag: 'onboarding', test: /\b(complex|complicated|steep|onboard|setup|configure|install|getting\s+started|tutorial)\b/i },
  // 功能缺口
  { tag: 'feature gap', test: /\b(missing|doesn't\s+have|no\s+support|wish|need\s+a|should\s+have|feature\s+request)\b/i },
  // 价格 / 许可
  { tag: 'pricing / license', test: /\b(pricing|subscription|cost|expensive|free|trial|pay[-\s]?wall|license|PolyForm|noncommercial|commercial\s+use)\b/i },
  // UX / 直观性
  { tag: 'usability', test: /\b(cluttered|overwhelming|hidden|buried|UX|UI|interface|clunky|ugly|counter[-\s]?intuitive)\b/i },
  // 思考工作流 / 反思 / 哲学
  { tag: 'thinking workflow', test: /\b(reflect|reflection|journal|narrative|re[-\s]?author|socratic|philosophical|meditat|mindful|stoic)\b/i },
  // 海龟汤 / 谜题
  { tag: 'puzzle hosting', test: /\b(lateral\s+thinking|host|puzzle|yes\s*\/\s*no|situation\s+puzzle|oracle|game\s+master|GM)\b/i },
  // 情感 / 表达
  { tag: 'expressive limits', test: /\b(can't\s+express|stuck|wordless|frustrated|overwhelm|burn\s+out|burnout|demotivat)\b/i }
];

const NEGATIVE_WORDS = [
  'struggle',
  'struggling',
  'frustrated',
  'frustrating',
  'hard',
  'difficult',
  'stuck',
  'nervous',
  'scared',
  'embarrassed',
  'give up',
  'fail',
  'failed',
  'failed',
  'terrible',
  'awful',
  'sucks',
  'hate',
  'horrible',
  'annoying',
  'annoyed',
  'painful',
  'useless',
  'broken'
];

const POSITIVE_WORDS = [
  'love',
  'loving',
  'great',
  'amazing',
  'fantastic',
  'perfect',
  'finally',
  'works',
  'helped',
  'helps',
  'recommend',
  'recommended',
  'game changer',
  'game-changer',
  'blown away',
  'wonderful',
  'excellent',
  'best'
];

export function inferPainTag(text) {
  const t = String(text || '');
  for (const { tag, test } of PAIN_KEYWORDS) {
    if (test.test(t)) return tag;
  }
  return 'general feedback';
}

export function sentimentFromText(text) {
  const t = String(text || '').toLowerCase();
  let score = 55;
  for (const w of NEGATIVE_WORDS) {
    if (t.includes(w)) score -= 6;
  }
  for (const w of POSITIVE_WORDS) {
    if (t.includes(w)) score += 5;
  }
  return Math.max(8, Math.min(92, Math.round(score)));
}

export function sentimentLabel(score) {
  if (score < 35) return '偏低';
  if (score < 60) return '中性';
  return '积极';
}
