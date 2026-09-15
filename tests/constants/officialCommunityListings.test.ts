import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

// Mock localStorage for i18n init
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  get length() { return Object.keys(store).length; },
  key: (index: number) => store[Object.keys(store)[index] ?? ''] ?? null,
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

import i18n from '../../src/i18n';
import {
  buildOfficialTurtleSoupPayload,
  buildOfficialIntuitionPumpPayload,
  OFFICIAL_AUTHOR_UID,
  OFFICIAL_TURTLE_SOUP_ID,
  OFFICIAL_TURTLE_SOUP_PERSONA_ID,
  OFFICIAL_INTUITION_PUMP_ID,
  OFFICIAL_INTUITION_PUMP_PERSONA_ID,
  OFFICIAL_TRAUMA_INNER_COSMOS_ID,
  OFFICIAL_TRAUMA_INNER_COSMOS_PERSONA_IDS,
  buildOfficialTraumaInnerCosmosPayload,
} from '../../src/constants/officialCommunityListings';
import { parseCommunityPayload } from '../../src/utils/communityPayload';

describe('officialCommunityListings', () => {
  beforeEach(() => {
    store['active_canvas_id'] = '';
  });

  it('exposes stable ids', () => {
    expect(OFFICIAL_AUTHOR_UID).toMatch(/^[0-9a-f-]{36}$/);
    expect(OFFICIAL_TURTLE_SOUP_ID).toMatch(/^[0-9a-f-]{36}$/);
    expect(OFFICIAL_TURTLE_SOUP_PERSONA_ID).toBe('turtle_soup_host');
    expect(OFFICIAL_INTUITION_PUMP_ID).toMatch(/^[0-9a-f-]{36}$/);
    expect(OFFICIAL_INTUITION_PUMP_PERSONA_ID).toBe('intuition_pump_expert');
    expect(OFFICIAL_TRAUMA_INNER_COSMOS_ID).toMatch(/^[0-9a-f-]{36}$/);
    expect([...OFFICIAL_TRAUMA_INNER_COSMOS_PERSONA_IDS].sort()).toEqual(
      ['character_atelier', 'cosmos_weaver'].sort(),
    );
  });

  describe('buildOfficialTurtleSoupPayload', () => {
    beforeAll(async () => {
      await i18n.changeLanguage('zh');
    });

    it('produces a payload that passes parseCommunityPayload', () => {
      const payload = buildOfficialTurtleSoupPayload();
      const parsed = parseCommunityPayload(payload);
      expect(parsed).not.toBeNull();
      expect(parsed?.kind).toBe('canvas');
    });

    it('ships exactly one turtle_soup_host agent', () => {
      const payload = buildOfficialTurtleSoupPayload();
      expect(payload.agents).toHaveLength(1);
      const host = payload.agents[0]!;
      expect(host.id).toBe(OFFICIAL_TURTLE_SOUP_PERSONA_ID);
      expect(host.coverImageUrl).toBeTruthy();
      expect(host.temperature).toBe(0.85);
      expect(host.creativity).toBe(0.75);
      expect(host.knowledgeMarkdownFiles ?? []).toHaveLength(0);
    });

    it('templates 2 nodes and no start note or edge, with a free-floating howto theme', () => {
      const payload = buildOfficialTurtleSoupPayload();
      const tpl = payload.template!;
      expect(tpl.nodes.map((n) => n.key).sort()).toEqual(
        ['agent-host', 'theme-howto'].sort(),
      );
      expect(tpl.nodes.some((n) => n.key === 'note-start')).toBe(false);
      expect(tpl.nodes.some((n) => n.type === 'ask')).toBe(false);
      const howto = tpl.nodes.find((n) => n.key === 'theme-howto');
      expect(howto?.type).toBe('theme');
      expect(howto?.contentText).toBe('怎么玩');
      expect(howto?.descriptionText).toContain('海龟汤');
      expect(howto?.descriptionText).toContain('汤底先不公布');
      expect(howto?.descriptionText).toContain('直接运行');
      expect(howto?.descriptionText).not.toContain('开始一局」便签');
      expect(howto?.descriptionText).not.toContain('玩家请勿阅读');
      expect(tpl.edges).toHaveLength(0);
      const howtoInEdge = tpl.edges.some(
        (e) => e.fromKey === 'theme-howto' || e.toKey === 'theme-howto',
      );
      expect(howtoInEdge).toBe(false);
    });

    it('zh persona prompt enforces the three-line answer format', async () => {
      await i18n.changeLanguage('zh');
      const prompt = buildOfficialTurtleSoupPayload().agents[0]!.prompt;
      expect(prompt).toContain('是 / 不是 / 与此无关');
      expect(prompt).toContain('隐藏汤底');
      expect(prompt).toContain('与此无关」不等于');
      expect(prompt).not.toContain('玩家请勿阅读');
    });

    it('en persona prompt enforces the yes/no/irrelevant format', async () => {
      await i18n.changeLanguage('en');
      const prompt = buildOfficialTurtleSoupPayload().agents[0]!.prompt;
      expect(prompt).toContain('Yes.');
      expect(prompt).toContain('No.');
      expect(prompt).toContain('Irrelevant.');
      expect(prompt).toContain('must never be modified');
      expect(prompt).toContain('Irrelevant is not');
      expect(prompt).not.toContain('do not read');
    });
  });

  describe('buildOfficialIntuitionPumpPayload', () => {
    beforeAll(async () => {
      await i18n.changeLanguage('zh');
    });

    it('produces a payload that passes parseCommunityPayload', () => {
      const payload = buildOfficialIntuitionPumpPayload();
      const parsed = parseCommunityPayload(payload);
      expect(parsed).not.toBeNull();
      expect(parsed?.kind).toBe('canvas');
    });

    it('ships a howto theme, the expert agent, and no start note / ask card', () => {
      const payload = buildOfficialIntuitionPumpPayload();
      const tpl = payload.template!;
      expect(tpl.nodes.some((n) => n.type === 'ask')).toBe(false);
      // Replaced by a canvas onboarding tour (see intuitionPumpTourSteps.ts).
      expect(tpl.nodes.some((n) => n.key === 'note-start')).toBe(false);
      expect(tpl.nodes.some((n) => n.type === 'note')).toBe(false);
      expect(tpl.edges).toHaveLength(0);
      const howto = tpl.nodes.find((n) => n.key === 'theme-howto');
      expect(howto?.type).toBe('theme');
      expect(howto?.contentText).toBe('怎么用');
      // The howto body must no longer reference the removed start note.
      expect(howto?.descriptionText).not.toContain('开始一次');
      expect(howto?.descriptionText).toContain('魔杖');
    });

    it('ships exactly one intuition_pump_expert agent', () => {
      const payload = buildOfficialIntuitionPumpPayload();
      expect(payload.agents).toHaveLength(1);
      const host = payload.agents[0]!;
      expect(host.id).toBe(OFFICIAL_INTUITION_PUMP_PERSONA_ID);
      expect(host.coverImageUrl).toBeTruthy();
      expect(host.temperature).toBe(0.8);
      expect(host.creativity).toBe(0.7);
      expect(host.knowledgeMarkdownFiles ?? []).toHaveLength(0);
    });

    it('zh howto body is structured with section breaks', async () => {
      await i18n.changeLanguage('zh');
      const payload = buildOfficialIntuitionPumpPayload();
      const howto = payload.template!.nodes.find((n) => n.key === 'theme-howto');
      expect(howto?.descriptionText).toContain('什么是直觉泵');
      expect(howto?.descriptionText).toContain('步骤');
      expect(howto?.descriptionText).toContain('继续追问');
    });

    it('template description includes the how-to body for editing', async () => {
      await i18n.changeLanguage('zh');
      const payload = buildOfficialIntuitionPumpPayload();
      expect(payload.template?.description).toContain('把抽象概念');
      expect(payload.template?.description).toContain('步骤');
      expect(payload.template?.description).toContain('继续追问');
    });

    it('localizeOfficialListing overlays title and description from i18n', async () => {
      await i18n.changeLanguage('en');
      const { localizeOfficialListing, OFFICIAL_INTUITION_PUMP_ID } = await import(
        '../../src/constants/officialCommunityListings'
      );
      const localized = localizeOfficialListing({
        id: OFFICIAL_INTUITION_PUMP_ID,
        is_official: true,
        title: '直觉泵：思想实验设计',
        description: '中文简介',
      });
      expect(localized.title).toBe('Intuition Pump: Thought Experiments');
      expect(localized.description).toContain('abstract concept');
      expect(localized.cover_url).toBeTruthy();
    });

    it('zh persona prompt outlines the six-section report', async () => {
      await i18n.changeLanguage('zh');
      const prompt = buildOfficialIntuitionPumpPayload().agents[0]!.prompt;
      expect(prompt).toContain('场景描述');
      expect(prompt).toContain('目标概念');
      expect(prompt).toContain('预期直觉反应');
      expect(prompt).toContain('深层分析');
      expect(prompt).toContain('局限性');
      expect(prompt).toContain('应用建议');
    });

    it('en persona prompt outlines the six-section report', async () => {
      await i18n.changeLanguage('en');
      const prompt = buildOfficialIntuitionPumpPayload().agents[0]!.prompt;
      expect(prompt).toContain('Scenario');
      expect(prompt).toContain('Target concept');
      expect(prompt).toContain('intuitive reactions');
      expect(prompt).toContain('Deeper analysis');
      expect(prompt).toContain('Limitations');
      expect(prompt).toContain('Application suggestions');
    });
  });

  describe('buildOfficialTraumaInnerCosmosPayload', () => {
    beforeAll(async () => {
      await i18n.changeLanguage('zh');
    });

    it('ships both cosmos personas and the starter canvas', () => {
      const payload = buildOfficialTraumaInnerCosmosPayload();
      expect(parseCommunityPayload(payload)?.kind).toBe('canvas');
      expect(payload.agents.map((a) => a.id).sort()).toEqual(
        ['character_atelier', 'cosmos_weaver'].sort(),
      );
      expect(payload.agents.every((a) => (a.knowledgeMarkdownFiles?.length ?? 0) > 0)).toBe(true);
      const tpl = payload.template!;
      expect(tpl.name).toBe('创伤内宇宙');
      expect(tpl.nodes.some((n) => n.agentConfigId === 'cosmos_weaver')).toBe(true);
      expect(tpl.nodes.some((n) => n.agentConfigId === 'character_atelier')).toBe(true);
      expect(tpl.nodes.some((n) => n.type === 'note')).toBe(true);
      expect(tpl.edges.length).toBeGreaterThan(0);
    });
  });
});