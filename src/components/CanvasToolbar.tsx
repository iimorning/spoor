import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  MapPin,
  Bot,
  Edit3,
  Mic,
  ZoomIn,
  Scan,
  FileText as FileTextIcon,
  PenLine,
  Loader2,
  Check,
  SquareDashed,
  ChevronRight,
  BookOpen,
} from 'lucide-react';
import type { AgentConfig } from '../db';
import { getCanvasCenterPosition, PUBLISH_MIN_SELECTION } from '../utils/canvas';
import { CANVAS_FILE_UPLOAD_ACCEPT } from '../utils/chatPanelFileUpload';
import { spawnAgentCardOnCanvas } from '../utils/spawnAgentCard';
import { resolveAgentLocalizedName } from '../utils/aiI18n';
import type { CanvasVoicePersona } from '../utils/canvasAskContext';
import { AgentIcon } from './AgentIcon';
import askFoxUrl from '../assets/ask-fox.png';
import { useAdaptiveLayout } from '../hooks/useAdaptiveLayout';
import { isTextEditingTarget } from '../utils/noteClipboard';
import { canvasOverlayProps } from '../utils/canvasOverlay';
import {
  readVoiceListenHintSeen,
  writeVoiceListenHintSeen,
} from '../utils/voiceListenHint';

export interface CanvasToolbarProps {
  addTextNode: () => void;
  addThemeNode: () => void;
  addEssayNode: () => void;
  addAskNode: () => void;
  addFileNode: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Activate voice mode on an Ask card (existing or freshly spawned). */
  onActivateVoice: () => void;
  /** Pin a canvas agent for toolbar voice (`null` = default Ask character). */
  onSelectVoicePersona?: (agentNodeId: string | null) => void;
  /** Agent cards currently on the active canvas — shown on mic hover. */
  canvasVoicePersonas?: CanvasVoicePersona[];
  /** True when an Ask card is on the canvas — only then offer 阿狸 in the mic picker. */
  showAskVoiceOption?: boolean;
  /** Pinned agent node id; `null` means the default Ask character. */
  pinnedVoiceAgentNodeId?: string | null;
  /** True while voice mode is active — drives the toolbar mic's active styling. */
  voiceModeActive?: boolean;
  /** Current voice loop phase; used to show live ASR above the mic. */
  voicePhase?: 'idle' | 'listening' | 'draft' | 'thinking' | 'speaking';
  /** Latest Volc ASR transcript while listening (updates as you speak). */
  liveTranscript?: string;
  agentConfigs: AgentConfig[];
  canvasTransform: { x: number; y: number; scale: number };
  setCanvasTransform: React.Dispatch<React.SetStateAction<{ x: number; y: number; scale: number }>>;
  transformRef: React.MutableRefObject<{ x: number; y: number; scale: number }>;
  activeCanvasId: string;
  /** Fit every card into the current viewport. */
  onFitCanvas?: () => void;
  /** Open the synthesize / publish outline flow. */
  onPublish: () => void;
  /** Number of currently selected canvas nodes (shown in title). */
  selectedCount: number;
  /** True while any AI job (incl. outline dialog) is busy. */
  publishDisabled?: boolean;
  /** True while the outline dialog is open / synthesizing. */
  publishBusy?: boolean;
  /** V2: toolbar toggle for drawing persona work zones. */
  canvasV2Enabled?: boolean;
  workZoneDrawMode?: boolean;
  onToggleWorkZoneDraw?: () => void;
}

function shouldIgnoreVoiceMicShortcut(target: EventTarget | null): boolean {
  if (isTextEditingTarget(target)) return true;
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      'button, [role="button"], a[href], summary, [role="menuitem"], [role="dialog"], [aria-modal="true"], [data-testid="settings-backdrop"], [data-testid="app-dialog-backdrop"]',
    ),
  );
}

export function CanvasToolbar({
  addTextNode,
  addThemeNode,
  addEssayNode,
  onActivateVoice,
  onSelectVoicePersona,
  canvasVoicePersonas = [],
  showAskVoiceOption = false,
  pinnedVoiceAgentNodeId = null,
  voiceModeActive = false,
  voicePhase = 'idle',
  liveTranscript = '',
  addAskNode,
  addFileNode,
  agentConfigs,
  canvasTransform,
  setCanvasTransform,
  transformRef,
  activeCanvasId,
  onFitCanvas,
  onPublish,
  selectedCount,
  publishDisabled = false,
  publishBusy = false,
  canvasV2Enabled = false,
  workZoneDrawMode = false,
  onToggleWorkZoneDraw,
}: CanvasToolbarProps) {
  const { t } = useTranslation();
  const { compact, touchChrome } = useAdaptiveLayout();
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  const [voicePickerHoverLocked, setVoicePickerHoverLocked] = useState(false);
  const [readyNudge, setReadyNudge] = useState(false);
  const voiceGroupRef = useRef<HTMLDivElement>(null);
  const sawStartupWaitRef = useRef(false);
  useEffect(() => {
    if (canvasV2Enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.key !== ' ' && event.code !== 'Space') || event.repeat) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (shouldIgnoreVoiceMicShortcut(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      onActivateVoice();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canvasV2Enabled, onActivateVoice]);

  const plusMenuPos = 'absolute bottom-full left-0 mb-2 w-52';
  const pinnedPersona = canvasVoicePersonas.find((p) => p.nodeId === pinnedVoiceAgentNodeId);
  const micLabel = pinnedPersona
    ? t('voice.toolbar_mic_with_persona', { name: pinnedPersona.name })
    : t('voice.toolbar_mic');
  const showVoicePicker = canvasVoicePersonas.length > 0;
  const showWaitForChime = voiceModeActive && voicePhase === 'idle';
  const showDraftHint = voiceModeActive && voicePhase === 'draft';
  const showReadyNudge = readyNudge && voicePhase === 'listening' && !voicePickerOpen;
  const showLiveCaption =
    voiceModeActive && voicePhase === 'listening' && !voicePickerOpen && !showReadyNudge;
  const showPersonaChip = voiceModeActive && showVoicePicker && !voicePickerOpen;

  const chipName = pinnedPersona
    ? pinnedPersona.name
    : t('voice.toolbar_mic_default', { name: t('ask.character_name') });

  useEffect(() => {
    if (!voicePickerOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (voiceGroupRef.current?.contains(event.target as Node)) return;
      setVoicePickerOpen(false);
      setVoicePickerHoverLocked(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [voicePickerOpen]);

  useEffect(() => {
    if (!voiceModeActive) {
      sawStartupWaitRef.current = false;
      setReadyNudge(false);
      return;
    }
    if (voicePhase === 'idle') sawStartupWaitRef.current = true;
  }, [voiceModeActive, voicePhase]);

  useEffect(() => {
    if (!voiceModeActive || voicePhase !== 'listening') return;
    if (!sawStartupWaitRef.current) return;
    if (readVoiceListenHintSeen()) return;
    setReadyNudge(true);
    writeVoiceListenHintSeen(true);
    const timer = window.setTimeout(() => setReadyNudge(false), 2800);
    return () => window.clearTimeout(timer);
  }, [voiceModeActive, voicePhase]);

  const selectVoicePersona = (agentNodeId: string | null) => {
    onSelectVoicePersona?.(agentNodeId);
    setVoicePickerOpen(false);
    setVoicePickerHoverLocked(true);
  };

  return (
    <>
      <div
        {...canvasOverlayProps}
        className="fixed bottom-3 left-1/2 z-40 -translate-x-1/2"
        data-no-drag=""
      >
          <div className="relative">
        <div
          className="flex items-center space-x-2 bg-white rounded-2xl border border-[#E6E4DF] p-2"
        >
          <div
            className="flex items-center gap-1 relative group pl-2 pr-2"
          >
            <div className="relative group/plus">
              <button
                type="button"
                onClick={addTextNode}
                title={t('sidebar.new_note')}
                data-testid="toolbar-plus"
                className={`flex items-center justify-center text-[#5a5a54] hover:text-[#1a1a1a] hover:bg-[#F4F1ED] rounded-lg cursor-pointer transition-colors ${
                  touchChrome ? 'w-10 h-10' : 'w-8 h-8'
                }`}
              >
                <Plus className={touchChrome ? 'w-5 h-5' : 'w-4 h-4'} />
              </button>
              <div
                {...canvasOverlayProps}
                className={`${plusMenuPos} bg-white border border-[#E6E4DF] rounded-xl shadow-xl opacity-0 invisible group-hover/plus:opacity-100 group-hover/plus:visible transition-all flex flex-col p-1 z-50 overflow-visible`}
              >
                <button
                  type="button"
                  onClick={addTextNode}
                  data-testid="toolbar-plus-new-note"
                  className="text-left px-3 py-2 text-sm text-[#1a1a1a] hover:bg-[#F4F1ED] rounded-lg mb-1 flex items-center gap-2 min-w-0"
                >
                  <Plus className="w-3.5 h-3.5 shrink-0 text-[#C2410C]" />
                  <span className="font-bold truncate">{t('sidebar.new_note')}</span>
                </button>
                <button
                  type="button"
                  onClick={addThemeNode}
                  data-testid="toolbar-plus-new-theme"
                  className="text-left px-3 py-2 text-sm text-[#1a1a1a] hover:bg-[#F4F1ED] rounded-lg mb-1 flex items-center gap-2 min-w-0"
                >
                  <MapPin className="w-3.5 h-3.5 shrink-0 text-[#C2410C]" />
                  <span className="font-bold truncate">{t('sidebar.new_theme_card')}</span>
                </button>
                <button
                  type="button"
                  onClick={addEssayNode}
                  data-testid="toolbar-plus-new-essay"
                  className="text-left px-3 py-2 text-sm text-[#1a1a1a] hover:bg-[#F4F1ED] rounded-lg mb-1 flex items-center gap-2 min-w-0"
                >
                  <BookOpen className="w-3.5 h-3.5 shrink-0 text-[#C2410C]" />
                  <span className="font-bold truncate">{t('canvas.add_essay_card')}</span>
                </button>
                <button
                  type="button"
                  onClick={addAskNode}
                  data-testid="toolbar-plus-add-ask"
                  className="text-left px-3 py-2 text-sm text-[#1a1a1a] hover:bg-[#F4F1ED] rounded-lg mb-1 flex items-center gap-2 min-w-0"
                >
                  <Edit3 className="w-3.5 h-3.5 shrink-0 text-[#C2410C]" />
                  <span className="font-bold truncate">{t('canvas.add_ask_card')}</span>
                </button>
                <div className="my-1 border-t border-[#E6E4DF]" />
                <div className="relative group/agents" data-testid="toolbar-plus-agents">
                  <div className="px-3 py-2 text-sm text-[#1a1a1a] hover:bg-[#F4F1ED] rounded-lg flex items-center gap-2 min-w-0 cursor-default">
                    <Bot className="w-3.5 h-3.5 shrink-0 text-[#C2410C]" />
                    <span className="font-bold truncate flex-1">{t('sidebar.agents')}</span>
                    <ChevronRight className="w-3.5 h-3.5 shrink-0 text-[#8c8a84]" />
                  </div>
                  <div
                    data-testid="toolbar-plus-agents-submenu"
                    className="absolute left-full bottom-0 z-50 pl-1 opacity-0 invisible group-hover/agents:opacity-100 group-hover/agents:visible"
                  >
                    <div className="w-52 bg-white border border-[#E6E4DF] rounded-xl shadow-xl flex flex-col p-1 max-h-72 overflow-y-auto overscroll-contain">
                      {agentConfigs.map((agent) => (
                        <button
                          key={agent.id}
                          type="button"
                          onClick={async () => {
                            await spawnAgentCardOnCanvas({
                              canvasId: activeCanvasId,
                              agentConfig: agent,
                              position: getCanvasCenterPosition(transformRef.current),
                            });
                          }}
                          className="text-left px-3 py-2 text-sm text-[#1a1a1a] hover:bg-[#F4F1ED] rounded-lg mb-1 last:mb-0 flex items-center gap-2 min-w-0"
                        >
                          <span className="w-5 h-5 rounded-md bg-[#FFF7ED] border border-[#E6E4DF] flex items-center justify-center shrink-0 overflow-hidden">
                            <AgentIcon
                              agentId={agent.id}
                              coverUrl={agent.coverImageUrl}
                              className="w-full h-full"
                              imageClassName="scale-[1.32]"
                              fallbackClassName="text-[#C2410C]"
                            />
                          </span>
                          <span className="font-bold truncate">{resolveAgentLocalizedName(agent)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <label
              title={t('canvas.upload_file')}
              aria-label={t('canvas.upload_file')}
              data-testid="toolbar-upload"
              className={`flex items-center justify-center text-[#5a5a54] hover:text-[#1a1a1a] hover:bg-[#F4F1ED] rounded-lg cursor-pointer transition-colors m-0 ${
                touchChrome ? 'w-10 h-10' : 'w-8 h-8'
              }`}
            >
              <FileTextIcon className={touchChrome ? 'w-5 h-5' : 'w-4 h-4'} />
              <input
                type="file"
                multiple
                accept={CANVAS_FILE_UPLOAD_ACCEPT}
                className="hidden"
                onChange={addFileNode}
              />
            </label>
            {canvasV2Enabled ? (
              <button
                type="button"
                title={t('canvas.v2.draw_work_zone')}
                aria-label={t('canvas.v2.draw_work_zone')}
                aria-pressed={workZoneDrawMode}
                data-testid="toolbar-draw-work-zone"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={onToggleWorkZoneDraw}
                className={`flex items-center justify-center rounded-lg cursor-pointer transition-colors ${
                  touchChrome ? 'w-10 h-10' : 'w-8 h-8'
                } ${
                  workZoneDrawMode
                    ? 'bg-[#C2410C] text-white hover:bg-[#a0350a]'
                    : 'text-[#5a5a54] hover:text-[#1a1a1a] hover:bg-[#F4F1ED]'
                }`}
              >
                <SquareDashed className={touchChrome ? 'w-5 h-5' : 'w-4 h-4'} aria-hidden />
              </button>
            ) : null}
            {canvasV2Enabled ? null : (
            <div
              ref={voiceGroupRef}
              className="relative"
              onPointerEnter={() => {
                if (!showVoicePicker || voicePickerHoverLocked) return;
                if (voiceModeActive && voicePhase === 'listening') return;
                setVoicePickerOpen(true);
              }}
              onPointerLeave={() => {
                setVoicePickerOpen(false);
                setVoicePickerHoverLocked(false);
              }}
            >
            <button
              type="button"
              title={micLabel}
              aria-label={micLabel}
              aria-keyshortcuts="Space"
              aria-pressed={voiceModeActive}
              aria-haspopup={showVoicePicker ? 'menu' : undefined}
              aria-expanded={showVoicePicker ? voicePickerOpen : undefined}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onActivateVoice}
              data-testid="toolbar-voice"
              className={`flex items-center justify-center rounded-lg cursor-pointer transition-colors ${
                touchChrome ? 'w-10 h-10' : 'w-8 h-8'
              } ${
                voiceModeActive
                  ? 'text-white bg-[#C2410C] hover:bg-[#a0350a]'
                  : 'text-[#5a5a54] hover:text-[#1a1a1a] hover:bg-[#F4F1ED]'
              }`}
            >
              <Mic className={touchChrome ? 'w-5 h-5' : 'w-4 h-4'} aria-hidden />
            </button>
            {showWaitForChime || showDraftHint || showLiveCaption || showReadyNudge || showPersonaChip ? (
              <div className="pointer-events-none absolute bottom-full left-1/2 z-50 flex w-max max-w-[min(18rem,70vw)] -translate-x-1/2 flex-col items-stretch gap-1.5 pb-4">
                {showWaitForChime ? (
                  <div
                    {...canvasOverlayProps}
                    role="status"
                    aria-live="polite"
                    data-testid="toolbar-voice-wait-chime"
                    className="w-max max-w-[min(18rem,70vw)] shrink-0 rounded-xl border border-[#E6E4DF] bg-white px-3 py-2 shadow-lg"
                  >
                    <div className="whitespace-normal text-sm font-serif leading-snug text-[#1a1a1a]">
                      {t('voice.wait_for_chime')}
                    </div>
                  </div>
                ) : null}
                {showDraftHint ? (
                  <div
                    {...canvasOverlayProps}
                    role="status"
                    aria-live="polite"
                    data-testid="toolbar-voice-draft-hint"
                    className="w-max max-w-[min(18rem,70vw)] shrink-0 rounded-xl border border-[#E6E4DF] bg-white px-3 py-2 shadow-lg"
                  >
                    <div className="whitespace-normal text-sm font-serif leading-snug text-[#1a1a1a]">
                      {t('voice.phase_draft')}
                    </div>
                  </div>
                ) : null}
                {showReadyNudge ? (
                  <div
                    {...canvasOverlayProps}
                    role="status"
                    aria-live="polite"
                    data-testid="toolbar-voice-ready-nudge"
                    className="w-max max-w-[min(18rem,70vw)] shrink-0 rounded-xl border border-[#C2410C]/30 bg-[#FFF7ED] px-3 py-2 shadow-lg"
                  >
                    <div className="whitespace-normal text-sm font-serif leading-snug text-[#C2410C]">
                      {t('voice.ready_to_speak')}
                    </div>
                  </div>
                ) : null}
                {showLiveCaption ? (
                  <div
                    {...canvasOverlayProps}
                    role="status"
                    aria-live="polite"
                    data-testid="toolbar-voice-live-caption"
                    className="w-max max-w-[min(18rem,70vw)] shrink-0 rounded-xl border border-[#E6E4DF] bg-white px-3 py-2 shadow-lg"
                  >
                    <div className="mb-1 text-[9px] font-mono font-bold uppercase tracking-wider text-[#C2410C]">
                      {t('voice.phase_listening')}
                    </div>
                    <div className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-sm font-serif leading-snug text-[#1a1a1a]">
                      {liveTranscript.trim() || '…'}
                    </div>
                  </div>
                ) : null}
                {showPersonaChip ? (
                  <button
                    type="button"
                    title={chipName}
                    aria-label={chipName}
                    aria-haspopup="menu"
                    data-testid="toolbar-voice-persona-chip"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setVoicePickerHoverLocked(false);
                      setVoicePickerOpen(true);
                    }}
                    className="flex max-w-[7.5rem] items-center gap-1 rounded-lg border border-[#E6E4DF] bg-white px-1.5 py-1 shadow-sm hover:border-[#C2410C]/40"
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-md border border-[#E6E4DF] bg-[#FFF7ED]">
                      {pinnedPersona ? (
                        <AgentIcon
                          agentId={pinnedPersona.agentConfigId}
                          coverUrl={pinnedPersona.coverUrl}
                          className="h-full w-full"
                          imageClassName="scale-[1.32]"
                          fallbackClassName="text-[#C2410C]"
                        />
                      ) : (
                        <img src={askFoxUrl} alt="" className="h-full w-full object-cover" />
                      )}
                    </span>
                    <span className="truncate text-[10px] font-bold leading-none text-[#1a1a1a]">
                      {chipName}
                    </span>
                  </button>
                ) : null}
              </div>
            ) : null}
            {showVoicePicker ? (
              <div
                {...canvasOverlayProps}
                role="menu"
                aria-label={t('voice.toolbar_mic_pick')}
                aria-hidden={!voicePickerOpen}
                data-testid="toolbar-voice-personas"
                className={`absolute bottom-full left-1/2 z-50 w-52 -translate-x-1/2 pb-4 transition-all ${
                  voicePickerOpen
                    ? 'visible pointer-events-auto opacity-100'
                    : 'invisible pointer-events-none opacity-0'
                }`}
              >
                <div className="flex max-h-72 flex-col overflow-y-auto overscroll-contain rounded-xl border border-[#E6E4DF] bg-white p-1 shadow-xl">
                  {showAskVoiceOption ? (
                  <button
                    type="button"
                    role="menuitem"
                    aria-checked={pinnedVoiceAgentNodeId === null}
                    data-testid="toolbar-voice-persona-ask"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      selectVoicePersona(null);
                    }}
                    className={`mb-1 flex min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                      pinnedVoiceAgentNodeId === null
                        ? 'bg-[#FFF7ED] text-[#C2410C]'
                        : 'text-[#1a1a1a] hover:bg-[#F4F1ED]'
                    }`}
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-md border border-[#E6E4DF] bg-[#FFF7ED]">
                      <img src={askFoxUrl} alt="" className="h-full w-full object-cover" />
                    </span>
                    <span className="flex-1 truncate font-bold">
                      {t('voice.toolbar_mic_default', { name: t('ask.character_name') })}
                    </span>
                    {pinnedVoiceAgentNodeId === null ? (
                      <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    ) : null}
                  </button>
                  ) : null}
                  {canvasVoicePersonas.map((persona) => {
                    const selected = pinnedVoiceAgentNodeId === persona.nodeId;
                    return (
                      <button
                        key={persona.nodeId}
                        type="button"
                        role="menuitem"
                        aria-checked={selected}
                        data-testid={`toolbar-voice-persona-${persona.nodeId}`}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          selectVoicePersona(persona.nodeId);
                        }}
                        className={`mb-1 flex min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                          selected
                            ? 'bg-[#FFF7ED] text-[#C2410C]'
                            : 'text-[#1a1a1a] hover:bg-[#F4F1ED]'
                        }`}
                      >
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-md border border-[#E6E4DF] bg-[#FFF7ED]">
                          <AgentIcon
                            agentId={persona.agentConfigId}
                            coverUrl={persona.coverUrl}
                            className="h-full w-full"
                            imageClassName="scale-[1.32]"
                            fallbackClassName="text-[#C2410C]"
                          />
                        </span>
                        <span className="flex-1 truncate font-bold">{persona.name}</span>
                        {selected ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
            </div>
            )}
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onPublish}
              disabled={selectedCount < PUBLISH_MIN_SELECTION || publishDisabled}
              title={`${t('sidebar.publish')} (${selectedCount})`}
              aria-label={`${t('sidebar.publish')} (${selectedCount})`}
              data-testid="toolbar-publish"
              className={`flex items-center justify-center rounded-lg transition-colors ${
                touchChrome ? 'w-10 h-10' : 'w-8 h-8'
              } ${
                selectedCount >= PUBLISH_MIN_SELECTION
                  ? 'bg-[#C2410C] text-white hover:bg-[#a0350a] disabled:opacity-50'
                  : 'bg-white text-[#5a5a54] hover:text-[#C2410C] hover:bg-[#F4F1ED] disabled:opacity-50'
              }`}
            >
              {publishBusy ? (
                <Loader2 className={touchChrome ? 'w-5 h-5' : 'w-4 h-4'} aria-hidden />
              ) : (
                <PenLine className={touchChrome ? 'w-5 h-5' : 'w-4 h-4'} aria-hidden />
              )}
            </button>
          </div>

          {/* AI input / send / voice moved to the Ask card on the canvas. */}
        </div>
          </div>
      </div>

      {/* Zoom Controls */}
      <div
        {...canvasOverlayProps}
        className={`fixed flex items-center bg-white/80 backdrop-blur-sm border border-[#E6E4DF] rounded-md shadow-sm font-sans text-[10px] font-bold text-[#8c8a84] z-40 bottom-[max(0.75rem,env(safe-area-inset-bottom))] ${
          compact
            ? 'right-[max(1rem,env(safe-area-inset-right))] px-3 py-2 space-x-2 text-xs'
            : 'right-[max(1.5rem,env(safe-area-inset-right))] px-3 py-1.5 space-x-3'
        }`}
      >
        <button
          type="button"
          className={`hover:text-[#1a1a1a] transition-colors flex items-center justify-center ${
            touchChrome ? 'min-w-9 min-h-9 text-base' : ''
          }`}
          onClick={() => setCanvasTransform((p) => ({ ...p, scale: Math.max(0.1, p.scale / 1.1) }))}
          title={`${t('canvas.zoom')} -`}
          aria-label={`${t('canvas.zoom')} -`}
          data-testid="canvas-zoom-out"
        >
          −
        </button>
        <span className={`flex items-center gap-1 justify-center ${touchChrome ? 'w-14' : 'w-12'}`}>
          <ZoomIn className={touchChrome ? 'w-4 h-4' : 'w-3 h-3'} aria-hidden /> {Math.round(canvasTransform.scale * 100)}%
        </span>
        <button
          type="button"
          className={`hover:text-[#1a1a1a] transition-colors flex items-center justify-center ${
            touchChrome ? 'min-w-9 min-h-9 text-base' : ''
          }`}
          onClick={() => setCanvasTransform((p) => ({ ...p, scale: Math.min(5, p.scale * 1.1) }))}
          title={`${t('canvas.zoom')} +`}
          aria-label={`${t('canvas.zoom')} +`}
          data-testid="canvas-zoom-in"
        >
          +
        </button>
        {onFitCanvas ? (
          <button
            type="button"
            className={`hover:text-[#C2410C] transition-colors flex items-center justify-center border-l border-[#E6E4DF] ${
              touchChrome ? 'min-w-9 min-h-9 pl-3' : 'pl-3'
            }`}
            onClick={onFitCanvas}
            title={t('canvas.fit_view')}
            aria-label={t('canvas.fit_view')}
            data-testid="canvas-fit-view"
          >
            <Scan className={touchChrome ? 'w-4 h-4' : 'w-3.5 h-3.5'} aria-hidden />
          </button>
        ) : null}
      </div>
    </>
  );
}
