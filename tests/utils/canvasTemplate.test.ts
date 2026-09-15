import { describe, it, expect } from 'vitest';
import type { CanvasTemplateDoc } from '../../src/db';
import { enrichTemplateDescriptionFromHowto, shouldSkipAmbienceForTemplate } from '../../src/utils/canvasTemplate';

const baseTemplate = (): CanvasTemplateDoc => ({
  id: 'tpl-1',
  name: 'Demo',
  description: 'Short blurb.',
  origin: 'user',
  builtinKey: null,
  personaIds: [],
  nodes: [
    {
      key: 'theme-howto',
      type: 'theme',
      contentText: '怎么用',
      descriptionText: '步骤\n1. 开始\n2. 提问',
      xFrac: 0.1,
      yFrac: 0.1,
      wFrac: 0.2,
      hFrac: 0.2,
    },
  ],
  edges: [],
  createdAt: 0,
  updatedAt: 0,
});

describe('enrichTemplateDescriptionFromHowto', () => {
  it('merges theme-howto body into template description', () => {
    const enriched = enrichTemplateDescriptionFromHowto(baseTemplate());
    expect(enriched.description).toContain('Short blurb.');
    expect(enriched.description).toContain('怎么用');
    expect(enriched.description).toContain('步骤');
  });

  it('is idempotent when description already contains the how-to body', () => {
    const tpl = baseTemplate();
    const once = enrichTemplateDescriptionFromHowto(tpl);
    const twice = enrichTemplateDescriptionFromHowto(once);
    expect(twice.description).toBe(once.description);
  });
});

describe('shouldSkipAmbienceForTemplate', () => {
  it('skips ambience for agent-only community game templates', () => {
    expect(
      shouldSkipAmbienceForTemplate({
        ...baseTemplate(),
        nodes: [
          ...baseTemplate().nodes,
          { key: 'agent-host', type: 'agent', agentConfigId: 'a1', xFrac: 0.5, yFrac: 0.5 },
        ],
      }),
    ).toBe(true);
  });

  it('keeps ambience for templates that already include an ask card', () => {
    expect(
      shouldSkipAmbienceForTemplate({
        ...baseTemplate(),
        nodes: [
          { key: 'ask', type: 'ask', xFrac: 0.5, yFrac: 0.5 },
        ],
      }),
    ).toBe(false);
  });
});
