import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { CanvasToolbar } from '../../src/components/CanvasToolbar';
import { db } from '../../src/db';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh', changeLanguage: vi.fn() },
  }),
}));

vi.mock('../../src/db', () => ({
  db: { nodes: { add: vi.fn() } },
}));

vi.mock('../../src/utils/aiI18n', () => ({
  resolveAgentLocalizedName: (a: { name: string }) => a.name,
}));

vi.mock('../../src/utils/canvas', () => ({
  getCanvasCenterPosition: () => ({ x: 0, y: 0 }),
  AGENT_NODE_SIZE: { width: 320, height: 180 },
  PUBLISH_MIN_SELECTION: 2,
}));

vi.mock('lucide-react', () => {
  const names = ['Plus', 'MapPin', 'Bot', 'Edit3', 'ZoomIn', 'Scan', 'FileText', 'Loader2', 'PenLine', 'Check', 'ChevronDown', 'ChevronUp', 'ChevronRight', 'BookOpen', 'X', 'Mic', 'MicOff', 'Square', 'SquareDashed', 'Send', 'Waves', 'AudioLines'] as const;
  const icons: Record<string, React.FC> = {};
  for (const name of names) {
    icons[name] = (props: Record<string, unknown>) => {
      const { createElement } = require('react');
      return createElement('svg', { 'data-testid': `icon-${name}`, ...props });
    };
  }
  return icons;
});

const defaultProps = () => ({
  addTextNode: vi.fn(),
  addThemeNode: vi.fn(),
  addEssayNode: vi.fn(),
  addAskNode: vi.fn(),
  addFileNode: vi.fn(),
  onActivateVoice: vi.fn(),
  voiceModeActive: false,
  agentConfigs: [],
  canvasTransform: { x: 0, y: 0, scale: 1 },
  setCanvasTransform: vi.fn(),
  transformRef: { current: { x: 0, y: 0, scale: 1 } },
  activeCanvasId: 'default',
  onPublish: vi.fn(),
  selectedCount: 0,
});

describe('CanvasToolbar (post Ask-card migration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders the plus button with a Plus icon', () => {
    render(<CanvasToolbar {...defaultProps()} />);
    // The main button + the dropdown menu item both render a Plus icon.
    expect(screen.getAllByTestId('icon-Plus').length).toBeGreaterThanOrEqual(1);
  });

  it('exposes addAskNode in the + dropdown menu', () => {
    render(<CanvasToolbar {...defaultProps()} />);
    expect(screen.getByText('canvas.add_ask_card')).toBeInTheDocument();
  });

  it('exposes a new essay card after the theme entry, not ambience', () => {
    render(<CanvasToolbar {...defaultProps()} />);
    expect(screen.getByTestId('toolbar-plus-new-essay')).toBeInTheDocument();
    expect(screen.getByText('canvas.add_essay_card')).toBeInTheDocument();
    const theme = screen.getByTestId('toolbar-plus-new-theme');
    const essay = screen.getByTestId('toolbar-plus-new-essay');
    const ask = screen.getByTestId('toolbar-plus-add-ask');
    expect(theme.compareDocumentPosition(essay) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(essay.compareDocumentPosition(ask) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('canvas.add_ambience_card')).toBeNull();
    expect(screen.queryByTestId('toolbar-add-ambience')).toBeNull();
  });

  it('clicking the essay entry in the + dropdown fires addEssayNode', async () => {
    const user = userEvent.setup();
    const addEssayNode = vi.fn();
    render(<CanvasToolbar {...defaultProps()} addEssayNode={addEssayNode} />);
    await user.click(screen.getByText('canvas.add_essay_card'));
    expect(addEssayNode).toHaveBeenCalledTimes(1);
  });

  it('clicking the Ask entry in the + dropdown fires addAskNode', async () => {
    const user = userEvent.setup();
    const addAskNode = vi.fn();
    render(<CanvasToolbar {...defaultProps()} addAskNode={addAskNode} />);
    await user.click(screen.getByText('canvas.add_ask_card'));
    expect(addAskNode).toHaveBeenCalledTimes(1);
  });

  it('still wires text + theme entries in the + dropdown', async () => {
    const user = userEvent.setup();
    const addTextNode = vi.fn();
    const addThemeNode = vi.fn();
    render(
      <CanvasToolbar
        {...defaultProps()}
        addTextNode={addTextNode}
        addThemeNode={addThemeNode}
      />,
    );
    await user.click(screen.getByText('sidebar.new_note'));
    expect(addTextNode).toHaveBeenCalledTimes(1);
    await user.click(screen.getByText('sidebar.new_theme_card'));
    expect(addThemeNode).toHaveBeenCalledTimes(1);
  });

  it('nests agent entries in a hover submenu off 角色', () => {
    render(
      <CanvasToolbar
        {...defaultProps()}
        agentConfigs={[
          { id: 'a1', name: 'Mirror', role: '', prompt: '' },
        ]}
      />,
    );
    expect(screen.getByTestId('toolbar-plus-agents')).toBeInTheDocument();
    expect(screen.getByTestId('toolbar-plus-agents-submenu')).toBeInTheDocument();
    expect(screen.getByText('Mirror')).toBeInTheDocument();
  });

  it('drops an agent with a cover at 16:9 size', async () => {
    const user = userEvent.setup();
    render(
      <CanvasToolbar
        {...defaultProps()}
        agentConfigs={[
          { id: 'a1', name: 'Fox', role: '', prompt: '', coverImageUrl: 'https://img.example/fox.jpg' },
        ]}
      />,
    );
    await user.click(screen.getByText('Fox'));
    expect(db.nodes.add).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'agent',
        agentConfigId: 'a1',
        width: 320,
        height: 180,
      }),
    );
  });

  it('drops an agent without a cover without explicit size', async () => {
    const user = userEvent.setup();
    render(
      <CanvasToolbar
        {...defaultProps()}
        agentConfigs={[{ id: 'a1', name: 'Mirror', role: '', prompt: '' }]}
      />,
    );
    await user.click(screen.getByText('Mirror'));
    expect(db.nodes.add).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'agent',
        agentConfigId: 'a1',
      }),
    );
    const payload = vi.mocked(db.nodes.add).mock.calls[0][0] as { width?: number; height?: number };
    expect(payload.width).toBeUndefined();
    expect(payload.height).toBeUndefined();
  });

  it('no longer renders the AI input box / send button / voice chip', () => {
    const { container } = render(<CanvasToolbar {...defaultProps()} />);
    expect(container.querySelector('[placeholder="ai.input_placeholder"]')).toBeNull();
    expect(container.querySelector('[placeholder="voice.input_placeholder"]')).toBeNull();
    expect(screen.queryByText('voice.phase_listening')).toBeNull();
    expect(screen.queryByText('voice.phase_idle')).toBeNull();
  });

  it('renders the toolbar mic button and fires onActivateVoice on click', async () => {
    const user = userEvent.setup();
    const onActivateVoice = vi.fn();
    render(<CanvasToolbar {...defaultProps()} onActivateVoice={onActivateVoice} />);
    const micBtn = screen.getByTestId('toolbar-voice');
    expect(micBtn).toBeInTheDocument();
    expect(micBtn.getAttribute('aria-pressed')).toBe('false');
    await user.click(micBtn);
    expect(onActivateVoice).toHaveBeenCalledTimes(1);
  });

  it('Space on the canvas fires the toolbar mic shortcut', () => {
    const onActivateVoice = vi.fn();
    render(<CanvasToolbar {...defaultProps()} onActivateVoice={onActivateVoice} />);
    expect(screen.getByTestId('toolbar-voice')).toHaveAttribute('aria-keyshortcuts', 'Space');
    fireEvent.keyDown(document.body, { key: ' ', code: 'Space', bubbles: true, cancelable: true });
    expect(onActivateVoice).toHaveBeenCalledTimes(1);
  });

  it('Space does not activate voice while typing, on a button, or with Shift', () => {
    const onActivateVoice = vi.fn();
    render(
      <>
        <textarea data-testid="note-input" />
        <CanvasToolbar {...defaultProps()} onActivateVoice={onActivateVoice} />
      </>,
    );
    const input = screen.getByTestId('note-input');
    input.focus();
    fireEvent.keyDown(input, { key: ' ', code: 'Space', bubbles: true, cancelable: true });
    fireEvent.keyDown(document.body, { key: ' ', code: 'Space', shiftKey: true, bubbles: true, cancelable: true });
    fireEvent.keyDown(screen.getByTestId('toolbar-voice'), {
      key: ' ',
      code: 'Space',
      bubbles: true,
      cancelable: true,
    });
    expect(onActivateVoice).not.toHaveBeenCalled();
  });

  it('toolbar mic shows active (orange) state when voiceModeActive=true', () => {
    render(<CanvasToolbar {...defaultProps()} voiceModeActive />);
    const micBtn = screen.getByTestId('toolbar-voice');
    expect(micBtn.getAttribute('aria-pressed')).toBe('true');
    expect(micBtn.className).toContain('bg-[#C2410C]');
  });

  it('renders publish in the toolbar and fires onPublish', async () => {
    const user = userEvent.setup();
    const onPublish = vi.fn();
    render(<CanvasToolbar {...defaultProps()} onPublish={onPublish} selectedCount={2} />);
    const publishBtn = screen.getByTestId('toolbar-publish');
    expect(publishBtn).toHaveAttribute('title', 'sidebar.publish (2)');
    await user.click(publishBtn);
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  it('publish stays disabled when fewer than two cards are selected', () => {
    const { rerender } = render(<CanvasToolbar {...defaultProps()} selectedCount={0} />);
    expect(screen.getByTestId('toolbar-publish')).toBeDisabled();
    expect(screen.getByTestId('toolbar-publish').className).toContain('bg-white');

    rerender(<CanvasToolbar {...defaultProps()} selectedCount={1} />);
    expect(screen.getByTestId('toolbar-publish')).toBeDisabled();
    expect(screen.getByTestId('toolbar-publish').className).toContain('bg-white');
    expect(screen.getByTestId('toolbar-publish').className).not.toContain('bg-[#C2410C]');
  });

  it('publish lights up when two or more cards are selected', () => {
    render(<CanvasToolbar {...defaultProps()} selectedCount={2} />);
    const publishBtn = screen.getByTestId('toolbar-publish');
    expect(publishBtn).not.toBeDisabled();
    expect(publishBtn.className).toContain('bg-[#C2410C]');
  });

  it('renders as a fixed, bottom-centered toolbar', () => {
    const { container } = render(<CanvasToolbar {...defaultProps()} />);
    const panel = container.querySelector('.fixed') as HTMLElement;
    expect(panel).toHaveClass('bottom-3', 'left-1/2', '-translate-x-1/2');
  });

  it('hides the mic persona picker when the canvas has no agent cards', () => {
    render(<CanvasToolbar {...defaultProps()} />);
    expect(screen.queryByTestId('toolbar-voice-personas')).toBeNull();
  });

  it('lists canvas agent names on the mic picker and pins on click', () => {
    const onSelectVoicePersona = vi.fn();
    const onActivateVoice = vi.fn();
    render(
      <CanvasToolbar
        {...defaultProps()}
        onActivateVoice={onActivateVoice}
        onSelectVoicePersona={onSelectVoicePersona}
        showAskVoiceOption
        canvasVoicePersonas={[
          { nodeId: 'host1', agentConfigId: 'turtle_soup_host', name: '海龟汤主持人' },
          { nodeId: 'host2', agentConfigId: 'intuition_pump_expert', name: '直觉泵专家' },
        ]}
      />,
    );
    expect(screen.getByTestId('toolbar-voice-personas')).toBeInTheDocument();
    expect(screen.getByTestId('toolbar-voice-persona-ask')).toBeInTheDocument();
    expect(screen.getByText('海龟汤主持人')).toBeInTheDocument();
    expect(screen.getByText('直觉泵专家')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('toolbar-voice-persona-host1'));
    expect(onSelectVoicePersona).toHaveBeenCalledWith('host1');
    expect(onActivateVoice).not.toHaveBeenCalled();
    expect(screen.getByTestId('toolbar-voice-personas')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(screen.getByTestId('toolbar-voice-persona-ask'));
    expect(onSelectVoicePersona).toHaveBeenCalledWith(null);
  });

  it('hides the 阿狸 mic option when the canvas has agents but no Ask card', () => {
    render(
      <CanvasToolbar
        {...defaultProps()}
        canvasVoicePersonas={[
          { nodeId: 'host1', agentConfigId: 'turtle_soup_host', name: '海龟汤主持人' },
        ]}
      />,
    );
    expect(screen.getByTestId('toolbar-voice-personas')).toBeInTheDocument();
    expect(screen.queryByTestId('toolbar-voice-persona-ask')).toBeNull();
    expect(screen.getByText('海龟汤主持人')).toBeInTheDocument();
  });

  it('hides the persona chip until voice mode is active', () => {
    const onSelectVoicePersona = vi.fn();
    const { rerender } = render(
      <CanvasToolbar
        {...defaultProps()}
        onSelectVoicePersona={onSelectVoicePersona}
        canvasVoicePersonas={[
          { nodeId: 'host1', agentConfigId: 'turtle_soup_host', name: '海龟汤主持人' },
        ]}
      />,
    );
    expect(screen.queryByTestId('toolbar-voice-persona-chip')).toBeNull();
    fireEvent.click(screen.getByTestId('toolbar-voice-persona-host1'));
    expect(onSelectVoicePersona).toHaveBeenCalledWith('host1');
    expect(screen.getByTestId('toolbar-voice-personas')).toHaveAttribute('aria-hidden', 'true');
    rerender(
      <CanvasToolbar
        {...defaultProps()}
        voiceModeActive
        onSelectVoicePersona={onSelectVoicePersona}
        pinnedVoiceAgentNodeId="host1"
        canvasVoicePersonas={[
          { nodeId: 'host1', agentConfigId: 'turtle_soup_host', name: '海龟汤主持人' },
        ]}
      />,
    );
    expect(screen.getByTestId('toolbar-voice-persona-chip')).toHaveTextContent('海龟汤主持人');
    expect(screen.getByTestId('toolbar-voice-persona-chip').parentElement).toHaveClass('pb-4');
  });

  it('lets a hovered mic picker pin a persona without the menu collapsing', () => {
    const onSelectVoicePersona = vi.fn();
    render(
      <CanvasToolbar
        {...defaultProps()}
        onSelectVoicePersona={onSelectVoicePersona}
        canvasVoicePersonas={[
          { nodeId: 'host1', agentConfigId: 'turtle_soup_host', name: '海龟汤主持人' },
        ]}
      />,
    );
    const group = screen.getByTestId('toolbar-voice').parentElement;
    expect(group).toBeTruthy();
    fireEvent.pointerEnter(group!);
    const picker = screen.getByTestId('toolbar-voice-personas');
    expect(picker).toHaveAttribute('aria-hidden', 'false');
    expect(picker.className).toContain('pb-4');
    expect(picker.className).not.toMatch(/(?:^|\s)mb-4(?:\s|$)/);
    fireEvent.click(screen.getByTestId('toolbar-voice-persona-host1'));
    expect(onSelectVoicePersona).toHaveBeenCalledWith('host1');
    expect(picker).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows live ASR text above the mic while listening', () => {
    render(
      <CanvasToolbar
        {...defaultProps()}
        voiceModeActive
        voicePhase="listening"
        liveTranscript="今天天气真好"
      />,
    );
    expect(screen.getByTestId('toolbar-voice-live-caption')).toHaveTextContent('今天天气真好');
    expect(screen.getByTestId('toolbar-voice-live-caption')).toHaveTextContent('voice.phase_listening');
  });

  it('stacks live ASR above the persona chip while listening', () => {
    render(
      <CanvasToolbar
        {...defaultProps()}
        voiceModeActive
        voicePhase="listening"
        liveTranscript="出一道海龟汤"
        onSelectVoicePersona={vi.fn()}
        canvasVoicePersonas={[
          { nodeId: 'host1', agentConfigId: 'turtle_soup_host', name: '海龟汤主持人' },
        ]}
      />,
    );
    expect(screen.getByTestId('toolbar-voice-live-caption')).toHaveTextContent('出一道海龟汤');
    expect(screen.getByTestId('toolbar-voice-persona-chip')).toBeInTheDocument();
  });

  it('hides the live ASR caption when not listening', () => {
    render(
      <CanvasToolbar
        {...defaultProps()}
        voiceModeActive
        voicePhase="thinking"
        liveTranscript="这段不该显示"
      />,
    );
    expect(screen.queryByTestId('toolbar-voice-live-caption')).toBeNull();
  });

  it('marks the pinned persona as selected', () => {
    render(
      <CanvasToolbar
        {...defaultProps()}
        pinnedVoiceAgentNodeId="host2"
        showAskVoiceOption
        canvasVoicePersonas={[
          { nodeId: 'host1', agentConfigId: 'turtle_soup_host', name: '海龟汤主持人' },
          { nodeId: 'host2', agentConfigId: 'intuition_pump_expert', name: '直觉泵专家' },
        ]}
      />,
    );
    expect(screen.getByTestId('toolbar-voice-persona-host2')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('toolbar-voice-persona-ask')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('toolbar-voice')).toHaveAttribute(
      'aria-label',
      'voice.toolbar_mic_with_persona',
    );
  });

  it('exposes the file upload control for the tour', () => {
    render(<CanvasToolbar {...defaultProps()} />);
    expect(screen.getByTestId('toolbar-upload')).toBeInTheDocument();
  });

  it('asks the user to wait for the chime while the mic is still opening', () => {
    render(<CanvasToolbar {...defaultProps()} voiceModeActive voicePhase="idle" />);
    const waitChime = screen.getByTestId('toolbar-voice-wait-chime');
    expect(waitChime).toHaveTextContent('voice.wait_for_chime');
    expect(waitChime.className).toContain('w-max');
    expect(screen.queryByTestId('toolbar-voice-live-caption')).toBeNull();
  });

  it('nudges first-time users to speak after the chime', () => {
    const { rerender } = render(
      <CanvasToolbar {...defaultProps()} voiceModeActive voicePhase="idle" />,
    );
    expect(screen.getByTestId('toolbar-voice-wait-chime')).toBeInTheDocument();
    rerender(
      <CanvasToolbar
        {...defaultProps()}
        voiceModeActive
        voicePhase="listening"
        liveTranscript="不该盖住开场提示"
      />,
    );
    expect(screen.queryByTestId('toolbar-voice-wait-chime')).toBeNull();
    expect(screen.getByTestId('toolbar-voice-ready-nudge')).toHaveTextContent('voice.ready_to_speak');
    expect(screen.queryByTestId('toolbar-voice-live-caption')).toBeNull();
  });
});
