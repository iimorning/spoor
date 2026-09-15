import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'sidebar.settings': '设置',
        'sidebar.personal': '画布',
        'sidebar.archive': '知识存档',
        'sidebar.agents': '角色',
        'onboarding.cta_next': '下一步',
        'onboarding.cta_done': '完成',
        'onboarding.cta_skip': '跳过引导',
        'onboarding.cta_waiting_move': '请把卡片拖进房间…',
        'onboarding.cta_waiting_send': '请发送一条消息…',
        'onboarding.cta_waiting_excerpt': '请把回复摘录到画布…',
        'onboarding.cta_waiting_compose': '请框选卡片并合成文章…',
        'onboarding.loop.step1.title': '这是阿狸的房间',
        'onboarding.loop.step1.body': '这是 AI 角色的工作区。把素材拖进来，就会成为对话的上下文记忆。',
        'onboarding.loop.step2.title': '把材料拖进来',
        'onboarding.loop.step2.body': '把右侧的卡片拖进房间里。',
        'onboarding.loop.step3.title': '和阿狸聊天',
        'onboarding.loop.step3.body': '就着你拖进来的便签，发一个问题试试，例如：「帮我看看这是什么」。',
        'onboarding.loop.step4.title': '拖到画布',
        'onboarding.loop.step4.body': '拖动AI回复即可变成卡片',
        'onboarding.loop.step5.title': '合成长文',
        'onboarding.loop.step5.body': '框选你需要的卡片。\n点合成文章。',
        'onboarding.step1.title': '添加卡片',
        'onboarding.step1.body': '点「+」可新建便签、主题卡、阿狸问卡或角色卡。空白处拖动可移动画布，右下角可缩放或适应全部。',
        'onboarding.step2.title': '上传书籍与图片',
        'onboarding.step2.body': '点文件图标可上传图片、视频、PDF / EPUB 电子书。',
        'onboarding.step3.title': '在侧栏里对话',
        'onboarding.step3.body': '点阿狸或角色卡，右侧会打开他们的对话。',
        'onboarding.work_zone.title': '画一间房间',
        'onboarding.work_zone.body': '点这个工具，再拖出一个矩形。',
        'onboarding.step5.title': '合成文章',
        'onboarding.step5.body': '选中 2 张以上卡片，点这里生成一篇合成长文。',
        'onboarding.step6.title': '新建画布',
        'onboarding.step6.body': '点右上角历史记录，再点「新建空白画布」。',
        'onboarding.step7.title': '左侧栏',
        'onboarding.step7.body': '这里是知识存档、角色和设置。',
        'onboarding.step8.title': '知识存档',
        'onboarding.step8.body': '从画布归档的卡片都集中在这里。',
        'onboarding.step9.title': '角色工作室',
        'onboarding.step9.body': '自定义 AI 角色。',
        'onboarding.step10.title': '角色工作室',
        'onboarding.step10.body': '自定义 AI 角色。',
        'onboarding.pan.title': '按住滚轮拖动画布',
        'onboarding.pan.body': '在空白处按住鼠标滚轮（中键）再拖动。',
        'onboarding.restart_button': '重新播放引导',
        'onboarding.restart_section': '新手引导',
        'sidebar.pocket': '备忘',
        'pocket.title': '备忘',
        'canvas.default_workspace_name': '主工作区',
      };
      return translations[key] ?? key;
    },
    i18n: { language: 'zh', changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  Trans: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('lucide-react', () => {
  const iconNames = [
    'MessageSquare', 'Terminal', 'Network', 'Search', 'Bell', 'Settings', 'Plus',
    'BookOpen', 'Users', 'Library', 'Microscope', 'Sparkles', 'Maximize2', 'Minimize2',
    'Quote', 'Brain', 'Bot', 'Coffee', 'Wand2', 'Send', 'SlidersHorizontal', 'History', 'ZoomIn',
    'Focus', 'Scan', 'Image', 'FilePlus', 'Trash2', 'Link2', 'X', 'Camera', 'ChevronLeft',
    'ChevronRight', 'Check', 'Cpu', 'ArrowRight', 'ListChecks', 'CheckCircle2',
    'Loader2', 'PenLine', 'Edit3', 'FileText', 'Globe', 'ExternalLink', 'RotateCcw',
    'Monitor', 'Download', 'Mic', 'MicOff', 'Layers2',
    'GripVertical', 'Pencil', 'Video', 'Layers', 'Type',
    'Sun', 'Moon',
    'Cloud', 'CloudOff', 'LogOut',
    'Headphones', 'GitBranch', 'Square', 'SquareDashed', 'StickyNote', 'MapPin',
    'MessagesSquare', 'Play', 'Pause', 'Waves', 'Droplets', 'Trees', 'Flower2',
    'AudioLines', 'SkipBack', 'SkipForward', 'RotateCcw',
    'Volume2', 'VolumeX',
    'Archive', 'ArrowUpRight',
    'Folder', 'FolderPlus', 'FolderOpen', 'Inbox',
    'Grid3x3', 'Share2', 'Heart', 'Bookmark', 'MessageCircle', 'CreditCard',
    'Mail', 'Github',
    'CloudLightning', 'Flame', 'Snowflake',
    'NotebookPen', 'LayoutGrid', 'ArrowLeft',
    'Copy',
  ];
  const icons: Record<string, React.FC> = {};
  for (const name of iconNames) {
    icons[name] = (props: Record<string, unknown>) => {
      const { createElement } = require('react');
      return createElement('svg', { 'data-testid': `icon-${name}`, ...props });
    };
  }
  return icons;
});

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => {
    const { createElement } = require('react');
    return createElement('div', { 'data-testid': 'markdown' }, children);
  },
}));

vi.mock('motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: new Proxy({}, {
    get: (_target, prop) => {
      return ({ children, ...rest }: Record<string, unknown>) => {
        const { createElement } = require('react');
        return createElement(String(prop), rest, children);
      };
    },
  }),
}));

import App from '../src/App';
import { db } from '../src/db';
import { ONBOARDING_STORAGE_KEY } from '../src/onboarding/useOnboarding';

/**
 * Integration coverage for the onboarding tour. These run the actual App
 * component so they also exercise the i18n + localStorage + tab-switching
 * plumbing that the tour relies on.
 */

describe('Onboarding tour (integration)', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.articles.clear();
    await db.agents.clear();
    await db.edges.clear();
    await db.canvases.clear();
    await db.agentSandboxThreads.clear();
    await db.canvasWorkZones.clear();
    localStorage.clear();
  });

  it('auto-shows on first launch when localStorage has no flag', async () => {
    await act(async () => { render(<App />); });
    await waitFor(() => {
      expect(screen.getByTestId('onboarding-backdrop')).toBeInTheDocument();
    });
    expect(screen.getByTestId('onboarding-tooltip')).toBeInTheDocument();
    // First step title (Chinese, mocked above)
    expect(screen.getByText('这是阿狸的房间')).toBeInTheDocument();
  });

  it('does not auto-show when the user has previously completed it', async () => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true');
    await act(async () => { render(<App />); });
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.queryByTestId('onboarding-backdrop')).not.toBeInTheDocument();
  });

  it('pressing Esc skips the tour and persists the completed flag', async () => {
    await act(async () => { render(<App />); });
    await waitFor(() => {
      expect(screen.getByTestId('onboarding-backdrop')).toBeInTheDocument();
    });
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('onboarding-backdrop')).not.toBeInTheDocument();
    });
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe('true');
  });

  it('clicking the skip link also closes the tour and persists', async () => {
    await act(async () => { render(<App />); });
    await waitFor(() => {
      expect(screen.getByTestId('onboarding-backdrop')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('onboarding-skip'));
    await waitFor(() => {
      expect(screen.queryByTestId('onboarding-backdrop')).not.toBeInTheDocument();
    });
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe('true');
  });

  it('settings panel exposes a "Restart tour" button that re-opens the tour', async () => {
    await act(async () => { render(<App />); });
    await waitFor(() => screen.getByTestId('onboarding-backdrop'));
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('onboarding-backdrop')).not.toBeInTheDocument();
    });
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe('true');

    fireEvent.click(screen.getByTitle('设置'));
    await waitFor(() => {
      expect(screen.getByTestId('restart-tour-button')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('restart-tour-button'));

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-backdrop')).toBeInTheDocument();
    }, { timeout: 10_000 });
    expect(screen.getByText('这是阿狸的房间')).toBeInTheDocument();
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBeNull();
  });
});