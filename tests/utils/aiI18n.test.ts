import { describe, it, expect, beforeEach } from 'vitest';
import i18n from '../../src/i18n';
import type { AgentConfig } from '../../src/db';
import {
  resolveAgentLocalizedName,
  resolveAgentLocalizedRole,
  resolveAgentSystemPrompt,
  getLocaleDirective,
} from '../../src/utils/aiI18n';

function cfg(overrides: Partial<AgentConfig> & Pick<AgentConfig, 'id'>): AgentConfig {
  return {
    name: '',
    role: '',
    prompt: '',
    ...overrides,
  };
}

describe('resolveAgentLocalizedName / Role / SystemPrompt', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('内置人格在切换语言时名称与角色随当前 UI 语言变化', async () => {
    await i18n.changeLanguage('en');
    const agent = cfg({
      id: 'interviewer',
      name: i18n.t('agents.defaults.interviewer.name'),
      role: i18n.t('agents.defaults.interviewer.role'),
      prompt: i18n.t('agents.defaults.interviewer.prompt'),
    });

    expect(resolveAgentLocalizedName(agent)).toBe(i18n.t('agents.defaults.interviewer.name'));
    expect(resolveAgentLocalizedRole(agent)).toBe(i18n.t('agents.defaults.interviewer.role'));

    await i18n.changeLanguage('zh');
    expect(resolveAgentLocalizedName(agent)).toBe(i18n.t('agents.defaults.interviewer.name'));
    expect(resolveAgentLocalizedRole(agent)).toBe(i18n.t('agents.defaults.interviewer.role'));
  });

  it('非内置 id 时保留数据库中的名称与角色', async () => {
    await i18n.changeLanguage('zh');
    const agent = cfg({
      id: 'custom-1',
      name: 'My Custom',
      role: 'Helper',
      prompt: 'Do things',
    });
    expect(resolveAgentLocalizedName(agent)).toBe('My Custom');
    expect(resolveAgentLocalizedRole(agent)).toBe('Helper');
  });

  it('用户修改过的内置名称不再视为库存文案', async () => {
    await i18n.changeLanguage('en');
    const agent = cfg({
      id: 'interviewer',
      name: 'Unique Name XYZ',
      role: i18n.t('agents.defaults.interviewer.role'),
      prompt: i18n.t('agents.defaults.interviewer.prompt'),
    });
    expect(resolveAgentLocalizedName(agent)).toBe('Unique Name XYZ');

    await i18n.changeLanguage('zh');
    expect(resolveAgentLocalizedName(agent)).toBe('Unique Name XYZ');
  });

  it('内置提示词随语言切换（与 resolveAgentSystemPrompt 一致）', async () => {
    await i18n.changeLanguage('en');
    const promptEn = i18n.t('agents.defaults.futurist.prompt');
    const agent = cfg({
      id: 'futurist',
      name: i18n.t('agents.defaults.futurist.name'),
      role: i18n.t('agents.defaults.futurist.role'),
      prompt: promptEn,
    });

    expect(resolveAgentSystemPrompt(agent)).toContain('sticky-note');

    await i18n.changeLanguage('zh');
    expect(resolveAgentSystemPrompt(agent)).toContain('便签画布');
  });

  it('官方海龟汤库存提示词随界面语言换成现行主持规则', async () => {
    const { LEGACY_OFFICIAL_TURTLE_SOUP_PROMPTS } = await import(
      '../../src/i18n/legacyOfficialTurtleSoupPrompts'
    );
    const agent = cfg({
      id: 'uuid-remapped',
      name: '海龟汤主持人',
      role: 'host',
      prompt: LEGACY_OFFICIAL_TURTLE_SOUP_PROMPTS[1],
      communityPersonaKey: 'official:turtle_soup_host',
    });
    await i18n.changeLanguage('zh');
    expect(resolveAgentSystemPrompt(agent)).toContain('隐藏汤底');
    await i18n.changeLanguage('en');
    expect(resolveAgentSystemPrompt(agent)).toContain('must never be modified');
  });

  it('用户改过的海龟汤提示词保持原文', () => {
    const agent = cfg({
      id: 'turtle_soup_host',
      name: '海龟汤主持人',
      role: 'host',
      prompt: '自定义主持词',
    });
    expect(resolveAgentSystemPrompt(agent)).toBe('自定义主持词');
  });
});

describe('getLocaleDirective', () => {
  it('stamps the device calendar date so “now” is not the training cutoff', async () => {
    await i18n.changeLanguage('en');
    const text = getLocaleDirective(new Date(2026, 8, 3, 12, 0, 0));
    expect(text).toContain('English');
    expect(text).toContain('2026-09-03');
  });
});
