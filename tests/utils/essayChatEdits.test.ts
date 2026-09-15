import { describe, expect, it } from 'vitest';
import {
  applyEssayChatEdits,
  parseEssayChatResponse,
  serializeEssayChatEdit,
} from '../../src/utils/essayChatEdits';
import { createHeadlessEssayEditor } from '../../src/utils/essayEditorMarkdown';

describe('parseEssayChatResponse', () => {
  it('reads reply and edits from JSON', () => {
    const parsed = parseEssayChatResponse(
      '{"reply":"Tightened the opener.","edits":[{"find":"Hello world","replace":"Hello there"}]}',
    );
    expect(parsed.reply).toBe('Tightened the opener.');
    expect(parsed.edits).toEqual([{ find: 'Hello world', replace: 'Hello there' }]);
    expect(parsed.replaceDocument).toBe(false);
  });

  it('treats unparseable output as a chat reply with no edits', () => {
    const parsed = parseEssayChatResponse('Just a thought, no JSON.');
    expect(parsed.reply).toBe('Just a thought, no JSON.');
    expect(parsed.edits).toEqual([]);
  });

  it('unwraps a markdown json fence before parsing', () => {
    const parsed = parseEssayChatResponse(
      '```json\n{"reply":"Fenced.","edits":[]}\n```',
    );
    expect(parsed.reply).toBe('Fenced.');
    expect(parsed.edits).toEqual([]);
  });

  it('parses a full-document rewrite', () => {
    const parsed = parseEssayChatResponse(
      '{"reply":"Rewrote.","replaceDocument":true,"document":"# New\\n\\nBody"}',
    );
    expect(parsed.replaceDocument).toBe(true);
    expect(parsed.edits[0]?.replace).toContain('Body');
  });
});

describe('applyEssayChatEdits', () => {
  it('wraps the first matching substring as a placeholder', () => {
    const { markdown, applied, missed } = applyEssayChatEdits('alpha beta gamma', [
      { find: 'beta', replace: 'BETA' },
    ]);
    expect(applied).toBe(1);
    expect(missed).toEqual([]);
    expect(markdown).toContain(serializeEssayChatEdit('beta', 'BETA'));
    expect(markdown).toContain('alpha');
    expect(markdown).toContain('gamma');
  });

  it('records misses when find is absent', () => {
    const { markdown, applied, missed } = applyEssayChatEdits('keep me', [
      { find: 'nope', replace: 'x' },
    ]);
    expect(applied).toBe(0);
    expect(missed[0]).toBe('nope');
    expect(markdown).toBe('keep me');
  });

  it('records misses when find occurs more than once', () => {
    const { markdown, applied, missed } = applyEssayChatEdits('于是走了于是又停', [
      { find: '于是', replace: '所以' },
    ]);
    expect(applied).toBe(0);
    expect(missed[0]).toBe('于是');
    expect(markdown).toBe('于是走了于是又停');
  });

  it('replaceDocument wraps the entire body', () => {
    const { markdown, applied } = applyEssayChatEdits('old body', [{ find: '', replace: 'new body' }], {
      replaceDocument: true,
    });
    expect(applied).toBe(1);
    expect(markdown).toBe(serializeEssayChatEdit('old body', 'new body'));
  });
});

describe('aiEssayEdit markdown round-trip', () => {
  it('parses the placeholder span into an aiEssayEdit node', () => {
    const html = serializeEssayChatEdit('old phrase', 'new phrase');
    const editor = createHeadlessEssayEditor(`Lead ${html} tail`);
    let found = false;
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'aiEssayEdit') {
        found = true;
        expect(node.attrs.original).toBe('old phrase');
        expect(node.attrs.proposed).toBe('new phrase');
      }
      return true;
    });
    expect(found).toBe(true);
    editor.destroy();
  });
});
