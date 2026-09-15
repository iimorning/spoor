/**
 * Canvas Templates tab — second tab of Agents Studio.
 *
 * Lets the user browse system + user-defined canvas templates, edit a
 * template's starter-card layout (drag) and bundled personas, and apply a
 * template to spawn a fresh canvas with those nodes + agents in place.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Search, Trash2, Sparkles, Layers, LayoutTemplate, CopyPlus } from 'lucide-react';
import type { AgentConfig, CanvasTemplateDoc, TemplateNode } from '../db';
import { db } from '../db';
import { useAppDialog } from './AppDialogProvider';
import { openCommunityInBrowser } from '../utils/openCommunity';
import { CanvasTemplatePreview } from './CanvasTemplatePreview';
import { AgentIcon } from './AgentIcon';
import { resolveAgentLocalizedName } from '../utils/aiI18n';
import {
  getSystemCanvasTemplates,
  saveUserCanvasTemplate,
  updateUserCanvasTemplate,
  deleteUserCanvasTemplate,
  cloneCanvasTemplateForUser,
  enrichTemplateDescriptionFromHowto,
  spawnCanvasFromTemplate,
} from '../utils/canvasTemplate';

type EditorTab = 'personas' | 'layout';

interface CanvasTemplatesTabProps {
  agentConfigs: AgentConfig[];
  /** Switches the app's active canvas to the freshly-spawned template canvas. */
  onActivateCanvas: (canvasId: string) => void;
}

function translateName(tpl: CanvasTemplateDoc, t: (k: string) => string): string {
  // System templates store i18n keys. User templates store literal text.
  if (tpl.origin === 'system') return t(tpl.name);
  return tpl.name;
}

export function CanvasTemplatesTab({
  agentConfigs,
  onActivateCanvas,
}: CanvasTemplatesTabProps) {
  const { t } = useTranslation();
  const { confirm } = useAppDialog();

  const systemTemplates = useMemo(() => getSystemCanvasTemplates().slice(), []);
  const [userTemplates, setUserTemplates] = useState<CanvasTemplateDoc[]>([]);

  const [search, setSearch] = useState('');
  const [activeId, setActiveId] = useState<string | null>(
    systemTemplates[0]?.id ?? null,
  );
  const [editorTab, setEditorTab] = useState<EditorTab>('layout');

  // Working draft: clone the active template locally; user templates auto-save to IndexedDB.
  const [draft, setDraft] = useState<CanvasTemplateDoc | null>(null);
  const skipAutoSaveRef = useRef(true);

  // Load user templates on mount + whenever activeId changes (so deletions propagate).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await db.canvasTemplates.toArray();
      if (cancelled) return;
      setUserTemplates(rows.filter((r) => r.origin === 'user'));
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  const allTemplates = useMemo(() => {
    // system first, then user, alphabetical by name within each group
    return [...systemTemplates, ...userTemplates];
  }, [systemTemplates, userTemplates]);

  const filteredTemplates = useMemo(() => {
    const q = search.trim().toLowerCase();
    const match = (tpl: CanvasTemplateDoc) =>
      !q || translateName(tpl, t).toLowerCase().includes(q);
    return {
      system: systemTemplates.filter(match),
      user: userTemplates.filter(match),
    };
  }, [search, systemTemplates, userTemplates, t]);

  const activeTemplate = useMemo(() => {
    if (!activeId) return null;
    return allTemplates.find((tpl) => tpl.id === activeId) ?? null;
  }, [activeId, allTemplates]);

  // When activeId changes, seed a working draft from the active template.
  useEffect(() => {
    if (activeTemplate) {
      skipAutoSaveRef.current = true;
      const enriched = enrichTemplateDescriptionFromHowto(activeTemplate);
      setDraft({
        ...enriched,
        nodes: enriched.nodes.map((n) => ({ ...n })),
        edges: enriched.edges.map((e) => ({ ...e })),
        personaIds: [...enriched.personaIds],
      });
    } else {
      setDraft(null);
    }
  }, [activeTemplate?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const reloadUserTemplates = async () => {
    const rows = await db.canvasTemplates.toArray();
    setUserTemplates(rows.filter((r) => r.origin === 'user'));
  };

  useEffect(() => {
    if (!draft || draft.origin !== 'user') return;
    if (skipAutoSaveRef.current) {
      skipAutoSaveRef.current = false;
      return;
    }

    const timer = window.setTimeout(() => {
      void (async () => {
        await updateUserCanvasTemplate(draft.id, {
          name: draft.name,
          description: draft.description,
          personaIds: draft.personaIds,
          nodes: draft.nodes,
          edges: draft.edges,
        });
        await reloadUserTemplates();
      })();
    }, 400);

    return () => window.clearTimeout(timer);
  }, [draft]);

  const handleSelectTemplate = (id: string) => {
    setActiveId(id);
    setEditorTab('layout');
  };

  const handleCreateNew = async () => {
    const created = await saveUserCanvasTemplate({
      name: t('canvas.new_template'),
      personaIds: [],
      nodes: [],
      edges: [],
    });
    await reloadUserTemplates();
    setActiveId(created.id);
    setEditorTab('layout');
  };

  const handleCloneSystem = async (src: CanvasTemplateDoc) => {
    const created = await cloneCanvasTemplateForUser(src);
    await reloadUserTemplates();
    setActiveId(created.id);
    setEditorTab('layout');
  };

  const handleDelete = async () => {
    if (!draft || draft.origin !== 'user') return;
    const ok = await confirm({
      message: t('canvas.delete_template_confirm'),
      variant: 'danger',
    });
    if (!ok) return;
    await deleteUserCanvasTemplate(draft.id);
    await reloadUserTemplates();
    setActiveId(systemTemplates[0]?.id ?? null);
  };

  const handleApply = async () => {
    if (!draft) return;
    const baseName = translateName(draft, t);
    const finalName = `${baseName}（${t('canvas.from_template_name', { name: '' })}）`;
    const newCanvasId = await spawnCanvasFromTemplate(draft, { canvasName: finalName });
    onActivateCanvas(newCanvasId);
  };

  // ----- Render -----

  return (
    <div className="flex-1 flex min-h-0">
      {/* Left pane: template list */}
      <section className="w-56 compact:w-48 shrink-0 flex flex-col min-h-0 border-r border-[#E6E4DF] bg-white">
        <div className="p-4 border-b border-[#E6E4DF] flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <input
              className="w-full pl-9 pr-3 py-2 text-xs font-sans bg-white border border-[#E6E4DF] rounded-lg focus:ring-1 focus:ring-[#C2410C] focus:border-[#C2410C] outline-none"
              placeholder={t('canvas.search_templates')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              type="search"
              autoComplete="off"
            />
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#8c8a84] pointer-events-none" />
          </div>
          <button
            type="button"
            onClick={() => void handleCreateNew()}
            aria-label={t('canvas.new_template')}
            className="text-[#C2410C] hover:bg-[#F4F1ED] p-1 rounded-full transition-colors flex items-center justify-center shrink-0"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {filteredTemplates.system.length > 0 && (
            <ListGroup
              title={t('canvas.template_origin_system')}
              items={filteredTemplates.system}
              activeId={activeId}
              onSelect={handleSelectTemplate}
            />
          )}
          <ListGroup
            title={t('canvas.template_origin_user')}
            items={filteredTemplates.user}
            activeId={activeId}
            onSelect={handleSelectTemplate}
            emptyText={t('canvas.empty_user_templates')}
          />
          <CommunityTemplatesSection />
        </div>
      </section>

      {/* Right pane: editor + actions */}
      <section className="flex-1 flex flex-col min-h-0 overflow-y-auto">
        {draft ? (
          <TemplateEditor
            draft={draft}
            setDraft={setDraft}
            agentConfigs={agentConfigs}
            editorTab={editorTab}
            setEditorTab={setEditorTab}
            onApply={() => void handleApply()}
            onDelete={() => void handleDelete()}
            onClone={() => {
              if (activeTemplate?.origin === 'system') {
                void handleCloneSystem(activeTemplate);
              }
            }}
            isSystem={activeTemplate?.origin === 'system'}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-[#8c8a84]">
            {t('canvas.no_template_selected')}
          </div>
        )}
      </section>
    </div>
  );
}

function CommunityTemplatesSection() {
  const { t } = useTranslation();

  return (
    <div className="border-b border-[#F4F1ED]">
      <button
        type="button"
        onClick={() => void openCommunityInBrowser()}
        title={t('canvas.templates_community_hint')}
        aria-label={`${t('agents.studio_community_templates')} — ${t('canvas.templates_community_hint')}`}
        className="w-full px-4 py-4 text-left text-sm font-bold text-[#C2410C] hover:text-[#9a3412] hover:bg-[#F4F1ED]/50 transition-colors"
      >
        {t('agents.studio_community_templates')} →
      </button>
    </div>
  );
}

interface ListGroupProps {
  title: string;
  items: CanvasTemplateDoc[];
  activeId: string | null;
  onSelect: (id: string) => void;
  emptyText?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
}

function ListGroup({
  title,
  items,
  activeId,
  onSelect,
  emptyText,
  emptyActionLabel,
  onEmptyAction,
}: ListGroupProps) {
  const { t } = useTranslation();
  return (
    <div className="border-b border-[#F4F1ED]">
      <div className="px-4 py-2 text-[10px] font-mono uppercase tracking-wider text-[#8c8a84]">
        {title}
      </div>
      {items.length === 0 && emptyText ? (
        <div className="px-4 pb-4 space-y-2">
          <p className="text-xs leading-relaxed text-[#8c8a84]">{emptyText}</p>
          {emptyActionLabel && onEmptyAction ? (
            <button
              type="button"
              onClick={onEmptyAction}
              className="text-xs font-bold text-[#C2410C] hover:text-[#9a3412] transition-colors"
            >
              {emptyActionLabel} →
            </button>
          ) : null}
        </div>
      ) : (
        items.map((tpl) => (
          <button
            type="button"
            key={tpl.id}
            onClick={() => onSelect(tpl.id)}
            className={`w-full p-4 cursor-pointer transition-colors border-l-4 text-left ${
              activeId === tpl.id
                ? 'bg-[#F4F1ED] border-[#C2410C]'
                : 'border-transparent hover:bg-[#F4F1ED]/50'
            }`}
          >
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#C2410C] shrink-0" aria-hidden />
              <h4
                className={`font-bold truncate ${
                  activeId === tpl.id ? 'text-[#1a1a1a]' : 'text-[#5a5a54]'
                }`}
              >
                {translateName(tpl, t)}
              </h4>
            </div>
            <div className="mt-1 text-[10px] font-mono text-[#8c8a84]">
              {t('canvas.personas_count', { count: tpl.personaIds.length })} ·{' '}
              {t('canvas.cards_count', { count: tpl.nodes.length })}
            </div>
          </button>
        ))
      )}
    </div>
  );
}

interface TemplateEditorProps {
  draft: CanvasTemplateDoc;
  setDraft: React.Dispatch<React.SetStateAction<CanvasTemplateDoc | null>>;
  agentConfigs: AgentConfig[];
  editorTab: EditorTab;
  setEditorTab: (tab: EditorTab) => void;
  onApply: () => void;
  onDelete: () => void;
  onClone: () => void;
  isSystem: boolean;
}

function TemplateEditor({
  draft,
  setDraft,
  agentConfigs,
  editorTab,
  setEditorTab,
  onApply,
  onDelete,
  onClone,
  isSystem,
}: TemplateEditorProps) {
  const { t } = useTranslation();

  const handleNodeMove = (key: string, next: { xFrac: number; yFrac: number }) => {
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            nodes: prev.nodes.map((n) =>
              n.key === key ? { ...n, xFrac: next.xFrac, yFrac: next.yFrac } : n,
            ),
          }
        : prev,
    );
  };

  const togglePersona = (id: string) => {
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            personaIds: prev.personaIds.includes(id)
              ? prev.personaIds.filter((x) => x !== id)
              : [...prev.personaIds, id],
          }
        : prev,
    );
  };

  const removeNode = (key: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        nodes: prev.nodes.filter((n) => n.key !== key),
        edges: prev.edges.filter((e) => e.fromKey !== key && e.toKey !== key),
      };
    });
  };

  return (
    <>
      {/* Header */}
      <div className="sticky top-0 bg-[#FAF9F6]/80 backdrop-blur-md px-10 py-6 border-b border-[#E6E4DF] flex justify-between items-center z-10 gap-4">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Sparkles className="w-5 h-5 text-[#C2410C] shrink-0" aria-hidden />
          <input
            type="text"
            className="font-serif text-2xl font-bold text-[#1a1a1a] bg-transparent border-0 border-b border-transparent hover:border-[#E6E4DF] focus:border-[#C2410C] focus:ring-0 outline-none min-w-0 flex-1 max-w-xl py-1 transition-colors"
            value={isSystem ? translateName(draft, t) : draft.name}
            onChange={(e) => {
              if (!isSystem) {
                setDraft((prev) => (prev ? { ...prev, name: e.target.value } : prev));
              }
            }}
            placeholder={t('canvas.new_template')}
            disabled={isSystem}
          />
        </div>

        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            onClick={onApply}
            className="p-2 rounded-lg text-[#C2410C] border border-[#E6E4DF] hover:bg-[#FFF7ED] hover:border-[#C2410C]/30 transition-colors"
            data-testid="canvas-template-apply"
            title={t('canvas.use_template')}
            aria-label={t('canvas.use_template')}
          >
            <LayoutTemplate className="w-4 h-4" aria-hidden />
          </button>
          {isSystem && (
            <button
              type="button"
              onClick={onClone}
              className="p-2 rounded-lg text-[#5a5a54] border border-[#E6E4DF] hover:text-[#C2410C] hover:bg-[#F4F1ED] hover:border-[#C2410C]/30 transition-colors"
              title={t('canvas.clone_template')}
              aria-label={t('canvas.clone_template')}
            >
              <CopyPlus className="w-4 h-4" aria-hidden />
            </button>
          )}
          {!isSystem && (
            <button
              type="button"
              onClick={onDelete}
              className="px-3 py-2 text-sm text-[#ef4444] rounded-lg font-sans font-bold hover:bg-[#ef4444]/10 transition-colors flex items-center gap-1.5"
              aria-label={t('canvas.delete_template')}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="px-10 pt-4 flex gap-2 border-b border-[#F4F1ED] bg-[#FAF9F6]">
        <SubTabButton
          active={editorTab === 'personas'}
          onClick={() => setEditorTab('personas')}
        >
          {t('canvas.template_personas_tab')}
        </SubTabButton>
        <SubTabButton
          active={editorTab === 'layout'}
          onClick={() => setEditorTab('layout')}
        >
          {t('canvas.template_layout_tab')}
        </SubTabButton>
      </div>

      {/* Tab content */}
      <div className="p-10 max-w-5xl w-full mx-auto">
        {editorTab === 'personas' && (
          <PersonaSelector
            agentConfigs={agentConfigs}
            selectedIds={draft.personaIds}
            onToggle={togglePersona}
            disabled={isSystem}
          />
        )}

        {editorTab === 'layout' && (
          <LayoutEditor
            template={draft}
            description={draft.description ?? ''}
            onDescriptionChange={(value) =>
              setDraft((prev) => (prev ? { ...prev, description: value } : prev))
            }
            onNodeMove={handleNodeMove}
            onRemoveNode={removeNode}
            readOnly={isSystem}
          />
        )}
      </div>
    </>
  );
}

interface SubTabButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active: boolean;
}

function SubTabButton({ active, children, ...rest }: SubTabButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={`px-4 py-2 text-sm font-sans font-bold border-b-2 -mb-px transition-colors ${
        active
          ? 'border-[#C2410C] text-[#1a1a1a]'
          : 'border-transparent text-[#8c8a84] hover:text-[#1a1a1a]'
      }`}
    >
      {children}
    </button>
  );
}

interface PersonaSelectorProps {
  agentConfigs: AgentConfig[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  disabled: boolean;
}

function PersonaSelector({
  agentConfigs,
  selectedIds,
  onToggle,
  disabled,
}: PersonaSelectorProps) {
  const { t } = useTranslation();
  if (agentConfigs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[#E6E4DF] p-8 text-center text-sm text-[#8c8a84]">
        {t('canvas.no_personas_yet')}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {agentConfigs.map((agent) => {
        const checked = selectedIds.includes(agent.id);
        return (
          <label
            key={agent.id}
            className={`flex items-center gap-3 p-3 border rounded-lg transition-colors ${
              disabled
                ? 'border-[#E6E4DF] bg-[#FAF9F6] cursor-default'
                : checked
                  ? 'border-[#C2410C] bg-[#FFF7ED] cursor-pointer'
                  : 'border-[#E6E4DF] hover:bg-[#F4F1ED] cursor-pointer'
            }`}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => !disabled && onToggle(agent.id)}
              disabled={disabled}
              className="w-4 h-4 accent-[#C2410C]"
            />
            <div className="w-8 h-8 rounded-lg bg-white border border-[#E6E4DF] flex items-center justify-center overflow-hidden shrink-0">
              <AgentIcon
                agentId={agent.id}
                coverUrl={agent.coverImageUrl}
                className="w-full h-full"
                imageClassName="scale-[1.32]"
                fallbackClassName="text-[#C2410C] text-xs"
              />
            </div>
            <span className="font-bold text-sm text-[#1a1a1a] truncate">
              {resolveAgentLocalizedName(agent)}
            </span>
          </label>
        );
      })}
    </div>
  );
}

interface LayoutEditorProps {
  template: CanvasTemplateDoc;
  description: string;
  onDescriptionChange: (value: string) => void;
  onNodeMove: (key: string, next: { xFrac: number; yFrac: number }) => void;
  onRemoveNode: (key: string) => void;
  readOnly: boolean;
}

function LayoutEditor({
  template,
  description,
  onDescriptionChange,
  onNodeMove,
  onRemoveNode,
  readOnly,
}: LayoutEditorProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-8">
      <div className="space-y-6">
        <div>
          <label className="text-xs font-mono font-bold text-[#5a5a54] uppercase tracking-wider">
            Description
          </label>
          <textarea
            rows={8}
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            disabled={readOnly}
            className="mt-2 w-full p-3 text-sm bg-white border border-[#E6E4DF] rounded-lg disabled:bg-[#F4F1ED] disabled:text-[#8c8a84] whitespace-pre-wrap leading-relaxed"
            placeholder="What is this template for?"
          />
        </div>
        <div className="text-xs text-[#8c8a84] font-mono">
          {t('canvas.personas_count', { count: template.personaIds.length })} ·{' '}
          {t('canvas.cards_count', { count: template.nodes.length })}
        </div>
      </div>

      <CanvasTemplatePreview template={template} onNodeMove={onNodeMove} />

      <div className="space-y-2">
        <h4 className="text-xs font-mono font-bold text-[#5a5a54] uppercase tracking-wider">
          Cards
        </h4>
        <div className="space-y-1">
          {template.nodes.map((node) => (
            <div
              key={node.key}
              className="flex items-center justify-between p-2 border border-[#E6E4DF] rounded-lg text-sm bg-white"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono text-[10px] uppercase text-[#8c8a84]">
                  {node.type}
                </span>
                <span className="truncate text-[#1a1a1a]">{node.key}</span>
              </div>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => onRemoveNode(node.key)}
                  className="text-[#ef4444] hover:bg-[#ef4444]/10 px-2 py-1 rounded text-xs"
                >
                  {t('canvas.remove_node')}
                </button>
              )}
            </div>
          ))}
          {template.nodes.length === 0 && (
            <div className="text-xs text-[#8c8a84] italic">No cards yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
