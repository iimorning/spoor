import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MINIMAX_SYSTEM_VOICES,
  minimaxVoiceGroups,
  minimaxVoiceLanguage,
} from '../constants/minimaxVoices';
import { MINIMAX_DEFAULT_TTS_MODEL } from '../constants/voiceWriting';
import { createTtsSentenceQueue, speakWholeText } from '../utils/ttsSentenceQueue';
import {
  readVoicePreviewClip,
  voicePreviewCacheKey,
  writeVoicePreviewClip,
} from '../utils/voicePreviewCache';
import { hasMinimaxTtsAccess } from '../lib/serverConfig';
import {
  Plus,
  Search,
  Bot,
  Wand2,
  Send,
  MessageSquare,
  X,
  FileText,
  FileUp,
  Image,
  Loader2,
  Trash2,
  RotateCcw,
  Check,
  ChevronDown,
  Play,
  Square,
  Volume2,
} from 'lucide-react';
import type { AgentConfig, AgentMarkdownKnowledgeFile } from '../db';
import { db } from '../db';
import type { CallAIFn } from '../types';
import { formatAiError } from '../services/ai';
import {
  buildAgentSystemInstruction,
  getLocaleDirective,
  resolveAgentLocalizedName,
  resolveAgentLocalizedRole,
  resolveAgentSystemPrompt,
} from '../utils/aiI18n';
import {
  AGENT_KNOWLEDGE_MAX_FILE_BYTES,
  isAgentMarkdownFilename,
} from '../utils/agentMarkdownKnowledge';
import { useAppDialog } from './AppDialogProvider';
import { AgentIcon } from './AgentIcon';
import { CanvasTemplatesTab } from './CanvasTemplatesTab';
import { toCoverImageDataUrl } from '../utils/file';
import {
  extractDocumentText,
  isPersonaPromptDocument,
  PERSONA_PROMPT_DOC_MAX_BYTES,
  truncateDocumentText,
} from '../utils/extractDocumentText';
import { syncAgentCanvasCardSize } from '../utils/agentCoverCards';
import {
  dedupeAgentsForList,
} from '../utils/agentPersonaSource';
import { useImeSafeText } from '../hooks/useImeSafeText';

/** Local avatar upload — keep IndexedDB rows from ballooning. */
const AGENT_COVER_MAX_BYTES = 4 * 1024 * 1024;

type SandboxChatMessage = { role: 'user' | 'model'; text: string };

function PersonaNameField({
  placeholder,
  'aria-label': ariaLabel,
  value,
  ...inputProps
}: {
  placeholder: string;
  'aria-label': string;
} & Pick<
  React.InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'onCompositionStart' | 'onCompositionUpdate' | 'onCompositionEnd' | 'onBlur'
>) {
  const measureRef = useRef<HTMLSpanElement>(null);
  const [inputWidth, setInputWidth] = useState(64);
  const mirrorText = value || placeholder;
  const isEmpty = !value;

  useEffect(() => {
    const node = measureRef.current;
    if (!node) return;
    setInputWidth(Math.max(48, Math.ceil(node.getBoundingClientRect().width) + 4));
  }, [mirrorText, isEmpty]);

  return (
    <span className="relative inline-block max-w-full align-bottom">
      <span
        ref={measureRef}
        className={`invisible absolute left-0 top-0 whitespace-pre pointer-events-none font-serif text-3xl ${
          isEmpty ? 'font-normal' : 'font-bold'
        }`}
        aria-hidden
      >
        {mirrorText}
      </span>
      <input
        type="text"
        style={{ width: inputWidth }}
        className="max-w-full font-serif text-3xl font-bold text-[#1a1a1a] bg-transparent border-0 border-b border-transparent hover:border-[#E6E4DF] focus:border-[#C2410C] focus:ring-0 outline-none py-1 px-0 transition-colors placeholder:text-[#8c8a84] placeholder:font-normal"
        placeholder={placeholder}
        aria-label={ariaLabel}
        value={value}
        {...inputProps}
      />
    </span>
  );
}

async function persistSandboxThread(agentId: string, messages: SandboxChatMessage[]) {
  await db.agentSandboxThreads.put({
    agentId,
    messages,
    updatedAt: Date.now(),
  });
}

export interface AgentsStudioProps {
  agentConfigs: AgentConfig[];
  setAgentConfigs: (configs: AgentConfig[]) => Promise<void>;
  aiConfig: {
    provider: string;
    apiKey: string;
    baseUrl: string;
    model: string;
    /** 试听音色要用；App 传的是完整配置，这里只多声明这两个用到的字段。 */
    minimaxApiKey?: string;
    minimaxTtsModel?: string;
  };
  callAI: CallAIFn;
  onGenerateCover?: (agentId: string) => void;
  generatingCoverAgentId?: string | null;
  /**
   * Switches the app's active canvas to a freshly-spawned template canvas.
   * Required to enable the "Canvas templates" tab — without it, the tab
   * still renders but "Use template" is a no-op after switching.
   */
  onActivateCanvas?: (canvasId: string) => void;
}

export function AgentsStudio({
  agentConfigs,
  setAgentConfigs,
  aiConfig,
  callAI,
  onGenerateCover,
  generatingCoverAgentId = null,
  onActivateCanvas,
}: AgentsStudioProps) {
  const { t } = useTranslation();
  const { confirm, alert: appAlert } = useAppDialog();
  const [activeAgentId, setActiveAgentId] = useState<string | null>(agentConfigs[0]?.id || null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [isSandboxOpen, setIsSandboxOpen] = useState(false);
  const [sandboxMessages, setSandboxMessages] = useState<SandboxChatMessage[]>([]);
  const [sandboxInput, setSandboxInput] = useState('');
  const [isSandboxLoading, setIsSandboxLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const knowledgeFileInputRef = useRef<HTMLInputElement>(null);
  const sandboxUiAgentRef = useRef<string | null>(null);

  const activeAgent = agentConfigs.find((a) => a.id === activeAgentId) || agentConfigs[0];

  const displayName = activeAgent ? resolveAgentLocalizedName(activeAgent) : '';
  const displayPrompt = activeAgent ? resolveAgentSystemPrompt(activeAgent) : '';

  useEffect(() => {
    sandboxUiAgentRef.current = activeAgentId;
    setIsSandboxLoading(false);

    let cancelled = false;
    (async () => {
      if (!activeAgentId) {
        setSandboxMessages([]);
        return;
      }
      const row = await db.agentSandboxThreads.get(activeAgentId);
      if (cancelled) return;
      setSandboxMessages(row?.messages ?? []);
    })();

    return () => {
      cancelled = true;
    };
  }, [activeAgentId]);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [sandboxMessages, isSandboxLoading]);

  const handleAddAgent = () => {
    const newId = "agent-" + Math.random().toString(36).substr(2, 9);
    setAgentConfigs([...agentConfigs, {
      id: newId,
      name: t('agents.new_persona'),
      role: t('agents.persona_default_role'),
      prompt: '',
      temperature: 0.7,
      creativity: 0.4
    }]);
    setActiveAgentId(newId);
  };

  const handleUpdateActiveAgent = (field: string, value: string | number) => {
    if (!activeAgentId) return;
    setAgentConfigs(agentConfigs.map((a) => (a.id === activeAgentId ? { ...a, [field]: value } : a)));
  };

  const setActiveAgentKnowledgeFiles = (next: AgentMarkdownKnowledgeFile[] | undefined) => {
    if (!activeAgentId) return;
    setAgentConfigs(
      agentConfigs.map((a) =>
        a.id === activeAgentId ? { ...a, knowledgeMarkdownFiles: next?.length ? next : undefined } : a,
      ),
    );
  };

  const readOneFileAsText = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('read'));
      reader.readAsText(file, 'UTF-8');
    });

  const handleKnowledgeFilesChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    e.target.value = '';
    if (!list?.length || !activeAgentId || !activeAgent) return;

    const errors: string[] = [];
    const merged = new Map((activeAgent.knowledgeMarkdownFiles ?? []).map((f) => [f.name, f]));

    for (const file of Array.from(list)) {
      if (!isAgentMarkdownFilename(file.name)) {
        errors.push(t('agents.knowledge_not_markdown', { name: file.name }));
        continue;
      }
      if (file.size > AGENT_KNOWLEDGE_MAX_FILE_BYTES) {
        errors.push(t('agents.knowledge_file_too_large', { name: file.name }));
        continue;
      }
      try {
        const content = await readOneFileAsText(file);
        merged.set(file.name, { name: file.name, content });
      } catch {
        errors.push(t('agents.knowledge_read_failed', { name: file.name }));
      }
    }

    if (errors.length) {
      void appAlert({ message: errors.join('\n') });
    }
    if (merged.size > 0) {
      setActiveAgentKnowledgeFiles(Array.from(merged.values()));
    }
  };

  const removeKnowledgeFile = (fileName: string) => {
    if (!activeAgent) return;
    const next = (activeAgent.knowledgeMarkdownFiles ?? []).filter((f) => f.name !== fileName);
    setActiveAgentKnowledgeFiles(next.length ? next : undefined);
  };

  const handleEnhancePrompt = async () => {
    if (!activeAgent || !displayPrompt.trim()) return;
    setIsEnhancing(true);
    try {
      const newPrompt = await callAI({
        config: aiConfig,
        systemInstruction: getLocaleDirective(),
        prompt: t('agents.studio.enhance_user', {
          name: resolveAgentLocalizedName(activeAgent),
          role: resolveAgentLocalizedRole(activeAgent),
          prompt: resolveAgentSystemPrompt(activeAgent),
        }),
        temperature: activeAgent.temperature ?? 0.7,
        topP: activeAgent.creativity ?? 0.4,
      });
      
      let enhanced = newPrompt.trim();
      enhanced = enhanced.replace(/^(New Enhanced Prompt:|新增强提示词[:：])\s*/i, '').trim();
      handleUpdateActiveAgent('prompt', enhanced);
    } catch (error) {
      const msg = formatAiError(error);
      console.error('[Scribe AI] enhance prompt failed', msg);
      void appAlert({
        message: `增强提示词失败\n\n${msg}\n\nF12 → Console 查看 [Scribe AI] 日志。`,
      });
    } finally {
      setIsEnhancing(false);
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!sandboxInput.trim() || isSandboxLoading || !activeAgent) return;

    const scopedAgentId = activeAgent.id;
    const userMsg = sandboxInput.trim();

    const afterUser: SandboxChatMessage[] = [...sandboxMessages, { role: 'user', text: userMsg }];
    setSandboxMessages(afterUser);
    setSandboxInput('');
    setIsSandboxLoading(true);

    try {
      await persistSandboxThread(scopedAgentId, afterUser);
    } catch (err) {
      console.error('[Scribe AI] sandbox persist (user msg) failed', err);
    }

    const streamingModel: SandboxChatMessage = { role: 'model', text: '' };
    if (sandboxUiAgentRef.current === scopedAgentId) {
      setSandboxMessages([...afterUser, streamingModel]);
    }

    try {
      const responseText = await callAI({
        config: aiConfig,
        prompt: userMsg,
        systemInstruction: buildAgentSystemInstruction(activeAgent, {
          fallbackPrompt: t('agents.studio.fallback_assistant'),
        }),
        temperature: activeAgent.temperature ?? 0.7,
        topP: activeAgent.creativity ?? 0.4,
        onStreamChunk: (acc) => {
          if (sandboxUiAgentRef.current !== scopedAgentId) return;
          setSandboxMessages((prev) => {
            const base = prev.length > 0 && prev[prev.length - 1]?.role === 'model' ? prev.slice(0, -1) : prev;
            return [...base, { role: 'model', text: acc }];
          });
        },
      });
      const afterModel: SandboxChatMessage[] = [...afterUser, { role: 'model', text: responseText }];
      if (sandboxUiAgentRef.current === scopedAgentId) {
        setSandboxMessages(afterModel);
      }
      try {
        await persistSandboxThread(scopedAgentId, afterModel);
      } catch (err) {
        console.error('[Scribe AI] sandbox persist (assistant) failed', err);
      }
    } catch (error) {
      const msg = formatAiError(error);
      console.error('[Scribe AI] sandbox chat failed', msg);
      const errLine: SandboxChatMessage = {
        role: 'model',
        text: `Error: ${msg}（详见 Console [Scribe AI]）`,
      };
      const afterErr: SandboxChatMessage[] = [...afterUser, errLine];
      if (sandboxUiAgentRef.current === scopedAgentId) {
        setSandboxMessages(afterErr);
      }
      try {
        await persistSandboxThread(scopedAgentId, afterErr);
      } catch (err) {
        console.error('[Scribe AI] sandbox persist (error bubble) failed', err);
      }
    } finally {
      if (sandboxUiAgentRef.current === scopedAgentId) {
        setIsSandboxLoading(false);
      }
    }
  };

  const handleClearSandboxChat = async () => {
    if (!activeAgentId || sandboxMessages.length === 0) return;
    const ok = await confirm({ message: t('agents.sandbox_clear_confirm'), variant: 'danger' });
    if (!ok) return;
    setSandboxMessages([]);
    try {
      await db.agentSandboxThreads.delete(activeAgentId);
    } catch (err) {
      console.error('[Scribe AI] sandbox clear failed', err);
    }
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({ message: t('agents.delete_confirm'), variant: 'danger' });
    if (!ok) return;
    const newConfigs = agentConfigs.filter((a) => a.id !== id);
    await setAgentConfigs(newConfigs);
    try {
      await db.agentSandboxThreads.delete(id);
    } catch (err) {
      console.error('[Scribe AI] sandbox thread delete failed', err);
    }
    if (activeAgentId === id) {
      setActiveAgentId(newConfigs[0]?.id || null);
    }
  };

  // 'personas' = the original two-pane editor; 'templates' = canvas-template tab.
  const [tab, setTab] = useState<'personas' | 'templates'>('personas');

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#FAF9F6] overflow-hidden relative pl-14">
      {/* Top tab strip — personas vs saved/community templates */}
      <div className="flex border-b border-[#E6E4DF] bg-white">
        <button
          type="button"
          onClick={() => setTab('personas')}
          className={`px-5 py-2.5 text-sm font-sans font-bold border-b-2 -mb-px transition-colors ${
            tab === 'personas'
              ? 'border-[#C2410C] text-[#1a1a1a]'
              : 'border-transparent text-[#8c8a84] hover:text-[#1a1a1a]'
          }`}
          data-testid="agents-studio-tab-personas"
          title={t('canvas.tab_personas_hint')}
        >
          {t('canvas.tab_personas')}
        </button>
        <button
          type="button"
          onClick={() => setTab('templates')}
          className={`px-5 py-2.5 text-sm font-sans font-bold border-b-2 -mb-px transition-colors ${
            tab === 'templates'
              ? 'border-[#C2410C] text-[#1a1a1a]'
              : 'border-transparent text-[#8c8a84] hover:text-[#1a1a1a]'
          }`}
          data-testid="agents-studio-tab-templates"
          title={t('canvas.tab_templates_hint')}
        >
          {t('canvas.tab_templates')}
        </button>
      </div>

      {tab === 'templates' ? (
        <CanvasTemplatesTab
          agentConfigs={agentConfigs}
          onActivateCanvas={(id) => {
            onActivateCanvas?.(id);
            setTab('personas'); // bounce back so the user sees the canvas in the right pane
          }}
        />
      ) : (
        <PersonasPane
          agentConfigs={agentConfigs}
          setAgentConfigs={setAgentConfigs}
          aiConfig={aiConfig}
          callAI={callAI}
          onGenerateCover={onGenerateCover}
          generatingCoverAgentId={generatingCoverAgentId}
        />
      )}
    </div>
  );
}

/** Persona editor split out so the tab strip above stays minimal. */
/**
 * 朗读音色选择器。原生 <select> 的选项列表由系统绘制（蓝色高亮、系统字体），
 * 跟 Spoor 的暖纸调对不上，所以照房间邀请菜单那套自己画：白底圆角面板、暖灰描边、
 * 选中行用 #FFF7ED + 对勾。
 */
/**
 * 试听用的样句。按**音色自己的语言**选，不按界面语言：中文音色在英文界面下也要念中文，
 * 否则听不出它真实的中文效果。（MiniMax 没有给系统音色提供试听音频的接口 ——
 * `get_voice` 只返回 id / 名字 / 描述，所以这里用我们自己的合成链路现念一句。）
 */
const VOICE_PREVIEW_LINE: Record<'zh' | 'en', string> = {
  zh: '你好，我是这个角色的声音。',
  en: 'Hi, this is how this voice sounds.',
};

export function voicePreviewLine(voiceId: string | undefined, uiLanguage: string | null | undefined) {
  const voiceLanguage = voiceId ? minimaxVoiceLanguage(voiceId) : undefined;
  const language =
    voiceLanguage ?? ((uiLanguage ?? '').trim().toLowerCase().startsWith('zh') ? 'zh' : 'en');
  return VOICE_PREVIEW_LINE[language];
}

function VoicePicker({
  value,
  onChange,
  aiConfig,
}: {
  value?: string;
  onChange: (next: string | undefined) => void;
  aiConfig: AgentsStudioProps['aiConfig'];
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  /** 正在合成的试听队列：再点一次 / 换个音色 / 关掉菜单都要把它停掉。 */
  const previewRef = useRef<ReturnType<typeof createTtsSentenceQueue> | null>(null);
  /** 正在播放的缓存音频。缓存命中时不走合成，所以得单独留个把柄给"停止"。 */
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  /**
   * 每次试听的代号。读缓存是异步的，中途可能被"再点一次"停掉或者切到别的音色 ——
   * 那时闭包里的 state 还是旧值，只有代号能判断这次请求还算不算数。
   */
  const previewTokenRef = useRef(0);
  const canPreview = hasMinimaxTtsAccess(aiConfig.minimaxApiKey);

  // 换了角色就收起并清空搜索，免得把上一个人的筛选条件带过来。
  useEffect(() => {
    setOpen(false);
    setQuery('');
  }, [value]);

  const stopPreview = useCallback(() => {
    previewTokenRef.current += 1;
    const queue = previewRef.current;
    previewRef.current = null;
    const audio = previewAudioRef.current;
    previewAudioRef.current = null;
    setPreviewingId(null);
    try {
      queue?.stop();
    } catch {
      /* ignore */
    }
    if (audio) {
      audio.pause();
      URL.revokeObjectURL(audio.src);
    }
  }, []);

  useEffect(() => stopPreview, [stopPreview]);

  const previewVoice = useCallback(
    async (voiceId: string) => {
      if (previewingId === voiceId) {
        stopPreview();
        return;
      }
      stopPreview();
      const model = aiConfig.minimaxTtsModel || MINIMAX_DEFAULT_TTS_MODEL;
      const line = voicePreviewLine(voiceId, i18n.language);
      const cacheKey = voicePreviewCacheKey({ model, voiceId, line });
      const token = previewTokenRef.current + 1;
      previewTokenRef.current = token;
      setPreviewingId(voiceId);

      // 听过一次就是本地播放，不用再等合成。
      const cached = await readVoicePreviewClip(cacheKey);
      if (token !== previewTokenRef.current) return; // 等待期间被停掉/换了别的音色
      if (cached) {
        const audio = new Audio(URL.createObjectURL(cached));
        previewAudioRef.current = audio;
        audio.onended = () => {
          if (previewAudioRef.current !== audio) return;
          previewAudioRef.current = null;
          URL.revokeObjectURL(audio.src);
          setPreviewingId(null);
        };
        try {
          await audio.play();
        } catch (e) {
          console.error('[Spoor] voice preview playback failed', e);
          if (previewAudioRef.current === audio) stopPreview();
        }
        return;
      }

      // 第一次：现合成，一边放一边把音频留下来给下次用。
      const queue = createTtsSentenceQueue({
        apiKey: (aiConfig.minimaxApiKey || '').trim(),
        model,
        voiceId,
        language: i18n.language,
        recordAudio: true,
        onError: (message) => {
          console.error('[Spoor] voice preview failed', message);
          if (previewRef.current === queue) {
            previewRef.current = null;
            setPreviewingId(null);
          }
        },
      });
      previewRef.current = queue;
      const finished = await speakWholeText(queue, line, {
        isStillCurrent: () => previewRef.current === queue && token === previewTokenRef.current,
      });
      if (previewRef.current !== queue) return;
      previewRef.current = null;
      setPreviewingId(null);
      if (!finished) return; // 被停掉/被打断：录到的音频可能不完整，不缓存
      const wavBytes = queue.takeRecordedWavBytes();
      if (wavBytes) void writeVoicePreviewClip(cacheKey, wavBytes);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aiConfig.minimaxApiKey, aiConfig.minimaxTtsModel, i18n.language, previewingId, stopPreview, t],
  );

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = value ? MINIMAX_SYSTEM_VOICES.find((v) => v.id === value) : undefined;
  // 表里查不到的 id（自填或账号里的克隆音色）也照实显示，别让它看起来像没设置。
  const triggerLabel = value ? (selected?.label ?? value) : t('agents.voice_default');

  const needle = query.trim().toLowerCase();
  const groups = minimaxVoiceGroups(i18n.language).map((group) => ({
    language: group.language,
    voices: needle
      ? group.voices.filter(
          (v) => v.label.toLowerCase().includes(needle) || v.id.toLowerCase().includes(needle),
        )
      : group.voices,
  }));
  const noMatch = groups.every((g) => g.voices.length === 0);

  const optionRow = (opts: {
    key: string;
    testId: string;
    label: string;
    isSelected: boolean;
    onPick: () => void;
    /** 试听用的音色 id；给 undefined（默认项、克隆音色）就不显示试听键。 */
    previewId?: string;
  }) => {
    const previewing = Boolean(opts.previewId) && previewingId === opts.previewId;
    return (
      <div
        key={opts.key}
        className={`flex w-full min-w-0 items-center gap-1 rounded-lg transition-colors ${
          opts.isSelected ? 'bg-[#FFF7ED]' : 'hover:bg-[#F4F1ED]'
        }`}
      >
        <button
          type="button"
          role="menuitem"
          aria-checked={opts.isSelected}
          data-testid={opts.testId}
          onClick={opts.onPick}
          className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px] ${
            opts.isSelected ? 'font-bold text-[#C2410C]' : 'text-[#1a1a1a]'
          }`}
        >
          <span className="min-w-0 flex-1 truncate">{opts.label}</span>
          {opts.isSelected ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
        </button>
        {canPreview && opts.previewId ? (
          <button
            type="button"
            data-testid={`${opts.testId}-preview`}
            onClick={() => void previewVoice(opts.previewId!)}
            title={t(previewing ? 'agents.voice_preview_stop' : 'agents.voice_preview')}
            aria-label={t(previewing ? 'agents.voice_preview_stop' : 'agents.voice_preview')}
            className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#8c8a84] transition-colors hover:bg-white hover:text-[#C2410C]"
          >
            {previewing ? (
              <Square className="h-3 w-3" aria-hidden />
            ) : (
              <Play className="h-3 w-3" aria-hidden />
            )}
          </button>
        ) : null}
      </div>
    );
  };

  return (
    <span ref={rootRef} className="relative inline-flex shrink-0">
      <button
        type="button"
        data-testid="agent-studio-voice"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 max-w-[11rem] items-center gap-1.5 rounded-lg border border-[#E6E4DF] bg-white px-2.5 text-left text-[13px] text-[#1a1a1a] transition-colors hover:border-[#C2410C]/40 focus:outline-none focus:ring-1 focus:ring-[#C2410C]"
      >
        <Volume2 className="h-4 w-4 shrink-0 text-[#8c8a84]" aria-hidden />
        <span className="min-w-0 truncate">{triggerLabel}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[#8c8a84]" aria-hidden />
      </button>
      {open ? (
        <div
          role="dialog"
          data-testid="agent-studio-voice-menu"
          className="absolute right-0 top-full z-30 mt-1 w-72 rounded-xl border border-[#E6E4DF] bg-white p-1 shadow-xl"
        >
          <input
            data-testid="agent-studio-voice-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('agents.voice_search')}
            className="mb-1 w-full rounded-lg bg-[#F4F1ED] px-3 py-1.5 text-[12px] text-[#1a1a1a] outline-none placeholder:text-[#a8a49c] focus:bg-white focus:ring-1 focus:ring-[#C2410C]/30"
          />
          <div className="max-h-64 overflow-y-auto overscroll-contain">
            {optionRow({
              key: 'default',
              testId: 'agent-studio-voice-option-default',
              label: t('agents.voice_default'),
              isSelected: !value,
              onPick: () => {
                onChange(undefined);
                setOpen(false);
              },
            })}
            {groups.map((group) =>
              group.voices.length === 0 ? null : (
                <div key={group.language}>
                  <p className="px-2 pb-0.5 pt-1 text-[10px] tracking-[0.06em] text-[#8c8a84]">
                    {t(
                      group.language === 'zh'
                        ? 'agents.voice_group_zh'
                        : 'agents.voice_group_en',
                    )}
                  </p>
                  {group.voices.map((voice) =>
                    optionRow({
                      key: voice.id,
                      testId: `agent-studio-voice-option-${voice.id}`,
                      label: voice.label,
                      isSelected: voice.id === value,
                      previewId: voice.id,
                      onPick: () => {
                        onChange(voice.id);
                        setOpen(false);
                      },
                    }),
                  )}
                </div>
              ),
            )}
            {noMatch ? (
              <p className="px-3 py-2 text-[11px] text-[#8a8a82]">{t('agents.voice_empty')}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </span>
  );
}

function PersonasPane({
  agentConfigs,
  setAgentConfigs,
  aiConfig,
  callAI,
  onGenerateCover,
  generatingCoverAgentId,
}: AgentsStudioProps) {
  const { t, i18n } = useTranslation();
  const { confirm, alert: appAlert } = useAppDialog();
  const [activeAgentId, setActiveAgentId] = useState<string | null>(agentConfigs[0]?.id || null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [isImportingFromDoc, setIsImportingFromDoc] = useState(false);
  const [isSandboxOpen, setIsSandboxOpen] = useState(false);
  const [sandboxMessages, setSandboxMessages] = useState<SandboxChatMessage[]>([]);
  const [sandboxInput, setSandboxInput] = useState('');
  const [isSandboxLoading, setIsSandboxLoading] = useState(false);
  const [editingKnowledgeFile, setEditingKnowledgeFile] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const knowledgeFileInputRef = useRef<HTMLInputElement>(null);
  const knowledgeEditorRef = useRef<HTMLDivElement | null>(null);
  const coverFileInputRef = useRef<HTMLInputElement>(null);
  const promptDocInputRef = useRef<HTMLInputElement>(null);
  const sandboxUiAgentRef = useRef<string | null>(null);
  const agentConfigsRef = useRef(agentConfigs);
  agentConfigsRef.current = agentConfigs;

  const activeAgent = agentConfigs.find((a) => a.id === activeAgentId) || agentConfigs[0];

  const resolvedName = activeAgent ? resolveAgentLocalizedName(activeAgent) : '';
  const resolvedPrompt = activeAgent ? resolveAgentSystemPrompt(activeAgent) : '';

  const patchActiveAgent = useCallback(
    (patch: Partial<AgentConfig>) => {
      const id = activeAgentId;
      if (!id) return;
      const latest = agentConfigsRef.current;
      void setAgentConfigs(latest.map((a) => (a.id === id ? { ...a, ...patch } : a)));
    },
    [activeAgentId, setAgentConfigs],
  );

  const nameField = useImeSafeText(activeAgent?.id ?? '', resolvedName, (value) => {
    patchActiveAgent({ name: value });
  });
  const promptField = useImeSafeText(activeAgent?.id ?? '', resolvedPrompt, (value) => {
    patchActiveAgent({ prompt: value });
  });

  const displayName = nameField.value;
  const displayPrompt = promptField.value;

  useEffect(() => {
    sandboxUiAgentRef.current = activeAgentId;
    setIsSandboxLoading(false);
    setEditingKnowledgeFile(null);

    let cancelled = false;
    (async () => {
      if (!activeAgentId) {
        setSandboxMessages([]);
        return;
      }
      const row = await db.agentSandboxThreads.get(activeAgentId);
      if (cancelled) return;
      setSandboxMessages(row?.messages ?? []);
    })();

    return () => {
      cancelled = true;
    };
  }, [activeAgentId]);

  useEffect(() => {
    if (!editingKnowledgeFile) return;

    const closeEditor = () => setEditingKnowledgeFile(null);

    const handlePointerDown = (event: MouseEvent) => {
      const root = knowledgeEditorRef.current;
      if (!root || root.contains(event.target as Node)) return;
      closeEditor();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeEditor();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [editingKnowledgeFile]);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [sandboxMessages, isSandboxLoading]);

  const handleAddAgent = () => {
    const newId = "agent-" + Math.random().toString(36).substr(2, 9);
    setAgentConfigs([...agentConfigs, {
      id: newId,
      name: t('agents.new_persona'),
      role: t('agents.persona_default_role'),
      prompt: '',
      temperature: 0.7,
      creativity: 0.4
    }]);
    setActiveAgentId(newId);
  };

  const handleUpdateActiveAgent = (field: string, value: string | number) => {
    patchActiveAgent({ [field]: value } as Partial<AgentConfig>);
  };

  const setActiveAgentKnowledgeFiles = (next: AgentMarkdownKnowledgeFile[] | undefined) => {
    patchActiveAgent({ knowledgeMarkdownFiles: next?.length ? next : undefined });
  };

  const openKnowledgeFilePicker = () => knowledgeFileInputRef.current?.click();
  const openCoverFilePicker = () => coverFileInputRef.current?.click();

  const handleCoverFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeAgentId) return;
    if (!file.type.startsWith('image/')) {
      void appAlert({ message: t('agents.card_cover_not_image') });
      return;
    }
    if (file.size > AGENT_COVER_MAX_BYTES) {
      void appAlert({ message: t('agents.card_cover_too_large') });
      return;
    }
    try {
      // 手机相片几 MB，直接当 data URL 存会把本地库撑大、也过不了云端单次上传上限：
      // 这里先转成 WebP（长边 1600），压不动的情况会原样返回。
      const dataUrl = await toCoverImageDataUrl(file);
      await setAgentConfigs(
        agentConfigs.map((a) => (a.id === activeAgentId ? { ...a, coverImageUrl: dataUrl } : a)),
      );
      await syncAgentCanvasCardSize(activeAgentId, true);
    } catch {
      void appAlert({ message: t('agents.card_cover_read_failed') });
    }
  };

  const readOneFileAsText = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('read'));
      reader.readAsText(file, 'UTF-8');
    });

  const handleKnowledgeFilesChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    e.target.value = '';
    if (!list?.length || !activeAgentId || !activeAgent) return;

    const errors: string[] = [];
    const merged = new Map((activeAgent.knowledgeMarkdownFiles ?? []).map((f) => [f.name, f]));

    for (const file of Array.from(list)) {
      if (!isAgentMarkdownFilename(file.name)) {
        errors.push(t('agents.knowledge_not_markdown', { name: file.name }));
        continue;
      }
      if (file.size > AGENT_KNOWLEDGE_MAX_FILE_BYTES) {
        errors.push(t('agents.knowledge_file_too_large', { name: file.name }));
        continue;
      }
      try {
        const content = await readOneFileAsText(file);
        merged.set(file.name, { name: file.name, content });
      } catch {
        errors.push(t('agents.knowledge_read_failed', { name: file.name }));
      }
    }

    if (errors.length) {
      void appAlert({ message: errors.join('\n') });
    }
    if (merged.size > 0) {
      setActiveAgentKnowledgeFiles(Array.from(merged.values()));
    }
  };

  const removeKnowledgeFile = (fileName: string) => {
    if (!activeAgent) return;
    const next = (activeAgent.knowledgeMarkdownFiles ?? []).filter((f) => f.name !== fileName);
    setActiveAgentKnowledgeFiles(next.length ? next : undefined);
    if (editingKnowledgeFile === fileName) {
      setEditingKnowledgeFile(null);
    }
  };

  const updateKnowledgeFileContent = (fileName: string, content: string) => {
    if (!activeAgent) return;
    const next = (activeAgent.knowledgeMarkdownFiles ?? []).map((f) =>
      f.name === fileName ? { ...f, content } : f,
    );
    setActiveAgentKnowledgeFiles(next);
  };

  const openPromptDocPicker = () => promptDocInputRef.current?.click();

  const handlePromptFromDocument = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeAgent || !activeAgentId) return;
    if (!isPersonaPromptDocument(file)) {
      void appAlert({ message: t('agents.prompt_from_doc_not_supported') });
      return;
    }
    if (file.size > PERSONA_PROMPT_DOC_MAX_BYTES) {
      void appAlert({ message: t('agents.prompt_from_doc_too_large') });
      return;
    }
    if (displayPrompt.trim()) {
      const ok = await confirm({
        message: t('agents.prompt_from_doc_overwrite'),
        confirmLabel: t('dialog.confirm'),
        cancelLabel: t('dialog.cancel'),
      });
      if (!ok) return;
    }

    setIsImportingFromDoc(true);
    try {
      const extracted = truncateDocumentText(await extractDocumentText(file));
      if (!extracted) {
        void appAlert({ message: t('agents.prompt_from_doc_empty') });
        return;
      }
      const newPrompt = await callAI({
        config: aiConfig,
        systemInstruction: getLocaleDirective(),
        prompt: t('agents.studio.from_document_user', {
          name: resolveAgentLocalizedName(activeAgent),
          role: resolveAgentLocalizedRole(activeAgent),
          filename: file.name,
          document: extracted,
        }),
        temperature: activeAgent.temperature ?? 0.7,
        topP: activeAgent.creativity ?? 0.4,
      });
      const drafted = (newPrompt ?? '')
        .trim()
        .replace(/^(New Enhanced Prompt:|新增强提示词[:：])\s*/i, '')
        .trim();
      if (!drafted) {
        void appAlert({ message: t('agents.prompt_from_doc_failed') });
        return;
      }
      promptField.replace(drafted);
    } catch (error) {
      const msg = formatAiError(error);
      console.error('[Scribe AI] prompt from document failed', msg);
      void appAlert({
        message: `${t('agents.prompt_from_doc_failed')}\n\n${msg}`,
      });
    } finally {
      setIsImportingFromDoc(false);
    }
  };

  const handleEnhancePrompt = async () => {
    if (!activeAgent || !displayPrompt.trim()) return;
    setIsEnhancing(true);
    try {
      const newPrompt = await callAI({
        config: aiConfig,
        systemInstruction: getLocaleDirective(),
        prompt: t('agents.studio.enhance_user', {
          name: resolveAgentLocalizedName(activeAgent),
          role: resolveAgentLocalizedRole(activeAgent),
          prompt: displayPrompt,
        }),
        temperature: activeAgent.temperature ?? 0.7,
        topP: activeAgent.creativity ?? 0.4,
      });

      let enhanced = newPrompt.trim();
      enhanced = enhanced.replace(/^(New Enhanced Prompt:|新增强提示词[:：])\s*/i, '').trim();
      promptField.replace(enhanced);
    } catch (error) {
      const msg = formatAiError(error);
      console.error('[Scribe AI] enhance prompt failed', msg);
      void appAlert({
        message: `增强提示词失败\n\n${msg}\n\nF12 → Console 查看 [Scribe AI] 日志。`,
      });
    } finally {
      setIsEnhancing(false);
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!sandboxInput.trim() || isSandboxLoading || !activeAgent) return;

    const scopedAgentId = activeAgent.id;
    const userMsg = sandboxInput.trim();

    const afterUser: SandboxChatMessage[] = [...sandboxMessages, { role: 'user', text: userMsg }];
    setSandboxMessages(afterUser);
    setSandboxInput('');
    setIsSandboxLoading(true);

    try {
      await persistSandboxThread(scopedAgentId, afterUser);
    } catch (err) {
      console.error('[Scribe AI] sandbox persist (user msg) failed', err);
    }

    const streamingModel: SandboxChatMessage = { role: 'model', text: '' };
    if (sandboxUiAgentRef.current === scopedAgentId) {
      setSandboxMessages([...afterUser, streamingModel]);
    }

    try {
      const responseText = await callAI({
        config: aiConfig,
        prompt: userMsg,
        systemInstruction: buildAgentSystemInstruction(activeAgent, {
          fallbackPrompt: t('agents.studio.fallback_assistant'),
        }),
        temperature: activeAgent.temperature ?? 0.7,
        topP: activeAgent.creativity ?? 0.4,
        onStreamChunk: (acc) => {
          if (sandboxUiAgentRef.current !== scopedAgentId) return;
          setSandboxMessages((prev) => {
            const base = prev.length > 0 && prev[prev.length - 1]?.role === 'model' ? prev.slice(0, -1) : prev;
            return [...base, { role: 'model', text: acc }];
          });
        },
      });
      const afterModel: SandboxChatMessage[] = [...afterUser, { role: 'model', text: responseText }];
      if (sandboxUiAgentRef.current === scopedAgentId) {
        setSandboxMessages(afterModel);
      }
      try {
        await persistSandboxThread(scopedAgentId, afterModel);
      } catch (err) {
        console.error('[Scribe AI] sandbox persist (assistant) failed', err);
      }
    } catch (error) {
      const msg = formatAiError(error);
      console.error('[Scribe AI] sandbox chat failed', msg);
      const errLine: SandboxChatMessage = {
        role: 'model',
        text: `Error: ${msg}（详见 Console [Scribe AI]）`,
      };
      const afterErr: SandboxChatMessage[] = [...afterUser, errLine];
      if (sandboxUiAgentRef.current === scopedAgentId) {
        setSandboxMessages(afterErr);
      }
      try {
        await persistSandboxThread(scopedAgentId, afterErr);
      } catch (err) {
        console.error('[Scribe AI] sandbox persist (error bubble) failed', err);
      }
    } finally {
      if (sandboxUiAgentRef.current === scopedAgentId) {
        setIsSandboxLoading(false);
      }
    }
  };

  const handleClearSandboxChat = async () => {
    if (!activeAgentId || sandboxMessages.length === 0) return;
    const ok = await confirm({ message: t('agents.sandbox_clear_confirm'), variant: 'danger' });
    if (!ok) return;
    setSandboxMessages([]);
    try {
      await db.agentSandboxThreads.delete(activeAgentId);
    } catch (err) {
      console.error('[Scribe AI] sandbox clear failed', err);
    }
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({ message: t('agents.delete_confirm'), variant: 'danger' });
    if (!ok) return;
    const newConfigs = agentConfigs.filter((a) => a.id !== id);
    await setAgentConfigs(newConfigs);
    try {
      await db.agentSandboxThreads.delete(id);
    } catch (err) {
      console.error('[Scribe AI] sandbox thread delete failed', err);
    }
    if (activeAgentId === id) {
      setActiveAgentId(newConfigs[0]?.id || null);
    }
  };

  const listedAgents = dedupeAgentsForList(agentConfigs);
  const filteredAgents = listedAgents.filter((a) =>
    resolveAgentLocalizedName(a).toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex-1 flex min-h-0 bg-[#FAF9F6] overflow-hidden">
      {/* Pane 1: Persona List */}
      <section className="w-56 compact:w-48 shrink-0 flex flex-col min-h-0 border-r border-[#E6E4DF] bg-white z-10">
        <div className="p-4 border-b border-[#E6E4DF] flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <input
              className="w-full pl-9 pr-3 py-2 text-xs font-sans bg-white border border-[#E6E4DF] rounded-lg focus:ring-1 focus:ring-[#C2410C] focus:border-[#C2410C] outline-none"
              placeholder={t('agents.search_personas')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              type="search"
              autoComplete="off"
              aria-label={t('agents.search_personas')}
            />
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#8c8a84] pointer-events-none" />
          </div>
          <button
            type="button"
            onClick={handleAddAgent}
            aria-label={t('agents.new_persona')}
            className="text-[#C2410C] hover:bg-[#F4F1ED] p-1 rounded-full transition-colors flex items-center justify-center shrink-0"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div>
            {filteredAgents.map((agent) => (
              <div 
                key={agent.id}
                onClick={() => {
                  setActiveAgentId(agent.id);
                }}
                className={`p-4 cursor-pointer transition-colors border-l-4 ${activeAgentId === agent.id ? 'bg-[#F4F1ED] border-[#C2410C]' : 'hover:bg-[#F4F1ED]/50 border-transparent'}`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-[#FFF7ED] border border-[#E6E4DF] flex items-center justify-center overflow-hidden">
                    <AgentIcon
                      agentId={agent.id}
                      coverUrl={agent.coverImageUrl}
                      className="w-full h-full"
                      imageClassName="scale-[1.32]"
                      fallbackClassName={activeAgentId === agent.id ? 'text-[#C2410C]' : 'text-[#8c8a84]'}
                    />
                  </div>
                  <div className="min-w-0">
                    <h4 className={`font-bold truncate ${activeAgentId === agent.id ? 'text-[#1a1a1a]' : 'text-[#5a5a54]'}`}>{resolveAgentLocalizedName(agent)}</h4>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pane 2: Workspace/Editor */}
      <section className="flex-1 flex flex-col min-h-0 overflow-y-auto relative">
        {activeAgent ? (
          <>
            <div className="sticky top-0 bg-[#FAF9F6]/80 backdrop-blur-md px-10 py-6 border-b border-[#E6E4DF] flex flex-wrap items-end justify-between gap-x-4 gap-y-3 z-10">
              <div className="inline-flex items-center gap-2 w-fit max-w-full min-w-0">
                <input
                  ref={coverFileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  data-testid="agent-studio-cover-input"
                  onChange={(e) => void handleCoverFileChange(e)}
                />
                <button
                  type="button"
                  data-testid="agent-studio-upload-cover"
                  onClick={openCoverFilePicker}
                  title={t('agents.card_cover_upload')}
                  aria-label={t('agents.card_cover_upload')}
                  className="group relative w-12 h-12 rounded-xl bg-[#FFF7ED] border border-[#E6E4DF] flex items-center justify-center shrink-0 shadow-sm overflow-hidden hover:border-[#C2410C]/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C]/35 transition-colors"
                >
                  <AgentIcon
                    agentId={activeAgent.id}
                    coverUrl={activeAgent.coverImageUrl}
                    className="w-full h-full"
                    imageClassName="scale-[1.32]"
                    fallbackClassName="text-[#C2410C]"
                  />
                  <span className="absolute inset-0 z-[5] flex items-center justify-center bg-black/35 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity">
                    <Image className="w-5 h-5 text-white" aria-hidden />
                  </span>
                  {generatingCoverAgentId === activeAgent.id ? (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#FBF5EE]/70">
                      <Loader2 className="w-5 h-5 text-[#C2410C] animate-spin" aria-hidden />
                    </div>
                  ) : null}
                </button>
                <PersonaNameField
                  placeholder={t('agents.new_persona')}
                  aria-label={t('agents.persona_name')}
                  {...nameField.bind}
                />
                <input
                  ref={promptDocInputRef}
                  type="file"
                  accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="hidden"
                  data-testid="agent-studio-prompt-doc-input"
                  onChange={(e) => void handlePromptFromDocument(e)}
                />
                <button
                  type="button"
                  data-testid="agent-studio-generate-cover"
                  onClick={() => onGenerateCover?.(activeAgent.id)}
                  disabled={!onGenerateCover || generatingCoverAgentId !== null}
                  title={
                    activeAgent.coverImageUrl
                      ? t('agents.card_cover_regenerate')
                      : t('agents.card_cover_generate')
                  }
                  aria-label={
                    activeAgent.coverImageUrl
                      ? t('agents.card_cover_regenerate')
                      : t('agents.card_cover_generate')
                  }
                  className="shrink-0 flex h-9 w-9 items-center justify-center rounded-lg bg-white border border-[#E6E4DF] text-[#5a5a54] hover:text-[#C2410C] hover:border-[#C2410C]/30 hover:bg-[#F4F1ED] transition-colors disabled:opacity-50"
                >
                  {generatingCoverAgentId === activeAgent.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Image className="w-4 h-4" />
                  )}
                </button>
                {/* 朗读音色：和名旁这几个小按钮排在一起，菜单里每个音色都能试听。 */}
                <VoicePicker
                  aiConfig={aiConfig}
                  value={activeAgent.voiceId}
                  onChange={(next) => patchActiveAgent({ voiceId: next })}
                />
              </div>
              <div className="flex gap-3 shrink-0">
                <button 
                  onClick={() => setIsSandboxOpen(!isSandboxOpen)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg font-sans font-bold transition-all text-sm shadow-sm ${isSandboxOpen ? 'bg-[#C2410C] text-white shadow-[#C2410C]/20' : 'bg-white border border-[#E6E4DF] text-[#5a5a54] hover:bg-[#F4F1ED]'}`}
                >
                  <MessageSquare className="w-4 h-4" />
                  {isSandboxOpen ? t('agents.close_sandbox') : t('agents.test_sandbox')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(activeAgent.id)}
                  className="px-6 py-2 text-[#ef4444] rounded-lg font-sans font-bold hover:bg-[#ef4444]/10 transition-all text-sm"
                >
                  {t('agents.delete_persona')}
                </button>
              </div>
            </div>

            <div className="p-10 max-w-4xl w-full mx-auto md:mx-0">
              <div className="grid grid-cols-1 gap-12 pb-32">
                {/* Identity Section */}
                <div className="space-y-6">
                  <div className="flex items-center gap-4">
                    <div className="w-1 h-8 bg-[#C2410C] rounded-full"></div>
                    <h3 className="text-xl font-serif font-bold text-[#1a1a1a]">{t('agents.identity_tone')}</h3>
                    {/* 从文档生成：归到这一节里，只留图标 —— 说明放在 title/aria-label 上，
                        免得跟标题抢注意力。 */}
                    <button
                      type="button"
                      data-testid="agent-studio-prompt-from-doc"
                      onClick={openPromptDocPicker}
                      disabled={isImportingFromDoc || isEnhancing}
                      title={
                        isImportingFromDoc
                          ? t('agents.prompt_from_doc_working')
                          : t('agents.prompt_from_doc_hint')
                      }
                      aria-label={t('agents.prompt_from_doc')}
                      className="shrink-0 flex h-8 w-8 items-center justify-center rounded-lg bg-white border border-[#E6E4DF] text-[#5a5a54] hover:text-[#C2410C] hover:border-[#C2410C]/30 hover:bg-[#F4F1ED] transition-colors disabled:opacity-50"
                    >
                      {isImportingFromDoc ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <FileUp className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between items-end">
                      <label className="text-xs font-mono font-bold text-[#5a5a54] uppercase tracking-wider">{t('agents.system_prompt')}</label>
                      <div className="flex items-center gap-3">
                        <span className={`${(displayPrompt.length || 0) > 2000 ? 'text-red-500' : 'text-[#5a5a54]'} text-xs font-mono`}>{displayPrompt.length} / 2000</span>
                        <button
                          onClick={handleEnhancePrompt}
                          disabled={isEnhancing || isImportingFromDoc || !displayPrompt.trim()}
                          className="flex items-center gap-1.5 text-xs font-bold text-[#C2410C] hover:text-[#9a3412] px-2 py-1 bg-[#C2410C]/5 rounded border border-[#C2410C]/20 transition-all disabled:opacity-50"
                        >
                          {isEnhancing ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Wand2 className="w-3.5 h-3.5" />}
                          {t('agents.enhance_prompt')}
                        </button>
                      </div>
                    </div>
                    <textarea
                      data-testid="agent-studio-system-prompt"
                      className={`w-full p-4 font-mono text-base leading-relaxed text-[#1a1a1a] bg-white border ${displayPrompt.length > 2000 ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : 'border-[#E6E4DF] focus:border-[#C2410C] focus:ring-[#C2410C]'} rounded-lg outline-none transition-colors overflow-y-auto resize-y min-h-[180px]`}
                      style={{ height: Math.max(180, (displayPrompt.split('\n').length || 1) * 26 + 40) + 'px' }}
                      placeholder={t('agents.prompt_placeholder')}
                      {...promptField.bind}
                    />
                  </div>
                </div>

                {/* Knowledge Section */}
                <div className="space-y-6">
                  <div className="flex items-center gap-4">
                    <div className="w-1 h-8 bg-[#C2410C] rounded-full"></div>
                    <h3 className="text-xl font-serif font-bold text-[#1a1a1a]">{t('agents.knowledge_base')}</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="md:col-span-2 p-6 bg-white border border-[#E6E4DF] rounded-xl space-y-4 shadow-sm">
                      <input
                        ref={knowledgeFileInputRef}
                        type="file"
                        accept=".md,.markdown,text/markdown,text/x-markdown"
                        multiple
                        className="hidden"
                        onChange={(e) => void handleKnowledgeFilesChange(e)}
                      />
                      <div className="flex justify-between items-center">
                        <h4 className="font-sans font-bold text-[#1a1a1a]">{t('agents.knowledge_custom_title')}</h4>
                        <button
                          type="button"
                          onClick={openKnowledgeFilePicker}
                          className="text-xs text-[#C2410C] font-bold hover:underline"
                        >
                          {t('agents.knowledge_manage_files')}
                        </button>
                      </div>
                      <p className="text-sm text-[#5a5a54] font-sans leading-relaxed">{t('agents.knowledge_hint')}</p>
                      <div className="space-y-2 min-h-[3rem]">
                        {(activeAgent.knowledgeMarkdownFiles ?? []).length === 0 ? (
                          <p className="text-sm text-[#5a5a54] font-sans py-2">{t('agents.knowledge_empty')}</p>
                        ) : (
                          (activeAgent.knowledgeMarkdownFiles ?? []).map((f) => {
                            const isEditing = editingKnowledgeFile === f.name;
                            return (
                              <div
                                key={f.name}
                                ref={isEditing ? knowledgeEditorRef : undefined}
                                className={`rounded-lg border overflow-hidden transition-colors ${
                                  isEditing
                                    ? 'border-[#C2410C]/35 bg-white shadow-sm'
                                    : 'border-[#E6E4DF] bg-[#F4F1ED]'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2 p-3">
                                  <button
                                    type="button"
                                    onClick={() => setEditingKnowledgeFile(isEditing ? null : f.name)}
                                    className="flex items-center gap-3 min-w-0 flex-1 text-left hover:text-[#C2410C] transition-colors"
                                    aria-expanded={isEditing}
                                    aria-label={t('agents.knowledge_edit_file', { name: f.name })}
                                  >
                                    <FileText className="w-4 h-4 text-[#8c8a84] shrink-0" />
                                    <span className="text-sm font-sans font-medium text-[#1a1a1a] truncate">
                                      {f.name}
                                    </span>
                                  </button>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <span className="text-xs text-[#5a5a54] font-mono">
                                      {t('agents.knowledge_chars', { count: f.content.length })}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => removeKnowledgeFile(f.name)}
                                      className="p-1.5 rounded-md text-[#8c8a84] hover:text-[#ef4444] hover:bg-[#fee2e2] transition-colors"
                                      aria-label={t('agents.knowledge_remove_file', { name: f.name })}
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                </div>
                                {isEditing ? (
                                  <textarea
                                    className="w-full min-h-[12rem] max-h-[28rem] p-3 font-mono text-sm leading-relaxed text-[#1a1a1a] bg-white border-0 border-t border-[#E6E4DF] focus:ring-0 focus:outline-none resize-y"
                                    value={f.content}
                                    onChange={(e) => updateKnowledgeFileContent(f.name, e.target.value)}
                                    aria-label={t('agents.knowledge_edit_file', { name: f.name })}
                                  />
                                ) : null}
                              </div>
                            );
                          })
                        )}
                      </div>
                      <div className="pt-4 border-t border-[#E6E4DF] flex items-center justify-center">
                        <button
                          type="button"
                          onClick={openKnowledgeFilePicker}
                          className="flex items-center gap-2 text-[#C2410C] hover:text-[#9a3412] font-sans text-sm font-bold transition-colors"
                        >
                          <Plus className="w-4 h-4" /> {t('agents.knowledge_add_md')}
                        </button>
                      </div>
                    </div>
                    <div className="p-6 bg-white text-[#1a1a1a] border border-[#E6E4DF] rounded-xl flex flex-col justify-between shadow-sm">
                      <div>
                        <h4 className="font-sans font-bold mb-2">{t('agents.model_params')}</h4>
                        <div className="space-y-4 mt-6">
                          <div className="space-y-1">
                            <div className="flex justify-between text-xs uppercase font-mono tracking-widest text-[#5a5a54] mb-2">
                              <span>{t('agents.temp')}</span>
                              <span>{activeAgent.temperature ?? 0.7}</span>
                            </div>
                            <input 
                              type="range" 
                              min="0" max="2" step="0.1" 
                              value={activeAgent.temperature ?? 0.7}
                              onChange={(e) => handleUpdateActiveAgent('temperature', parseFloat(e.target.value))}
                              className="w-full accent-[#C2410C] h-1 bg-[#F4F1ED] rounded-lg appearance-none cursor-pointer"
                            />
                          </div>
                          <div className="space-y-1 mt-4">
                            <div className="flex justify-between text-xs uppercase font-mono tracking-widest text-[#5a5a54] mb-2">
                              <span>{t('agents.creativity')}</span>
                              <span>{activeAgent.creativity ?? 0.4}</span>
                            </div>
                            <input 
                              type="range" 
                              min="0" max="1" step="0.1" 
                              value={activeAgent.creativity ?? 0.4}
                              onChange={(e) => handleUpdateActiveAgent('creativity', parseFloat(e.target.value))}
                              className="w-full accent-[#C2410C] h-1 bg-[#F4F1ED] rounded-lg appearance-none cursor-pointer"
                            />
                          </div>
                        </div>
                      </div>
                      <div className="text-xs font-mono text-[#5a5a54] mt-6">
                        {t('agents.model_params_footer')}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Test Sandbox Panel */}
            {isSandboxOpen && (
              <div className="absolute inset-y-0 right-0 z-20 flex w-[min(100vw,400px)] compact:w-[min(100vw,320px)] min-h-0 flex-col border-l border-[#E6E4DF] bg-[#FAF9F6] shadow-[-12px_0_32px_rgba(0,0,0,0.06)] animate-in slide-in-from-right duration-300">
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#E6E4DF] bg-[#F4F1ED]/50 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <MessageSquare className="h-4 w-4 shrink-0 text-[#C2410C]" />
                    <span className="truncate font-serif font-bold text-[#1a1a1a]">
                      {t('agents.sandbox_title', { name: displayName })}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void handleClearSandboxChat()}
                      disabled={sandboxMessages.length === 0 || isSandboxLoading}
                      title={t('agents.sandbox_clear')}
                      aria-label={t('agents.sandbox_clear_aria')}
                      className="rounded-md p-2 text-[#8c8a84] transition-colors hover:bg-[#E6E4DF]/60 hover:text-[#1a1a1a] disabled:pointer-events-none disabled:opacity-30"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsSandboxOpen(false)}
                      className="rounded-md p-2 text-[#8c8a84] hover:bg-[#E6E4DF]/60 hover:text-[#1a1a1a]"
                      aria-label={t('agents.close_sandbox')}
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
                  {sandboxMessages.length === 0 && (
                    <div className="text-center py-10 px-4">
                      <Bot className="w-10 h-10 text-[#E6E4DF] mx-auto mb-3" />
                      <p className="text-xs text-[#8c8a84] font-sans">
                        {t('agents.sandbox_empty', { name: displayName })}
                      </p>
                    </div>
                  )}
                  {sandboxMessages.map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm font-sans shadow-sm ${
                        msg.role === 'user' 
                          ? 'bg-[#EAE7E2] text-[#1a1a1a] rounded-tr-none border border-[#D9D6D1]' 
                          : 'bg-white border border-[#E6E4DF] text-[#1a1a1a] rounded-tl-none'
                      }`}>
                        {msg.text}
                      </div>
                    </div>
                  ))}
                  {isSandboxLoading && (
                    <div className="flex justify-start">
                      <div className="bg-white border border-[#E6E4DF] px-4 py-2.5 rounded-2xl rounded-tl-none shadow-sm flex items-center gap-2">
                        <Loader2 className="w-4 h-4 text-[#C2410C] animate-spin" />
                        <span className="text-xs text-[#8c8a84] italic">{t('agents.ai_thinking')}</span>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                <div className="shrink-0 border-t border-[#E6E4DF] bg-[#FAF9F6] p-4">
                  <form onSubmit={handleSendMessage} className="relative">
                    <input 
                      type="text"
                      className="w-full rounded-xl border border-[#E6E4DF] bg-white py-3 pl-4 pr-12 text-sm font-sans shadow-sm transition-all focus:border-[#C2410C] focus:outline-none focus:ring-1 focus:ring-[#C2410C]"
                      placeholder={t('agents.message_placeholder', { name: displayName })}
                      value={sandboxInput}
                      onChange={e => setSandboxInput(e.target.value)}
                    />
                    <button 
                      type="submit"
                      disabled={!sandboxInput.trim() || isSandboxLoading}
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg bg-[#C2410C] text-white flex items-center justify-center hover:bg-[#9a3412] transition-colors disabled:opacity-50"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </form>
                  <p className="text-[10px] text-center text-[#8c8a84] mt-2 font-mono">
                    {t('agents.sandbox_note')}
                  </p>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center opacity-50">
            <Bot className="w-16 h-16 text-[#8c8a84] mb-4" />
            <h2 className="font-serif text-2xl font-bold text-[#1a1a1a]">{t('agents.select_persona')}</h2>
            <p className="font-sans text-[#5a5a54] mt-2">{t('agents.select_subtitle')}</p>
          </div>
        )}
      </section>
    </div>
  );
}
