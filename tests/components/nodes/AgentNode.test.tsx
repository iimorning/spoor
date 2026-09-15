import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { AgentCardEdgeActions, AgentNode, AgentRunAnalysisButton } from '../../../src/components/nodes/AgentNode';
import type { AgentConfig, CanvasNode } from '../../../src/db';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('../../../src/utils/aiI18n', () => ({
  resolveAgentLocalizedName: vi.fn((c: { name: string }) => c.name),
}));

const { AgentIconMock } = vi.hoisted(() => ({
  AgentIconMock: vi.fn(
    ({ agentId, className }: { agentId?: string; className?: string }) =>
      React.createElement('div', { 'data-testid': 'agent-icon', 'data-agent-id': agentId, className }),
  ),
}));
vi.mock('../../../src/components/AgentIcon', () => ({
  AgentIcon: AgentIconMock,
}));

vi.mock('lucide-react', () => ({
  Loader2: (props: Record<string, unknown>) =>
    React.createElement('svg', { 'data-testid': 'icon-Loader2', ...props }),
  Play: (props: Record<string, unknown>) =>
    React.createElement('svg', { 'data-testid': 'icon-Play', ...props }),
  Image: (props: Record<string, unknown>) =>
    React.createElement('svg', { 'data-testid': 'icon-Image', ...props }),
  MessagesSquare: (props: Record<string, unknown>) =>
    React.createElement('svg', { 'data-testid': 'icon-MessagesSquare', ...props }),
}));

function makeNode(overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id: 'a1',
    type: 'agent',
    x: 0,
    y: 0,
    agentConfigId: 'agent-1',
    ...overrides,
  };
}

function makeAgent(id = 'agent-1', name = '研究员'): AgentConfig {
  // role + prompt are required by the AgentConfig interface
  return { id, name, role: 'role', prompt: 'prompt' };
}

describe('AgentNode', () => {
  beforeEach(() => {
    AgentIconMock.mockClear();
  });

  describe('render basics', () => {
    it('falls back to "Agent" title when no matching agent config exists', () => {
      render(
        <AgentNode
          node={makeNode({ agentConfigId: 'nonexistent' })}
          agentConfigs={[]}
          editingNodeId={null}
          setEditingNodeId={vi.fn()}
        />,
      );
      expect(screen.getByText('Agent')).toBeInTheDocument();
    });

    it('falls back to "Agent" when agentConfigs is empty array', () => {
      render(
        <AgentNode
          node={makeNode()}
          agentConfigs={[]}
          editingNodeId={null}
          setEditingNodeId={vi.fn()}
        />,
      );
      expect(screen.getByText('Agent')).toBeInTheDocument();
    });

    it('uses the matching config name when found', () => {
      render(
        <AgentNode
          node={makeNode()}
          agentConfigs={[makeAgent('agent-1', '历史学家'), makeAgent('agent-2', '科学家')]}
          editingNodeId={null}
          setEditingNodeId={vi.fn()}
        />,
      );
      expect(screen.getByText('历史学家')).toBeInTheDocument();
      expect(screen.queryByText('科学家')).not.toBeInTheDocument();
    });
  });

  describe('AgentIcon', () => {
    it('passes the agent id to AgentIcon', () => {
      render(
        <AgentNode
          node={makeNode({ agentConfigId: 'agent-1' })}
          agentConfigs={[makeAgent('agent-1', 'A')]}
          editingNodeId={null}
          setEditingNodeId={vi.fn()}
        />,
      );
      const icon = screen.getByTestId('agent-icon');
      expect(icon).toHaveAttribute('data-agent-id', 'agent-1');
    });

    it('passes undefined when no matching config is found', () => {
      render(
        <AgentNode
          node={makeNode({ agentConfigId: undefined })}
          agentConfigs={[]}
          editingNodeId={null}
          setEditingNodeId={vi.fn()}
        />,
      );
      const icon = screen.getByTestId('agent-icon');
      expect(icon.getAttribute('data-agent-id')).toBeFalsy();
    });
  });

  describe('AgentRunAnalysisButton', () => {
    it('renders a labeled pill for analysis beside Ask AI', () => {
      render(<AgentRunAnalysisButton onRunAnalysis={vi.fn()} />);
      const run = screen.getByTestId('agent-run-analysis');
      expect(run).toHaveAttribute('title', 'nodes.agent_run_analysis');
      expect(run).toHaveTextContent('nodes.agent_run_analysis_hint');
      expect(run.className).toContain('rounded-full');
      expect(run.className).toContain('h-7');
    });

    it('is disabled when disabled is true', () => {
      render(<AgentRunAnalysisButton onRunAnalysis={vi.fn()} disabled />);
      expect(screen.getByTestId('agent-run-analysis')).toBeDisabled();
    });

    it('calls onRunAnalysis exactly once when clicked and enabled', async () => {
      const onRun = vi.fn();
      const user = userEvent.setup();
      render(<AgentRunAnalysisButton onRunAnalysis={onRun} />);
      await user.click(screen.getByTestId('agent-run-analysis'));
      expect(onRun).toHaveBeenCalledTimes(1);
    });

    it('does NOT call onRunAnalysis when disabled', async () => {
      const onRun = vi.fn();
      const user = userEvent.setup();
      render(<AgentRunAnalysisButton onRunAnalysis={onRun} disabled />);
      await user.click(screen.getByTestId('agent-run-analysis'));
      expect(onRun).not.toHaveBeenCalled();
    });
  });

  describe('AgentCardEdgeActions', () => {
    it('does NOT render discussion when canStartDiscussion is false', () => {
      render(<AgentCardEdgeActions onStartDiscussion={vi.fn()} />);
      expect(screen.queryByTestId('agent-start-discussion')).not.toBeInTheDocument();
    });

    it('renders an archive-sized round discussion button', () => {
      render(
        <AgentCardEdgeActions
          onStartDiscussion={vi.fn()}
          canStartDiscussion
        />,
      );
      const talk = screen.getByTestId('agent-start-discussion');
      expect(talk).toHaveAttribute('title', 'nodes.agent_start_discussion');
      expect(talk.className).toContain('w-6');
      expect(talk.className).toContain('rounded-full');
    });
  });

  describe('analyzing overlay', () => {
    it('does NOT render the overlay when isAnalyzing is false', () => {
      render(
        <AgentNode
          node={makeNode()}
          agentConfigs={[makeAgent()]}
          editingNodeId={null}
          setEditingNodeId={vi.fn()}
        />,
      );
      expect(screen.queryByTestId('agent-analyzing-overlay')).not.toBeInTheDocument();
    });

    it('renders the overlay + spinner when isGeneratingCover is true', () => {
      render(
        <AgentNode
          node={makeNode()}
          agentConfigs={[makeAgent()]}
          isGeneratingCover
          editingNodeId={null}
          setEditingNodeId={vi.fn()}
        />,
      );
      expect(screen.getByTestId('agent-analyzing-overlay')).toBeInTheDocument();
    });
  });

  describe('card cover', () => {
    it('does not render generate, analysis, or discussion on the card body', () => {
      render(
        <AgentNode
          node={makeNode()}
          agentConfigs={[makeAgent()]}
          editingNodeId={null}
          setEditingNodeId={vi.fn()}
        />,
      );
      expect(screen.queryByTestId('agent-generate-cover')).not.toBeInTheDocument();
      expect(screen.queryByTestId('agent-run-analysis')).not.toBeInTheDocument();
      expect(screen.queryByTestId('agent-start-discussion')).not.toBeInTheDocument();
    });

    it('shows the cover image and hides the title when coverImageUrl is set', () => {
      render(
        <AgentNode
          node={makeNode()}
          agentConfigs={[{ ...makeAgent(), coverImageUrl: 'https://img.example/fox.jpg' }]}
          editingNodeId={null}
          setEditingNodeId={vi.fn()}
        />,
      );
      expect(screen.getByTestId('agent-cover')).toHaveAttribute('src', 'https://img.example/fox.jpg');
      expect(screen.queryByText('研究员')).not.toBeInTheDocument();
      expect(screen.queryByTestId('agent-icon')).not.toBeInTheDocument();
    });
  });
});
