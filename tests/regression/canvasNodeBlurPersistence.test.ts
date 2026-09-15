import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * 源码契约：可编辑画布节点须在 onBlur 中写 IndexedDB；AI 回复正文只读。
 * 若重构 ThemeNode / NoteBody / AiNode，请同步更新本文件中的断言。
 */
const root = join(__dirname, '../..');

function readSrc(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

describe('画布节点 blur 写库源码契约', () => {
  it('ThemeNode：三处字段失焦写库，且聚焦时不被 props 回写（无 onInput 防抖）', () => {
    const src = readSrc('src/components/nodes/ThemeNode.tsx');
    expect(src).toContain('db.nodes.update(node.id, patch)');
    expect(src).toContain("persistField('content')");
    expect(src).toContain("persistField('description')");
    expect(src).toContain("persistField('themeTag')");
    expect(src).toContain('isFocusedRef.current');
    expect(src).not.toContain('onInput');
    expect(src).not.toContain('schedulePersist');
    expect(src).not.toContain('createDebouncedThemePersist');
    expect(src).not.toContain('fitThemeCardWidth');
  });

  it('NoteBody：编辑区 onBlur 写入 content', () => {
    const src = readSrc('src/components/nodes/note/NoteBody.tsx');
    expect(src).toContain('db.nodes.update(node.id, { content: next');
    expect(src).toContain('isContentBlurPersistenceDisabled()');
  });

  it('AiNode：回复正文只读，选区工具栏摘抄/问 AI，不再 contentEditable 写库', () => {
    const src = readSrc('src/components/nodes/AiNode.tsx');
    expect(src).not.toContain('contentEditable');
    expect(src).not.toContain('db.nodes.update');
    expect(src).toContain('onExtractSelectionToCard');
    expect(src).toContain('onAskAboutSelection');
  });

  it('commitCanvasInlineEditing：主题卡无 editingNodeId 时仍 blur 焦点元素', () => {
    const src = readSrc('src/utils/commitCanvasInlineEditing.ts');
    expect(src).not.toMatch(/if\s*\(\s*!editingNodeId\s*\)\s*return/);
    expect(src).toContain('主题卡等始终 contentEditable');
  });

  it('App：通过 registerCanvasUnloadFlush 注册卸载前 flush', () => {
    const appSrc = readSrc('src/App.tsx');
    expect(appSrc).toContain('registerCanvasUnloadFlush');
    expect(appSrc).not.toContain('blurActiveContentEditable');
    const regSrc = readSrc('src/utils/registerCanvasUnloadFlush.ts');
    expect(regSrc).toContain('pagehide');
    expect(regSrc).toContain('beforeunload');
    expect(regSrc).toContain('blurActiveContentEditable');
  });

  it('CanvasToolbar：AI 输入已迁出工具栏，+ 下拉含 Ask 与长文；不含氛围音', () => {
    const src = readSrc('src/components/CanvasToolbar.tsx');
    // Toolbar no longer hosts the AI submit button / send / voice chip.
    expect(src).not.toContain('isToolbarAiLoading');
    expect(src).not.toContain('ai.input_placeholder');
    expect(src).not.toContain('Wand2');
    expect(src).not.toContain('<Send');
    // The + dropdown grew Ask and blank-essay entries.
    expect(src).toContain('canvas.add_ask_card');
    expect(src).toContain('addAskNode');
    expect(src).toContain('addEssayNode');
    expect(src).toContain('canvas.add_essay_card');
    expect(src).not.toContain('addAmbienceNode');
    expect(src).not.toContain('canvas.add_ambience_card');
    // A standalone mic icon now lives on the toolbar as a voice-chat entry
    // point; it routes to the Ask card's voice mode via onActivateVoice.
    expect(src).toContain('onActivateVoice');
    expect(src).toContain('toolbar-voice');
    const micUses = (src.match(/<Mic\b/g) ?? []).length;
    expect(micUses).toBe(1);
  });
});
