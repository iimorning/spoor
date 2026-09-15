import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { AgentsStudio } from '../../src/components/AgentsStudio';
import { db } from '../../src/db';
import type { AgentConfig } from '../../src/db';

const { extractDocumentText } = vi.hoisted(() => ({
  extractDocumentText: vi.fn(async () => '占星讲义正文'),
}));

const callAIMock = vi.fn();

vi.mock('../../src/utils/extractDocumentText', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/extractDocumentText')>();
  return { ...actual, extractDocumentText };
});

vi.mock('../../src/utils/agentMarkdownKnowledge', () => ({
  AGENT_KNOWLEDGE_MAX_FILE_BYTES: 512_000,
  isAgentMarkdownFilename: (name: string) => name.endsWith('.md'),
}));

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, opts?: Record<string, unknown>) => {
        if (key === 'agents.sandbox_title') return `Sandbox: ${opts?.name ?? ''}`;
        if (key === 'agents.message_placeholder') return `Message ${opts?.name ?? ''}`;
        if (key === 'agents.sandbox_empty') return `Empty sandbox for ${opts?.name ?? ''}`;
        if (key === 'agents.studio.from_document_user') return `FROMDOC ${opts?.document ?? ''}`;
        return key;
      },
      i18n: { language: 'en' },
    }),
  };
});

vi.mock('../../src/utils/aiI18n', () => ({
  buildAgentSystemInstruction: () => 'system',
  getLocaleDirective: () => 'locale',
  resolveAgentLocalizedName: (a: AgentConfig) => a.name,
  resolveAgentLocalizedRole: (a: AgentConfig) => a.role,
  resolveAgentSystemPrompt: (a: AgentConfig) => a.prompt,
}));

vi.mock('lucide-react', () => {
  const names = [
    'Plus', 'Search', 'Bot', 'Wand2', 'Send', 'MessageSquare', 'X', 'FileText',
    'FileUp', 'Loader2', 'Trash2', 'RotateCcw', 'Image', 'Share2', 'Sparkles', 'Layers',
  ];
  const icons: Record<string, React.FC> = {};
  for (const name of names) {
    icons[name] = () => {
      const { createElement } = require('react');
      return createElement('svg', { 'data-testid': `icon-${name}` });
    };
  }
  return icons;
});

const agentA: AgentConfig = {
  id: 'agent-a',
  name: 'Agent Alpha',
  role: 'Tester',
  prompt: 'You are alpha',
  temperature: 0.7,
  creativity: 0.4,
};

const agentB: AgentConfig = {
  id: 'agent-b',
  name: 'Agent Beta',
  role: 'Tester',
  prompt: 'You are beta',
  temperature: 0.5,
  creativity: 0.3,
};

const aiConfig = { provider: 'gemini', apiKey: 'k', baseUrl: '', model: 'gemini-2.0-flash' };

function renderStudio(
  agents: AgentConfig[] = [agentA, agentB],
  setAgentConfigs = vi.fn().mockResolvedValue(undefined),
  extra?: { onGenerateCover?: (id: string) => void; generatingCoverAgentId?: string | null },
) {
  return render(
    <AgentsStudio
      agentConfigs={agents}
      setAgentConfigs={setAgentConfigs}
      aiConfig={aiConfig}
      callAI={callAIMock}
      onGenerateCover={extra?.onGenerateCover}
      generatingCoverAgentId={extra?.generatingCoverAgentId}
    />,
  );
}

describe('AgentsStudio 沙盒', () => {
  beforeEach(async () => {
    await db.agentSandboxThreads.clear();
    callAIMock.mockReset();
    callAIMock.mockResolvedValue('Assistant reply');
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('打开沙盒时从 IndexedDB 恢复历史消息', async () => {
    await db.agentSandboxThreads.put({
      agentId: 'agent-a',
      messages: [
        { role: 'user', text: 'Stored question' },
        { role: 'model', text: 'Stored answer' },
      ],
      updatedAt: Date.now(),
    });

    const user = userEvent.setup();
    renderStudio();
    await user.click(screen.getByText('agents.test_sandbox'));

    await waitFor(() => {
      expect(screen.getByText('Stored question')).toBeInTheDocument();
      expect(screen.getByText('Stored answer')).toBeInTheDocument();
    });
  });

  it('发送消息时通过 onStreamChunk 流式更新沙盒回复', async () => {
    callAIMock.mockImplementation(async (opts: { onStreamChunk?: (t: string) => void }) => {
      opts.onStreamChunk?.('Part');
      opts.onStreamChunk?.('Assistant reply');
      return 'Assistant reply';
    });

    const user = userEvent.setup();
    renderStudio();
    await user.click(screen.getByText('agents.test_sandbox'));

    const input = await screen.findByPlaceholderText('Message Agent Alpha');
    await user.type(input, 'Stream test');
    const submitBtn = input.closest('form')!.querySelector('button[type="submit"]') as HTMLButtonElement;
    await user.click(submitBtn);

    await waitFor(() => {
      expect(callAIMock).toHaveBeenCalled();
      expect(callAIMock.mock.calls[0][0].onStreamChunk).toEqual(expect.any(Function));
      expect(screen.getByText('Assistant reply')).toBeInTheDocument();
    });
  });

  it('发送消息后写入 agentSandboxThreads', async () => {
    const user = userEvent.setup();
    renderStudio();
    await user.click(screen.getByText('agents.test_sandbox'));

    const input = await screen.findByPlaceholderText('Message Agent Alpha');
    await user.type(input, 'Hello sandbox');
    const submitBtn = input.closest('form')!.querySelector('button[type="submit"]') as HTMLButtonElement;
    await user.click(submitBtn);

    await waitFor(() => {
      expect(callAIMock).toHaveBeenCalled();
    });
    await waitFor(async () => {
      const row = await db.agentSandboxThreads.get('agent-a');
      expect(row?.messages.some((m) => m.text === 'Hello sandbox')).toBe(true);
      expect(row?.messages.some((m) => m.text === 'Assistant reply')).toBe(true);
    });
  });

  it('清空沙盒删除线程并清空界面', async () => {
    await db.agentSandboxThreads.put({
      agentId: 'agent-a',
      messages: [{ role: 'user', text: 'To clear' }],
      updatedAt: Date.now(),
    });

    const user = userEvent.setup();
    renderStudio();
    await user.click(screen.getByText('agents.test_sandbox'));
    await waitFor(() => expect(screen.getByText('To clear')).toBeInTheDocument());

    const clearBtn = screen.getByLabelText('agents.sandbox_clear_aria');
    await user.click(clearBtn);
    await user.click(screen.getByRole('button', { name: 'dialog.confirm' }));

    await waitFor(() => {
      expect(screen.queryByText('To clear')).not.toBeInTheDocument();
    });
    const row = await db.agentSandboxThreads.get('agent-a');
    expect(row).toBeUndefined();
  });

  it('切换人格后加载对应沙盒记录', async () => {
    await db.agentSandboxThreads.bulkPut([
      {
        agentId: 'agent-a',
        messages: [{ role: 'user', text: 'Only A' }],
        updatedAt: 1,
      },
      {
        agentId: 'agent-b',
        messages: [{ role: 'user', text: 'Only B' }],
        updatedAt: 2,
      },
    ]);

    const user = userEvent.setup();
    renderStudio();
    await user.click(screen.getByText('agents.test_sandbox'));
    await waitFor(() => expect(screen.getByText('Only A')).toBeInTheDocument());

    const betaRow = screen.getByRole('heading', { name: 'Agent Beta' }).closest('[class*="cursor-pointer"]');
    expect(betaRow).toBeTruthy();
    await user.click(betaRow!);
    await waitFor(
      () => {
        expect(screen.getByText('Only B')).toBeInTheDocument();
        expect(screen.queryByText('Only A')).not.toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });
});

describe('AgentsStudio 生成卡片', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('名称旁有生成卡片按钮，不展示插画预览区', () => {
    renderStudio();
    const name = screen.getByLabelText('agents.persona_name');
    const generate = screen.getByTestId('agent-studio-generate-cover');
    expect(generate).toHaveTextContent('agents.card_cover_generate');
    expect(name.compareDocumentPosition(generate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByTestId('agent-studio-cover-empty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agent-studio-cover')).not.toBeInTheDocument();
    expect(screen.queryByText('agents.card_cover')).not.toBeInTheDocument();
  });

  it('点击生成会把当前人格 id 交给 onGenerateCover', async () => {
    const onGenerateCover = vi.fn();
    const user = userEvent.setup();
    renderStudio([agentA, agentB], vi.fn().mockResolvedValue(undefined), { onGenerateCover });
    await user.click(screen.getByTestId('agent-studio-generate-cover'));
    expect(onGenerateCover).toHaveBeenCalledWith('agent-a');
  });

  it('已有封面时名称旁显示封面缩略图，按钮改为重新生成', () => {
    renderStudio([{ ...agentA, coverImageUrl: 'https://img.example/fox.jpg' }]);
    expect(screen.getByTestId('agent-studio-generate-cover')).toHaveTextContent('agents.card_cover_regenerate');
    expect(screen.queryByTestId('agent-studio-clear-cover')).not.toBeInTheDocument();
    const thumbs = screen.getAllByTestId('agent-cover-thumb');
    expect(thumbs.length).toBeGreaterThanOrEqual(1);
    expect(thumbs[0]).toHaveAttribute('src', 'https://img.example/fox.jpg');
  });

  it('单击头像可上传本地图片并写入 coverImageUrl', async () => {
    const setAgentConfigs = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderStudio([agentA], setAgentConfigs);

    expect(screen.getByTestId('agent-studio-upload-cover')).toHaveAttribute(
      'aria-label',
      'agents.card_cover_upload',
    );

    const file = new File(['avatar-bytes'], 'me.png', { type: 'image/png' });
    await user.upload(screen.getByTestId('agent-studio-cover-input'), file);

    await waitFor(() => {
      expect(setAgentConfigs).toHaveBeenCalled();
    });
    const next = setAgentConfigs.mock.calls[0][0] as AgentConfig[];
    expect(next[0].id).toBe('agent-a');
    expect(next[0].coverImageUrl).toMatch(/^data:image\/png;base64,/);
  });
});

describe('AgentsStudio 从文档生成提示词', () => {
  beforeEach(() => {
    callAIMock.mockReset();
    callAIMock.mockResolvedValue('New Enhanced Prompt:\nYou are an astrologer.');
    extractDocumentText.mockReset();
    extractDocumentText.mockResolvedValue('占星讲义正文');
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('名称旁有从文档生成按钮', () => {
    renderStudio();
    const fromDoc = screen.getByTestId('agent-studio-prompt-from-doc');
    const generate = screen.getByTestId('agent-studio-generate-cover');
    expect(fromDoc).toHaveTextContent('agents.prompt_from_doc');
    expect(fromDoc.compareDocumentPosition(generate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('上传 Word 后把 AI 起草的系统提示词写入角色', async () => {
    const setAgentConfigs = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderStudio([agentA], setAgentConfigs);

    const file = new File(['doc-bytes'], 'brief.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    await user.upload(screen.getByTestId('agent-studio-prompt-doc-input'), file);
    await user.click(screen.getByRole('button', { name: 'dialog.confirm' }));

    await waitFor(() => {
      expect(extractDocumentText).toHaveBeenCalled();
      expect(callAIMock).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining('占星讲义正文'),
        }),
      );
    });
    await waitFor(() => {
      expect(setAgentConfigs).toHaveBeenCalled();
    });
    const next = setAgentConfigs.mock.calls.at(-1)?.[0] as AgentConfig[];
    expect(next[0].prompt).toBe('You are an astrologer.');
  });
});

describe('AgentsStudio 系统提示词输入法', () => {
  it('组字过程中不写入，选字后才持久化最终汉字', async () => {
    const setAgentConfigs = vi.fn().mockResolvedValue(undefined);
    renderStudio([agentA], setAgentConfigs);
    const field = screen.getByTestId('agent-studio-system-prompt');

    fireEvent.compositionStart(field);
    fireEvent.change(field, { target: { value: 'You are alpha' + 'ru' } });
    expect(setAgentConfigs).not.toHaveBeenCalled();
    expect(field).toHaveValue('You are alpharu');

    fireEvent.change(field, { target: { value: 'You are alpha如果' } });
    fireEvent.compositionEnd(field);
    expect(setAgentConfigs).toHaveBeenCalled();
    const next = setAgentConfigs.mock.calls.at(-1)?.[0] as AgentConfig[];
    expect(next[0].prompt).toBe('You are alpha如果');
  });
});
