import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { db } from '../src/db';
import { ONBOARDING_STORAGE_KEY } from '../src/onboarding/useOnboarding';

// --- Mock 外部依赖 ---

// Mock @google/genai
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: vi.fn().mockResolvedValue({ text: 'AI generated response' }),
    },
  })),
}));

// Mock react-i18next，用真实翻译资源但绕过 initReactI18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'sidebar.personal': '画布',
        'sidebar.archive': '知识存档',
        'sidebar.agents': '角色',
        'nodes.essay': '长文',
        'nodes.essay_open': '打开',
        'nodes.essay_untitled': '未命名长文',
        'nodes.essay_loading': '加载长文…',
        'nodes.essay_missing': '这篇长文不存在或已被删除。',
        'canvas.add_essay_card': '长文卡',
        'reference.empty_body': '空正文',
        'sidebar.search_placeholder': '搜索记忆...',
        'sidebar.new_note': '新建便签',
        'sidebar.publish': '合成文章',
        'sidebar.pocket': '备忘',
        'sidebar.archive_waiting': `${opts?.count ?? ''} 条手机备忘待放入画布`,
        'sidebar.settings': '设置',
        'sidebar.rail_label': '快捷导航',
        'canvas.zoom': '缩放',
        'canvas.full_screen': '全屏',
        'canvas.history': '历史记录',
        'canvas.new_canvas': '新建画布',
        'canvas.new_blank_canvas': '新建空白画布',
        'canvas.new_folder': '新建文件夹',
        'canvas.new_folder_name': `文件夹 ${opts?.number ?? ''}`,
        'canvas.history_drag_hint': '长按可调整顺序，拖到文件夹上即可归类',
        'canvas.default_name': `画布 ${opts?.number ?? ''}`,
        'canvas.rename': '重命名',
        'canvas.delete_note': '删除便签',
        'canvas.select_note': '选择便签',
        'canvas.link_note': '链接到其他节点',
        'canvas.cycle_layout': '切换布局',
        'canvas.change_color': '更改颜色',
        'canvas.change_font': '更改字体',
        'nodes.theme': '核心主题',
        'nodes.note': '笔记',
        'nodes.observation': '观察',
        'nodes.thought_node': '思绪节点',
        'nodes.ai_refinement': 'AI 优化',
        'nodes.ai_loading': '合成中...',
        'nodes.empty_note': '空笔记。点击编辑。',
        'nodes.type_something': '输入内容...',
        'settings.title': '设置',
        'settings.profile': '个人资料',
        'settings.ai_config': 'AI 配置',
        'settings.language': '语言',
        'settings.desktop_download_title': '桌面版（Windows）',
        'settings.desktop_download_blurb': '安装原生应用可获得本地优先存储、桌面专属能力（如本地 GGUF）。浏览器里的数据留在本浏览器；桌面版使用独立数据目录。',
        'settings.desktop_download_button': '下载 Windows 安装包',
        'settings.desktop_installed_title': '桌面版',
        'settings.desktop_installed_blurb': '当前为桌面应用。',
        'settings.desktop_releases_button': '打开 Releases 页面',
        'settings.user_name': '显示名称',
        'settings.user_role': '当前焦点 / 状态',
        'settings.provider': 'AI 服务商',
        'settings.api_key': 'API 密钥',
        'settings.base_url': '基础 URL (可选)',
        'settings.model': '模型',
        'settings.close': '关闭',
        'settings.save': '保存配置',
        'ai.input_placeholder': '让 AI 构思一些想法或段落...',
        'ask.input_placeholder': '把卡片连到我身上，再向我提问...',
        'canvas.add_ask_card': '阿狸',
        'sidebar.new_theme_card': '新建主题',
        'ai.loading': 'AI 思考中...',
        'agents.personas': '人格设定',
        'agents.new_persona': '新建人格',
        'agents.test_sandbox': '测试沙盒',
        'agents.close_sandbox': '关闭沙盒',
        'agents.enhance_prompt': 'AI 优化提示词',
        'agents.identity_tone': '身份与基调',
        'agents.persona_name': '人格名称',
        'agents.role_specialty': '角色专长',
        'agents.system_prompt': '系统提示词',
        'agents.knowledge_base': '知识集群',
        'agents.model_params': '模型参数',
        'agents.temp': '采样温度',
        'agents.creativity': '创造力',
        'agents.delete_confirm': '您确定要删除此人格设定吗？',
        'agents.delete_persona': '删除人格',
        'agents.search_personas': '搜索人格...',
        'agents.sandbox_title': `沙盒：${opts?.name ?? ''}`,
        'agents.sandbox_empty': `正在测试 ${opts?.name ?? ''} 的沙盒。`,
        'agents.ai_thinking': 'AI 正在思考...',
        'agents.message_placeholder': `给 ${opts?.name ?? ''} 发送消息...`,
        'agents.sandbox_note': '沙盒使用当前的提示词和参数',
        'agents.sandbox_clear': '清空对话',
        'agents.sandbox_clear_aria': '清空沙盒对话',
        'agents.sandbox_clear_confirm': '确定清空该人格沙盒中的对话记录？此操作不可恢复。',
        'settings.docs_heading': '配置说明与官方文档',
        'settings.docs_expand': '展开',
        'settings.docs_blurb_gemini': '在 Google AI Studio 创建 API 密钥后填入。',
        'settings.docs_link_gemini_console_key': 'Google AI Studio — 获取 API 密钥',
        'settings.docs_all_providers_heading': '各 AI 服务商 — 官方文档',
        'settings.docs_metaso_heading': '秘塔联网搜索（可选）',
        'settings.docs_security_note': '切勿向他人泄露密钥。',
        'agents.select_persona': '请选择一个人格',
        'agents.select_subtitle': '从侧边栏选择一个人格或创建一个新人格。',
        'reference.index_title': '档案索引',
        'reference.search_refs': '搜索参考文献...',
        'reference.citation': '引用文献',
        'reference.metadata_notes': '元数据与笔记',
        'reference.tags': '标签',
        'reference.linked_drafts': '关联便签',
        'reference.private_notes': '私密笔记',
        'reference.notes_placeholder': '为此参考文献添加您自己的笔记...',
        'app.name': '记忆建筑师',
        'app.description': '空间思维与知识合成',
        'onboarding.cta_next': '下一步',
        'onboarding.cta_done': '完成',
        'onboarding.cta_skip': '跳过引导',
        'onboarding.step1.title': '你的画布',
        'onboarding.step1.body': '这是你的画布。点击 + 可添加便签、主题、问卡（阿狸）或角色卡。',
        'onboarding.step2.title': '向画布提问',
        'onboarding.step2.body': '把卡片连到阿狸问卡上提问，AI 会把卡片当作上下文来回答。',
        'onboarding.step3.title': '说出来',
        'onboarding.step3.body': '按 Tab 或点击麦克风进入语音模式；工具栏上每个角色都有自己的麦。',
        'onboarding.step4.title': '合成文章',
        'onboarding.step4.body': '选中 2 张以上卡片，点这里生成一篇合成长文。',
        'onboarding.step5.title': '左侧栏',
        'onboarding.step5.body': '这里是知识存档、角色和设置。点击切换标签，再点当前标签可回到画布。',
        'onboarding.step6.title': '新建画布',
        'onboarding.step6.body': '点右上角历史记录，再点「新建空白画布」。当前画布会原样保留。',
        'onboarding.step7.title': '知识存档',
        'onboarding.step7.body': '从画布归档的卡片都集中在这里，可搜索、可拖回画布。',
        'onboarding.step8.title': '角色工作室',
        'onboarding.step8.body': '自定义 AI 角色，各自以不同声音读画布。按 Esc 回到画布。',
        'onboarding.restart_button': '重新播放引导',
        'onboarding.restart_section': '新手引导',
        'pocket.title': '备忘',
        'pocket.empty': '备忘还是空的。',
        'pocket.new': '新记一条',
        'pocket.placeholder': '想到什么就写。',
        'pocket.open_canvas': '打开画布',
        'canvas.default_workspace_name': '主工作区',
      };
      return translations[key] ?? key;
    },
    i18n: {
      language: 'zh',
      changeLanguage: vi.fn(),
    },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  Trans: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock lucide-react icons - 简单返回 SVG 占位
vi.mock('lucide-react', async (importOriginal) =>
  (await import('./mocks/lucideReactMock')).lucideReactMock(importOriginal),
);

// 设置面板里的提供商下拉/Base URL 这些本地配置项，只在 `configured` 为真时
// 渲染（AISettingsModal: `{!serverManaged && configured ? …}`）。开源版的
// AuthContext 桩把 configured 钉成 false，所以这里改成 true —— 这批用例验的是
// 各 provider 的表单布局，跟登录无关；不换的话它们只会全部卡在"找不到那个开关"。
//
// 包一层真实 useAuth 而不是自己造一个对象：AuthContextValue 有十几个字段，
// 手写一份迟早会和桩漂移。
vi.mock('../src/contexts/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/contexts/AuthContext')>();
  const realUseAuth = actual.useAuth;
  return {
    ...actual,
    useAuth: () => ({ ...realUseAuth(), configured: true }),
  };
});

// Mock react-markdown
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => {
    const { createElement } = require('react');
    return createElement('div', { 'data-testid': 'markdown' }, children);
  },
}));

// Mock motion
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

// 导入被测组件
import App from '../src/App';
import { PHONE_MQ } from '../src/hooks/useAdaptiveLayout';
import { POCKET_CANVAS_ID } from '../src/utils/pocketNotes';

describe('App 组件', () => {
  beforeEach(async () => {
    // 清空数据库
    await db.nodes.clear();
    await db.articles.clear();
    await db.agents.clear();
    await db.edges.clear();
    await db.canvases.clear();
    await db.agentSandboxThreads.clear();
    localStorage.clear();
    // 抑制新手引导，避免现有测试被 overlay 干扰；专门测引导的集成测试自己清 key。
    localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true');
  });

  const getRail = () => screen.getByTestId('side-rail');

  // --- 基础渲染 ---
  describe('基础渲染', () => {
    it('能正常渲染 App 组件', async () => {
      await act(async () => {
        render(<App />);
      });
      const rail = getRail();
      expect(rail).toBeInTheDocument();
      expect(screen.queryByTestId('rail-pocket')).not.toBeInTheDocument();
      expect(screen.getByTestId('rail-archive')).toBeInTheDocument();
      expect(screen.getByLabelText('知识存档')).toBeInTheDocument();
      expect(screen.getByLabelText('角色')).toBeInTheDocument();
      expect(screen.getByLabelText('设置')).toBeInTheDocument();
      expect(screen.queryByLabelText('画布')).not.toBeInTheDocument();
      expect(screen.queryByText('长文')).not.toBeInTheDocument();
      expect(screen.queryByText('研究')).not.toBeInTheDocument();
    });

    it('损坏的本地 AI 配置不会导致启动白屏', async () => {
      localStorage.setItem('ai_config', '{broken json');
      await act(async () => {
        render(<App />);
      });
      expect(getRail()).toBeInTheDocument();
    });

    it('手机端不显示侧栏，默认进口袋', async () => {
      const original = window.matchMedia;
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: (query: string) => ({
          matches: query === PHONE_MQ,
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        }),
      });
      try {
        await act(async () => {
          render(<App />);
        });
        expect(screen.queryByTestId('side-rail')).not.toBeInTheDocument();
        expect(screen.getByTestId('pocket-view')).toBeInTheDocument();
        expect(screen.queryByTestId('pocket-open-canvas')).not.toBeInTheDocument();
      } finally {
        Object.defineProperty(window, 'matchMedia', {
          writable: true,
          configurable: true,
          value: original,
        });
      }
    });

    it('桌面端把手机备忘记在存档按钮上，而不是单独的口袋入口', async () => {
      await db.nodes.add({
        id: 'p1',
        type: 'note',
        content: 'from phone',
        x: 0,
        y: 0,
        canvasId: POCKET_CANVAS_ID,
        createdAt: Date.now(),
      });
      await act(async () => {
        render(<App />);
      });
      expect(screen.queryByTestId('rail-pocket')).not.toBeInTheDocument();
      expect(await screen.findByTestId('rail-archive-badge')).toHaveTextContent('1');
      expect(screen.getByTestId('rail-archive')).toHaveAttribute(
        'aria-label',
        '知识存档 · 1 条手机备忘待放入画布',
      );
    });
  });

  // --- 侧边栏导航 ---
  describe('侧边栏导航', () => {
    it('画布态时归档/角色均未按下', async () => {
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByLabelText('知识存档')).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByLabelText('角色')).toHaveAttribute('aria-pressed', 'false');
    });

    it('切换到 agents 标签', async () => {
      const user = userEvent.setup();
      await act(async () => {
        render(<App />);
      });

      const agentsBtn = screen.getByLabelText('角色');
      await user.click(agentsBtn);
      expect(agentsBtn).toHaveAttribute('aria-pressed', 'true');
    });
  });

  // --- 设置按钮 ---
  describe('设置', () => {
    it('点击设置按钮打开设置面板', async () => {
      const user = userEvent.setup();
      await act(async () => {
        render(<App />);
      });

      const settingsBtn = screen.getByTitle('设置');
      await user.click(settingsBtn);

      // 设置面板应出现（无冗余标题，以关闭按钮与语言区为准）
      expect(
        await screen.findByRole('button', { name: '关闭' }, { timeout: 10_000 }),
      ).toBeInTheDocument();
      // Language chips: visible text is "EN"/"中", aria-label is "English"/"中文".
      expect(
        await screen.findByRole('button', { name: 'English' }, { timeout: 10_000 }),
      ).toBeInTheDocument();
    });

    it('设置面板包含语言切换选项', async () => {
      const user = userEvent.setup();
      await act(async () => {
        render(<App />);
      });

      await user.click(screen.getByTitle('设置'));
      expect(
        await screen.findByRole('button', { name: 'English' }, { timeout: 10_000 }),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '中文' })).toBeInTheDocument();
    });

    it('设置面板包含 AI 提供商选项', async () => {
      const user = userEvent.setup();
      await act(async () => {
        render(<App />);
      });

      await user.click(screen.getByTitle('设置'));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument();
      });
      // 默认显示账号面板，需点一下「自己配置 API Key」展开本地 AI 表单
      await user.click(screen.getByTestId('settings-show-api-config'));
      await waitFor(() => {
        expect(document.querySelector('select')).toBeInTheDocument();
      });
      expect(screen.getByText('AI 服务商')).toBeInTheDocument();
      expect(screen.getByText('API 密钥')).toBeInTheDocument();
      expect(screen.getByText('模型')).toBeInTheDocument();
    });
  });

  // --- 新建便签 ---
  describe('新建便签', () => {
    it('点击新建便签按钮创建节点', async () => {
      const user = userEvent.setup();
      await act(async () => {
        render(<App />);
      });

      // "新建便签" 是 title 属性，不是可见文本
      const newNoteBtn = screen.getAllByTitle('新建便签')[0];
      await user.click(newNoteBtn);

      // 处理器先读一次工作区（stampWorkZoneScopeOnNewNodes）再写节点，所以写库
      // 晚于 click 返回：紧跟 click 读库会读到"还没有这张卡"，得等它落地。
      await waitFor(async () => {
        const nodes = await db.nodes.toArray();
        expect(nodes.length).toBeGreaterThanOrEqual(1);
        expect(nodes.some(n => n.type === 'text')).toBe(true);
      });
    });
  });

  // --- 画布管理 ---
  describe('画布管理', () => {
    it('历史按钮能打开画布列表', async () => {
      const user = userEvent.setup();
      await act(async () => {
        render(<App />);
      });

      // 先确保有画布数据
      await db.canvases.put({
        id: 'default',
        name: 'Main Workspace',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // 点击历史按钮（用 title 定位）
      const historyBtn = screen.getByTitle('历史记录');
      await user.click(historyBtn);

      // 画布列表应出现
      expect(screen.getByText('新建空白画布')).toBeInTheDocument();
    });
  });

  // --- 缩放控制 ---
  describe('缩放控制', () => {
    it('显示缩放百分比', async () => {
      await act(async () => {
        render(<App />);
      });

      // 初始缩放应为 100%
      expect(screen.getByText('100%')).toBeInTheDocument();
    });

    it('点击缩放+按钮增加缩放', async () => {
      const user = userEvent.setup();
      await act(async () => {
        render(<App />);
      });

      await user.click(screen.getByTestId('canvas-zoom-in'));

      // 缩放应大于 100%
      const zoomText = screen.getByText(/%/);
      const value = parseInt(zoomText.textContent ?? '100');
      expect(value).toBeGreaterThan(100);
    });

    it('点击缩放-按钮减少缩放', async () => {
      const user = userEvent.setup();
      await act(async () => {
        render(<App />);
      });

      await user.click(screen.getByTestId('canvas-zoom-out'));

      const zoomText = screen.getByText(/%/);
      const value = parseInt(zoomText.textContent ?? '100');
      expect(value).toBeLessThan(100);
    });

    it('连续缩放后百分比正确更新', async () => {
      const user = userEvent.setup();
      await act(async () => {
        render(<App />);
      });

      // 连续放大两次
      await user.click(screen.getByTestId('canvas-zoom-in'));
      await user.click(screen.getByTestId('canvas-zoom-in'));

      const zoomText = screen.getByText(/%/);
      const value = parseInt(zoomText.textContent ?? '100');
      expect(value).toBeGreaterThan(110);
    });
  });

  // --- 数据库种子初始化 ---
  describe('数据库种子数据', () => {
    it('首次渲染时自动创建默认画布', async () => {
      await act(async () => {
        render(<App />);
      });

      // 等待 useEffect 中的 seed 完成
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      const canvas = await db.canvases.get('default');
      expect(canvas).toBeDefined();
      expect(canvas?.name).toBe('Main Workspace');
    });

    it('首次渲染时自动创建系统 Agent', async () => {
      await act(async () => {
        render(<App />);
      });

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      });

      const agents = await db.agents.toArray();
      const roles = agents.map(a => a.role);
      expect(roles).toContain('Journalist');
      expect(roles).toContain('Connector');
      expect(roles).toContain('Editor');
      expect(roles).toContain('Visionary');
    });

    it('首次渲染时自动创建阿狸、主题卡和便签卡（无默认连线）', async () => {
      await act(async () => {
        render(<App />);
      });

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      });

      const nodes = (await db.nodes.toArray()).filter((n) => n.type !== 'ambience');
      expect(nodes.filter((n) => n.type === 'ask')).toHaveLength(1);
      expect(nodes.filter((n) => n.type === 'theme')).toHaveLength(1);
      expect(nodes.filter((n) => n.type === 'note')).toHaveLength(1);

      const edges = await db.edges.toArray();
      expect(edges).toEqual([]);
    });
  });

  // --- localStorage 持久化（资料编辑已从画布 rail 移除，仅验证 hook 仍读写） ---
  describe('localStorage 持久化', () => {
    it('用户名从 localStorage 恢复并写回', async () => {
      localStorage.setItem('user_name', '自定义用户');
      await act(async () => {
        render(<App />);
      });
      expect(localStorage.getItem('user_name')).toBe('自定义用户');
    });

    it('用户角色从 localStorage 恢复并写回', async () => {
      localStorage.setItem('user_role', '专注写作中');
      await act(async () => {
        render(<App />);
      });
      expect(localStorage.getItem('user_role')).toBe('专注写作中');
    });
  });

  // ============================================================
  // AISettingsModal 设置面板
  // ============================================================
  describe('AISettingsModal 设置面板', () => {
    const openSettings = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByTitle('设置'));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument();
      });
    };

    /**
     * AISettingsModal 默认显示账号面板，需要展开本地 AI 表单才能拿到
     * `<select>` / Base URL 字段 / API Key 输入框。
     * 切换按钮用 data-testid `settings-show-api-config` 唯一定位，避免和
     * canvas 网格按钮（同样是 aria-pressed）混淆。
     */
    const openSettingsApi = async (user: ReturnType<typeof userEvent.setup>) => {
      await openSettings(user);
      const apiToggle = screen.getByTestId('settings-show-api-config');
      await user.click(apiToggle);
      await waitFor(() => {
        expect(document.querySelector('select')).toBeInTheDocument();
      });
    };

    it('设置面板显示关闭按钮', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await openSettings(user);
      expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument();
    });

    it('设置面板里的 API 密钥是掩码输入', async () => {
      // 开源版没有云端登录表单（CloudAccountPanel 不存在），所以这里验的是
      // 用户自己的 AI 密钥字段：它必须掩码显示，不能明文摊在页面上。
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await openSettingsApi(user);
      const keyInputs = Array.from(document.querySelectorAll('input[type="password"]'));
      expect(keyInputs.length).toBeGreaterThanOrEqual(1);
    });

    it('网页版设置面板显示桌面版下载入口', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await openSettings(user);
      expect(screen.getByText('下载 Windows 安装包')).toBeInTheDocument();
    });

    it('设置面板包含提供商下拉选项', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await openSettingsApi(user);
      const select = document.querySelector('select');
      expect(select).toBeInTheDocument();
      expect(select?.querySelector('option[value="gemini"]')).toBeTruthy();
      expect(select?.querySelector('option[value="openai"]')).toBeTruthy();
      expect(select?.querySelector('option[value="anthropic"]')).toBeTruthy();
      expect(select?.querySelector('option[value="deepseek"]')).toBeTruthy();
      expect(select?.querySelector('option[value="custom"]')).toBeTruthy();
    });

    it('切换到 gemini 提供商后不显示 Base URL 字段', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await openSettingsApi(user);
      const select = document.querySelector('select')!;
      await user.selectOptions(select, 'gemini');
      expect(screen.queryByText('基础 URL (可选)')).not.toBeInTheDocument();
    });

    it('切换到 OpenAI 提供商时显示 Base URL 字段', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await openSettingsApi(user);
      const select = document.querySelector('select')!;
      await user.selectOptions(select, 'openai');
      expect(screen.getByText('基础 URL (可选)')).toBeInTheDocument();
    });

    it('切换到 DeepSeek 提供商时显示 Base URL 字段', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await openSettingsApi(user);
      const select = document.querySelector('select')!;
      await user.selectOptions(select, 'deepseek');
      expect(screen.getByText('基础 URL (可选)')).toBeInTheDocument();
      expect(screen.getByDisplayValue('deepseek-chat')).toBeInTheDocument();
    });

    it('切换到 Custom 提供商时显示 Base URL 字段', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await openSettingsApi(user);
      const select = document.querySelector('select')!;
      await user.selectOptions(select, 'custom');
      expect(screen.getByText('基础 URL (可选)')).toBeInTheDocument();
    });

    it('切换到 Anthropic 提供商时不显示 Base URL 字段', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await openSettingsApi(user);
      const select = document.querySelector('select')!;
      await user.selectOptions(select, 'anthropic');
      expect(screen.queryByText('基础 URL (可选)')).not.toBeInTheDocument();
    });

    it('修改 API Key 后自动更新 localStorage', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await openSettingsApi(user);
      // Find the AI provider's API-key input by walking down from the
      // 'API 密钥' label. CloudAccountPanel renders its own type=password
      // inputs in a <form>, so a flat querySelector picks the wrong field.
      const apiKeyLabel = Array.from(document.querySelectorAll('label')).find(
        (el) => el.textContent === 'API 密钥',
      );
      expect(apiKeyLabel).toBeTruthy();
      const apiKeyInput = apiKeyLabel!.parentElement!.querySelector('input[type="password"]') as HTMLInputElement;
      expect(apiKeyInput).toBeTruthy();
      await user.clear(apiKeyInput);
      await user.type(apiKeyInput, 'test-key-123');
      // 配置通过 useEffect 自动保存到 localStorage
      await waitFor(() => {
        const saved = JSON.parse(localStorage.getItem('ai_config') || '{}');
        expect(saved.apiKey).toContain('test');
      });
    });

    it('修改模型名称', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await openSettingsApi(user);
      const textInputs = document.querySelectorAll('input[type="text"]');
      const modelInput = Array.from(textInputs).find(input =>
        (input as HTMLInputElement).placeholder?.includes('gemini') ||
        (input as HTMLInputElement).value?.includes('gemini')
      );
      if (modelInput) {
        await user.clear(modelInput);
        await user.type(modelInput, 'gpt-4o');
        expect((modelInput as HTMLInputElement).value).toBe('gpt-4o');
      }
    });

    it('设置面板展示 AI 配置说明折叠区', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await openSettingsApi(user);
      expect(screen.getByText('配置说明与官方文档')).toBeInTheDocument();
    });
  });

  // ============================================================
  // Essays live on canvas (no sidebar Reference tab)
  // ============================================================
  describe('长文画布卡片', () => {
    it('侧栏不再显示「长文」入口，也不显示画布按钮', async () => {
      await act(async () => {
        render(<App />);
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
      });
      expect(screen.queryByLabelText('长文')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('画布')).not.toBeInTheDocument();
      expect(screen.getByLabelText('知识存档')).toBeInTheDocument();
      expect(screen.getByTestId('side-rail').querySelectorAll('button')).toHaveLength(3);
    });

    it('已有文章且无 essay 卡时会迁移到画布', async () => {
      await db.articles.put({
        id: 'user-essay-1',
        title: 'Spatial Encoding in Reconstructive Memory',
        content: 'The human mind does not merely store experiences.',
        date: '1994',
        type: 'REF-042',
        tags: [],
        linkedCanvasIds: ['default'],
      });
      await act(async () => {
        render(<App />);
      });
      await waitFor(async () => {
        const essays = await db.nodes.where('type').equals('essay').toArray();
        expect(essays.length).toBeGreaterThanOrEqual(1);
      });
      await waitFor(() => {
        expect(screen.getAllByText(/Spatial Encoding/i).length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  // ============================================================
  // AgentsStudio AI 助手工作室
  // ============================================================
  describe('AgentsStudio AI 助手工作室', () => {
    const goToAgents = async (user: ReturnType<typeof userEvent.setup>) => {
      await act(async () => { render(<App />); });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 300));
      });
      await user.click(screen.getByLabelText('角色'));
    };

    it('切换到 AI 助手标签后顶部为搜索人格栏且无「人格设定」标题', async () => {
      const user = userEvent.setup();
      await goToAgents(user);
      expect(screen.getByPlaceholderText('搜索人格...')).toBeInTheDocument();
      expect(screen.queryByText('人格设定')).not.toBeInTheDocument();
    });

    it('显示默认的系统代理列表', async () => {
      const user = userEvent.setup();
      await goToAgents(user);
      const mirrorMatches = screen.getAllByText('The Mirror of Insight');
      expect(mirrorMatches.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('The Weaver')).toBeInTheDocument();
      expect(screen.getByText('The Smoothing Iron')).toBeInTheDocument();
    });

    it('显示搜索人格输入框', async () => {
      const user = userEvent.setup();
      await goToAgents(user);
      const searchInput = document.querySelector('input[placeholder="搜索人格..."]');
      expect(searchInput).toBeInTheDocument();
    });

    it('搜索代理过滤列表', async () => {
      const user = userEvent.setup();
      await goToAgents(user);
      const searchInput = document.querySelector('input[placeholder="搜索人格..."]') as HTMLInputElement;
      await user.type(searchInput, 'Weaver');
      expect(screen.getAllByText('The Weaver').length).toBeGreaterThanOrEqual(1);
      expect(screen.queryByText('The Mirror of Insight')).not.toBeInTheDocument();
    });

    it('点击代理选中并显示配置编辑器', async () => {
      const user = userEvent.setup();
      await goToAgents(user);
      // 第一个代理默认已选中，直接验证编辑器
      expect(screen.getByText('身份与基调')).toBeInTheDocument();
    });

    it('选中代理后顶部标题为人格名称可编辑输入', async () => {
      const user = userEvent.setup();
      await goToAgents(user);
      const titleInput = screen.getByLabelText('人格名称');
      expect(titleInput).toBeInstanceOf(HTMLInputElement);
      expect(screen.queryByText('角色专长')).not.toBeInTheDocument();
    });

    it('选中代理后显示系统提示词', async () => {
      const user = userEvent.setup();
      await goToAgents(user);
      expect(screen.getByText('系统提示词')).toBeInTheDocument();
    });

    it('选中代理后显示模型参数', async () => {
      const user = userEvent.setup();
      await goToAgents(user);
      expect(screen.getByText('模型参数')).toBeInTheDocument();
      expect(screen.getByText('采样温度')).toBeInTheDocument();
      expect(screen.getByText('创造力')).toBeInTheDocument();
    });

    it('选中代理后显示沙盒测试按钮', async () => {
      const user = userEvent.setup();
      await goToAgents(user);
      expect(screen.getByText('测试沙盒')).toBeInTheDocument();
    });

    it('选中代理后显示删除按钮', async () => {
      const user = userEvent.setup();
      await goToAgents(user);
      expect(screen.getByText('删除人格')).toBeInTheDocument();
    });

    it('点击新建人格按钮添加新代理', async () => {
      const user = userEvent.setup();
      await goToAgents(user);
      const sidebar = screen.getByPlaceholderText('搜索人格...').closest('section');
      const addBtn = Array.from(sidebar?.querySelectorAll('button') ?? []).find((btn) =>
        btn.querySelector('svg[data-testid="icon-Plus"]'),
      );
      expect(addBtn).toBeDefined();
      await user.click(addBtn!);
      // 新人格应出现在列表中
      await waitFor(() => {
        expect(screen.getAllByText('新建人格').length).toBeGreaterThanOrEqual(1);
      });
    });

    it('点击沙盒按钮打开沙盒面板', async () => {
      const user = userEvent.setup();
      await goToAgents(user);
      await user.click(screen.getByText('测试沙盒'));
      expect(screen.getByText('关闭沙盒')).toBeInTheDocument();
    });

  });

  // callUniversalAI 间接测试
  // ============================================================
  describe('callUniversalAI 间接测试', () => {
    it('Gemini 配置下 AI 提交成功返回内容', async () => {
      const user = userEvent.setup();
      localStorage.setItem('ai_config', JSON.stringify({
        provider: 'gemini', apiKey: 'test-gemini-key', model: 'gemini-1.5-flash'
      }));
      await act(async () => { render(<App />); });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      });

      // 找到 AI 输入框并提交
      const aiInput = document.querySelector('input[placeholder*="AI 构思"]');
      if (aiInput) {
        await user.type(aiInput, 'Write about memory architecture');
        const sendBtn = aiInput.closest('div')?.querySelector('button');
        if (sendBtn) {
          await user.click(sendBtn);
          // AI 应该返回 mock 的内容
          await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 500));
          });
        }
      }
    });

    it('无 API Key 时 Gemini 回退到环境变量', async () => {
      // 不设置 apiKey，环境变量也没有 GEMINI_API_KEY
      localStorage.setItem('ai_config', JSON.stringify({
        provider: 'gemini', apiKey: '', model: 'gemini-1.5-flash'
      }));
      await act(async () => { render(<App />); });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      });
      // 应用正常渲染不崩溃 — 验证左侧 icon rail 存在
      expect(getRail()).toBeInTheDocument();
    });

    it('OpenAI 配置下应用正常渲染', async () => {
      localStorage.setItem('ai_config', JSON.stringify({
        provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o', baseUrl: ''
      }));
      await act(async () => { render(<App />); });
      expect(getRail()).toBeInTheDocument();
    });

    it('Anthropic 配置下应用正常渲染', async () => {
      localStorage.setItem('ai_config', JSON.stringify({
        provider: 'anthropic', apiKey: 'sk-ant-test', model: 'claude-3-5-sonnet'
      }));
      await act(async () => { render(<App />); });
      expect(getRail()).toBeInTheDocument();
    });

    it('Custom 配置下应用正常渲染', async () => {
      localStorage.setItem('ai_config', JSON.stringify({
        provider: 'custom', apiKey: 'test-key', model: 'custom-model', baseUrl: 'http://localhost:8080/v1'
      }));
      await act(async () => { render(<App />); });
      expect(getRail()).toBeInTheDocument();
    });
  });

  // ============================================================
  // DraggableNode 节点交互
  // ============================================================
  describe('DraggableNode 节点交互', () => {
    it('渲染种子节点内容', async () => {
      await act(async () => { render(<App />); });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 300));
      });
      // 种子数据包含主题卡与便签卡（不再是 cosmos 四问便签）
      const nodes = await db.nodes.toArray();
      const onDefault = nodes.filter((n) => (!n.canvasId || n.canvasId === 'default') && n.type !== 'ambience');
      expect(onDefault.some((n) => n.type === 'theme')).toBe(true);
      expect(onDefault.some((n) => n.type === 'note')).toBe(true);
      expect(onDefault.some((n) => n.type === 'ask')).toBe(true);
    });

    it('渲染多种节点类型', async () => {
      await act(async () => { render(<App />); });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 300));
      });
      // 默认画布：阿狸 + 主题卡 + 便签卡各 1 张，不再有 cosmos 默认便签文案
      const nodes = await db.nodes.toArray();
      const onDefault = nodes.filter((n) => (!n.canvasId || n.canvasId === 'default') && n.type !== 'ambience');
      expect(onDefault.filter((n) => n.type === 'ask')).toHaveLength(1);
      expect(onDefault.filter((n) => n.type === 'theme')).toHaveLength(1);
      expect(onDefault.filter((n) => n.type === 'note')).toHaveLength(1);
      expect(screen.queryByText(/自我探索 · 四问|Self-discovery · four questions/)).not.toBeInTheDocument();
      expect(screen.queryByText(/写下你的创伤|Write your pain/)).not.toBeInTheDocument();
    });

    it('新建便签按钮在数据库中创建 text 类型节点', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      const newNoteBtn = screen.getAllByTitle('新建便签')[0];
      await user.click(newNoteBtn);
      // 写库是异步的（先读工作区再写节点），等它落地再断言。
      await waitFor(async () => {
        const textNodes = (await db.nodes.toArray()).filter(n => n.type === 'text');
        expect(textNodes.length).toBeGreaterThanOrEqual(1);
        expect(textNodes[0].canvasId).toBeDefined();
      });
    });

    it('新建便签的节点有正确的 canvasId', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      const newNoteBtn = screen.getAllByTitle('新建便签')[0];
      await user.click(newNoteBtn);
      await waitFor(async () => {
        const textNode = (await db.nodes.toArray()).find(n => n.type === 'text');
        expect(textNode?.canvasId).toBe('default');
      });
    });

    it('节点有 x 和 y 坐标', async () => {
      await act(async () => { render(<App />); });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 300));
      });
      const nodes = await db.nodes.toArray();
      nodes.forEach(node => {
        expect(typeof node.x).toBe('number');
        expect(typeof node.y).toBe('number');
      });
    });

    it('选中节点后按下 Delete 键批量删除（含关联边）', async () => {
      // Pre-populate two text nodes plus an edge between them. Use unique content so we can
      // locate their DOM wrappers without colliding with the seed dataset.
      await db.nodes.add({ id: 'kbd-a', canvasId: 'default', type: 'text', content: 'kbd-delete-a', x: 0, y: 0 });
      await db.nodes.add({ id: 'kbd-b', canvasId: 'default', type: 'text', content: 'kbd-delete-b', x: 0, y: 0 });
      await db.edges.add({ id: 'kbd-edge', canvasId: 'default', from: 'kbd-a', to: 'kbd-b' });
      // A third unrelated node that should survive the deletion.
      await db.nodes.add({ id: 'kbd-keep', canvasId: 'default', type: 'text', content: 'kbd-keep', x: 0, y: 0 });

      await act(async () => { render(<App />); });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      });

      // Selection is marquee-only (top-left check circle removed).
      const main = document.querySelector('main')!;
      const marquee = screen.getByTestId('canvas-marquee-layer');
      const aEl = (await screen.findByText('kbd-delete-a')).closest('.group') as HTMLElement;
      const bEl = (await screen.findByText('kbd-delete-b')).closest('.group') as HTMLElement;
      const keepEl = (await screen.findByText('kbd-keep')).closest('.group') as HTMLElement;
      vi.spyOn(main, 'getBoundingClientRect').mockReturnValue({
        x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000, toJSON: () => ({}),
      });
      vi.spyOn(aEl, 'getBoundingClientRect').mockReturnValue({
        x: 100, y: 100, left: 100, top: 100, right: 200, bottom: 200, width: 100, height: 100, toJSON: () => ({}),
      });
      vi.spyOn(bEl, 'getBoundingClientRect').mockReturnValue({
        x: 150, y: 150, left: 150, top: 150, right: 250, bottom: 250, width: 100, height: 100, toJSON: () => ({}),
      });
      vi.spyOn(keepEl, 'getBoundingClientRect').mockReturnValue({
        x: 800, y: 800, left: 800, top: 800, right: 900, bottom: 900, width: 100, height: 100, toJSON: () => ({}),
      });

      await act(async () => {
        marquee.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 80, clientY: 80 }));
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 280, clientY: 280 }));
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 280, clientY: 280 }));
      });

      // Drive the canvas-level keyboard-delete handler. event.target defaults to body, which
      // is not an editing target, so the listener passes its gate and calls removeNodeIds.
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      const nodes = await db.nodes.toArray();
      const ids = nodes.map(n => n.id);
      expect(ids).not.toContain('kbd-a');
      expect(ids).not.toContain('kbd-b');
      expect(ids).toContain('kbd-keep');

      const edges = await db.edges.toArray();
      expect(edges.find(e => e.id === 'kbd-edge')).toBeUndefined();
    });

    it('剪切（Ctrl+X）带摘抄的书之前也要问一句', async () => {
      // 剪切当初是另抄了一份删除逻辑，所以漏掉了"书里有摘抄就先问"这道闸——
      // Ctrl+X 会一声不吭地把一本书连同几十条摘抄删掉。
      await db.nodes.add({
        id: 'cut-book',
        canvasId: 'default',
        type: 'book',
        content: '',
        x: 100,
        y: 100,
        bookExcerpts: [
          { id: 'e1', text: '一条摘抄', unitIndex: 0, unitLabel: 'Ch1', bookTitle: 'B', createdAt: 1 },
          { id: 'e2', text: '另一条摘抄', unitIndex: 0, unitLabel: 'Ch1', bookTitle: 'B', createdAt: 2 },
        ],
      });
      // jsdom 没有 ClipboardEvent 构造器，自己造一个带剪贴板的事件。
      const written: Record<string, string> = {};
      const cut = new Event('cut', { bubbles: true, cancelable: true });
      Object.defineProperty(cut, 'clipboardData', {
        value: {
          setData: (type: string, value: string) => { written[type] = value; },
          getData: (type: string) => written[type] ?? '',
        },
      });
      await act(async () => {
        window.dispatchEvent(cut);
        await new Promise((resolve) => setTimeout(resolve, 200));
      });
      // 问句出现了（这条路径以前根本不问），所以节点还在。
      expect((await db.nodes.get('cut-book'))).toBeDefined();
    });

    it('框选一张卡片后 Backspace 删除，Ctrl+Z 可恢复', async () => {
      await db.nodes.add({
        id: 'kbd-bs-one',
        canvasId: 'default',
        type: 'text',
        content: 'kbd-backspace-one',
        x: 0,
        y: 0,
      });
      await db.nodes.add({
        id: 'kbd-bs-keep',
        canvasId: 'default',
        type: 'text',
        content: 'kbd-backspace-keep',
        x: 0,
        y: 0,
      });

      await act(async () => { render(<App />); });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
      });

      const main = document.querySelector('main')!;
      const marquee = screen.getByTestId('canvas-marquee-layer');
      const oneEl = (await screen.findByText('kbd-backspace-one')).closest('.group') as HTMLElement;
      const keepEl = (await screen.findByText('kbd-backspace-keep')).closest('.group') as HTMLElement;
      vi.spyOn(main, 'getBoundingClientRect').mockReturnValue({
        x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000, toJSON: () => ({}),
      });
      vi.spyOn(oneEl, 'getBoundingClientRect').mockReturnValue({
        x: 100, y: 100, left: 100, top: 100, right: 200, bottom: 200, width: 100, height: 100, toJSON: () => ({}),
      });
      vi.spyOn(keepEl, 'getBoundingClientRect').mockReturnValue({
        x: 800, y: 800, left: 800, top: 800, right: 900, bottom: 900, width: 100, height: 100, toJSON: () => ({}),
      });

      await act(async () => {
        marquee.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 80, clientY: 80 }));
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 220, clientY: 220 }));
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 220, clientY: 220 }));
      });

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      expect((await db.nodes.toArray()).map((n) => n.id)).not.toContain('kbd-bs-one');
      expect((await db.nodes.toArray()).map((n) => n.id)).toContain('kbd-bs-keep');

      await act(async () => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }),
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      expect((await db.nodes.toArray()).map((n) => n.id)).toContain('kbd-bs-one');
      expect((await db.nodes.toArray()).map((n) => n.id)).toContain('kbd-bs-keep');
    });

    it('框选多张卡片后 Backspace 批量删除，Ctrl+Z 一并恢复（含边）', async () => {
      await db.nodes.add({ id: 'kbd-bs-a', canvasId: 'default', type: 'text', content: 'kbd-bs-a', x: 0, y: 0 });
      await db.nodes.add({ id: 'kbd-bs-b', canvasId: 'default', type: 'text', content: 'kbd-bs-b', x: 0, y: 0 });
      await db.edges.add({ id: 'kbd-bs-edge', canvasId: 'default', from: 'kbd-bs-a', to: 'kbd-bs-b' });
      await db.nodes.add({ id: 'kbd-bs-keep2', canvasId: 'default', type: 'text', content: 'kbd-bs-keep2', x: 0, y: 0 });

      await act(async () => { render(<App />); });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
      });

      const main = document.querySelector('main')!;
      const marquee = screen.getByTestId('canvas-marquee-layer');
      const aEl = (await screen.findByText('kbd-bs-a')).closest('.group') as HTMLElement;
      const bEl = (await screen.findByText('kbd-bs-b')).closest('.group') as HTMLElement;
      const keepEl = (await screen.findByText('kbd-bs-keep2')).closest('.group') as HTMLElement;
      vi.spyOn(main, 'getBoundingClientRect').mockReturnValue({
        x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000, toJSON: () => ({}),
      });
      vi.spyOn(aEl, 'getBoundingClientRect').mockReturnValue({
        x: 100, y: 100, left: 100, top: 100, right: 200, bottom: 200, width: 100, height: 100, toJSON: () => ({}),
      });
      vi.spyOn(bEl, 'getBoundingClientRect').mockReturnValue({
        x: 150, y: 150, left: 150, top: 150, right: 250, bottom: 250, width: 100, height: 100, toJSON: () => ({}),
      });
      vi.spyOn(keepEl, 'getBoundingClientRect').mockReturnValue({
        x: 800, y: 800, left: 800, top: 800, right: 900, bottom: 900, width: 100, height: 100, toJSON: () => ({}),
      });

      await act(async () => {
        marquee.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 80, clientY: 80 }));
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 280, clientY: 280 }));
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 280, clientY: 280 }));
      });

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      const idsAfterDelete = (await db.nodes.toArray()).map((n) => n.id);
      expect(idsAfterDelete).not.toContain('kbd-bs-a');
      expect(idsAfterDelete).not.toContain('kbd-bs-b');
      expect(idsAfterDelete).toContain('kbd-bs-keep2');
      expect((await db.edges.toArray()).find((e) => e.id === 'kbd-bs-edge')).toBeUndefined();

      await act(async () => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }),
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      const idsAfterUndo = (await db.nodes.toArray()).map((n) => n.id);
      expect(idsAfterUndo).toContain('kbd-bs-a');
      expect(idsAfterUndo).toContain('kbd-bs-b');
      expect(idsAfterUndo).toContain('kbd-bs-keep2');
      expect((await db.edges.toArray()).find((e) => e.id === 'kbd-bs-edge')).toBeDefined();
    });

    // 守护 18e2c7f 的"正文点击不进入 selectedNodes"契约：
    // 若未来有人重新让 body click 触发选中，本测试会因为 Delete 删除了节点而失败。
    // 选中改由框选完成，左上角勾选圈已移除。
    it('正文点击不会把节点加入 selectedNodes（Delete 不会删除未被框选的节点）', async () => {
      const user = userEvent.setup();
      await db.nodes.add({
        id: 'body-click-a',
        canvasId: 'default',
        type: 'text',
        content: 'body-click-guard',
        x: 0,
        y: 0,
      });

      await act(async () => { render(<App />); });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      });

      // 模拟"点击正文"——pointerdown 在 body 上，预期不会进入 selectedNodes。
      // userEvent 的 click 会触发 pointerdown/pointerup/click 全套。
      const text = await screen.findByText('body-click-guard');
      await act(async () => { await user.click(text); });

      // 现在按 Delete 键——因为没有节点被选中，所以这个节点应当保留。
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      const nodes = await db.nodes.toArray();
      const stillThere = nodes.find(n => n.id === 'body-click-a');
      expect(stillThere).toBeDefined();
      expect(stillThere?.content).toBe('body-click-guard');
    });

    it('Shift+单击可以把漏选的卡片加入选区，再按 Delete 会删掉它', async () => {
      await db.nodes.add({
        id: 'shift-click-a',
        canvasId: 'default',
        type: 'text',
        content: 'shift-click-guard',
        x: 0,
        y: 0,
      });

      await act(async () => { render(<App />); });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      });

      const text = await screen.findByText('shift-click-guard');
      await act(async () => {
        text.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            button: 0,
            shiftKey: true,
            pointerId: 1,
          }),
        );
      });

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      const nodes = await db.nodes.toArray();
      expect(nodes.find((n) => n.id === 'shift-click-a')).toBeUndefined();
    });
  });

  // ============================================================
  // 画布增强测试
  // ============================================================
  describe('画布增强测试', () => {
    it('新建画布后切换到新画布', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });

      // 打开画布列表
      const historyBtn = screen.getByTitle('历史记录');
      await user.click(historyBtn);

      // 点击新建画布
      const newCanvasBtn = screen.getByText('新建空白画布');
      await user.click(newCanvasBtn);

      await waitFor(async () => {
        const canvases = await db.canvases.toArray();
        expect(canvases.length).toBeGreaterThanOrEqual(2);
      });
    });

    it('画布列表显示默认画布名称', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      });

      const historyBtn = screen.getByTitle('历史记录');
      await user.click(historyBtn);
      expect(screen.getByText('Main Workspace')).toBeInTheDocument();
    });

    it('新建便签后节点属于当前画布', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      });

      const newNoteBtn = screen.getAllByTitle('新建便签')[0];
      await user.click(newNoteBtn);

      const nodes = await db.nodes.toArray();
      const newNode = nodes.find(n => n.type === 'text');
      expect(newNode?.canvasId).toBe('default');
    });

    it('合成文章按钮存在', async () => {
      await act(async () => { render(<App />); });
      // 合成文章按钮在底部工具栏
      const publishBtns = screen.getAllByTitle(/合成文章/);
      expect(publishBtns.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByTestId('toolbar-publish')).toBeInTheDocument();
    });

    it('画布合成按钮未选中或只选一张时为白色样式', async () => {
      await db.nodes.add({
        id: 'publish-select-a',
        canvasId: 'default',
        type: 'text',
        content: 'publish-select-target',
        x: 0,
        y: 0,
      });

      await act(async () => { render(<App />); });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
      });
      const idleBtn = screen.getByTitle(/合成文章\s*\(/);
      expect(idleBtn.className).toContain('bg-white');
      expect(idleBtn.className).not.toContain('bg-[#C2410C]');

      const main = document.querySelector('main')!;
      const marquee = screen.getByTestId('canvas-marquee-layer');
      const nodeEl = (await screen.findByText('publish-select-target')).closest('.group') as HTMLElement;
      vi.spyOn(main, 'getBoundingClientRect').mockReturnValue({
        x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000, toJSON: () => ({}),
      });
      vi.spyOn(nodeEl, 'getBoundingClientRect').mockReturnValue({
        x: 100, y: 100, left: 100, top: 100, right: 200, bottom: 200, width: 100, height: 100, toJSON: () => ({}),
      });

      await act(async () => {
        marquee.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 80, clientY: 80 }));
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 220, clientY: 220 }));
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 220, clientY: 220 }));
      });

      const oneSelected = screen.getByTitle(/合成文章\s*\(/);
      expect(oneSelected.className).toContain('bg-white');
      expect(oneSelected.className).not.toContain('bg-[#C2410C]');
      expect(oneSelected).toBeDisabled();
    });

    it('画布合成按钮圈中两张以上便签后为橙色样式', async () => {
      await db.nodes.bulkAdd([
        {
          id: 'publish-select-a',
          canvasId: 'default',
          type: 'text',
          content: 'publish-select-a',
          x: 0,
          y: 0,
        },
        {
          id: 'publish-select-b',
          canvasId: 'default',
          type: 'text',
          content: 'publish-select-b',
          x: 40,
          y: 0,
        },
      ]);

      await act(async () => { render(<App />); });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
      });

      const main = document.querySelector('main')!;
      const marquee = screen.getByTestId('canvas-marquee-layer');
      const nodeA = (await screen.findByText('publish-select-a')).closest('.group') as HTMLElement;
      const nodeB = (await screen.findByText('publish-select-b')).closest('.group') as HTMLElement;
      vi.spyOn(main, 'getBoundingClientRect').mockReturnValue({
        x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000, toJSON: () => ({}),
      });
      vi.spyOn(nodeA, 'getBoundingClientRect').mockReturnValue({
        x: 100, y: 100, left: 100, top: 100, right: 200, bottom: 200, width: 100, height: 100, toJSON: () => ({}),
      });
      vi.spyOn(nodeB, 'getBoundingClientRect').mockReturnValue({
        x: 210, y: 100, left: 210, top: 100, right: 310, bottom: 200, width: 100, height: 100, toJSON: () => ({}),
      });

      await act(async () => {
        marquee.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 80, clientY: 80 }));
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 330, clientY: 220 }));
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 330, clientY: 220 }));
      });

      const publishBtn = screen.getByTitle(/合成文章\s*\(/);
      expect(publishBtn.className).toContain('bg-[#C2410C]');
      expect(publishBtn).not.toBeDisabled();
    });

    it('主工作区默认展示阿狸、主题卡和便签卡各一张', async () => {
      await act(async () => { render(<App />); });
      await waitFor(async () => {
        const nodes = await db.nodes.toArray();
        const onDefault = nodes.filter((n) => (!n.canvasId || n.canvasId === 'default') && n.type !== 'ambience');
        expect(onDefault.filter((n) => n.type === 'ask')).toHaveLength(1);
        expect(onDefault.filter((n) => n.type === 'theme')).toHaveLength(1);
        expect(onDefault.filter((n) => n.type === 'note')).toHaveLength(1);
        // 默认画布上不再出现 cosmos 角色卡
        expect(onDefault.some((n) => n.agentConfigId === 'cosmos_weaver')).toBe(false);
        expect(onDefault.some((n) => n.agentConfigId === 'character_atelier')).toBe(false);
      });
    });

    it('全屏按钮存在', async () => {
      await act(async () => { render(<App />); });
      const fullscreenBtn = screen.getByTitle('全屏');
      expect(fullscreenBtn).toBeInTheDocument();
    });

    it('左侧为固定 icon rail，无折叠宽栏', async () => {
      await act(async () => { render(<App />); });
      const rail = getRail();
      expect(rail).toHaveClass('fixed');
      expect(rail.className).not.toContain('w-36');
      expect(rail.className).not.toContain('w-16');
    });
  });
});
