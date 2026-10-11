import fs from 'fs';
import path from 'path';

export function getDefaultForumInsights() {
  return {
    meta: {
      title: 'Spoor 论坛痛点雷达',
      subtitle: '本地 fetch · Reddit 多版块',
      lastSyncNote: '示例数据：将 fetch.mjs 写入 data/forum-raw.json 后会自动覆盖',
      n8nConnected: false
    },
    frictionTags: [
      'tool switching',
      'mobile missing',
      'AI quality',
      'sync issues',
      'pricing / license',
      'thinking workflow'
    ],
    items: [
      {
        id: 'demo-1',
        userLabel: 'u/SampleUser',
        source: 'Reddit',
        timeAgo: '2 小时前',
        sentiment: 28,
        sentimentLabel: '偏低',
        quote:
          'I tried switching from Obsidian because the AI plugins kept breaking on every update. I just want a canvas that lets me put notes down and ask an AI to challenge them.',
        painTag: 'tool switching',
        selected: true,
        aiLab: null
      },
      {
        id: 'demo-2',
        userLabel: 'u/AnotherUser',
        source: 'Reddit',
        timeAgo: '5 小时前',
        sentiment: 45,
        sentimentLabel: '中性',
        quote:
          "Loving the local-first angle. The one thing that stops me is sync — I work across desktop and laptop and I don't want to give that up.",
        painTag: 'sync issues',
        aiLab: null
      },
      {
        id: 'demo-3',
        userLabel: 'u/YetAnother',
        source: 'Reddit',
        timeAgo: '1 天前',
        sentiment: 60,
        sentimentLabel: '中性',
        quote:
          "Has anyone used this for Socratic-style dialogue? I'm trying to find a way to have AI challenge my assumptions instead of agreeing with me.",
        painTag: 'thinking workflow',
        aiLab: null
      }
    ]
  };
}

/**
 * @param {string} projectRoot
 * @returns {ReturnType<typeof getDefaultForumInsights>}
 */
export function loadForumInsights(projectRoot) {
  const jsonPath = path.join(projectRoot, 'data', 'forum-insights.json');
  if (fs.existsSync(jsonPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      if (parsed && Array.isArray(parsed.items)) return parsed;
    } catch {
      /* 无效 JSON 时使用内置示例 */
    }
  }
  return getDefaultForumInsights();
}
