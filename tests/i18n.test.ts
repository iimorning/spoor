import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock localStorage for i18n init
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach(k => delete store[k]); },
  get length() { return Object.keys(store).length; },
  key: (index: number) => Object.keys(store)[index] ?? null,
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

import i18n from '../src/i18n';

describe('i18n 国际化模块', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  // --- 初始化 ---
  describe('初始化', () => {
    it('i18n 实例已正确初始化', () => {
      expect(i18n).toBeDefined();
      expect(typeof i18n.t).toBe('function');
    });

    it('支持 en 和 zh 两种语言', () => {
      expect(i18n.hasResourceBundle('en', 'translation')).toBe(true);
      expect(i18n.hasResourceBundle('zh', 'translation')).toBe(true);
    });

    it('初始化后的语言是 en 或 zh', () => {
      expect(['en', 'zh']).toContain(i18n.language);
    });
  });

  // --- 英文翻译完整性 ---
  describe('英文翻译 (en)', () => {
    beforeEach(() => {
      i18n.changeLanguage('en');
    });

    it('app.name 翻译正确', () => {
      expect(i18n.t('app.name')).toBe('The Memory Architect');
    });

    it('sidebar 翻译完整', () => {
      expect(i18n.t('sidebar.personal')).toBe('Canvas');
      expect(i18n.t('sidebar.reference')).toBe('Essays');
      expect(i18n.t('sidebar.archive')).toBe('Knowledge Archive');
      expect(i18n.t('sidebar.agents')).toBe('Agents');
      expect(i18n.t('sidebar.new_note')).toBe('New Note');
      expect(i18n.t('sidebar.new_theme_card')).toBe('New Theme Card');
      expect(i18n.t('sidebar.publish')).toBe('Synthesize');
      expect(i18n.t('sidebar.settings')).toBe('Settings');
    });

    it('canvas 翻译完整', () => {
      expect(i18n.t('canvas.zoom')).toBe('Zoom');
      expect(i18n.t('canvas.new_canvas')).toBe('New Canvas');
      expect(i18n.t('canvas.rename')).toBe('Rename');
      expect(i18n.t('canvas.delete_canvas')).toBe('Delete canvas');
      expect(i18n.t('canvas.delete_canvas_confirm', { name: 'Canvas 4' })).toContain('no local or cloud backup');
      expect(i18n.t('canvas.delete_canvas_last')).toBe('Keep at least one canvas.');
      expect(i18n.t('canvas.delete_note')).toBe('Delete note');
      expect(i18n.t('canvas.cycle_layout')).toBe('Cycle Layout');
    });

    it('nodes 翻译完整', () => {
      expect(i18n.t('nodes.theme')).toBe('Core Theme');
      expect(i18n.t('nodes.new_theme_title')).toBe('Untitled theme');
      expect(i18n.t('nodes.theme_default_description')).toBe(
        'Central research objective for the current workspace.',
      );
      expect(i18n.t('nodes.theme_default_tag')).toBe('Spatial Encoding');
      expect(i18n.t('nodes.note')).toBe('Note');
      expect(i18n.t('nodes.ai_streaming')).toBe('Generating…');
      expect(i18n.t('nodes.ai_thinking_label')).toBe('Thinking');
      expect(i18n.t('nodes.ai_thinking_view')).toBe('View thinking');
      expect(i18n.t('nodes.ai_failed_open_settings')).toBe('Sign in');
      expect(i18n.t('nodes.ai_loading')).toBe('Synthesizing...');
    });

    it('settings 翻译完整', () => {
      expect(i18n.t('settings.title')).toBe('Settings');
      expect(i18n.t('settings.api_key')).toBe('API Key');
      expect(i18n.t('settings.save')).toBe('Save Configuration');
      expect(i18n.t('settings.language')).toBe('Language');
      expect(i18n.t('settings.docs_heading')).toContain('Configuration');
      expect(i18n.t('settings.docs_blurb_gemini')).toContain('Google');
      expect(i18n.t('settings.docs_link_gemini_console_key')).toContain('API');
      expect(i18n.t('settings.support')).toBe('Contact support');
    });

    it('agents 翻译完整', () => {
      expect(i18n.t('agents.personas')).toBe('Personas');
      expect(i18n.t('agents.new_persona')).toBe('New Persona');
      expect(i18n.t('agents.test_sandbox')).toBe('Test Sandbox');
      expect(i18n.t('agents.delete_confirm')).toBe('Are you sure you want to delete this persona?');
      expect(i18n.t('agents.delete_persona')).toBe('Delete persona');
      expect(i18n.t('agents.sandbox_clear')).toBe('Clear chat');
      expect(i18n.t('agents.sandbox_clear_confirm')).toContain('cannot be undone');
    });

    it('reference 翻译完整', () => {
      expect(i18n.t('reference.index_title')).toBe('Archive Index');
      expect(i18n.t('reference.citation')).toBe('Copy Citation');
      expect(i18n.t('reference.tags')).toBe('Tags');
      expect(i18n.t('reference.word_count_label')).toBe('Characters');
    });

    it('ai 翻译完整', () => {
      expect(i18n.t('ai.loading')).toBe('AI is thinking...');
      expect(i18n.t('ai.prompts.localeDirective')).toContain('English');
      expect(i18n.t('ai.prompts.publishEssayPolishSystem')).toContain('minimum change');
      expect(i18n.t('ai.prompts.publishEssayPolishSystem')).not.toContain("Today's date");
      expect(i18n.t('ai.prompts.publishEssayPolish')).toContain('first-pass structure');
      expect(i18n.t('ai.prompts.essayChatSystem')).toContain('minimum change');
      expect(i18n.t('ai.prompts.essayChatSystem')).not.toContain("Today's date");
      expect(i18n.t('ai.prompts.essayChatSystem')).toContain('Selection first');
      expect(
        i18n.t('ai.prompts.agentThreadFollowUp', {
          initialContext: 'IC',
          dialogueHistory: 'DH',
          request: 'RQ',
        }),
      ).toContain('IC');
      expect(
        i18n.t('ai.prompts.agentThreadFollowUp', {
          initialContext: 'IC',
          dialogueHistory: 'DH',
          request: 'RQ',
        }),
      ).toContain('RQ');
    });

    it('drawToolAvailable tells the model to generate text-in-image posters here', () => {
      const draw = i18n.t('ai.prompts.drawToolAvailable');
      expect(draw).toContain('```draw');
      expect(draw.toLowerCase()).toContain('xiaohongshu');
      expect(draw.toLowerCase()).toContain('gaoding');
      expect(draw).toMatch(/still call this tool/i);
      expect(draw).toMatch(/Do not send the user to Xiaohongshu/i);
      const persona = i18n.t('ai.prompts.toolbarBarePersona');
      expect(persona).toMatch(/later appendix grants illustration/i);
    });

    it('内置 Agent 系统提示词有英文文案', () => {
      expect(i18n.t('agents.defaults.interviewer.name')).toBe('The Mirror of Insight');
      expect(i18n.t('agents.defaults.stylist.prompt')).toContain('stacking blocks');
    });

    it('官方海龟汤主持人有英文文案', () => {
      expect(i18n.t('community.official_badge')).toBe('Curated by Spoor');
      expect(i18n.t('community.official.turtle_soup.title')).toBe('Turtle Soup: Lateral Thinking');
      expect(i18n.t('community.official.turtle_soup.persona_name')).toBe('Turtle Soup Host');
      expect(i18n.t('community.official.turtle_soup.persona_prompt')).toContain('Yes.');
      expect(i18n.t('community.official.turtle_soup.note_start')).toContain('Start a round');
    });

    it('官方直觉泵专家有英文文案', () => {
      expect(i18n.t('community.official.intuition_pump.title')).toBe(
        'Intuition Pump: Thought Experiments',
      );
      expect(i18n.t('community.official.intuition_pump.persona_name')).toBe(
        'Intuition Pump Expert',
      );
      expect(i18n.t('community.official.intuition_pump.persona_prompt')).toContain(
        'intuition pump',
      );
      expect(i18n.t('community.official.intuition_pump.note_start')).toContain('intuition pump');
    });
  });

  // --- 中文翻译完整性 ---
  describe('中文翻译 (zh)', () => {
    beforeEach(() => {
      i18n.changeLanguage('zh');
    });

    it('app.name 翻译正确', () => {
      expect(i18n.t('app.name')).toBe('记忆建筑师');
    });

    it('sidebar 翻译完整', () => {
      expect(i18n.t('sidebar.personal')).toBe('画布');
      expect(i18n.t('sidebar.reference')).toBe('长文');
      expect(i18n.t('sidebar.archive')).toBe('知识存档');
      expect(i18n.t('sidebar.agents')).toBe('角色');
      expect(i18n.t('sidebar.new_note')).toBe('新建便签');
      expect(i18n.t('sidebar.new_theme_card')).toBe('新建主题卡');
      expect(i18n.t('sidebar.settings')).toBe('设置');
    });

    it('canvas 翻译完整', () => {
      expect(i18n.t('canvas.zoom')).toBe('缩放');
      expect(i18n.t('canvas.new_canvas')).toBe('新建画布');
      expect(i18n.t('canvas.rename')).toBe('重命名');
      expect(i18n.t('canvas.delete_canvas')).toBe('删除画布');
      expect(i18n.t('canvas.delete_canvas_confirm', { name: '画布 4' })).toContain('本地和云端都不会再有备份');
      expect(i18n.t('canvas.delete_canvas_last')).toBe('至少保留一张画布。');
      expect(i18n.t('canvas.delete_note')).toBe('删除便签');
    });

    it('nodes 翻译完整', () => {
      expect(i18n.t('nodes.theme')).toBe('核心主题');
      expect(i18n.t('nodes.new_theme_title')).toBe('未命名主题');
      expect(i18n.t('nodes.theme_default_description')).toBe('当前画布的核心研究目标。');
      expect(i18n.t('nodes.theme_default_tag')).toBe('空间编码');
      expect(i18n.t('nodes.note')).toBe('笔记');
      expect(i18n.t('nodes.ai_refinement')).toBe('AI 优化');
      expect(i18n.t('nodes.ai_failed_open_settings')).toBe('去登录');
    });

    it('settings 翻译完整', () => {
      expect(i18n.t('settings.title')).toBe('设置');
      expect(i18n.t('settings.api_key')).toBe('API 密钥');
      expect(i18n.t('settings.save')).toBe('保存配置');
      expect(i18n.t('settings.docs_heading')).toContain('配置');
      expect(i18n.t('settings.docs_blurb_mimo')).toContain('MiMo');
      expect(i18n.t('settings.support')).toBe('联系客服');
    });

    it('agents 翻译完整', () => {
      expect(i18n.t('agents.personas')).toBe('人格设定');
      expect(i18n.t('agents.new_persona')).toBe('新建人格');
      expect(i18n.t('agents.delete_confirm')).toBe('您确定要删除此人格设定吗？');
      expect(i18n.t('agents.delete_persona')).toBe('删除人格');
      expect(i18n.t('agents.sandbox_clear')).toBe('清空对话');
      expect(i18n.t('agents.sandbox_clear_confirm')).toContain('不可恢复');
    });

    it('ai 翻译完整', () => {
      expect(i18n.t('ai.loading')).toBe('AI 思考中...');
      expect(i18n.t('ai.prompts.localeDirective')).toContain('简体中文');
      expect(i18n.t('ai.prompts.publishEssayPolishSystem')).toContain('最小修改');
      expect(i18n.t('ai.prompts.publishEssayPolishSystem')).not.toContain('今天的日期');
      expect(i18n.t('ai.prompts.publishEssayPolish')).toContain('结构整理阶段');
      expect(i18n.t('ai.prompts.essayChatSystem')).toContain('最小修改');
      expect(i18n.t('ai.prompts.essayChatSystem')).not.toContain('今天的日期');
      expect(i18n.t('ai.prompts.essayChatSystem')).toContain('选区优先');
      expect(
        i18n.t('ai.prompts.agentThreadFollowUp', {
          initialContext: '原文',
          dialogueHistory: '对话',
          request: '问',
        }),
      ).toContain('原文');
    });

    it('drawToolAvailable 禁止把用户打发去外部排版', () => {
      const draw = i18n.t('ai.prompts.drawToolAvailable');
      expect(draw).toContain('```draw');
      expect(draw).toContain('小红书');
      expect(draw).toContain('稿定');
      expect(draw).toContain('仍然调用本工具');
      expect(draw).toContain('不要把用户打发去小红书');
      const persona = i18n.t('ai.prompts.toolbarBarePersona');
      expect(persona).toContain('若后面的附录授予了画图或检索工具');
    });

    it('内置 Agent 系统提示词有中文文案', () => {
      expect(i18n.t('agents.defaults.interviewer.name')).toBe('真知镜');
      expect(i18n.t('agents.defaults.stylist.prompt')).toContain('文字积木');
    });

    it('官方海龟汤主持人有中文文案', () => {
      expect(i18n.t('community.official_badge')).toBe('Spoor 官方');
      expect(i18n.t('community.official.turtle_soup.title')).toBe('海龟汤：情境推理');
      expect(i18n.t('community.official.turtle_soup.persona_name')).toBe('海龟汤主持人');
      expect(i18n.t('community.official.turtle_soup.persona_prompt')).toContain('是 / 不是 / 与此无关');
      expect(i18n.t('community.official.turtle_soup.note_start')).toContain('开始一局');
    });

    it('官方直觉泵专家有中文文案', () => {
      expect(i18n.t('community.official.intuition_pump.title')).toBe('直觉泵：思想实验设计');
      expect(i18n.t('community.official.intuition_pump.persona_name')).toBe('直觉泵专家');
      expect(i18n.t('community.official.intuition_pump.persona_prompt')).toContain('直觉泵');
      expect(i18n.t('community.official.intuition_pump.note_start')).toContain('直觉泵');
    });

    it('reference 翻译完整', () => {
      expect(i18n.t('reference.index_title')).toBe('档案索引');
      expect(i18n.t('reference.citation')).toBe('引用文献');
      expect(i18n.t('reference.word_count_label')).toBe('字数');
    });
  });

  // --- 插值 (interpolation) ---
  describe('插值功能', () => {
    it('英文插值正常工作', () => {
      i18n.changeLanguage('en');
      expect(i18n.t('canvas.default_name', { number: 3 })).toBe('Canvas 3');
    });

    it('中文插值正常工作', () => {
      i18n.changeLanguage('zh');
      expect(i18n.t('canvas.default_name', { number: 5 })).toBe('画布 5');
    });

    it('agents 沙盒标题插值正常', () => {
      i18n.changeLanguage('en');
      expect(i18n.t('agents.sandbox_title', { name: 'Weaver' })).toBe('Sandbox: Weaver');
    });

    it('agents 沙盒空消息插值正常', () => {
      i18n.changeLanguage('zh');
      expect(i18n.t('agents.sandbox_empty', { name: '真知镜' })).toBe(
        '正在测试 真知镜 的沙盒。发送消息以查看其根据当前系统提示词的响应。'
      );
    });
  });

  // --- 语言切换 ---
  describe('语言切换', () => {
    it('能在 en 和 zh 之间切换', async () => {
      await i18n.changeLanguage('en');
      expect(i18n.t('app.name')).toBe('The Memory Architect');

      await i18n.changeLanguage('zh');
      expect(i18n.t('app.name')).toBe('记忆建筑师');
    });

    it('未知翻译 key 返回 key 本身', () => {
      i18n.changeLanguage('en');
      expect(i18n.t('nonexistent.key')).toBe('nonexistent.key');
    });
  });
});
